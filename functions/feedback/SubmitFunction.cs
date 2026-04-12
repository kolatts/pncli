using System.Net;
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
    DailyCounter dailyCounter)
{
    private const int DefaultDailyLimit = 100;

    [Function("Submit")]
    public async Task<SubmitResult> Run(
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
            return new SubmitResult { HttpResponse = req.CreateResponse(HttpStatusCode.OK) };
        }

        // ── Origin check ─────────────────────────────────────────────────────
        var allowedOrigin = Environment.GetEnvironmentVariable("ALLOWED_ORIGIN") ?? "";
        if (!req.Headers.TryGetValues("Origin", out var origins) || !origins.Contains(allowedOrigin))
        {
            logger.LogWarning("Origin check failed");
            return new SubmitResult { HttpResponse = req.CreateResponse(HttpStatusCode.Forbidden) };
        }

        // ── Validation ───────────────────────────────────────────────────────
        if (feedback.Kind is not ("bug" or "feature"))
            return await ErrorAsync(req, HttpStatusCode.BadRequest, "kind must be 'bug' or 'feature'");
        if (string.IsNullOrWhiteSpace(feedback.Title) || feedback.Title.Length > 120)
            return await ErrorAsync(req, HttpStatusCode.BadRequest, "title must be 1–120 characters");
        if (string.IsNullOrWhiteSpace(feedback.Body))
            return await ErrorAsync(req, HttpStatusCode.BadRequest, "body is required");
        if (feedback.Body.Length > 4000)
            return await ErrorAsync(req, HttpStatusCode.BadRequest, "body must be 4000 characters or fewer");

        // ── Resolve IP ───────────────────────────────────────────────────────
        var ip = req.Headers.TryGetValues("X-Forwarded-For", out var fwd)
            ? fwd.First().Split(',')[0].Trim()
            : "unknown";

        // ── CAPTCHA ──────────────────────────────────────────────────────────
        if (!await turnstile.VerifyAsync(feedback.TurnstileToken, ip))
        {
            logger.LogWarning("Turnstile verification failed for {IP}", ip);
            return await ErrorAsync(req, HttpStatusCode.BadRequest,
                "CAPTCHA verification failed. Please try again.");
        }

        // ── Per-IP rate limit ────────────────────────────────────────────────
        if (!await rateLimiter.TryConsumeAsync(ip))
        {
            logger.LogWarning("Rate limit exceeded for {IP}", ip);
            return await ErrorAsync(req, (HttpStatusCode)429,
                "Rate limit exceeded. Please try again later.");
        }

        // ── Global daily cap ─────────────────────────────────────────────────
        var dailyLimit = int.TryParse(
            Environment.GetEnvironmentVariable("DAILY_SUBMISSION_LIMIT"), out var dl) ? dl : DefaultDailyLimit;

        if (!await dailyCounter.TryIncrementAsync(dailyLimit))
        {
            logger.LogWarning("Daily submission cap ({Limit}) reached", dailyLimit);
            return await ErrorAsync(req, (HttpStatusCode)429,
                "Daily submission limit reached. Please try again tomorrow.");
        }

        // ── Enqueue for async processing ─────────────────────────────────────
        var queued = new QueuedSubmission
        {
            Kind    = feedback.Kind,
            Title   = feedback.Title,
            Body    = feedback.Body,
            Service = feedback.Service,
            Version = feedback.Version,
        };

        logger.LogInformation("Enqueuing submission: {Title}", feedback.Title);

        var response = req.CreateResponse(HttpStatusCode.Accepted);
        response.Headers.Add("Content-Type", "application/json; charset=utf-8");
        await response.WriteStringAsync(JsonSerializer.Serialize(new
        {
            ok      = true,
            message = "Thanks! Your feedback has been received and will be processed shortly.",
        }));

        return new SubmitResult
        {
            QueueMessage = JsonSerializer.Serialize(queued),
            HttpResponse = response,
        };
    }

    private static async Task<SubmitResult> ErrorAsync(
        HttpRequestData req, HttpStatusCode status, string message)
    {
        var response = req.CreateResponse(status);
        response.Headers.Add("Content-Type", "application/json; charset=utf-8");
        await response.WriteStringAsync(JsonSerializer.Serialize(new { ok = false, error = message }));
        return new SubmitResult { HttpResponse = response };
    }
}

public class SubmitResult
{
    [QueueOutput("feedback-submissions", Connection = "AzureWebJobsStorage")]
    public string? QueueMessage { get; set; }

    [HttpResult]
    public HttpResponseData? HttpResponse { get; set; }
}
