using Azure;
using Azure.Data.Tables;
using Feedback.Models;

namespace Feedback;

public sealed class IssueEmailStore
{
    private readonly TableClient _table;

    public IssueEmailStore(string connectionString)
    {
        _table = new TableServiceClient(connectionString).GetTableClient("IssueEmails");
        _table.CreateIfNotExists();
    }

    public async Task SaveAsync(int issueNumber, string email, string title)
    {
        var entity = new IssueEmailEntity
        {
            RowKey     = issueNumber.ToString(),
            Email      = email,
            Title      = title,
            CreatedAt  = DateTimeOffset.UtcNow,
        };
        await _table.UpsertEntityAsync(entity, TableUpdateMode.Replace);
    }

    public async Task<IssueEmailEntity?> GetAsync(int issueNumber)
    {
        try
        {
            var response = await _table.GetEntityAsync<IssueEmailEntity>("issue", issueNumber.ToString());
            return response.Value;
        }
        catch (RequestFailedException ex) when (ex.Status == 404)
        {
            return null;
        }
    }
}
