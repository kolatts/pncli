using Azure;
using Azure.Data.Tables;
using Feedback.Models;

namespace Feedback;

public sealed class PendingSubmissionStore
{
    private readonly TableClient _table;

    public PendingSubmissionStore(string connectionString)
    {
        _table = new TableServiceClient(connectionString).GetTableClient("PendingSubmissions");
        _table.CreateIfNotExists();
    }

    public async Task AddAsync(PendingSubmissionEntity entity)
    {
        await _table.AddEntityAsync(entity);
    }

    /// <summary>Returns all submissions for today (UTC), both pending and processed.</summary>
    public async Task<List<PendingSubmissionEntity>> GetAllTodayAsync()
    {
        var today = DateTimeOffset.UtcNow.ToString("yyyy-MM-dd");
        var results = new List<PendingSubmissionEntity>();

        await foreach (var entity in _table.QueryAsync<PendingSubmissionEntity>(
            e => e.PartitionKey == today))
        {
            results.Add(entity);
        }

        return results;
    }

    /// <summary>
    /// Returns all unprocessed submissions from the last <paramref name="daysBack"/> days (default 7).
    /// Ordered oldest-first so submissions that have been waiting longest get priority.
    /// </summary>
    public async Task<List<PendingSubmissionEntity>> GetAllPendingAsync(int daysBack = 7)
    {
        var cutoff  = DateTimeOffset.UtcNow.AddDays(-daysBack).ToString("yyyy-MM-dd");
        var filter  = $"PartitionKey ge '{cutoff}' and Processed eq false";
        var results = new List<PendingSubmissionEntity>();

        await foreach (var entity in _table.QueryAsync<PendingSubmissionEntity>(filter: filter))
        {
            results.Add(entity);
        }

        // Oldest submissions first so long-waiting items are not starved
        results.Sort((a, b) => a.SubmittedAt.CompareTo(b.SubmittedAt));
        return results;
    }

    /// <summary>
    /// Marks a submission as processed with its resulting issue number.
    /// Ignores 412 conflicts — another instance beat us to it, which is fine.
    /// </summary>
    public async Task MarkProcessedAsync(PendingSubmissionEntity entity, int issueNumber)
    {
        entity.Processed    = true;
        entity.IssueNumber  = issueNumber;

        try
        {
            await _table.UpdateEntityAsync(entity, entity.ETag, TableUpdateMode.Replace);
        }
        catch (RequestFailedException ex) when (ex.Status == 412)
        {
            // Another timer instance already processed this — safe to ignore
        }
    }
}
