"""Generic YouTube scraper and /yt routes."""

import json
import re
import time
from concurrent.futures import ThreadPoolExecutor

import requests
from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import JSONResponse

router = APIRouter()

_YT_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/131.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "en-US,en;q=0.9",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Cookie": "SOCS=CAI",
}
_YT_INITIAL_DATA_RE = re.compile(r"var ytInitialData\s*=\s*(\{.*?\});</script>", re.S)
_YT_PLAYER_URL = "https://www.youtube.com/youtubei/v1/player"
_YT_PLAYER_KEY = "AIzaSyA8eiZmM1FaDVjRy-df2KTyQ_vz_yYM39w"
_YT_PLAYER_CLIENT = {
    "clientName": "ANDROID",
    "clientVersion": "17.10.35",
    "androidSdkVersion": 30,
}
_YT_PLAYER_FALLBACK_VERSION = "20.10.38"
_YT_PLAYER_HEADERS = {"Content-Type": "application/json"}
_YT_CACHE = {}
_YT_CACHE_TTL = 600
_YT_HOME_QUERIES = [
    ("Trending now", "trending videos"),
    ("Technology", "technology"),
    ("Gaming", "gaming"),
    ("News & politics", "news"),
    ("Comedy", "comedy"),
    ("Sports", "sports highlights"),
    ("Movies & trailers", "movie trailers"),
]


def _youtube_get(url, params=None):
    error = None
    for attempt in range(2):
        try:
            response = requests.get(url, params=params, headers=_YT_HEADERS, timeout=20)
            response.raise_for_status()
            return response.text
        except requests.RequestException as exc:
            error = exc
            if attempt == 0:
                time.sleep(0.4)
    raise HTTPException(status_code=502, detail=f"YouTube request failed: {error}") from error


def _youtube_json(text, pattern, label):
    match = pattern.search(text)
    if not match:
        raise HTTPException(status_code=502, detail=f"YouTube {label} data was not found")
    try:
        return json.loads(match.group(1))
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=502, detail=f"YouTube {label} data was invalid") from exc


def _youtube_find(value, key):
    if isinstance(value, dict):
        if key in value:
            return value[key]
        for child in value.values():
            found = _youtube_find(child, key)
            if found is not None:
                return found
    elif isinstance(value, list):
        for child in value:
            found = _youtube_find(child, key)
            if found is not None:
                return found
    return None


def _youtube_find_all(value, key):
    found = []
    if isinstance(value, dict):
        for child_key, child in value.items():
            if child_key == key:
                found.append(child)
            found.extend(_youtube_find_all(child, key))
    elif isinstance(value, list):
        for child in value:
            found.extend(_youtube_find_all(child, key))
    return found


def _youtube_text(value):
    if isinstance(value, str):
        return value
    if not isinstance(value, dict):
        return ""
    if value.get("simpleText"):
        return value["simpleText"]
    if value.get("content"):
        return value["content"]
    return "".join(run.get("text", "") for run in value.get("runs") or [] if isinstance(run, dict))


def _youtube_entry(
    video_id,
    title,
    channel="",
    views="",
    duration="",
    published="",
    thumbnail="",
    is_live=False,
    channel_id="",
):
    return {
        "videoId": video_id,
        "title": title or video_id,
        "channel": channel or "",
        "channelId": channel_id or "",
        "views": views or "",
        "duration": "LIVE" if is_live else (duration or ""),
        "publishDate": published or "",
        "thumbnail": thumbnail or f"https://i.ytimg.com/vi/{video_id}/hqdefault.jpg",
        "isLive": is_live,
    }


def _youtube_video_from_renderer(item):
    if not isinstance(item, dict):
        return None
    video_id = item.get("videoId")
    if not video_id:
        return None
    labels = [
        (badge.get("metadataBadgeRenderer") or {}).get("label", "")
        for badge in item.get("badges") or []
        if isinstance(badge, dict)
    ]
    is_live = any("live" in label.lower() for label in labels)
    thumbnails = ((item.get("thumbnail") or {}).get("thumbnails") or [])
    thumbnail = thumbnails[-1].get("url", "") if thumbnails else ""
    channel = (
        _youtube_text(item.get("ownerText"))
        or _youtube_text(item.get("longBylineText"))
        or _youtube_text(item.get("shortBylineText"))
    )
    views = _youtube_text(item.get("viewCountText")) or _youtube_text(item.get("shortViewCountText"))
    duration = _youtube_text(item.get("lengthText"))
    published = _youtube_text(item.get("publishedTimeText"))
    return _youtube_entry(
        video_id,
        _youtube_text(item.get("title")),
        channel=channel,
        views=views,
        duration=duration,
        published=published,
        thumbnail=thumbnail,
        is_live=is_live or duration.upper() == "LIVE",
    )


