using System.Net;
using System.Text.Json;
using WebTube.YoutubeBridge;
using YoutubeExplode;
using YoutubeExplode.Exceptions;

var builder = WebApplication.CreateBuilder(args);

builder.Services.ConfigureHttpJsonOptions(options =>
{
    options.SerializerOptions.PropertyNamingPolicy = JsonNamingPolicy.CamelCase;
});

var cookieHeader = Environment.GetEnvironmentVariable("YOUTUBE_COOKIE");
if (!string.IsNullOrWhiteSpace(cookieHeader))
{
    var cookies = cookieHeader
        .Split(';', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
        .Select(part => part.Split('=', 2))
        .Where(parts => parts.Length == 2 && !string.IsNullOrWhiteSpace(parts[0]))
        .Select(parts => new Cookie(parts[0], parts[1])
        {
            Domain = ".youtube.com",
            Path = "/",
            Secure = true,
            HttpOnly = true,
        })
        .ToList();

    builder.Services.AddSingleton(new YoutubeClient(cookies));
}
else
{
    builder.Services.AddSingleton<YoutubeClient>();
}

var app = builder.Build();

app.MapGet("/health", () => Results.Ok(new HealthResponse("ok")));

app.MapGet(
    "/search",
    async (YoutubeClient youtube, string q, int? limit, CancellationToken cancellationToken) =>
    {
        if (string.IsNullOrWhiteSpace(q))
            return Results.BadRequest(new ErrorResponse("Search query is required."));

        var count = Math.Clamp(limit is > 0 ? limit.Value : 24, 1, 100);

        try
        {
            var results = new List<SearchVideo>();
            await foreach (var video in youtube.Search.GetVideosAsync(q, cancellationToken))
            {
                results.Add(Mapping.ToSearchVideo(video));
                if (results.Count >= count)
                    break;
            }

            return Results.Ok(new SearchResponse(results));
        }
        catch (Exception ex)
        {
            return ToError(ex);
        }
    }
);

app.MapGet(
    "/video/{id}",
    async (YoutubeClient youtube, string id, CancellationToken cancellationToken) =>
    {
        try
        {
            var video = await youtube.Videos.GetAsync(id, cancellationToken);
            return Results.Ok(new VideoResponse(Mapping.ToVideoDetails(video)));
        }
        catch (Exception ex)
        {
            return ToError(ex);
        }
    }
);

app.MapGet(
    "/streams/{id}",
    async (YoutubeClient youtube, string id, CancellationToken cancellationToken) =>
    {
        try
        {
            var manifest = await youtube.Videos.Streams.GetManifestAsync(id, cancellationToken);
            return Results.Ok(Mapping.ToStreamsResponse(manifest));
        }
        catch (Exception ex)
        {
            return ToError(ex);
        }
    }
);

app.Run();

static IResult ToError(Exception ex)
{
    var statusCode = ex switch
    {
        VideoUnavailableException => 404,
        VideoRequiresPurchaseException => 402,
        RequestLimitExceededException => 429,
        _ => 502,
    };

    return Results.Json(new ErrorResponse(ex.Message), statusCode: statusCode);
}
