using Feedback;
using Feedback.Services;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using SendGrid;

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

        var sendGridKey = Environment.GetEnvironmentVariable("SENDGRID_API_KEY") ?? "";
        if (!string.IsNullOrEmpty(sendGridKey))
        {
            services.AddSingleton<ISendGridClient>(_ => new SendGridClient(sendGridKey));
            services.AddSingleton<EmailService>();
        }
    })
    .Build();

host.Run();
