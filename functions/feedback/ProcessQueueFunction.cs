using System.Text;
using System.Text.RegularExpressions;
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

    /// <summary>
    /// Label on the one persistent issue the smoke-test path writes to.
    /// Deliberately not <c>from-website</c>: that label is what fires
    /// <c>claude-triage.yml</c>, and a smoke test must never spend an agent run.
    /// </summary>
    private const string SmokeTestLabel = "smoke-test";

    private const string SmokeTestIssueTitle = "Feedback pipeline smoke test";

    /// <summary>Rows of run history kept in the smoke-test issue body.</summary>
    private const int SmokeTestHistoryRows = 20;

    /// <summary>
    /// One history row as written by <see cref="BuildSmokeTestBody"/>. GitHub
    /// returns issue bodies with CRLF, hence the optional <c>\r</c>.
    /// </summary>
    private static readonly Regex SmokeTestRow =
        new(@"^\| [^|]+ \| `[^`]+` \|\r?$", RegexOptions.Multiline | RegexOptions.Compiled);

    /// <summary>Cached across ticks; cleared if a recorded run fails.</summary>
    private static int? _smokeTestIssueNumber;

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
        // Smoke-test rows are not user submissions; they never consume a slot.
        var alreadyProcessed = allToday.Count(e => e.Processed && !e.SmokeTest);
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
            if (submission.SmokeTest)
            {
                // A smoke run is recorded on one persistent issue, rewritten in
                // place — no new issue per deploy, and body edits send nothing.
                try
                {
                    var number = await RecordSmokeTestAsync(parts[0], parts[1], submission);
                    await pendingSubmissions.MarkProcessedAsync(submission, number);
                    processedCount++;
                }
                catch (Exception ex)
                {
                    logger.LogError(ex, "Failed to record smoke test {RowKey} — will retry next run", submission.RowKey);
                }
                continue;
            }

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
    /// Rewrites the persistent smoke-test issue with this run at the top of its
    /// history and returns the issue number. Creating vs updating an issue goes
    /// through the same App identity and <c>issues:write</c> permission, so the
    /// auth path the real submissions depend on is still exercised. No
    /// IssueEmailStore row is written, so the close webhook stays silent.
    /// </summary>
    private async Task<int> RecordSmokeTestAsync(string owner, string repo, PendingSubmissionEntity submission)
    {
        var number = _smokeTestIssueNumber ?? await FindOrCreateSmokeTestIssueAsync(owner, repo);
        try
        {
            var current = await github.Issue.Get(owner, repo, number);
            var update  = new IssueUpdate
            {
                Title = SmokeTestIssueTitle,
                Body  = BuildSmokeTestBody(current.Body, submission),
            };
            if (current.State.Value == ItemState.Open)
            {
                update.State       = ItemState.Closed;
                update.StateReason = ItemStateReason.NotPlanned;
            }

            await github.Issue.Update(owner, repo, number, update);
            _smokeTestIssueNumber = number;
            logger.LogInformation("Recorded smoke test '{Title}' on issue #{Number}", submission.Title, number);
            return number;
        }
        catch
        {
            _smokeTestIssueNumber = null; // re-discover next tick (issue deleted, transferred…)
            throw;
        }
    }

    /// <summary>
    /// The lowest-numbered non-PR issue carrying the smoke-test label, created
    /// (and closed as not planned) if there is none yet. Lowest-numbered so that
    /// the function and the skill script, which discovers it the same way, agree.
    /// </summary>
    private async Task<int> FindOrCreateSmokeTestIssueAsync(string owner, string repo)
    {
        var request = new RepositoryIssueRequest
        {
            State         = ItemStateFilter.All,
            SortProperty  = IssueSort.Created,
            SortDirection = SortDirection.Ascending,
        };
        request.Labels.Add(SmokeTestLabel);

        var existing = await github.Issue.GetAllForRepository(
            owner, repo, request, new ApiOptions { PageSize = 10, PageCount = 1 });
        var found = existing.FirstOrDefault(i => i.PullRequest is null);
        if (found is not null)
            return found.Number;

        var newIssue = new NewIssue(SmokeTestIssueTitle) { Body = BuildSmokeTestBody(null, null) };
        newIssue.Labels.Add(SmokeTestLabel);
        var created = await github.Issue.Create(owner, repo, newIssue);
        await github.Issue.Update(owner, repo, created.Number, new IssueUpdate
        {
            State       = ItemState.Closed,
            StateReason = ItemStateReason.NotPlanned,
        });
        logger.LogInformation("Created persistent smoke-test issue #{Number}", created.Number);
        return created.Number;
    }

    private static string BuildSmokeTestBody(string? existingBody, PendingSubmissionEntity? run)
    {
        var rows = new List<string>();
        if (run is not null)
            rows.Add($"| {DateTimeOffset.UtcNow:yyyy-MM-dd HH:mm:ss} | `{run.Title}` |");
        if (!string.IsNullOrEmpty(existingBody))
            rows.AddRange(SmokeTestRow.Matches(existingBody).Select(m => m.Value.TrimEnd('\r')));

        var sb = new StringBuilder();
        sb.AppendLine("Automated end-to-end smoke test of the feedback pipeline (`.claude/skills/feedback-smoke/`).");
        sb.AppendLine("Every run rewrites this issue in place. It stays closed, never notifies, and is the only issue the smoke test touches — nothing to do here.");
        sb.AppendLine();
        sb.AppendLine("| Run (UTC) | Submission |");
        sb.AppendLine("|---|---|");
        foreach (var row in rows.Take(SmokeTestHistoryRows))
            sb.AppendLine(row);
        sb.AppendLine();
        sb.AppendLine("---");
        sb.Append("*Recorded by `ProcessSubmissions` — see `infra/README.md` §7.*");
        return sb.ToString();
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
