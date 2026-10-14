/* ytmusicapi player frontend — talks to the FastAPI service on the same origin. */
const $ = (id) => document.getElementById(id);
const statusEl = $("status"), resultsEl = $("results"), detailEl = $("detail"), homeEl = $("home");

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const thumb = (item, i = -1) => (item?.thumbnails?.length ? item.thumbnails[i < 0 ? item.thumbnails.length - 1 : i].url : "");
const artistNames = (item) => (item?.artists || []).map((a) => a.name).join(", ");
const setStatus = (t) => { statusEl.textContent = t || ""; };

async function api(path) {
  const r = await fetch(path);
  if (!r.ok) {
    let msg = r.statusText;
    try { msg = (await r.json()).detail || msg; } catch { /* ignore */ }
    throw new Error(`API ${r.status}: ${msg}`);
  }
  return r.json();
}

/* ---------- player ---------- */
let currentVideoId = null;
function play(videoId, title) {
  if (!videoId) return;
  currentVideoId = videoId;
  $("player").classList.remove("hidden");
  $("ytframe").src = `https://www.youtube.com/embed/${videoId}?autoplay=1&rel=0`;
  $("nowPlaying").textContent = "▶ " + (title || videoId);
  $("lyrics").classList.add("hidden");
  $("upnext").classList.add("hidden");
}
$("hideBtn").onclick = () => { $("player").classList.add("hidden"); $("ytframe").src = ""; };
$("lyricsBtn").onclick = async () => {
  if (!currentVideoId) return;
  setStatus("Loading lyrics…");
  try {
    const watch = await api(`/watch?videoId=${encodeURIComponent(currentVideoId)}&limit=1`);
    const track = (watch.tracks || [])[0] || {};
    const lyricsId = track.lyrics;
    if (!lyricsId) throw new Error("No lyrics for this track");
    const data = await api(`/lyrics?browseId=${encodeURIComponent(lyricsId)}`);
    $("lyrics").textContent = data.lyrics || "No lyrics text";
    $("lyrics").classList.remove("hidden");
    setStatus("");
  } catch (e) { setStatus(String(e.message || e)); }
};
$("upnextBtn").onclick = async () => {
  if (!currentVideoId) return;
  setStatus("Loading up next…");
  try {
    const watch = await api(`/watch?videoId=${encodeURIComponent(currentVideoId)}&limit=25`);
    const box = $("upnext");
    box.innerHTML = "<b>Up next</b>" + (watch.tracks || []).map((t) =>
      `<div class="upnext-item" data-vid="${esc(t.videoId || "")}"><b>${esc(t.title)}</b><br><span>${esc(artistNames(t))}</span></div>`
    ).join("");
    box.classList.remove("hidden");
    box.querySelectorAll("[data-vid]").forEach((el) =>
      el.onclick = () => play(el.dataset.vid, el.textContent.trim()));
    setStatus("");
  } catch (e) { setStatus(String(e.message || e)); }
};

/* ---------- search ---------- */
async function doSearch() {
  const q = $("q").value.trim();
  if (!q) return;
  detailEl.innerHTML = ""; homeEl.innerHTML = "";
  setStatus("Searching…");
  try {
    const params = new URLSearchParams({ q, limit: 24 });
    if ($("filter").value) params.set("filter", $("filter").value);
    const items = await api("/search?" + params);
    setStatus(`${items.length} result(s) for “${q}”`);
    resultsEl.innerHTML = `<h2>Results</h2><div class="grid">` + items.map((it, i) =>
      `<div class="card" data-idx="${i}"><img loading="lazy" src="${esc(thumb(it))}"><div class="t"><b>${esc(it.title)}</b><span>${esc(artistNames(it) || it.author || it.year || "")}</span><br><span class="badge">${esc(it.resultType || "")}</span></div></div>`
    ).join("") + `</div>`;
    resultsEl.querySelectorAll(".card").forEach((c) => { c.onclick = () => openResult(items[+c.dataset.idx]); });
  } catch (e) { setStatus(String(e.message || e)); }
}
$("searchBtn").onclick = doSearch;
$("q").addEventListener("keydown", (e) => { if (e.key === "Enter") doSearch(); });
$("homeLink").onclick = (e) => { e.preventDefault(); resultsEl.innerHTML = ""; detailEl.innerHTML = ""; loadHome(); };

function openResult(it) {
  const type = it.resultType;
  if (type === "song" || type === "video") { play(it.videoId, `${it.title} — ${artistNames(it)}`); showSong(it.videoId); }
  else if (type === "album") showAlbum(it.browseId);
  else if (type === "artist") showArtist(it.browseId);
  else if (type === "playlist") showPlaylist(String(it.browseId || "").replace(/^VL/, ""));
  else if (it.videoId) play(it.videoId, it.title);
  else if (it.browseId) showAlbum(it.browseId);
}

/* ---------- detail views ---------- */
function trackTable(tracks) {
  return `<table class="tracks"><tr><th>#</th><th>Title</th><th>Artists</th><th>Length</th></tr>` +
    tracks.map((t, i) => `<tr data-vid="${esc(t.videoId || "")}"><td>${i + 1}</td><td>${esc(t.title)}</td><td>${esc(artistNames(t))}</td><td>${esc(t.duration || "")}</td></tr>`).join("") + `</table>`;
}
function bindTracks(root) {
  root.querySelectorAll("tr[data-vid]").forEach((tr) => {
    tr.onclick = () => { if (tr.dataset.vid) play(tr.dataset.vid, tr.cells[1].textContent); };
  });
}
function head(img, title, sub) {
  return `<div class="detail-head">${img ? `<img src="${esc(img)}">` : ""}<div><h2>${esc(title)}</h2><div>${sub || ""}</div></div></div>`;
}

