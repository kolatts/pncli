using System.Collections.Concurrent;
using System.Net;
using System.Text.Json;
using Feedback.Models;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Http;
using Microsoft.Extensions.Logging;
using Octokit;

namespace Feedback;

public class SubmitFunction(ILogger<SubmitFunction> logger)
{
    // Per-IP token bucket. Cold starts reset it — acceptable for a starter.
    private static readonly ConcurrentDictionary<string, (int Tokens, DateTimeOffset LastRefill)> _buckets = new();
    private static readonly object _bucketsLock = new();
    private const int MaxTokens = 5;
    private static readonly TimeSpan RefillPeriod = TimeSpan.FromMinutes(1);

    [Function("Submit")]
    public async Task<HttpResponseData> Run(
        [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "submit")] HttpRequestData req)
    {
        // ── Parse body ────────────────────────────────────────────────────────
        FeedbackRequest? feedback;
        try { feedback = await req.ReadFromJsonAsync<FeedbackRequest>(); }
        catch { return await JsonResponse(req, HttpStatusCode.BadRequest, new { ok = false, error = "Invalid JSON body" }); }

        if (feedback is null)
            return await JsonResponse(req, HttpStatusCode.BadRequest, new { ok = false, error = "Missing request body" });

        // ── Honeypot ─────────────────────────────────────────────────────────
        if (!string.IsNullOrEmpty(feedback.Hp))
        {
            logger.LogInformation("Honeypot triggered — silent 200");
            return req.CreateResponse(HttpStatusCode.OK);
        }

        // ── Origin check ─────────────────────────────────────────────────────
        var allowedOrigin = Environment.GetEnvironmentVariable("ALLOWED_ORIGIN") ?? "";
        if (!req.Headers.TryGetValues("Origin", out var origins) || !origins.Contains(allowedOrigin))
        {
            logger.LogWarning("Origin check failed");
            return req.CreateResponse(HttpStatusCode.Forbidden);
        }

        // ── Validation ───────────────────────────────────────────────────────
        if (feedback.Kind is not ("bug" or "feature"))
            return await JsonResponse(req, HttpStatusCode.BadRequest, new { ok = false, error = "kind must be 'bug' or 'feature'" });
        if (string.IsNullOrWhiteSpace(feedback.Title) || feedback.Title.Length > 120)
            return await JsonResponse(req, HttpStatusCode.BadRequest, new { ok = false, error = "title must be 1–120 characters" });
        if (string.IsNullOrWhiteSpace(feedback.Body))
            return await JsonResponse(req, HttpStatusCode.BadRequest, new { ok = false, error = "body is required" });
        if (string.IsNullOrWhiteSpace(feedback.Email) || !IsValidEmail(feedback.Email))
            return await JsonResponse(req, HttpStatusCode.BadRequest, new { ok = false, error = "a valid email address is required" });

        // ── Rate limit ───────────────────────────────────────────────────────
        var ip = req.Headers.TryGetValues("X-Forwarded-For", out var fwd)
            ? fwd.First().Split(',')[0].Trim()
            : "unknown";

        if (!TryConsumeToken(ip))
        {
            logger.LogWarning("Rate limit exceeded for {IP}", ip);
            return await JsonResponse(req, (HttpStatusCode)429,
                new { ok = false, error = "Rate limit exceeded. Please try again later." });
        }

        // ── Create GitHub issue ───────────────────────────────────────────────
        var token     = Environment.GetEnvironmentVariable("GITHUB_TOKEN") ?? "";
        var repoStr   = Environment.GetEnvironmentVariable("GITHUB_REPO")  ?? "kolatts/pncli";
        var label     = Environment.GetEnvironmentVariable("GITHUB_ISSUE_LABEL") ?? "from-website";
        var repoParts = repoStr.Split('/');

        var title = string.IsNullOrEmpty(feedback.Version)
            ? feedback.Title
            : $"Re: v{feedback.Version} — {feedback.Title}";

        var body = feedback.Body
            + (string.IsNullOrEmpty(feedback.Service) ? "" : $"\n\n**Service:** {feedback.Service}")
            + $"\n\n**Contact:** {feedback.Email}"
            + "\n\n---\n*Submitted via [kolatts.github.io/pncli](https://kolatts.github.io/pncli)*";

        try
        {
            var github = new GitHubClient(new ProductHeaderValue("pncli-site"))
            {
                Credentials = new Credentials(token)
            };

            var issue = new NewIssue(title) { Body = body };
            issue.Labels.Add(label);
            issue.Labels.Add(feedback.Kind == "bug" ? "bug" : "enhancement");

            var created = await github.Issue.Create(repoParts[0], repoParts[1], issue);
            logger.LogInformation("Created issue #{Number}", created.Number);

            return await JsonResponse(req, HttpStatusCode.Created,
                new { ok = true, issueUrl = created.HtmlUrl });
        }
        catch (Exception ex)
        {
            var incidentId = Guid.NewGuid().ToString("N")[..8].ToUpperInvariant();
            logger.LogError(ex, "Failed to create issue. Incident={Id}", incidentId);
            return await JsonResponse(req, HttpStatusCode.InternalServerError,
                new { ok = false, error = $"Internal error. Reference: {incidentId}" });
        }
    }

    private static bool TryConsumeToken(string ip)
    {
        lock (_bucketsLock)
        {
            var now = DateTimeOffset.UtcNow;

            if (!_buckets.TryGetValue(ip, out var bucket))
            {
                _buckets[ip] = (MaxTokens - 1, now);
                return true;
            }

            var (tokens, lastRefill) = bucket;

            if (now - lastRefill >= RefillPeriod)
            {
                _buckets[ip] = (MaxTokens - 1, now);
                return true;
            }

            if (tokens <= 0) return false;

            _buckets[ip] = (tokens - 1, lastRefill);
            return true;
        }
    }

    private static bool IsValidEmail(string email)
    {
        try { _ = new System.Net.Mail.MailAddress(email); return true; }
        catch { return false; }
    }

    private static async Task<HttpResponseData> JsonResponse(HttpRequestData req, HttpStatusCode status, object payload)
    {
        var response = req.CreateResponse(status);
        response.Headers.Add("Content-Type", "application/json; charset=utf-8");
        await response.WriteStringAsync(JsonSerializer.Serialize(payload));
        return response;
    }
}
