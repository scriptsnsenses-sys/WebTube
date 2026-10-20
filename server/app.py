"""ytmusicapi wrapped as a tiny HTTP service for Render / Docker / any host.

Run locally:
    uvicorn server.app:app --host 0.0.0.0 --port 8000

Render uses:
    uvicorn server.app:app --host 0.0.0.0 --port $PORT

Auth (optional, only needed for library / private endpoints):
    YTMUSIC_AUTH        JSON string (browser headers or oauth token) OR path to auth file
    YTMUSIC_AUTH_FILE   path to headers.json / oauth.json (alternative to YTMUSIC_AUTH)
    YTMUSIC_LANGUAGE    default "en"
    YTMUSIC_LOCATION    default "" (auto)
"""

import json
import os
from dataclasses import asdict, is_dataclass
from functools import lru_cache
from pathlib import Path

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from ytmusicapi import YTMusic
from ytmusicapi.exceptions import YTMusicServerError, YTMusicUserError

app = FastAPI(title="ytmusicapi-service", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

STATIC_DIR = Path(__file__).resolve().parent.parent / "static"
if STATIC_DIR.is_dir():
    app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")


@app.get("/manifest.webmanifest")
def manifest():
    return FileResponse(str(STATIC_DIR / "manifest.webmanifest"), media_type="application/manifest+json")


@app.get("/sw.js")
def service_worker():
    # Must be served from the root scope so it can control the whole app.
    return FileResponse(str(STATIC_DIR / "sw.js"), media_type="application/javascript")


def _resolve_auth():
    # Explicit file var wins, else generic var (JSON string or path).
    auth_file = os.environ.get("YTMUSIC_AUTH_FILE")
    if auth_file:
        return auth_file
    auth = os.environ.get("YTMUSIC_AUTH")
    if not auth:
        return None
    auth = auth.strip()
    if auth.startswith("{"):
        try:
            return json.loads(auth)
        except json.JSONDecodeError:
            return auth
    return auth


@lru_cache(maxsize=1)
def get_client() -> YTMusic:
    try:
        return YTMusic(
            auth=_resolve_auth(),
            language=os.environ.get("YTMUSIC_LANGUAGE", "en"),
            location=os.environ.get("YTMUSIC_LOCATION", ""),
        )
    except Exception as exc:  # bad auth / language at startup
        raise RuntimeError(f"Failed to init YTMusic: {exc}") from exc


def _jsonable(obj):
    if obj is None or isinstance(obj, (str, int, float, bool)):
        return obj
    if is_dataclass(obj):
        return _jsonable(asdict(obj))
    if isinstance(obj, dict):
        return {k: _jsonable(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_jsonable(v) for v in obj]
    return obj


def _call(fn, *args, **kwargs):
    try:
        return _jsonable(fn(*args, **kwargs))
    except YTMusicUserError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except YTMusicServerError as exc:
        raise HTTPException(status_code=502, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"{type(exc).__name__}: {exc}")


def _safe_call(fn, *args, **kwargs):
    try:
        return _call(fn, *args, **kwargs)
    except HTTPException:
        return None


def _yt_artists(item):
    return [a.get("name") for a in (item.get("artists") or []) if a.get("name")]


def _yt_video(item):
    if not isinstance(item, dict):
        return None
    video_id = item.get("videoId")
    if not video_id and isinstance(item.get("counterpart"), dict):
        item = item["counterpart"]
        video_id = item.get("videoId")
    if not video_id:
        return None
    artists = _yt_artists(item)
    channel = item.get("author") or (artists[0] if artists else "")
    if not channel and isinstance(item.get("podcast"), dict):
        channel = item["podcast"].get("name") or ""
    return {
        "videoId": video_id,
        "title": item.get("title") or video_id,
        "channel": channel,
        "artists": artists,
        "views": item.get("views"),
        "duration": item.get("duration") or item.get("length"),
        "videoType": item.get("videoType"),
        "thumbnail": f"https://i.ytimg.com/vi/{video_id}/hqdefault.jpg",
        "isLive": bool(item.get("isLive")),
        "isAvailable": item.get("isAvailable") is not False,
    }


def _yt_videos(items, limit=24):
    videos = []
    seen = set()
    for item in items or []:
        video = _yt_video(item)
        if video and video["videoId"] not in seen:
            seen.add(video["videoId"])
            videos.append(video)
            if len(videos) >= limit:
                break
    return videos


def _yt_section(title, items, limit=24):
    videos = _yt_videos(items, limit=limit)
    return {"title": title, "videos": videos} if videos else None


def _format_duration(seconds):
    try:
        seconds = int(seconds)
    except (TypeError, ValueError):
        return None
    if seconds <= 0:
        return None
    minutes, seconds = divmod(seconds, 60)
    hours, minutes = divmod(minutes, 60)
    return f"{hours}:{minutes:02d}:{seconds:02d}" if hours else f"{minutes}:{seconds:02d}"


@app.get("/")
def root():
    index = STATIC_DIR / "index.html"
    if index.is_file():
        return FileResponse(str(index))
    return {"service": "ytmusicapi-service", "health": "/health", "player": "static files missing"}


@app.get("/api")
def api_info():
    return {
        "service": "ytmusicapi-service",
        "docs": "/docs",
        "health": "/health",
        "endpoints": [
            "/search",
            "/home",
            "/artist/{channelId}",
            "/album/{browseId}",
            "/song/{videoId}",
            "/playlist/{playlistId}",
            "/watch",
            "/lyrics",
            "/yt/home",
            "/yt/search",
            "/yt/video/{videoId}",
        ],
    }


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/search")
def search(
    q: str = Query(..., description="Search query, e.g. 'Oasis Wonderwall'"),
    filter: str | None = Query(None, description="songs|videos|albums|artists|playlists|..."),
    scope: str | None = Query(None, description="library|uploads"),
    limit: int = Query(20, ge=1, le=100),
    ignore_spelling: bool = False,
):
    yt = get_client()
    return JSONResponse(_call(yt.search, q, filter=filter, scope=scope, limit=limit, ignore_spelling=ignore_spelling))


@app.get("/home")
def home(limit: int = Query(3, ge=1, le=10)):
    return JSONResponse(_call(get_client().get_home, limit=limit))


@app.get("/yt/home")
def yt_home(limit: int = Query(24, ge=1, le=40)):
    yt = get_client()
    explore = _call(yt.get_explore)
    trending = explore.get("trending") or {}
    sections = [
        _yt_section("Trending now", trending.get("items") if isinstance(trending, dict) else [], limit),
        _yt_section("New music videos", explore.get("new_videos"), limit),
        _yt_section("Podcasts & episodes", explore.get("top_episodes"), limit),
    ]
    sections = [section for section in sections if section]
    if not sections:
        rows = _call(yt.get_home, limit=5)
        sections = [
            _yt_section(row.get("title") or "Recommended", row.get("contents"), limit)
            for row in rows
        ]
        sections = [section for section in sections if section]
    return JSONResponse({"sections": sections})


@app.get("/yt/search")
def yt_search(
    q: str = Query(..., min_length=1, description="Search query"),
    filter: str = Query("videos", description="videos|songs"),
    limit: int = Query(30, ge=1, le=100),
    ignore_spelling: bool = False,
):
    if filter not in {"videos", "songs"}:
        raise HTTPException(status_code=400, detail="filter must be 'videos' or 'songs'")
    items = _call(get_client().search, q, filter=filter, limit=limit, ignore_spelling=ignore_spelling)
    return JSONResponse({"query": q, "filter": filter, "results": _yt_videos(items, limit=limit)})


@app.get("/yt/video/{video_id}")
def yt_video(video_id: str, related_limit: int = Query(15, ge=0, le=30)):
    yt = get_client()
    raw = _call(yt.get_song, video_id)
    details = raw.get("videoDetails") or {}
    micro = (raw.get("microformat") or {}).get("microformatDataRenderer") or {}
    playability = raw.get("playabilityStatus") or {}
    artists = _yt_artists(details)
    channel = details.get("author") or (artists[0] if artists else "")
    is_live = bool(details.get("isLive"))
    thumbs = (micro.get("thumbnail") or {}).get("thumbnails") or (details.get("thumbnail") or {}).get("thumbnails") or []
    thumbnail = thumbs[-1]["url"] if thumbs else f"https://i.ytimg.com/vi/{video_id}/hqdefault.jpg"

    related = []
    seen = {video_id}

    def collect(items):
        for item in items or []:
            video = _yt_video(item)
            if video and video["videoId"] not in seen and len(related) < related_limit:
                seen.add(video["videoId"])
                related.append(video)

    watch = _safe_call(yt.get_watch_playlist, videoId=video_id, limit=min(25, related_limit + 5)) if related_limit else None
    if watch:
        related_id = watch.get("related")
        if related_id:
            sections = _safe_call(yt.get_song_related, related_id) or []
            for section in sections:
                if isinstance(section, dict):
                    collect(section.get("contents"))
        collect(watch.get("tracks"))

    if related_limit and not related:
        query = " ".join(part for part in [details.get("title"), channel] if part)
        if query:
            collect(_safe_call(yt.search, query, filter="videos", limit=related_limit + 1))

    publish_date = micro.get("publishDate") or micro.get("uploadDate") or ""
    if str(publish_date).startswith(("1969", "1970")):
        publish_date = ""
    video = {
        "videoId": video_id,
        "title": details.get("title") or micro.get("title") or video_id,
        "channel": channel,
        "channelId": details.get("channelId") or "",
        "artists": artists,
        "description": micro.get("description") or "",
        "views": details.get("viewCount"),
        "duration": "LIVE" if is_live else _format_duration(details.get("lengthSeconds")),
        "isLive": is_live,
        "thumbnail": thumbnail,
        "publishDate": publish_date,
        "embeddable": playability.get("playableInEmbed") is not False,
        "status": playability.get("status") or "",
    }
    return JSONResponse({"video": video, "related": related[:related_limit]})


@app.get("/artist/{channel_id}")
def artist(channel_id: str):
    return JSONResponse(_call(get_client().get_artist, channel_id))


@app.get("/album/{browse_id}")
def album(browse_id: str):
    return JSONResponse(_call(get_client().get_album, browse_id))


@app.get("/song/{video_id}")
def song(video_id: str):
    return JSONResponse(_call(get_client().get_song, video_id))


@app.get("/playlist/{playlist_id}")
def playlist(playlist_id: str, limit: int | None = Query(100, ge=1, le=5000)):
    return JSONResponse(_call(get_client().get_playlist, playlist_id, limit=limit))


@app.get("/watch")
def watch(
    videoId: str | None = Query(None),
    playlistId: str | None = Query(None),
    limit: int = Query(25, ge=1, le=100),
    radio: bool = False,
    shuffle: bool = False,
):
    if not videoId and not playlistId:
        raise HTTPException(status_code=400, detail="Provide videoId and/or playlistId")
    return JSONResponse(
        _call(get_client().get_watch_playlist, videoId=videoId, playlistId=playlistId, limit=limit, radio=radio, shuffle=shuffle)
    )


@app.get("/lyrics")
def lyrics(
    browseId: str | None = Query(None, description="lyrics browseId from get_watch_playlist (MPLYt...)"),
    videoId: str | None = Query(None, description="videoId of the track — lyrics id is resolved automatically"),
):
    yt = get_client()
    if not browseId and videoId:
        watch = _call(yt.get_watch_playlist, videoId=videoId, limit=1)
        browseId = (watch or {}).get("lyrics")
        if not browseId:
            raise HTTPException(status_code=404, detail="No lyrics available for this track")
    if not browseId:
        raise HTTPException(status_code=400, detail="Provide browseId or videoId")
    data = _call(yt.get_lyrics, browseId)
    if not data:
        raise HTTPException(status_code=404, detail="No lyrics found for this track")
    return JSONResponse(data)
