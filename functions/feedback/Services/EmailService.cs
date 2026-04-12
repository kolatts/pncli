using System.Net;
using Microsoft.Extensions.Logging;
using SendGrid;
using SendGrid.Helpers.Mail;

namespace Feedback.Services;

public sealed class EmailService
{
    private readonly ISendGridClient _client;
    private readonly EmailAddress _from;
    private readonly ILogger<EmailService> _logger;

    public EmailService(ISendGridClient client, ILogger<EmailService> logger)
    {
        _client = client;
        _logger = logger;
        var fromEmail = Environment.GetEnvironmentVariable("SENDGRID_FROM_EMAIL")
            ?? throw new InvalidOperationException("SENDGRID_FROM_EMAIL is not configured");
        _from = new EmailAddress(fromEmail, "pncli Feedback");
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
            <a href="{issueUrl}">issue #{issueNumber}</a>.</p>
            <p>Track its progress at <a href="{issueUrl}">{issueUrl}</a>.</p>
            <p>We'll send you another email when it's resolved.</p>
            <p>— pncli team</p>
            """;

        return await SendAsync(toEmail, subject, plain, html,
            onSuccess: () => _logger.LogInformation("Confirmation email sent to {Email} for issue #{Number}", toEmail, issueNumber));
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
            (<a href="{issueUrl}">issue #{issueNumber}</a>) has been resolved and closed.</p>
            <p>See the details at <a href="{issueUrl}">{issueUrl}</a>.</p>
            <p>Thanks for helping improve pncli!</p>
            <p>— pncli team</p>
            """;

        return await SendAsync(toEmail, subject, plain, html,
            onSuccess: () => _logger.LogInformation("Closed notification sent to {Email} for issue #{Number}", toEmail, issueNumber));
    }

    private async Task<bool> SendAsync(string toEmail, string subject, string plain, string html, Action onSuccess)
    {
        var to = new EmailAddress(toEmail);
        var msg = MailHelper.CreateSingleEmail(_from, to, subject, plain, html);

        var response = await _client.SendEmailAsync(msg);

        if ((int)response.StatusCode >= 200 && (int)response.StatusCode < 300)
        {
            onSuccess();
            return true;
        }

        var body = await response.Body.ReadAsStringAsync();
        _logger.LogError("SendGrid returned {Status}: {Body}", response.StatusCode, body);
        return false;
    }
}
