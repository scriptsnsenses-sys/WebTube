namespace WebTube.YoutubeBridge;

public sealed record HealthResponse(string Status);

public sealed record SearchResponse(IReadOnlyList<SearchVideo> Results);

public sealed record SearchVideo(
    string VideoId,
    string Title,
    string Channel,
    string ChannelId,
    string Duration,
    string Views,
    string PublishDate,
    string Thumbnail,
    bool IsLive,
    string Status
);

public sealed record VideoResponse(VideoDetails Video);

public sealed record VideoDetails(
    string VideoId,
    string Title,
    string Channel,
    string ChannelId,
    string Description,
    string Views,
    string Duration,
    bool IsLive,
    string Thumbnail,
    string PublishDate,
    bool Embeddable,
    string Status
);

public sealed record StreamInfo(
    string Url,
    string Container,
    string? Quality,
    long Bitrate,
    long Size,
    string Codec,
    int? Width,
    int? Height
);

public sealed record StreamsResponse(StreamInfo? Muxed, StreamInfo? Video, StreamInfo? Audio);

public sealed record ErrorResponse(string Detail);
