using System.Net;
using Azure.Communication.Email;
using Microsoft.Extensions.Logging;

namespace Feedback.Services;

public sealed class EmailService
{
    private readonly EmailClient _client;
    private readonly string _from;
    private readonly ILogger<EmailService> _logger;

    public EmailService(EmailClient client, ILogger<EmailService> logger)
    {
        _client = client;
        _logger = logger;
        _from   = Environment.GetEnvironmentVariable("EMAIL_FROM_ADDRESS") ?? "no-reply@imagile.dev";
    }

    public async Task<bool> SendConfirmationAsync(string toEmail, int issueNumber, string issueUrl, string title)
    {
        var encodedTitle = WebUtility.HtmlEncode(title);
        var subject      = $"Feedback received — Issue #{issueNumber}";

        var bodyHtml =
            EmailTemplates.Heading("We've got your feedback!") +
            EmailTemplates.Para($"Your report <strong>{encodedTitle}</strong> has been filed as {EmailTemplates.IssueLink(issueNumber, issueUrl)}.") +
            EmailTemplates.Para("We'll review it and send you another email when it's resolved.") +
            EmailTemplates.Button(issueUrl, $"View Issue #{issueNumber} →");

        var plain = $"""
            We've got your feedback!

            Your report "{title}" has been filed as issue #{issueNumber}.
            Track it here: {issueUrl}

            We'll send you another email when it's resolved.

            — pncli team
            """;

        return await SendAsync(toEmail, subject, plain, EmailTemplates.Wrap(bodyHtml, subject),
            onSuccess: () => _logger.LogInformation(
                "Confirmation email sent to {Email} for issue #{Number}", toEmail, issueNumber));
    }

    public async Task<bool> SendClosedNotificationAsync(
        string toEmail, int issueNumber, string issueUrl, string title,
        string? stateReason = null, string? closingComment = null)
    {
        var encodedTitle = WebUtility.HtmlEncode(title);

        var (heading, subject, blurb) = stateReason switch
        {
            "completed"   => ("Your feedback has been resolved!",
                              $"Your feedback has been resolved — Issue #{issueNumber}",
                              "We've addressed it."),
            "not_planned" => ("A decision has been made on your feedback",
                              $"Update on your feedback — Issue #{issueNumber}",
                              "This issue was closed as not planned. See the issue for details."),
            _             => ("Your issue has been closed",
                              $"Your feedback has been closed — Issue #{issueNumber}",
                              "This issue has been closed."),
        };

        var commentHtml = closingComment is not null
            ? EmailTemplates.Quote(WebUtility.HtmlEncode(TruncateComment(closingComment)))
            : "";

        var commentPlain = closingComment is not null
            ? $"\n\nNote from the team:\n{TruncateComment(closingComment)}"
            : "";

        var bodyHtml =
            EmailTemplates.Heading(heading) +
            EmailTemplates.Para($"<strong>{encodedTitle}</strong> ({EmailTemplates.IssueLink(issueNumber, issueUrl)}) — {blurb}") +
            commentHtml +
            EmailTemplates.Para("Thanks for helping improve pncli!") +
            EmailTemplates.Button(issueUrl, "View Resolution →");

        var plain = $"""
            {heading}

            "{title}" (issue #{issueNumber}) — {blurb}{commentPlain}

            See the details here: {issueUrl}

            Thanks for helping improve pncli!

            — pncli team
            """;

        return await SendAsync(toEmail, subject, plain, EmailTemplates.Wrap(bodyHtml, subject),
            onSuccess: () => _logger.LogInformation(
                "Closed notification sent to {Email} for issue #{Number}", toEmail, issueNumber));
    }

    private static string TruncateComment(string text, int maxLength = 500) =>
        text.Length <= maxLength ? text : text[..maxLength] + "…";

    private async Task<bool> SendAsync(string toEmail, string subject, string plain, string html, Action onSuccess)
    {
        try
        {
            var message = new EmailMessage(
                senderAddress: _from,
                content: new EmailContent(subject) { PlainText = plain, Html = html },
                recipients: new EmailRecipients([new EmailAddress(toEmail)]));

            var operation = await _client.SendAsync(Azure.WaitUntil.Completed, message);

            if (operation.Value.Status == EmailSendStatus.Succeeded)
            {
                onSuccess();
                return true;
            }

            _logger.LogError("ACS email send failed with status {Status}", operation.Value.Status);
            return false;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Exception sending email to {Email}", toEmail);
            return false;
        }
    }
}
