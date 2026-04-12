using System.Net.Http.Json;
using System.Text.Json.Serialization;

namespace Feedback;

/// <summary>
/// Verifies Cloudflare Turnstile tokens server-side.
/// If TURNSTILE_SECRET is not configured the check is skipped (dev mode).
/// </summary>
public sealed class TurnstileVerifier(HttpClient http)
{
    private const string VerifyUrl = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

    public async Task<bool> VerifyAsync(string? token, string ip)
    {
        var secret = Environment.GetEnvironmentVariable("TURNSTILE_SECRET");
        if (string.IsNullOrEmpty(secret))
            return true; // not configured — skip (dev / CI)

        if (string.IsNullOrWhiteSpace(token))
            return false;

        try
        {
            using var response = await http.PostAsync(VerifyUrl,
                new FormUrlEncodedContent(new Dictionary<string, string>
                {
                    ["secret"]   = secret,
                    ["response"] = token,
                    ["remoteip"] = ip,
                }));

            if (!response.IsSuccessStatusCode) return false;

            var result = await response.Content.ReadFromJsonAsync<TurnstileResult>();
            return result?.Success == true;
        }
        catch
        {
            return false;
        }
    }

    private record TurnstileResult(
        [property: JsonPropertyName("success")] bool Success
    );
}
