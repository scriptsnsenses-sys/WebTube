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
def lyrics(browseId: str = Query(..., description="lyrics browseId from get_watch_playlist / get_album")):
    return JSONResponse(_call(get_client().get_lyrics, browseId))
