using Azure;
using Azure.Data.Tables;

namespace Feedback;

/// <summary>
/// Per-IP daily rate limiter backed by Azure Table Storage.
/// The number of allowed submissions per IP per calendar day (UTC) is
/// controlled by the IP_DAILY_LIMIT app setting (default 1).
/// </summary>
public sealed class TableStorageRateLimiter
{
    private readonly TableClient _table;

    public TableStorageRateLimiter(string connectionString)
    {
        _table = new TableServiceClient(connectionString).GetTableClient("IpDailyLimit");
        _table.CreateIfNotExists();
    }

    /// <summary>
    /// Returns true and increments the counter if the IP is under today's limit.
    /// Returns false if the limit has already been reached.
    /// </summary>
    public async Task<bool> TryConsumeAsync(string ip, int limit)
    {
        var partitionKey = DateTimeOffset.UtcNow.ToString("yyyy-MM-dd");
        var rowKey       = HashIp(ip);

        for (var attempt = 0; attempt < 3; attempt++)
        {
            try
            {
                var resp   = await _table.GetEntityAsync<TableEntity>(partitionKey, rowKey);
                var entity = resp.Value;
                var count  = entity.GetInt32("Count") ?? 0;

                if (count >= limit) return false;

                entity["Count"] = count + 1;
                await _table.UpdateEntityAsync(entity, entity.ETag, TableUpdateMode.Replace);
                return true;
            }
            catch (RequestFailedException ex) when (ex.Status == 412)
            {
                // Concurrent update — retry with back-off
                await Task.Delay(TimeSpan.FromMilliseconds(25 * (attempt + 1)));
            }
            catch (RequestFailedException ex) when (ex.Status == 404)
            {
                try
                {
                    await _table.AddEntityAsync(new TableEntity(partitionKey, rowKey) { ["Count"] = 1 });
                    return true;
                }
                catch (RequestFailedException e) when (e.Status == 409) { /* race on insert — retry loop */ }
            }
        }

        return false; // fail-closed after retries exhausted
    }

    private static string HashIp(string ip)
    {
        var bytes = System.Security.Cryptography.SHA256.HashData(
            System.Text.Encoding.UTF8.GetBytes(ip));
        return Convert.ToHexString(bytes)[..16].ToLowerInvariant();
    }
}
