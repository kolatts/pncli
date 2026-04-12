using Azure;
using Azure.Data.Tables;

namespace Feedback;

/// <summary>
/// Per-IP token-bucket rate limiter backed by Azure Table Storage.
/// Persistent across cold starts; uses ETags for safe concurrent updates.
/// </summary>
public sealed class TableStorageRateLimiter
{
    private readonly TableClient _table;
    private const int MaxTokens = 5;
    private static readonly TimeSpan RefillPeriod = TimeSpan.FromMinutes(1);

    public TableStorageRateLimiter(string connectionString)
    {
        _table = new TableServiceClient(connectionString).GetTableClient("ratelimit");
        _table.CreateIfNotExists();
    }

    /// <summary>Returns true if the request should be allowed; false if rate-limited.</summary>
    public async Task<bool> TryConsumeAsync(string ip)
    {
        var rowKey = HashIp(ip);

        for (var attempt = 0; attempt < 3; attempt++)
        {
            try
            {
                var resp = await _table.GetEntityAsync<TableEntity>("ip", rowKey);
                var entity    = resp.Value;
                var tokens    = entity.GetInt32("Tokens") ?? MaxTokens;
                var lastRefill = entity.GetDateTimeOffset("LastRefill") ?? DateTimeOffset.MinValue;
                var now       = DateTimeOffset.UtcNow;

                int next;
                DateTimeOffset nextRefill;

                if (now - lastRefill >= RefillPeriod)
                {
                    next       = MaxTokens - 1;
                    nextRefill = now;
                }
                else if (tokens <= 0)
                {
                    return false;
                }
                else
                {
                    next       = tokens - 1;
                    nextRefill = lastRefill;
                }

                entity["Tokens"]     = next;
                entity["LastRefill"] = nextRefill;
                await _table.UpdateEntityAsync(entity, entity.ETag, TableUpdateMode.Replace);
                return true;
            }
            catch (RequestFailedException ex) when (ex.Status == 412)
            {
                // Concurrent update from another instance — retry with back-off.
                await Task.Delay(TimeSpan.FromMilliseconds(25 * (attempt + 1)));
            }
            catch (RequestFailedException ex) when (ex.Status == 404)
            {
                try
                {
                    await _table.AddEntityAsync(new TableEntity("ip", rowKey)
                    {
                        ["Tokens"]     = MaxTokens - 1,
                        ["LastRefill"] = DateTimeOffset.UtcNow,
                    });
                    return true;
                }
                catch (RequestFailedException e) when (e.Status == 409) { /* race on insert — retry loop */ }
            }
        }

        return false; // fail-closed after retries exhausted
    }

    // Hash the IP so we don't store PII in table keys.
    private static string HashIp(string ip)
    {
        var bytes = System.Security.Cryptography.SHA256.HashData(
            System.Text.Encoding.UTF8.GetBytes(ip));
        return Convert.ToHexString(bytes)[..16].ToLowerInvariant();
    }
}
