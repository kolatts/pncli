using Feedback.Models;
using Feedback.Services;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Extensions.Logging;
using Octokit;

namespace Feedback;

/// <summary>
/// Runs every minute and promotes pending submissions into GitHub issues,
/// up to the configured daily cap. Submissions that fail are left in the
/// pending state and retried on the next tick.
/// </summary>
public class ProcessSubmissionsFunction(
    ILogger<ProcessSubmissionsFunction> logger,
    PendingSubmissionStore pendingSubmissions,
    IssueEmailStore issueEmailStore,
    GitHubClient github,
    EmailService? emailService = null)
{
    private const int DefaultDailyLimit = 10;

    /// <summary>How long a submission may stay unconverted before it counts as stuck.</summary>
    private const int DefaultStaleMinutes = 15;

    [Function("ProcessSubmissions")]
    public async Task Run([TimerTrigger("0 * * * * *")] TimerInfo timer)
    {
        var pending = await pendingSubmissions.GetAllPendingAsync();
        if (pending.Count == 0)
        {
            logger.LogInformation("No pending submissions");
            return;
        }

        var dailyLimit       = int.TryParse(
            Environment.GetEnvironmentVariable("DAILY_SUBMISSION_LIMIT"), out var dl) ? dl : DefaultDailyLimit;
        var allToday         = await pendingSubmissions.GetAllTodayAsync();
        var alreadyProcessed = allToday.Count(e => e.Processed);
        var slotsRemaining   = dailyLimit - alreadyProcessed;

        if (slotsRemaining <= 0)
        {
            logger.LogInformation("Daily issue limit ({Limit}) already reached", dailyLimit);
            return;
        }

        logger.LogInformation(
            "{Pending} pending, {Processed}/{Limit} processed today — will process up to {Slots}",
            pending.Count, alreadyProcessed, dailyLimit, slotsRemaining);

        var repoStr = Environment.GetEnvironmentVariable("GITHUB_REPO")  ?? "kolatts/pncli";
        var label   = Environment.GetEnvironmentVariable("GITHUB_ISSUE_LABEL") ?? "from-website";
        var parts   = repoStr.Split('/');
        if (parts.Length != 2)
        {
            logger.LogError("GITHUB_REPO must be in 'owner/repo' format, got: {Repo}", repoStr);
            return; // config error — don't retry
        }

        var processedCount = 0;
        var attempted = pending.Take(slotsRemaining).ToList();
        foreach (var submission in attempted)
        {
            var title = string.IsNullOrEmpty(submission.Version)
                ? submission.Title
                : $"Re: v{submission.Version} — {submission.Title}";

            var body = "A user on the website submitted:\n\n"
                + submission.Body
                + (string.IsNullOrEmpty(submission.Service) ? "" : $"\n\n**Service:** {submission.Service}")
                + "\n\n---\n*Submitted via [kolatts.github.io/pncli](https://kolatts.github.io/pncli)*";

            var newIssue = new NewIssue(title) { Body = body };
            newIssue.Labels.Add(label);
            newIssue.Labels.Add(submission.Kind == "bug" ? "bug" : "enhancement");

            try
            {
                var created = await github.Issue.Create(parts[0], parts[1], newIssue);
                logger.LogInformation("Created issue #{Number}: {Title}", created.Number, created.Title);

                await pendingSubmissions.MarkProcessedAsync(submission, created.Number);

                if (!string.IsNullOrEmpty(submission.Email))
                {
                    await issueEmailStore.SaveAsync(created.Number, submission.Email, submission.Title);

                    if (emailService is not null)
                    {
                        await emailService.SendConfirmationAsync(
                            submission.Email,
                            created.Number,
                            created.HtmlUrl,
                            submission.Title);
                    }
                }

                processedCount++;
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "Failed to process submission {RowKey} — will retry next run", submission.RowKey);
                // Leave as pending so it's retried on the next tick
            }
        }

        logger.LogInformation("Processed {Count} submission(s) this run", processedCount);

        ReportBacklog(attempted);
    }

    /// <summary>
    /// Emits the one signal that deterministically means "a user's submission did
    /// not become a GitHub issue".
    ///
    /// Scoped to the submissions this run actually attempted, which is what makes
    /// it precise. Rows deferred by the daily cap are excluded by construction —
    /// they are never in <paramref name="attempted"/> — so a legitimately
    /// over-cap day cannot raise a false alarm. The age threshold keeps a single
    /// transient GitHub or storage blip from alerting; only a submission that has
    /// survived roughly <c>STALE_SUBMISSION_MINUTES</c> worth of one-minute
    /// retries and is still unconverted counts as stuck.
    ///
    /// MarkProcessedAsync sets Processed on the in-memory entity, so this reads
    /// post-loop state without a second table query.
    /// </summary>
    private void ReportBacklog(List<PendingSubmissionEntity> attempted)
    {
        var staleAfter = int.TryParse(
            Environment.GetEnvironmentVariable("STALE_SUBMISSION_MINUTES"), out var sm)
            ? sm : DefaultStaleMinutes;

        var now = DateTimeOffset.UtcNow;
        var stuck = attempted.Count(s => !s.Processed && (now - s.SubmittedAt).TotalMinutes > staleAfter);
        var oldestUnconverted = attempted
            .Where(s => !s.Processed)
            .Select(s => (int)(now - s.SubmittedAt).TotalMinutes)
            .DefaultIfEmpty(0)
            .Max();

        logger.LogInformation(
            "SubmissionBacklog StuckCount={StuckCount} AttemptedCount={AttemptedCount} "
            + "OldestUnconvertedMinutes={OldestUnconvertedMinutes} StaleAfterMinutes={StaleAfterMinutes}",
            stuck, attempted.Count, oldestUnconverted, staleAfter);
    }
}
