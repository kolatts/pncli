using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Feedback.Models;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Http;
using Microsoft.Extensions.Logging;

namespace Feedback;

public class SubmitFunction(
    ILogger<SubmitFunction> logger,
    TurnstileVerifier turnstile,
    TableStorageRateLimiter rateLimiter,
    PendingSubmissionStore pendingSubmissions)
{
    /// <summary>
    /// Header carrying the maintainer smoke-test key. A matching key skips the
    /// Turnstile call and nothing else — see <see cref="IsSmokeTest"/>.
    /// </summary>
    public const string SmokeTestHeader = "X-Smoke-Test-Key";

    [Function("Submit")]
    public async Task<HttpResponseData> Run(
        [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "submit")] HttpRequestData req)
    {
        // ── Parse body ────────────────────────────────────────────────────────
        FeedbackRequest? feedback;
        try { feedback = await req.ReadFromJsonAsync<FeedbackRequest>(); }
        catch { return await ErrorAsync(req, HttpStatusCode.BadRequest, "Invalid JSON body"); }

        if (feedback is null)
            return await ErrorAsync(req, HttpStatusCode.BadRequest, "Missing request body");

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
            return await ErrorAsync(req, HttpStatusCode.BadRequest, "kind must be 'bug' or 'feature'");
        if (string.IsNullOrWhiteSpace(feedback.Title) || feedback.Title.Length > 120)
            return await ErrorAsync(req, HttpStatusCode.BadRequest, "title must be 1–120 characters");
        if (string.IsNullOrWhiteSpace(feedback.Body) || feedback.Body.Length > 4000)
            return await ErrorAsync(req, HttpStatusCode.BadRequest, "body must be 1–4000 characters");
        if (string.IsNullOrWhiteSpace(feedback.Email) || feedback.Email.Length > 254 || !IsValidEmail(feedback.Email))
            return await ErrorAsync(req, HttpStatusCode.BadRequest, "A valid email address is required");
        if (feedback.Version is { Length: > 20 })
            return await ErrorAsync(req, HttpStatusCode.BadRequest, "version must be 20 characters or fewer");

        // ── Resolve IP ───────────────────────────────────────────────────────
        var ip = req.Headers.TryGetValues("X-Forwarded-For", out var fwd)
            ? fwd.First().Split(',')[0].Trim()
            : "unknown";

        // ── CAPTCHA (or maintainer smoke-test key) ───────────────────────────
        // The smoke path replaces only this step. Origin, validation and the
        // per-IP limit below still apply, so a leaked key buys a CAPTCHA bypass
        // at ten submissions a day, not a spam channel.
        var isSmokeTest = IsSmokeTest(req);
        if (isSmokeTest)
        {
            logger.LogInformation("Smoke-test key accepted — skipping Turnstile for {IP}", ip);
        }
        else if (!await turnstile.VerifyAsync(feedback.TurnstileToken, ip))
        {
            logger.LogWarning("Turnstile verification failed for {IP}", ip);
            return await ErrorAsync(req, HttpStatusCode.BadRequest,
                "CAPTCHA verification failed. Please try again.");
        }

        // ── Per-IP daily limit ────────────────────────────────────────────────
        var ipDailyLimit = int.TryParse(
            Environment.GetEnvironmentVariable("IP_DAILY_LIMIT"), out var idl) ? idl : 10;

        if (!await rateLimiter.TryConsumeAsync(ip, ipDailyLimit))
        {
            logger.LogWarning("Daily limit ({Limit}) exceeded for {IP}", ipDailyLimit, ip);
            return await ErrorAsync(req, (HttpStatusCode)429,
                "You've already submitted feedback today. Please try again tomorrow.");
        }

        // ── Store pending submission ──────────────────────────────────────────
        var entity = new PendingSubmissionEntity
        {
            PartitionKey = DateTimeOffset.UtcNow.ToString("yyyy-MM-dd"),
            RowKey       = Guid.NewGuid().ToString("N"),
            Kind         = feedback.Kind,
            Title        = feedback.Title,
            Body         = feedback.Body,
            Email        = feedback.Email,
            Service      = feedback.Service,
            Version      = feedback.Version,
            SmokeTest    = isSmokeTest,
            SubmittedAt  = DateTimeOffset.UtcNow,
        };

        await pendingSubmissions.AddAsync(entity);
        logger.LogInformation("Stored pending submission: {Title}", feedback.Title);

        var response = req.CreateResponse(HttpStatusCode.Accepted);
        response.Headers.Add("Content-Type", "application/json; charset=utf-8");
        await response.WriteStringAsync(JsonSerializer.Serialize(new
        {
            ok      = true,
            message = "Thanks! Your feedback has been received and will be reviewed shortly.",
        }));

        return response;
    }

    /// <summary>
    /// True when the request carries <see cref="SmokeTestHeader"/> matching the
    /// <c>SMOKE_TEST_KEY</c> app setting (a Key Vault reference in production).
    /// Unset setting means the path is disabled — no header can match.
    /// Comparison is fixed-time so the key cannot be recovered byte by byte.
    /// </summary>
    private static bool IsSmokeTest(HttpRequestData req)
    {
        var expected = Environment.GetEnvironmentVariable("SMOKE_TEST_KEY");
        if (string.IsNullOrEmpty(expected))
            return false;
        if (!req.Headers.TryGetValues(SmokeTestHeader, out var values))
            return false;

        var provided = values.FirstOrDefault() ?? "";
        return CryptographicOperations.FixedTimeEquals(
            Encoding.UTF8.GetBytes(provided),
            Encoding.UTF8.GetBytes(expected));
    }

    private static bool IsValidEmail(string email)
    {
        try { _ = new System.Net.Mail.MailAddress(email); return true; }
        catch { return false; }
    }

    private static async Task<HttpResponseData> ErrorAsync(
        HttpRequestData req, HttpStatusCode status, string message)
    {
        var response = req.CreateResponse(status);
        response.Headers.Add("Content-Type", "application/json; charset=utf-8");
        await response.WriteStringAsync(JsonSerializer.Serialize(new { ok = false, error = message }));
        return response;
    }
}
