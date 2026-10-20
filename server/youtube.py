"""YouTube video mode backed by the YoutubeExplode bridge."""

import os
import time
from concurrent.futures import ThreadPoolExecutor
from urllib.parse import quote

import requests
from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import JSONResponse, Response, StreamingResponse

router = APIRouter()

_BRIDGE_URL = os.environ.get("YOUTUBE_BRIDGE_URL", "http://127.0.0.1:5001").rstrip("/")
_CACHE = {}
_CACHE_TTL = 600
_HOME_QUERIES = [
    ("Trending now", "trending videos"),
    ("Technology", "technology"),
    ("Gaming", "gaming"),
    ("News & politics", "news"),
    ("Comedy", "comedy"),
    ("Sports", "sports highlights"),
    ("Movies & trailers", "movie trailers"),
]
_STREAM_KINDS = {"muxed", "video", "audio"}
_STREAM_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/131.0.0.0 Safari/537.36"
    ),
    "Accept": "*/*",
    "Origin": "https://www.youtube.com",
    "Referer": "https://www.youtube.com/",
}


def _bridge(path, params=None, timeout=60):
    url = f"{_BRIDGE_URL}{path}"
    error = None
    for attempt in range(2):
        try:
            response = requests.get(url, params=params, timeout=timeout)
            if response.status_code >= 400:
                try:
                    detail = response.json().get("detail") or response.text
                except ValueError:
                    detail = response.text
                status = 502 if response.status_code >= 500 else response.status_code
                raise HTTPException(status_code=status, detail=f"YouTube: {detail}")
            return response.json()
        except HTTPException:
            raise
        except (requests.RequestException, ValueError) as exc:
            error = exc
            if attempt == 0:
                time.sleep(0.4)
    raise HTTPException(
        status_code=502,
        detail=(
            "The YoutubeExplode bridge is unavailable. "
            "Start it with ./start.sh or run the bridge project separately."
        ),
    ) from error


def _cached(key, loader, ttl=_CACHE_TTL):
    now = time.monotonic()
    cached = _CACHE.get(key)
    if cached and now - cached[0] < ttl:
        return cached[1]
    value = loader()
    if len(_CACHE) > 256:
        _CACHE.clear()
    _CACHE[key] = (now, value)
    return value


def _search(query, limit=24):
    return _cached(
        ("search", query.strip().lower(), limit),
        lambda: _bridge("/search", {"q": query, "limit": limit})["results"],
        ttl=180,
    )


def _home_sections(limit):
    def load(entry):
        title, query = entry
        try:
            videos = _search(query, limit=limit)
        except HTTPException:
            videos = []
        return {"title": title, "videos": videos} if videos else None

    with ThreadPoolExecutor(max_workers=len(_HOME_QUERIES)) as pool:
        sections = list(pool.map(load, _HOME_QUERIES))
    return [section for section in sections if section]


def _video(video_id):
    return _cached(
        ("video", video_id),
        lambda: _bridge(f"/video/{quote(video_id, safe='')}")["video"],
        ttl=300,
    )


def _watch(video_id, related_limit):
    video = _video(video_id)
    related = []
    seen = {video_id}
    if related_limit:
        query = " ".join(part for part in [video.get("title"), video.get("channel")] if part)
        if query:
            try:
                for item in _search(query, limit=related_limit + 1):
                    if item["videoId"] not in seen:
                        seen.add(item["videoId"])
                        related.append(item)
                        if len(related) >= related_limit:
                            break
            except HTTPException:
                pass
    return {"video": video, "related": related}


def _streams(video_id, refresh=False):
    key = ("streams", video_id)
    if refresh:
        _CACHE.pop(key, None)
    return _cached(
        key,
        lambda: _bridge(f"/streams/{quote(video_id, safe='')}"),
        ttl=120,
    )


def _stream_headers(upstream):
    headers = {}
    for name in ("Content-Length", "Content-Range", "Accept-Ranges", "ETag", "Last-Modified"):
        value = upstream.headers.get(name)
        if value:
            headers[name] = value
    headers["Cache-Control"] = "no-store"
    return headers


def _open_stream(url, range_header, method):
    headers = dict(_STREAM_HEADERS)
    if range_header:
        headers["Range"] = range_header
    return requests.request(
        method,
        url,
        headers=headers,
        stream=True,
        timeout=(10, 90),
        allow_redirects=True,
    )


@router.get("/yt/home")
def yt_home(limit: int = Query(24, ge=1, le=40)):
    sections = _cached(("home", limit), lambda: _home_sections(limit), ttl=300)
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
    return JSONResponse({"query": q, "filter": filter, "results": _search(query, limit=limit)})


@router.get("/yt/video/{video_id}")
def yt_video(video_id: str, related_limit: int = Query(15, ge=0, le=30)):
    return JSONResponse(_watch(video_id, related_limit))


@router.get("/yt/streams/{video_id}")
def yt_streams(video_id: str):
    data = _streams(video_id)
    available = {
        kind: bool(data.get(kind))
        for kind in _STREAM_KINDS
    }
    if not available["muxed"] and not (available["video"] and available["audio"]):
        raise HTTPException(status_code=404, detail="No playable streams found for this video")
    video_stream = data.get("video") or {}
    return JSONResponse(
        {
            "videoId": video_id,
            **available,
            "quality": video_stream.get("quality"),
            "width": video_stream.get("width"),
            "height": video_stream.get("height"),
            "streams": {
                kind: f"/yt/stream/{quote(video_id, safe='')}/{kind}"
                for kind, is_available in available.items()
                if is_available
            },
        }
    )


@router.api_route("/yt/stream/{video_id}/{kind}", methods=["GET", "HEAD"])
def yt_stream(video_id: str, kind: str, request: Request):
    if kind not in _STREAM_KINDS:
        raise HTTPException(status_code=404, detail="Unknown stream type")

    range_header = request.headers.get("range")
    upstream = None
    for attempt in range(2):
        data = _streams(video_id, refresh=attempt > 0)
        stream = data.get(kind)
        if not stream or not stream.get("url"):
            raise HTTPException(status_code=404, detail=f"No {kind} stream available")

        upstream = _open_stream(stream["url"], range_header, request.method)
        if upstream.status_code in {403, 404, 410} and attempt == 0:
            upstream.close()
            upstream = None
            continue
        break

    if upstream is None:
        raise HTTPException(status_code=502, detail="Could not open the YouTube stream")

    media_type = upstream.headers.get("Content-Type") or "application/octet-stream"
    headers = _stream_headers(upstream)

    if upstream.status_code == 416:
        upstream.close()
        return Response(status_code=416, headers=headers)

    if upstream.status_code >= 400:
        status = upstream.status_code
        upstream.close()
        raise HTTPException(status_code=502 if status >= 500 else status, detail="YouTube stream request failed")

    if request.method == "HEAD":
        upstream.close()
        return Response(status_code=upstream.status_code, headers=headers, media_type=media_type)

    def body():
        try:
            for chunk in upstream.iter_content(chunk_size=64 * 1024):
                if chunk:
                    yield chunk
        finally:
            upstream.close()

    return StreamingResponse(
        body(),
        status_code=upstream.status_code,
        media_type=media_type,
        headers=headers,
    )
