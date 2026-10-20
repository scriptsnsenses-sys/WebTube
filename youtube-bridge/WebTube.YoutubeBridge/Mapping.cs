using System.Globalization;
using YoutubeExplode.Common;
using YoutubeExplode.Search;
using YoutubeExplode.Videos;
using YoutubeExplode.Videos.Streams;

namespace WebTube.YoutubeBridge;

public static class Mapping
{
    public static SearchVideo ToSearchVideo(VideoSearchResult video) =>
        new(
            video.Id,
            video.Title,
            video.Author.ChannelTitle,
            video.Author.ChannelId,
            FormatDuration(video.Duration),
            "",
            "",
            video.Thumbnails.TryGetWithHighestResolution()?.Url ?? "",
            video.Duration is null,
            "OK"
        );

    public static VideoDetails ToVideoDetails(Video video) =>
        new(
            video.Id,
            video.Title,
            video.Author.ChannelTitle,
            video.Author.ChannelId,
            video.Description ?? "",
            video.Engagement.ViewCount.ToString(CultureInfo.InvariantCulture),
            FormatDuration(video.Duration),
            video.Duration is null,
            video.Thumbnails.TryGetWithHighestResolution()?.Url ?? "",
            video.UploadDate.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
            true,
            "OK"
        );

    public static StreamsResponse ToStreamsResponse(StreamManifest manifest)
    {
        var muxed =
            manifest.GetMuxedStreams().Where(s => s.Container == Container.Mp4).MaxBy(s => s.VideoQuality)
            ?? manifest.GetMuxedStreams().MaxBy(s => s.VideoQuality);

        var video =
            manifest
                .GetVideoOnlyStreams()
                .Where(s => s.Container == Container.Mp4 && s.VideoQuality.MaxHeight <= 1080)
                .MaxBy(s => s.VideoQuality)
            ?? manifest
                .GetVideoOnlyStreams()
                .Where(s => s.Container == Container.Mp4)
                .MaxBy(s => s.VideoQuality)
            ?? manifest.GetVideoOnlyStreams().MaxBy(s => s.VideoQuality);

        var audio =
            manifest
                .GetAudioOnlyStreams()
                .Where(s => s.Container == Container.Mp4)
                .MaxBy(s => s.Bitrate)
            ?? manifest.GetAudioOnlyStreams().MaxBy(s => s.Bitrate);

        return new StreamsResponse(
            muxed is null ? null : ToStreamInfo(muxed),
            video is null ? null : ToStreamInfo(video),
            audio is null ? null : ToStreamInfo(audio)
        );
    }

    private static StreamInfo ToStreamInfo(IStreamInfo stream)
    {
        var video = stream as IVideoStreamInfo;
        var codec = stream switch
        {
            MuxedStreamInfo muxed => $"{muxed.VideoCodec} / {muxed.AudioCodec}",
            VideoOnlyStreamInfo videoOnly => videoOnly.VideoCodec,
            AudioOnlyStreamInfo audioOnly => audioOnly.AudioCodec,
            _ => "",
        };

        return new StreamInfo(
            stream.Url,
            stream.Container.Name,
            video?.VideoQuality.Label,
            stream.Bitrate.BitsPerSecond,
            stream.Size.Bytes,
            codec,
            video?.VideoResolution.Width,
            video?.VideoResolution.Height
        );
    }

    private static string FormatDuration(TimeSpan? duration)
    {
        if (duration is null)
            return "LIVE";

        var value = duration.Value;
        return value.TotalHours >= 1
            ? $"{(int)value.TotalHours}:{value.Minutes:00}:{value.Seconds:00}"
            : $"{value.Minutes}:{value.Seconds:00}";
    }
}
