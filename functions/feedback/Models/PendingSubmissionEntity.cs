using Azure;
using Azure.Data.Tables;

namespace Feedback.Models;

public class PendingSubmissionEntity : ITableEntity
{
    /// <summary>UTC date "yyyy-MM-dd" — enables efficient per-day queries.</summary>
    public string PartitionKey { get; set; } = "";

    /// <summary>Unique submission ID.</summary>
    public string RowKey { get; set; } = "";

    public string Kind     { get; set; } = "";
    public string Title    { get; set; } = "";
    public string Body     { get; set; } = "";
    public string Email    { get; set; } = "";
    public string? Service { get; set; }
    public string? Version { get; set; }

    public bool Processed          { get; set; } = false;
    public DateTimeOffset SubmittedAt { get; set; } = DateTimeOffset.UtcNow;
    public int? IssueNumber        { get; set; }

    public DateTimeOffset? Timestamp { get; set; }
    public ETag ETag { get; set; }
}