def _youtube_video_from_lockup(item):
    if not isinstance(item, dict):
        return None
    content_type = str(item.get("contentType") or "").upper()
    if content_type and "VIDEO" not in content_type:
        return None
    video_id = item.get("contentId")
    if not video_id:
        watch = _youtube_find(item, "watchEndpoint") or {}
        video_id = watch.get("videoId")
    if not video_id:
        return None

    metadata = ((item.get("metadata") or {}).get("lockupMetadataViewModel") or {})
    title = _youtube_text(metadata.get("title"))
    rows = (((metadata.get("metadata") or {}).get("contentMetadataViewModel") or {}).get("metadataRows") or [])
    parts = []
    for row in rows:
        row_parts = []
        for part in row.get("metadataParts") or []:
            text = _youtube_text(part.get("text"))
            if text:
                row_parts.append((text, part.get("accessibilityLabel") or ""))
        if row_parts:
            parts.append(row_parts)
    channel = parts[0][0][0] if parts and parts[0] else ""
    views = ""
    published = ""
    for row in parts[1:]:
        for text, label in row:
            lowered = f"{text} {label}".lower()
            if "view" in lowered:
                views = text
            elif re.search(r"\b(?:ago|streamed|premiered|scheduled)\b", lowered):
                published = text

    thumbnails = (
        (((item.get("contentImage") or {}).get("thumbnailViewModel") or {}).get("image") or {}).get("sources")
        or []
    )
    thumbnail = thumbnails[-1].get("url", "") if thumbnails else ""
    duration = ""
    is_live = False
    for badge in _youtube_find_all(item, "thumbnailBadgeViewModel"):
        text = str(badge.get("text") or "")
        if text.upper() == "LIVE":
            is_live = True
            duration = "LIVE"
            break
        if re.fullmatch(r"\d+(?::\d+){1,2}", text):
            duration = text
            break
    return _youtube_entry(
        video_id,
        title,
        channel=channel,
        views=views,
        duration=duration,
        published=published,
        thumbnail=thumbnail,
        is_live=is_live,
    )


def _youtube_cached(key, loader, ttl=_YT_CACHE_TTL):
    now = time.monotonic()
    cached = _YT_CACHE.get(key)
    if cached and now - cached[0] < ttl:
        return cached[1]
    value = loader()
    if len(_YT_CACHE) > 256:
        _YT_CACHE.clear()
    _YT_CACHE[key] = (now, value)
    return value


def _youtube_search_uncached(query, limit):
    html = _youtube_get(
        "https://www.youtube.com/results",
        params={"search_query": query, "hl": "en", "sp": "EgIQAQ%3D%3D"},
    )
    data = _youtube_json(html, _YT_INITIAL_DATA_RE, "search")
    results = []
    seen = set()
    for item in _youtube_find_all(data, "videoRenderer"):
        video = _youtube_video_from_renderer(item)
        if video and video["videoId"] not in seen:
            seen.add(video["videoId"])
            results.append(video)
            if len(results) >= limit:
                return results
    for item in _youtube_find_all(data, "lockupViewModel"):
        video = _youtube_video_from_lockup(item)
        if video and video["videoId"] not in seen:
            seen.add(video["videoId"])
            results.append(video)
            if len(results) >= limit:
                break
    return results[:limit]


def _youtube_search(query, limit=24):
    key = ("search", query.strip().lower(), limit)
    return _youtube_cached(key, lambda: _youtube_search_uncached(query, limit), ttl=180)


def _youtube_home_sections(limit):
    def load(entry):
        title, query = entry
        try:
            videos = _youtube_search(query, limit=limit)
        except HTTPException:
            videos = []
        return {"title": title, "videos": videos} if videos else None

    with ThreadPoolExecutor(max_workers=len(_YT_HOME_QUERIES)) as pool:
        sections = list(pool.map(load, _YT_HOME_QUERIES))
    return [section for section in sections if section]


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


