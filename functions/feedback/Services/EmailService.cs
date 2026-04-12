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
        _from   = Environment.GetEnvironmentVariable("EMAIL_FROM_ADDRESS")
            ?? throw new InvalidOperationException("EMAIL_FROM_ADDRESS is not configured");
    }

    public async Task<bool> SendConfirmationAsync(string toEmail, int issueNumber, string issueUrl, string title)
    {
        var subject = $"Feedback received — Issue #{issueNumber}";
        var plain = $"""
            Thanks for submitting feedback!

            Your report "{title}" has been filed as issue #{issueNumber}.
            Track its progress here: {issueUrl}

            We'll send you another email when it's resolved.

            — pncli team
            """;
        var html = $"""
            <p>Thanks for submitting feedback!</p>
            <p>Your report "<strong>{WebUtility.HtmlEncode(title)}</strong>" has been filed as
            <a href="{WebUtility.HtmlEncode(issueUrl)}">issue #{issueNumber}</a>.</p>
            <p>Track its progress at <a href="{WebUtility.HtmlEncode(issueUrl)}">{WebUtility.HtmlEncode(issueUrl)}</a>.</p>
            <p>We'll send you another email when it's resolved.</p>
            <p>— pncli team</p>
            """;

        return await SendAsync(toEmail, subject, plain, html,
            onSuccess: () => _logger.LogInformation(
                "Confirmation email sent to {Email} for issue #{Number}", toEmail, issueNumber));
    }

    public async Task<bool> SendClosedNotificationAsync(string toEmail, int issueNumber, string issueUrl, string title)
    {
        var subject = $"Your feedback has been resolved — Issue #{issueNumber}";
        var plain = $"""
            Good news! Your feedback "{title}" (issue #{issueNumber}) has been resolved and closed.

            See the details here: {issueUrl}

            Thanks for helping improve pncli!

            — pncli team
            """;
        var html = $"""
            <p>Good news! Your feedback "<strong>{WebUtility.HtmlEncode(title)}</strong>"
            (<a href="{WebUtility.HtmlEncode(issueUrl)}">issue #{issueNumber}</a>) has been resolved and closed.</p>
            <p>See the details at <a href="{WebUtility.HtmlEncode(issueUrl)}">{WebUtility.HtmlEncode(issueUrl)}</a>.</p>
            <p>Thanks for helping improve pncli!</p>
            <p>— pncli team</p>
            """;

        return await SendAsync(toEmail, subject, plain, html,
            onSuccess: () => _logger.LogInformation(
                "Closed notification sent to {Email} for issue #{Number}", toEmail, issueNumber));
    }

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
