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
        foreach (var submission in pending.Take(slotsRemaining))
        {
            var title = string.IsNullOrEmpty(submission.Version)
                ? submission.Title
                : $"Re: v{submission.Version} — {submission.Title}";

            var body = submission.Body
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
    }
}