def _youtube_player_request(video_id, client_version):
    body = {
        "videoId": video_id,
        "context": {
            "client": {
                **_YT_PLAYER_CLIENT,
                "clientVersion": client_version,
            }
        },
    }
    error = None
    for attempt in range(2):
        try:
            return requests.post(
                _YT_PLAYER_URL,
                params={"key": _YT_PLAYER_KEY},
                json=body,
                headers=_YT_PLAYER_HEADERS,
                timeout=20,
            )
        except requests.RequestException as exc:
            error = exc
            if attempt == 0:
                time.sleep(0.4)
    raise HTTPException(status_code=502, detail=f"YouTube player request failed: {error}") from error


def _youtube_player_uncached(video_id):
    response = _youtube_player_request(video_id, _YT_PLAYER_CLIENT["clientVersion"])
    if response.status_code == 400 and "Precondition check failed" in response.text:
        response = _youtube_player_request(video_id, _YT_PLAYER_FALLBACK_VERSION)
    if not response.ok:
        try:
            detail = response.json().get("error", {}).get("message") or response.text
        except ValueError:
            detail = response.text
        raise HTTPException(status_code=502, detail=f"YouTube player request failed: {detail}")
    try:
        return response.json()
    except ValueError as exc:
        raise HTTPException(status_code=502, detail="YouTube player returned invalid JSON") from exc


def _youtube_watch(video_id, related_limit):
    player = _youtube_cached(
        ("player", video_id),
        lambda: _youtube_player_uncached(video_id),
        ttl=300,
    )
    details = player.get("videoDetails") or {}
    playability = player.get("playabilityStatus") or {}
    micro = ((player.get("microformat") or {}).get("microformatDataRenderer") or {})
    status = playability.get("status") or "OK"

    if not details:
        reason = playability.get("reason") or "Video unavailable"
        code = 404 if status in {"ERROR", "UNPLAYABLE", "LOGIN_REQUIRED"} else 502
        raise HTTPException(status_code=code, detail=reason)

    title = details.get("title") or micro.get("title") or video_id
    channel = details.get("author") or ""
    channel_id = details.get("channelId") or ""
    description = details.get("shortDescription") or micro.get("description") or ""
    is_live = bool(details.get("isLive"))
    duration = "LIVE" if is_live else _format_duration(details.get("lengthSeconds"))
    thumbnails = (
        ((details.get("thumbnail") or {}).get("thumbnails"))
        or ((micro.get("thumbnail") or {}).get("thumbnails"))
        or []
    )
    thumbnail = thumbnails[-1].get("url", "") if thumbnails else f"https://i.ytimg.com/vi/{video_id}/hqdefault.jpg"
    embeddable = playability.get("playableInEmbed") is not False and status not in {
        "ERROR",
        "UNPLAYABLE",
        "LOGIN_REQUIRED",
    }

    related = []
    seen = {video_id}
    if related_limit:
        query = " ".join(part for part in [title, channel] if part)
        if query:
            try:
                for video in _youtube_search(query, limit=related_limit + 1):
                    if video["videoId"] not in seen:
                        seen.add(video["videoId"])
                        related.append(video)
                        if len(related) >= related_limit:
                            break
            except HTTPException:
                pass

    video = {
        "videoId": video_id,
        "title": title,
        "channel": channel,
        "channelId": channel_id,
        "description": description,
        "views": str(details.get("viewCount") or ""),
        "duration": duration,
        "isLive": is_live,
        "thumbnail": thumbnail,
        "publishDate": micro.get("publishDate") or "",
        "embeddable": embeddable,
        "status": status,
    }
    return {"video": video, "related": related[:related_limit]}


@router.get("/yt/home")
def yt_home(limit: int = Query(24, ge=1, le=40)):
    sections = _youtube_cached(
        ("home", limit),
        lambda: _youtube_home_sections(limit),
        ttl=300,
    )
    if not sections:
        raise HTTPException(status_code=502, detail="YouTube returned no videos")
    return JSONResponse({"sections": sections})


@router.get("/yt/search")
def yt_search(
    q: str = Query(..., min_length=1, description="Search query"),
    filter: str = Query("videos", description="videos|songs"),
    limit: int = Query(30, ge=1, le=100),
    ignore_spelling: bool = False,
):
    if filter not in {"videos", "songs"}:
        raise HTTPException(status_code=400, detail="filter must be 'videos' or 'songs'")
    query = q if filter == "videos" else f"{q} song"
    return JSONResponse({"query": q, "filter": filter, "results": _youtube_search(query, limit=limit)})


@router.get("/yt/video/{video_id}")
def yt_video(video_id: str, related_limit: int = Query(15, ge=0, le=30)):
    return JSONResponse(_youtube_watch(video_id, related_limit))
