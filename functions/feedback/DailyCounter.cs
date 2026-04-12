using Azure;
using Azure.Data.Tables;

namespace Feedback;

/// <summary>
/// Global daily submission cap backed by Azure Table Storage.
/// Prevents runaway credit burn when all per-IP limits are saturated.
/// </summary>
public sealed class DailyCounter
{
    private readonly TableClient _table;

    public DailyCounter(string connectionString)
    {
        _table = new TableServiceClient(connectionString).GetTableClient("dailycount");
        _table.CreateIfNotExists();
    }

    /// <summary>
    /// Atomically increments today's counter.
    /// Returns false (and does NOT increment) if <paramref name="maxPerDay"/> is already reached.
    /// </summary>
    public async Task<bool> TryIncrementAsync(int maxPerDay)
    {
        var rowKey = DateTimeOffset.UtcNow.ToString("yyyy-MM-dd");

        for (var attempt = 0; attempt < 3; attempt++)
        {
            try
            {
                var resp   = await _table.GetEntityAsync<TableEntity>("daily", rowKey);
                var entity = resp.Value;
                var count  = entity.GetInt32("Count") ?? 0;

                if (count >= maxPerDay) return false;

                entity["Count"] = count + 1;
                await _table.UpdateEntityAsync(entity, entity.ETag, TableUpdateMode.Replace);
                return true;
            }
            catch (RequestFailedException ex) when (ex.Status == 412)
            {
                await Task.Delay(TimeSpan.FromMilliseconds(25 * (attempt + 1)));
            }
            catch (RequestFailedException ex) when (ex.Status == 404)
            {
                try
                {
                    await _table.AddEntityAsync(new TableEntity("daily", rowKey)
                    {
                        ["Count"] = 1,
                    });
                    return true;
                }
                catch (RequestFailedException e) when (e.Status == 409) { /* race on insert — retry loop */ }
            }
        }

        return false;
    }
}
