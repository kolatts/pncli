using System.Security.Cryptography;

namespace Feedback.Services;

/// <summary>
/// The GitHub credential the function will use, resolved and validated once at
/// startup. Either the Imagile Bot GitHub App (app id + private key) or a PAT
/// (<c>GITHUB_TOKEN</c>, the local-development fallback).
///
/// Resolution fails fast — an unusable credential throws here so the host never
/// starts, rather than being discovered one GitHub call at a time. The case that
/// motivated this (#417): an App Service Key Vault reference that fails to
/// resolve does not become empty, it stays the literal
/// <c>@Microsoft.KeyVault(...)</c> string. A bare emptiness check then selected
/// App auth and <see cref="RSA.ImportFromPem"/> threw on every timer tick for
/// four days while submissions sat pending.
/// </summary>
public abstract record GitHubAuth
{
    public const string KeyVaultReferencePrefix = "@Microsoft.KeyVault(";

    public sealed record App(string AppId, string PrivateKeyPem) : GitHubAuth;

    public sealed record Token(string Value) : GitHubAuth;

    private GitHubAuth() { }

    /// <summary>
    /// True when an app setting still holds the raw Key Vault reference syntax,
    /// i.e. the platform could not resolve it (missing secret, missing RBAC, or
    /// the managed identity is not yet available).
    /// </summary>
    public static bool IsUnresolvedKeyVaultReference(string? value) =>
        value is not null
        && value.TrimStart().StartsWith(KeyVaultReferencePrefix, StringComparison.OrdinalIgnoreCase);

    /// <summary>
    /// App settings sometimes carry the PEM with escaped newlines; restore them.
    /// </summary>
    public static string NormalizePem(string pem) => pem.Replace("\\n", "\n").Trim();

    /// <summary>
    /// Resolve from the process environment.
    /// </summary>
    public static GitHubAuth Resolve() => Resolve(Environment.GetEnvironmentVariable);

    /// <summary>
    /// Resolve from an arbitrary settings source. Throws
    /// <see cref="InvalidOperationException"/> naming the offending setting when
    /// the configuration cannot produce a working credential.
    /// </summary>
    public static GitHubAuth Resolve(Func<string, string?> getSetting)
    {
        var appId = Setting(getSetting, "GITHUB_APP_ID");
        var appKey = Setting(getSetting, "GITHUB_APP_PRIVATE_KEY");

        // Either App setting being present means App auth was intended. Do not
        // fall through to the PAT when the pair is incomplete or unusable: in
        // production the PAT has been retired (infra/README.md §3), so a silent
        // fallback would fail just as hard, only later and less obviously.
        if (appId is not null || appKey is not null)
        {
            if (appId is null)
                throw Misconfigured("GITHUB_APP_ID", "is not set but GITHUB_APP_PRIVATE_KEY is; both are required for GitHub App auth");
            if (appKey is null)
                throw Misconfigured("GITHUB_APP_PRIVATE_KEY", "is not set but GITHUB_APP_ID is; both are required for GitHub App auth");

            RejectUnresolvedReference("GITHUB_APP_ID", appId);
            RejectUnresolvedReference("GITHUB_APP_PRIVATE_KEY", appKey);

            var pem = NormalizePem(appKey);
            if (!pem.Contains("-----BEGIN", StringComparison.Ordinal))
                throw Misconfigured("GITHUB_APP_PRIVATE_KEY",
                    "does not look like a PEM-encoded private key (no '-----BEGIN' marker); it must hold the key contents, not a path or a placeholder");

            try
            {
                using var rsa = RSA.Create();
                rsa.ImportFromPem(pem);
            }
            catch (Exception ex) when (ex is ArgumentException or CryptographicException)
            {
                throw Misconfigured("GITHUB_APP_PRIVATE_KEY",
                    $"could not be parsed as an RSA private key: {ex.Message}", ex);
            }

            return new App(appId, pem);
        }

        var token = Setting(getSetting, "GITHUB_TOKEN");
        if (token is null)
            throw new InvalidOperationException(
                "No GitHub credentials configured: set GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY (GitHub App auth), or GITHUB_TOKEN (PAT, local development only).");

        RejectUnresolvedReference("GITHUB_TOKEN", token);
        return new Token(token.Trim());
    }

    private static string? Setting(Func<string, string?> getSetting, string name)
    {
        var value = getSetting(name);
        return string.IsNullOrWhiteSpace(value) ? null : value;
    }

    private static void RejectUnresolvedReference(string name, string value)
    {
        if (!IsUnresolvedKeyVaultReference(value))
            return;

        // The reference string itself is not secret (vault + secret name), and
        // naming it is what makes the cause obvious in the logs.
        throw Misconfigured(name,
            $"is an unresolved Key Vault reference ({value.Trim()}). The function app's managed identity could not read the secret: " +
            "check that the secret exists and that the identity has 'Key Vault Secrets User' on the vault (infra/README.md sections 2-3)");
    }

    private static InvalidOperationException Misconfigured(string name, string problem, Exception? inner = null) =>
        new($"GitHub auth misconfigured: app setting {name} {problem}.", inner);
}
