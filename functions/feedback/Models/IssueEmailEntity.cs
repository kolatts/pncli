using Azure;
using Azure.Data.Tables;

namespace Feedback.Models;

public class IssueEmailEntity : ITableEntity
{
    /// <summary>Always "issue" for this table.</summary>
    public string PartitionKey { get; set; } = "issue";

    /// <summary>GitHub issue number as string.</summary>
    public string RowKey { get; set; } = "";

    public string Email { get; set; } = "";
    public string Title { get; set; } = "";
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;

    public DateTimeOffset? Timestamp { get; set; }
    public ETag ETag { get; set; }
}
