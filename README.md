# YT Music free player and API
The repo contains code that enables you to host and run efficiently, a web music player. Powered by Youtube Music.

## What's Included
* No ADs
* Background Music
* No download required
* YouTube mode with video search, home feed, and a video watch page

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

(GET) /artist/{chanel_id}
Artist's chanel ID

(GET) /song/{video_id}
Play a song

(GET) /playlist/{playlist_id}
Fetch a playlist

(GET) /watch
Watch a music video

(GET) /lyrics
Fetch the lyrics.

(GET) /yt/home
YouTube mode home feed (trending videos, new videos, podcasts)

(GET) /yt/search
Search YouTube videos or songs

(GET) /yt/video/{video_id}
Video details and related videos for the watch page
```
Complete docs at the /docs endpoint, or you can use my hosted version: https://ytmusicapi-83b8.onrender.com/docs

My hosted version URL: https://ytmusicapi-83b8.onrender.com
{You can use it for free forever unlimited}

**Note: The software is hosted on Render and it falls asleep every 15 mins without interactivity so it may take some extra time around 30-50 sec to respond for the first query, after it no such extra delays. Upon opening the software in your browser, you may have to wait for the program to wake up. Sorry for misconvinience.**

Credits:
```
sigma67/ytmusicapi:
* API
* Framework
* YT Music backend

This software is a fork of this repo, make sure to check out the original version.

Link:
https://github.com/sigma67/ytmusicapi
```

**Software licensed as MIT. Feel free to modify and make your versions of the software.**

_Happy Coding_