async function showSong(videoId) {
  setStatus("Loading song…");
  try {
    const s = await api(`/song/${encodeURIComponent(videoId)}`);
    const d = s.videoDetails || {};
    detailEl.innerHTML = head(thumb({ thumbnails: d.thumbnail?.thumbnails || [] }), d.title || "Song",
      `${esc(d.author || "")} · ${esc(d.lengthSeconds ? Math.floor(d.lengthSeconds / 60) + ":" + String(d.lengthSeconds % 60).padStart(2, "0") : "")}`);
    detailEl.scrollIntoView();
    setStatus("");
  } catch (e) { setStatus(String(e.message || e)); }
}

async function showAlbum(browseId) {
  setStatus("Loading album…");
  try {
    const a = await api(`/album/${encodeURIComponent(browseId)}`);
    detailEl.innerHTML = head(thumb({ thumbnails: a.thumbnails || [] }), a.title || "Album",
      `${esc(artistNames({ artists: a.artists }))} · ${esc(a.year || "")} · ${esc(a.trackCount || (a.tracks || []).length)} tracks`) + trackTable(a.tracks || []);
    bindTracks(detailEl);
    detailEl.scrollIntoView();
    setStatus("");
  } catch (e) { setStatus(String(e.message || e)); }
}

async function showArtist(channelId) {
  setStatus("Loading artist…");
  try {
    const a = await api(`/artist/${encodeURIComponent(channelId)}`);
    let html = head(thumb({ thumbnails: a.thumbnails || [] }), a.name || a.title || "Artist", esc(a.subscribers || ""));
    for (const sec of ["songs", "albums", "singles", "videos"]) {
      const secData = a[sec];
      const items = secData?.results || secData || [];
      if (Array.isArray(items) && items.length) {
        html += `<h3>${esc(secData?.title || sec)}</h3>`;
        if (sec === "songs" || sec === "videos") { html += trackTable(items); }
        else {
          html += `<div class="grid">` + items.map((it) =>
            `<div class="card" data-browse="${esc(it.browseId || "")}"><img loading="lazy" src="${esc(thumb(it))}"><div class="t"><b>${esc(it.title)}</b><span>${esc(it.year || "")}</span></div></div>`
          ).join("") + `</div>`;
        }
      }
    }
    detailEl.innerHTML = html;
    bindTracks(detailEl);
    detailEl.querySelectorAll("[data-browse]").forEach((c) => { c.onclick = () => showAlbum(c.dataset.browse); });
    detailEl.scrollIntoView();
    setStatus("");
  } catch (e) { setStatus(String(e.message || e)); }
}

async function showPlaylist(playlistId) {
  setStatus("Loading playlist…");
  try {
    const p = await api(`/playlist/${encodeURIComponent(playlistId)}?limit=100`);
    detailEl.innerHTML = head(thumb({ thumbnails: p.thumbnails || [] }), p.title || "Playlist",
      `${esc(p.author?.name || "")} · ${esc(p.trackCount || (p.tracks || []).length)} tracks<br>${esc(p.description || "").slice(0, 200)}`) +
      `<div><button class="small" id="radioBtn">▶ Radio from this playlist</button></div>` + trackTable(p.tracks || []);
    bindTracks(detailEl);
    const rb = $("radioBtn");
    if (rb) rb.onclick = async () => {
      const w = await api(`/watch?playlistId=${encodeURIComponent(playlistId)}&limit=25`);
      if (w.tracks?.length) play(w.tracks[0].videoId, w.tracks[0].title);
    };
    detailEl.scrollIntoView();
    setStatus("");
  } catch (e) { setStatus(String(e.message || e)); }
}

/* ---------- home ---------- */
async function loadHome() {
  setStatus("Loading home…");
  try {
    const rows = await api("/home?limit=3");
    homeEl.innerHTML = rows.map((row) =>
      `<h2>${esc(row.title)}</h2><div class="grid">` + (row.contents || []).map((it) => {
        const bid = esc(it.browseId || it.playlistId || "");
        const vid = esc(it.videoId || "");
        return `<div class="card" data-browse="${bid}" data-vid="${vid}"><img loading="lazy" src="${esc(thumb(it))}"><div class="t"><b>${esc(it.title)}</b><span>${esc(artistNames(it) || it.author || "")}</span></div></div>`;
      }).join("") + `</div>`
    ).join("");
    homeEl.querySelectorAll(".card").forEach((c) => {
      c.onclick = () => {
        if (c.dataset.vid) play(c.dataset.vid, c.textContent.trim());
        else if (c.dataset.browse) (c.dataset.browse.startsWith("UC") ? showArtist : c.dataset.browse.startsWith("MPRE") ? showAlbum : showPlaylist)(c.dataset.browse.replace(/^VL/, ""));
      };
    });
    setStatus("");
  } catch (e) { setStatus(String(e.message || e)); }
}

loadHome();
