using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Feedback.Models;
using Feedback.Services;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Http;
using Microsoft.Extensions.Logging;
using Octokit;

namespace Feedback;

/// <summary>
/// Receives GitHub issue webhook events and sends a closed-notification email
/// to the original submitter when a from-website issue is closed.
/// Authenticated via HMAC-SHA256 signature in the X-Hub-Signature-256 header.
/// </summary>
public class IssueWebhookFunction(
    ILogger<IssueWebhookFunction> logger,
    IssueEmailStore issueEmailStore,
    GitHubClient github,
    EmailService? emailService = null)
{
    [Function("IssueWebhook")]
    public async Task<HttpResponseData> Run(
        [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "webhook/issue")] HttpRequestData req)
    {
        // ── Read raw body (needed for HMAC verification) ──────────────────────
        var bodyBytes = await BinaryData.FromStreamAsync(req.Body);
        var bodyString = bodyBytes.ToString();

        // ── HMAC-SHA256 signature verification ────────────────────────────────
        var secret = Environment.GetEnvironmentVariable("WEBHOOK_API_KEY") ?? "";
        if (string.IsNullOrEmpty(secret))
        {
            logger.LogError("WEBHOOK_API_KEY not configured");
            return req.CreateResponse(HttpStatusCode.InternalServerError);
        }

        if (!req.Headers.TryGetValues("X-Hub-Signature-256", out var sigs))
        {
            logger.LogWarning("Missing X-Hub-Signature-256 header");
            return req.CreateResponse(HttpStatusCode.Unauthorized);
        }

        var receivedSig = sigs.FirstOrDefault() ?? "";
        var expectedSig = "sha256=" + ComputeHmacSha256(secret, bodyString);

        if (!CryptographicOperations.FixedTimeEquals(
                Encoding.UTF8.GetBytes(receivedSig),
                Encoding.UTF8.GetBytes(expectedSig)))
        {
            logger.LogWarning("Webhook signature mismatch");
            return req.CreateResponse(HttpStatusCode.Unauthorized);
        }

        // ── Parse payload ─────────────────────────────────────────────────────
        GitHubWebhookPayload? payload;
        try { payload = JsonSerializer.Deserialize<GitHubWebhookPayload>(bodyString); }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Could not parse webhook payload");
            return req.CreateResponse(HttpStatusCode.BadRequest);
        }

        if (payload?.Issue is null)
            return req.CreateResponse(HttpStatusCode.OK);

        if (payload.Action != "closed")
        {
            logger.LogInformation("Ignoring action '{Action}' for issue #{Number}", payload.Action, payload.Issue.Number);
            return req.CreateResponse(HttpStatusCode.OK);
        }

        // The persisted mapping is authoritative: it is created only for issues
        // submitted through the website and is not affected by mutable labels.
        var mapping = await issueEmailStore.GetAsync(payload.Issue.Number);
        if (mapping is null)
        {
            logger.LogInformation("No email mapping for issue #{Number} — skipping notification", payload.Issue.Number);
            return req.CreateResponse(HttpStatusCode.OK);
        }

        // ── Fetch last comment as closing context ─────────────────────────────
        string? closingComment = null;
        try
        {
            var repoStr = Environment.GetEnvironmentVariable("GITHUB_REPO") ?? "kolatts/pncli";
            var parts   = repoStr.Split('/');
            if (parts.Length == 2)
            {
                var comments = await github.Issue.Comment.GetAllForIssue(parts[0], parts[1], payload.Issue.Number);
                closingComment = comments.LastOrDefault()?.Body;
            }
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Could not fetch closing comment for issue #{Number}", payload.Issue.Number);
        }

        // ── Send closed notification ──────────────────────────────────────────
        if (emailService is null)
        {
            logger.LogError("EmailService not configured — cannot send closed notification for issue #{Number}", payload.Issue.Number);
            return req.CreateResponse(HttpStatusCode.InternalServerError);
        }

        var sent = await emailService.SendClosedNotificationAsync(
            mapping.Email,
            payload.Issue.Number,
            payload.Issue.HtmlUrl,
            mapping.Title,
            payload.Issue.StateReason,
            closingComment);

        if (!sent)
        {
            logger.LogError("Failed to send closed notification for issue #{Number} — returning 500 for GitHub retry", payload.Issue.Number);
            return req.CreateResponse(HttpStatusCode.InternalServerError);
        }

        return req.CreateResponse(HttpStatusCode.OK);
    }

    private static string ComputeHmacSha256(string secret, string payload)
    {
        var keyBytes     = Encoding.UTF8.GetBytes(secret);
        var payloadBytes = Encoding.UTF8.GetBytes(payload);
        var hash         = HMACSHA256.HashData(keyBytes, payloadBytes);
        return Convert.ToHexString(hash).ToLowerInvariant();
    }
}
