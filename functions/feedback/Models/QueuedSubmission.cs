namespace Feedback.Models;

public record QueuedSubmission
{
    public string Kind    { get; init; } = "";
    public string Title   { get; init; } = "";
    public string Body    { get; init; } = "";
    public string? Service { get; init; }
    public string? Version { get; init; }
}
