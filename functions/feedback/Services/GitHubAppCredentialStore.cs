using Octokit;

namespace Feedback.Services;

/// <summary>
/// Octokit credential store backed by short-lived GitHub App installation
/// tokens. Octokit consults the store on every request, so token refresh in
/// <see cref="GitHubAppTokenProvider"/> is picked up transparently.
/// </summary>
public class GitHubAppCredentialStore(GitHubAppTokenProvider tokenProvider) : ICredentialStore
{
    public async Task<Credentials> GetCredentials() =>
        new(await tokenProvider.GetInstallationTokenAsync());
}
