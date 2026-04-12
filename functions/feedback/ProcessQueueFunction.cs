using System.Text.Json;
using Feedback.Models;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Extensions.Logging;
using Octokit;

namespace Feedback;

/// <summary>
/// Dequeues validated feedback submissions and creates GitHub issues.
/// Failures are retried automatically; after 5 attempts the message moves
/// to the feedback-submissions-poison queue for manual review.
/// </summary>
public class ProcessQueueFunction(ILogger<ProcessQueueFunction> logger)
{
    [Function("ProcessFeedbackQueue")]
    public async Task Run(
        [QueueTrigger("feedback-submissions", Connection = "AzureWebJobsStorage")] string messageJson)
    {
        var submission = JsonSerializer.Deserialize<QueuedSubmission>(messageJson);
        if (submission is null)
        {
            logger.LogError("Could not deserialize queue message: {Message}", messageJson);
            return; // don't retry malformed messages
        }

        var token   = Environment.GetEnvironmentVariable("GITHUB_TOKEN") ?? "";
        var repoStr = Environment.GetEnvironmentVariable("GITHUB_REPO")  ?? "kolatts/pncli";
        var label   = Environment.GetEnvironmentVariable("GITHUB_ISSUE_LABEL") ?? "from-website";
        var parts   = repoStr.Split('/');

        var title = string.IsNullOrEmpty(submission.Version)
            ? submission.Title
            : $"Re: v{submission.Version} — {submission.Title}";

        var body = submission.Body
            + (string.IsNullOrEmpty(submission.Service) ? "" : $"\n\n**Service:** {submission.Service}")
            + "\n\n---\n*Submitted via [kolatts.github.io/pncli](https://kolatts.github.io/pncli)*";

        var github = new GitHubClient(new ProductHeaderValue("pncli-site"))
        {
            Credentials = new Credentials(token),
        };

        var newIssue = new NewIssue(title) { Body = body };
        newIssue.Labels.Add(label);
        newIssue.Labels.Add(submission.Kind == "bug" ? "bug" : "enhancement");

        var created = await github.Issue.Create(parts[0], parts[1], newIssue);
        logger.LogInformation("Created issue #{Number}: {Title}", created.Number, created.Title);
    }
}
