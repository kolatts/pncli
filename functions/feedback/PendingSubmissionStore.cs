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
