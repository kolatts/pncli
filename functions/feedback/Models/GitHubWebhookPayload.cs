using System.Text.Json.Serialization;

namespace Feedback.Models;

public record GitHubWebhookPayload
{
    [JsonPropertyName("action")]
    public string Action { get; init; } = "";

    [JsonPropertyName("issue")]
    public GitHubWebhookIssue? Issue { get; init; }
}

public record GitHubWebhookIssue
{
    [JsonPropertyName("number")]
    public int Number { get; init; }

    [JsonPropertyName("title")]
    public string Title { get; init; } = "";

    [JsonPropertyName("html_url")]
    public string HtmlUrl { get; init; } = "";

    [JsonPropertyName("labels")]
    public List<GitHubWebhookLabel> Labels { get; init; } = [];
}

public record GitHubWebhookLabel
{
    [JsonPropertyName("name")]
    public string Name { get; init; } = "";
}
