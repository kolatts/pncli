using Azure.Communication.Email;
using Feedback;
using Feedback.Services;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Octokit;

var connectionString = Environment.GetEnvironmentVariable("AzureWebJobsStorage")
    ?? "UseDevelopmentStorage=true";

GitHubAuth gitHubAuth;
try
{
    gitHubAuth = GitHubAuth.Resolve();
}
catch (InvalidOperationException ex)
{
    // Startup failures surface in the Functions host log as the worker's
    // stderr; make the line findable without the stack trace.
    Console.Error.WriteLine($"FATAL: {ex.Message}");
    throw;
}

var host = new HostBuilder()
    .ConfigureFunctionsWorkerDefaults()
    .ConfigureServices(services =>
    {
        services.AddHttpClient<TurnstileVerifier>();
        services.AddSingleton(_ => new TableStorageRateLimiter(connectionString));
        services.AddSingleton(_ => new PendingSubmissionStore(connectionString));
        services.AddSingleton(_ => new IssueEmailStore(connectionString));
        // Prefer the Imagile Bot GitHub App identity; fall back to a PAT
        // (GITHUB_TOKEN) for local development when no app id/key is configured.
        // Resolved and validated once, up front: an unusable credential (an
        // unresolved Key Vault reference, a malformed PEM, nothing configured)
        // throws before the host starts (#417). That fails the deploy's smoke
        // test and trips the heartbeat alert, instead of every timer tick
        // throwing quietly while submissions stay pending.
        switch (gitHubAuth)
        {
            case GitHubAuth.App app:
                services.AddSingleton(app);
                services.AddHttpClient(nameof(GitHubAppTokenProvider));
                services.AddSingleton<GitHubAppTokenProvider>();
                services.AddSingleton(sp => new GitHubClient(
                    new ProductHeaderValue("pncli-site"),
                    new GitHubAppCredentialStore(sp.GetRequiredService<GitHubAppTokenProvider>())));
                break;
            case GitHubAuth.Token token:
                services.AddSingleton(_ => new GitHubClient(new ProductHeaderValue("pncli-site"))
                {
                    Credentials = new Credentials(token.Value),
                });
                break;
        }

        var acsConnectionString = Environment.GetEnvironmentVariable("ACS_CONNECTION_STRING") ?? "";
        if (!string.IsNullOrEmpty(acsConnectionString))
        {
            services.AddSingleton(_ => new EmailClient(acsConnectionString));
            services.AddSingleton<EmailService>();
        }
    })
    .Build();

host.Run();
