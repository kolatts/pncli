using System.Text.Json.Serialization;

namespace Feedback.Models;

public record FeedbackRequest
{
    [JsonPropertyName("kind")]
    public string Kind { get; init; } = "";

    [JsonPropertyName("title")]
    public string Title { get; init; } = "";

    [JsonPropertyName("body")]
    public string Body { get; init; } = "";

    [JsonPropertyName("email")]
    public string Email { get; init; } = "";

    [JsonPropertyName("service")]
    public string? Service { get; init; }

    [JsonPropertyName("hp")]
    public string? Hp { get; init; }

    [JsonPropertyName("version")]
    public string? Version { get; init; }

    [JsonPropertyName("cf-turnstile-response")]
    public string? TurnstileToken { get; init; }
}
