using Feedback;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;

var connectionString = Environment.GetEnvironmentVariable("AzureWebJobsStorage")
    ?? "UseDevelopmentStorage=true";

var host = new HostBuilder()
    .ConfigureFunctionsWorkerDefaults()
    .ConfigureServices(services =>
    {
        services.AddHttpClient<TurnstileVerifier>();
        services.AddSingleton(_ => new TableStorageRateLimiter(connectionString));
        services.AddSingleton(_ => new DailyCounter(connectionString));
    })
    .Build();

host.Run();
