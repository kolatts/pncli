using System.Security.Cryptography;
using Feedback.Services;
using Xunit;

namespace Feedback.Tests;

public class GitHubAuthTests
{
    private const string UnresolvedReference =
        "@Microsoft.KeyVault(VaultName=imagile-keyvault;SecretName=GITHUB-APP-PRIVATE-KEY)";

    private static readonly string ValidPem = RSA.Create(2048).ExportRSAPrivateKeyPem();

    private static Func<string, string?> Settings(params (string Name, string? Value)[] settings)
    {
        var map = settings.ToDictionary(s => s.Name, s => s.Value);
        return name => map.GetValueOrDefault(name);
    }

    [Fact]
    public void AppAuth_WithValidPem_ResolvesApp()
    {
        var auth = GitHubAuth.Resolve(Settings(("GITHUB_APP_ID", "12345"), ("GITHUB_APP_PRIVATE_KEY", ValidPem)));

        var app = Assert.IsType<GitHubAuth.App>(auth);
        Assert.Equal("12345", app.AppId);
        Assert.Equal(ValidPem.Trim(), app.PrivateKeyPem);
    }

    [Fact]
    public void AppAuth_WithEscapedNewlines_IsNormalized()
    {
        var escaped = ValidPem.Replace("\n", "\\n");
        var auth = GitHubAuth.Resolve(Settings(("GITHUB_APP_ID", "12345"), ("GITHUB_APP_PRIVATE_KEY", escaped)));

        var app = Assert.IsType<GitHubAuth.App>(auth);
        Assert.Equal(ValidPem.Trim(), app.PrivateKeyPem);
    }

    [Fact]
    public void AppAuth_WithUnresolvedKeyVaultReference_FailsNamingTheSetting()
    {
        // The #417 case: the platform leaves the literal reference in the setting
        // when the secret cannot be read. It is non-empty, so a bare emptiness
        // check would select App auth and fail on every call.
        var ex = Assert.Throws<InvalidOperationException>(() =>
            GitHubAuth.Resolve(Settings(("GITHUB_APP_ID", "12345"), ("GITHUB_APP_PRIVATE_KEY", UnresolvedReference))));

        Assert.Contains("GITHUB_APP_PRIVATE_KEY", ex.Message);
        Assert.Contains("unresolved Key Vault reference", ex.Message);
        Assert.Contains("SecretName=GITHUB-APP-PRIVATE-KEY", ex.Message);
    }

    [Fact]
    public void AppAuth_WithUnresolvedKeyVaultReference_DoesNotFallBackToToken()
    {
        var ex = Assert.Throws<InvalidOperationException>(() =>
            GitHubAuth.Resolve(Settings(
                ("GITHUB_APP_ID", "12345"),
                ("GITHUB_APP_PRIVATE_KEY", UnresolvedReference),
                ("GITHUB_TOKEN", "ghp_stillhere"))));

        Assert.Contains("GITHUB_APP_PRIVATE_KEY", ex.Message);
    }

    [Fact]
    public void AppAuth_WithUnresolvedAppIdReference_Fails()
    {
        var ex = Assert.Throws<InvalidOperationException>(() =>
            GitHubAuth.Resolve(Settings(
                ("GITHUB_APP_ID", "@Microsoft.KeyVault(VaultName=imagile-keyvault;SecretName=APP-ID)"),
                ("GITHUB_APP_PRIVATE_KEY", ValidPem))));

        Assert.Contains("GITHUB_APP_ID", ex.Message);
        Assert.Contains("unresolved Key Vault reference", ex.Message);
    }

    [Theory]
    [InlineData("<imagile-bot-app-private-key-pem>")]
    [InlineData("/home/site/imagile-bot.private-key.pem")]
    public void AppAuth_WithNonPemValue_FailsWithoutEchoingTheValue(string value)
    {
        var ex = Assert.Throws<InvalidOperationException>(() =>
            GitHubAuth.Resolve(Settings(("GITHUB_APP_ID", "12345"), ("GITHUB_APP_PRIVATE_KEY", value))));

        Assert.Contains("GITHUB_APP_PRIVATE_KEY", ex.Message);
        Assert.Contains("does not look like a PEM", ex.Message);
        Assert.DoesNotContain(value, ex.Message);
    }

