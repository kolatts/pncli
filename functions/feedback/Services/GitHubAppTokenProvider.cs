using System.Net.Http.Headers;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.Extensions.Logging;

namespace Feedback.Services;

/// <summary>
/// Mints GitHub App installation tokens for the Imagile Bot app so issues are
/// created under the bot identity instead of a personal access token.
/// Flow: RS256 app JWT → resolve installation for GITHUB_REPO → exchange for an
/// installation token scoped to issues:write. Tokens live ~1 hour and are cached
/// until shortly before expiry.
/// </summary>
public class GitHubAppTokenProvider(
    IHttpClientFactory httpClientFactory,
    ILogger<GitHubAppTokenProvider> logger)
{
    private static readonly TimeSpan RefreshMargin = TimeSpan.FromMinutes(5);

    private readonly SemaphoreSlim _refreshLock = new(1, 1);
    // Single reference so the lock-free fast path reads token + expiry atomically.
    private volatile CachedToken? _cache;
    private long? _installationId;

    public async Task<string> GetInstallationTokenAsync()
    {
        var cached = _cache;
        if (cached is not null && DateTimeOffset.UtcNow < cached.ExpiresAt - RefreshMargin)
            return cached.Token;

        await _refreshLock.WaitAsync();
        try
        {
            cached = _cache;
            if (cached is not null && DateTimeOffset.UtcNow < cached.ExpiresAt - RefreshMargin)
                return cached.Token;

            var jwt = CreateAppJwt();
            using var http = httpClientFactory.CreateClient(nameof(GitHubAppTokenProvider));
            http.BaseAddress = new Uri("https://api.github.com/");
            http.DefaultRequestHeaders.UserAgent.Add(new ProductInfoHeaderValue("pncli-site", "1.0"));
            http.DefaultRequestHeaders.Accept.Add(new MediaTypeWithQualityHeaderValue("application/vnd.github+json"));
            http.DefaultRequestHeaders.Add("X-GitHub-Api-Version", "2022-11-28");
            http.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", jwt);

            var installationId = _installationId ??= await ResolveInstallationIdAsync(http);

            // Scope the token down: this function only ever touches issues.
            using var response = await http.PostAsync(
                $"app/installations/{installationId}/access_tokens",
                new StringContent("""{"permissions":{"issues":"write"}}""", Encoding.UTF8, "application/json"));

            var body = await response.Content.ReadAsStringAsync();
            if (!response.IsSuccessStatusCode)
                throw new InvalidOperationException(
                    $"GitHub App token exchange failed ({(int)response.StatusCode}): {body}");

            var tokenResponse = JsonSerializer.Deserialize<InstallationTokenResponse>(body)
                ?? throw new InvalidOperationException("Empty installation token response");

            _cache = new CachedToken(tokenResponse.Token, tokenResponse.ExpiresAt);
            logger.LogInformation(
                "Minted GitHub App installation token for installation {InstallationId}, expires {ExpiresAt}",
                installationId, tokenResponse.ExpiresAt);
            return tokenResponse.Token;
        }
        finally
        {
            _refreshLock.Release();
        }
    }

    private static async Task<long> ResolveInstallationIdAsync(HttpClient http)
    {
        var configured = Environment.GetEnvironmentVariable("GITHUB_APP_INSTALLATION_ID");
        if (long.TryParse(configured, out var fromEnv))
            return fromEnv;

        var repo = Environment.GetEnvironmentVariable("GITHUB_REPO") ?? "kolatts/pncli";
        using var response = await http.GetAsync($"repos/{repo}/installation");
        var body = await response.Content.ReadAsStringAsync();
        if (!response.IsSuccessStatusCode)
            throw new InvalidOperationException(
                $"Could not resolve GitHub App installation for {repo} ({(int)response.StatusCode}): {body}");

        var installation = JsonSerializer.Deserialize<InstallationResponse>(body);
        return installation?.Id
            ?? throw new InvalidOperationException($"Installation lookup for {repo} returned no id");
    }

    private static string CreateAppJwt()
    {
        var appId = Environment.GetEnvironmentVariable("GITHUB_APP_ID")
            ?? throw new InvalidOperationException("GITHUB_APP_ID not configured");
        var pem = Environment.GetEnvironmentVariable("GITHUB_APP_PRIVATE_KEY")
            ?? throw new InvalidOperationException("GITHUB_APP_PRIVATE_KEY not configured");

        // App settings sometimes carry the PEM with escaped newlines.
        pem = pem.Replace("\\n", "\n");

        var now = DateTimeOffset.UtcNow;
        // iat backdated 60s for clock drift; exp well under GitHub's 10-minute cap.
        var header = """{"alg":"RS256","typ":"JWT"}""";
        var payload = JsonSerializer.Serialize(new
        {
            iat = now.AddSeconds(-60).ToUnixTimeSeconds(),
            exp = now.AddMinutes(8).ToUnixTimeSeconds(),
            iss = appId,
        });

        var signingInput = $"{Base64Url(Encoding.UTF8.GetBytes(header))}.{Base64Url(Encoding.UTF8.GetBytes(payload))}";

        using var rsa = RSA.Create();
        rsa.ImportFromPem(pem);
        var signature = rsa.SignData(
            Encoding.UTF8.GetBytes(signingInput),
            HashAlgorithmName.SHA256,
            RSASignaturePadding.Pkcs1);

        return $"{signingInput}.{Base64Url(signature)}";
    }

    private static string Base64Url(byte[] bytes) =>
        Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');

    private sealed record CachedToken(string Token, DateTimeOffset ExpiresAt);

    private sealed class InstallationTokenResponse
    {
        [JsonPropertyName("token")]
        public string Token { get; set; } = "";

        [JsonPropertyName("expires_at")]
        public DateTimeOffset ExpiresAt { get; set; }
    }

    private sealed class InstallationResponse
    {
        [JsonPropertyName("id")]
        public long? Id { get; set; }
    }
}
