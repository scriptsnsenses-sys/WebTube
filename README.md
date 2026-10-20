# WebTube (powered by YouTube)

WebTube is a free, self-hostable web player powered by YouTube and YouTube Music through the open-source [`ytmusicapi`](https://github.com/sigma67/ytmusicapi) library.

It has two modes:

* **WebTube Music (powered by YouTube Music)** — search, stream, queue, and organize music.
* **WebTube (powered by YouTube)** — browse the video home feed, search videos, and watch with related videos.

## What's Included
* No ads
* Background music
* No download required
* WebTube Music mode with search, playback, playlists, queue, and lyrics
* WebTube video mode with home feed, video search, a watch page, and related videos

## Project Layout
* `server/music.py` — YouTube Music routes powered by `ytmusicapi`.
* `server/youtube.py` — standalone generic YouTube scraper and `/yt` routes.
* `server/app.py` — shared FastAPI app, static shell, and API metadata.

## API
Endpoints:

```
(GET) /api
API Info

(GET) /health
API Health

(GET) /search
Search for songs

(GET) /home
Shows top 50 songs. These songs were last updated by the library owner not me so these are outdated. Consider updating them or wait for me to update.

(GET) /artist/{channel_id}
Artist's channel ID

(GET) /song/{video_id}
Play a song

(GET) /playlist/{playlist_id}
Fetch a playlist

(GET) /watch
Watch a music video

(GET) /lyrics
Fetch the lyrics.

(GET) /yt/home
WebTube video mode home feed (trending, technology, gaming, news, comedy, sports, and trailers)

(GET) /yt/search
Search YouTube videos or songs

(GET) /yt/video/{video_id}
Video details and related videos for the watch page
```
Complete docs at the `/docs` endpoint, or use the hosted WebTube instance: https://ytmusicapi-83b8.onrender.com/docs

Hosted WebTube URL: https://ytmusicapi-83b8.onrender.com
{You can use it for free forever, unlimited}

**Note: WebTube is hosted on Render and falls asleep after 15 minutes without activity. The first request may take around 30–50 seconds while the app wakes up; later requests are fast. Sorry for the inconvenience.**

Credits:
```
sigma67/ytmusicapi:
* API
* Framework
* YouTube Music backend

WebTube is a fork of this repo, make sure to check out the original version.

Link:
https://github.com/sigma67/ytmusicapi
```

**Software licensed as MIT. Feel free to modify and make your own versions of WebTube.**

_Happy Coding_
