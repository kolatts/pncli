using Azure.Communication.Email;
using Feedback;
using Feedback.Services;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Octokit;

var connectionString = Environment.GetEnvironmentVariable("AzureWebJobsStorage")
    ?? "UseDevelopmentStorage=true";

var host = new HostBuilder()
    .ConfigureFunctionsWorkerDefaults()
    .ConfigureServices(services =>
    {
        services.AddHttpClient<TurnstileVerifier>();
        services.AddSingleton(_ => new TableStorageRateLimiter(connectionString));
        services.AddSingleton(_ => new PendingSubmissionStore(connectionString));
        services.AddSingleton(_ => new IssueEmailStore(connectionString));
        // Prefer the Imagile Bot GitHub App identity; fall back to a PAT
        // (GITHUB_TOKEN) for local development when no app key is configured.
        var appId = Environment.GetEnvironmentVariable("GITHUB_APP_ID");
        var appKey = Environment.GetEnvironmentVariable("GITHUB_APP_PRIVATE_KEY");
        if (!string.IsNullOrEmpty(appId) && !string.IsNullOrEmpty(appKey))
        {
            services.AddHttpClient(nameof(GitHubAppTokenProvider));
            services.AddSingleton<GitHubAppTokenProvider>();
            services.AddSingleton(sp => new GitHubClient(
                new ProductHeaderValue("pncli-site"),
                new GitHubAppCredentialStore(sp.GetRequiredService<GitHubAppTokenProvider>())));
        }
        else
        {
            services.AddSingleton(_ => new GitHubClient(new ProductHeaderValue("pncli-site"))
            {
                Credentials = new Credentials(Environment.GetEnvironmentVariable("GITHUB_TOKEN") ?? ""),
            });
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