    [Fact]
    public void AppAuth_WithCorruptPem_FailsAsUnparseable()
    {
        const string corrupt = "-----BEGIN RSA PRIVATE KEY-----\nnot base64 at all\n-----END RSA PRIVATE KEY-----";
        var ex = Assert.Throws<InvalidOperationException>(() =>
            GitHubAuth.Resolve(Settings(("GITHUB_APP_ID", "12345"), ("GITHUB_APP_PRIVATE_KEY", corrupt))));

        Assert.Contains("GITHUB_APP_PRIVATE_KEY", ex.Message);
        Assert.Contains("could not be parsed", ex.Message);
        Assert.DoesNotContain("not base64", ex.Message);
    }

    [Fact]
    public void AppAuth_WithAppIdButNoKey_FailsInsteadOfFallingBack()
    {
        var ex = Assert.Throws<InvalidOperationException>(() =>
            GitHubAuth.Resolve(Settings(("GITHUB_APP_ID", "12345"), ("GITHUB_TOKEN", "ghp_x"))));

        Assert.Contains("GITHUB_APP_PRIVATE_KEY", ex.Message);
        Assert.Contains("is not set", ex.Message);
    }

    [Fact]
    public void AppAuth_WithKeyButNoAppId_Fails()
    {
        var ex = Assert.Throws<InvalidOperationException>(() =>
            GitHubAuth.Resolve(Settings(("GITHUB_APP_PRIVATE_KEY", ValidPem))));

        Assert.Contains("GITHUB_APP_ID", ex.Message);
        Assert.Contains("is not set", ex.Message);
    }

    [Fact]
    public void TokenAuth_WhenNoAppSettings_ResolvesToken()
    {
        var auth = GitHubAuth.Resolve(Settings(("GITHUB_TOKEN", "ghp_local")));

        var token = Assert.IsType<GitHubAuth.Token>(auth);
        Assert.Equal("ghp_local", token.Value);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public void TokenAuth_BlankAppSettings_AreTreatedAsUnset(string? blank)
    {
        var auth = GitHubAuth.Resolve(Settings(
            ("GITHUB_APP_ID", blank),
            ("GITHUB_APP_PRIVATE_KEY", blank),
            ("GITHUB_TOKEN", "ghp_local")));

        Assert.IsType<GitHubAuth.Token>(auth);
    }

    [Fact]
    public void TokenAuth_WithUnresolvedKeyVaultReference_Fails()
    {
        var ex = Assert.Throws<InvalidOperationException>(() =>
            GitHubAuth.Resolve(Settings(("GITHUB_TOKEN", "@Microsoft.KeyVault(VaultName=imagile-keyvault;SecretName=GITHUB-TOKEN)"))));

        Assert.Contains("GITHUB_TOKEN", ex.Message);
        Assert.Contains("unresolved Key Vault reference", ex.Message);
    }

    [Fact]
    public void NothingConfigured_Fails()
    {
        var ex = Assert.Throws<InvalidOperationException>(() => GitHubAuth.Resolve(Settings()));

        Assert.Contains("No GitHub credentials configured", ex.Message);
    }

    [Fact]
    public void DanglingTokenReference_IsIgnoredWhenAppAuthIsValid()
    {
        // infra/README.md §3 tells operators to delete GITHUB_TOKEN once App auth
        // works, but a lingering broken reference must not take down a working
        // App configuration.
        var auth = GitHubAuth.Resolve(Settings(
            ("GITHUB_APP_ID", "12345"),
            ("GITHUB_APP_PRIVATE_KEY", ValidPem),
            ("GITHUB_TOKEN", "@Microsoft.KeyVault(VaultName=imagile-keyvault;SecretName=GITHUB-TOKEN)")));

        Assert.IsType<GitHubAuth.App>(auth);
    }

    [Theory]
    [InlineData("@Microsoft.KeyVault(SecretUri=https://imagile-keyvault.vault.azure.net/secrets/x)", true)]
    [InlineData("  @microsoft.keyvault(VaultName=v;SecretName=s)", true)]
    [InlineData("ghp_abc", false)]
    [InlineData("", false)]
    [InlineData(null, false)]
    public void IsUnresolvedKeyVaultReference_DetectsReferenceSyntax(string? value, bool expected) =>
        Assert.Equal(expected, GitHubAuth.IsUnresolvedKeyVaultReference(value));
}
