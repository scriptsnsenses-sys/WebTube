/* YTMusic player — same-origin FastAPI backend. */
const $ = (id) => document.getElementById(id);
const statusEl = $("status"), resultsEl = $("results"), detailEl = $("detail"), homeEl = $("home");

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const setStatus = (t) => { statusEl.textContent = t || ""; };
const artistNames = (it) => (it?.artists || []).map((a) => a.name).join(", ");
const ytThumb = (vid) => vid ? `https://i.ytimg.com/vi/${vid}/hqdefault.jpg` : "";

function thumbOf(it) {
  if (!it) return "";
  if (Array.isArray(it.thumbnails) && it.thumbnails.length) return it.thumbnails[it.thumbnails.length - 1].url;
  const th = it.thumbnail;
  if (typeof th === "string") return th;
  if (th && Array.isArray(th.thumbnails) && th.thumbnails.length) return th.thumbnails[th.thumbnails.length - 1].url;
  if (it.videoId) return ytThumb(it.videoId);
  return "";
}

async function api(path) {
  const r = await fetch(path);
  if (!r.ok) {
    let msg = r.statusText;
    try { msg = (await r.json()).detail || msg; } catch { /* ignore */ }
    throw new Error(msg);
  }
  return r.json();
}

/* ---------- player state ---------- */
let current = { videoId: null, title: "", sub: "" };
let queueFor = null;

/* ---------- recent searches (localStorage) ---------- */
const RS_KEY = "ytm_recent_searches";
const getRecents = () => { try { return JSON.parse(localStorage.getItem(RS_KEY)) || []; } catch { return []; } };
function saveRecent(q) {
  q = (q || "").trim();
  if (!q) return;
  const r = getRecents().filter((x) => x.toLowerCase() !== q.toLowerCase());
  r.unshift(q);
  try { localStorage.setItem(RS_KEY, JSON.stringify(r.slice(0, 10))); } catch { /* ignore */ }
}
function renderRecents() {
  const panel = $("recentPanel");
  const recents = getRecents();
  panel.innerHTML = `<div class="recent-head">Recent searches</div>` + (recents.length ? recents.map((q, i) => `
    <div class="recent-item" data-i="${i}">
      <span class="clock">🕐</span><span class="txt">${esc(q)}</span><button class="rm" data-rm="${i}" title="Remove">✕</button>
    </div>`).join("") : `<div class="recent-empty">No recent searches</div>`);
  panel.querySelectorAll(".recent-item").forEach((el) => {
    el.onclick = (e) => {
      if (e.target.dataset.rm !== undefined) {
        const r = getRecents();
        r.splice(+e.target.dataset.rm, 1);
        try { localStorage.setItem(RS_KEY, JSON.stringify(r)); } catch { /* ignore */ }
        renderRecents();
        return;
      }
      $("q").value = recents[+el.dataset.i];
      panel.classList.add("hidden");
      doSearch();
    };
  });
}
$("q").addEventListener("focus", () => { renderRecents(); $("recentPanel").classList.remove("hidden"); });
$("q").addEventListener("click", () => { renderRecents(); $("recentPanel").classList.remove("hidden"); });
$("q").addEventListener("blur", () => { setTimeout(() => $("recentPanel").classList.add("hidden"), 150); });

/* ---------- continue listening (localStorage, newest first) ---------- */
const RP_KEY = "ytm_recently_played";
const getPlayed = () => { try { return JSON.parse(localStorage.getItem(RP_KEY)) || []; } catch { return []; } };
function pushPlayed(videoId, title, sub) {
  if (!videoId) return;
  const list = getPlayed().filter((x) => x.videoId !== videoId);
  list.unshift({ videoId, title: title || videoId, sub: sub || "", at: Date.now() });
  try { localStorage.setItem(RP_KEY, JSON.stringify(list.slice(0, 20))); } catch { /* ignore */ }
}
function renderContinue() {
  const box = $("continue");
  const list = getPlayed();
  if (!list.length) { box.innerHTML = ""; return; }
  box.innerHTML = `<h2 class="shelf-title">Continue listening</h2><div class="shelf-row">` + list.map((t) => `
    <button class="card" data-vid="${esc(t.videoId)}" data-title="${esc(t.title)}" data-sub="${esc(t.sub)}">
      <span class="art"><img loading="lazy" src="${esc(ytThumb(t.videoId))}" alt=""><span class="veil"><span class="playdot">▶</span></span></span>
      <span class="meta"><b>${esc(t.title)}</b><span>${esc(t.sub)}</span></span>
    </button>`).join("") + `</div>`;
  box.querySelectorAll(".card").forEach((c) => {
    c.onclick = () => play(c.dataset.vid, c.dataset.title, c.dataset.sub);
  });
}

function play(videoId, title, sub) {
  if (!videoId) return;
  current = { videoId, title: title || videoId, sub: sub || "" };
  queueFor = null;
  pushPlayed(videoId, current.title, current.sub);
  renderContinue();
  $("player").classList.remove("hidden");
  $("sheet").classList.remove("hidden");
  $("ytframe").src = `https://www.youtube.com/embed/${videoId}?autoplay=1&rel=0`;
  $("nowPlaying").textContent = current.title;
  $("nowSub").textContent = current.sub;
  $("ptumb").src = ytThumb(videoId);
  showPane("upnext");
  loadQueue(videoId);
}
function openSheet() { $("sheet").classList.remove("hidden"); }
function showPane(which) {
  $("tabQueue").classList.toggle("active", which === "upnext");
  $("tabLyrics").classList.toggle("active", which === "lyrics");
  $("upnext").classList.toggle("hidden", which !== "upnext");
  $("lyrics").classList.toggle("hidden", which !== "lyrics");
}
$("tabQueue").onclick = () => { showPane("upnext"); if (current.videoId) loadQueue(current.videoId); };
$("tabLyrics").onclick = () => { showPane("lyrics"); if (current.videoId) loadLyrics(current.videoId); };
$("watchBtn").onclick = () => { $("sheet").classList.toggle("hidden"); };
$("hideBtn").onclick = () => { $("player").classList.add("hidden"); $("sheet").classList.add("hidden"); $("ytframe").src = ""; current.videoId = null; };
$("upnextBtn").onclick = () => { if (!current.videoId) return; openSheet(); showPane("upnext"); loadQueue(current.videoId); };
$("lyricsBtn").onclick = () => { if (!current.videoId) return; openSheet(); showPane("lyrics"); loadLyrics(current.videoId); };

async function loadQueue(videoId) {
  if (queueFor === videoId && $("upnext").dataset.loaded) return;
  try {
    const w = await api(`/watch?videoId=${encodeURIComponent(videoId)}&limit=25`);
    queueFor = videoId;
    $("upnext").dataset.loaded = "1";
    $("upnext").innerHTML = (w.tracks || []).map((t) => `
      <div class="qitem" data-vid="${esc(t.videoId || "")}" data-title="${esc(t.title || "")}" data-sub="${esc(artistNames(t))}">
        <img loading="lazy" src="${esc(thumbOf(t))}"><div><b>${esc(t.title)}</b><span>${esc(artistNames(t))}</span></div>
      </div>`).join("") || "<div class='qitem'>Queue is empty</div>";
    $("upnext").querySelectorAll(".qitem[data-vid]").forEach((el) => {
      el.onclick = () => play(el.dataset.vid, el.dataset.title, el.dataset.sub);
    });
  } catch (e) { $("upnext").innerHTML = `<div class="qitem">Queue failed: ${esc(e.message)}</div>`; }
}

async function loadLyrics(videoId) {
  const box = $("lyrics");
  box.textContent = "Loading lyrics…";
  try {
    const d = await api(`/lyrics?videoId=${encodeURIComponent(videoId)}`);
    const text = Array.isArray(d.lyrics) ? d.lyrics.map((l) => l.text).join("\n") : (d.lyrics || "");
    box.innerHTML = esc(text || "No lyrics text returned.") + (d.source ? `<span class="src">${esc(d.source)}</span>` : "");
  } catch (e) { box.textContent = "Lyrics unavailable: " + e.message; }
}

/* ---------- search ---------- */
document.querySelectorAll(".chip").forEach((c) => {
  c.onclick = () => {
    document.querySelectorAll(".chip").forEach((x) => x.classList.remove("active"));
    c.classList.add("active");
    if ($("q").value.trim()) doSearch();
  };
});
const activeFilter = () => document.querySelector(".chip.active")?.dataset.filter || "";

async function doSearch() {
  const q = $("q").value.trim();
  if (!q) return;
  saveRecent(q);
  $("recentPanel").classList.add("hidden");
  detailEl.innerHTML = ""; homeEl.innerHTML = "";
  setStatus("Searching…");
  try {
    const p = new URLSearchParams({ q, limit: 24 });
    if (activeFilter()) p.set("filter", activeFilter());
    const items = await api("/search?" + p);
    setStatus(items.length ? `${items.length} result(s) for “${q}”` : `No results for “${q}”`);
    resultsEl.innerHTML = `<h2 class="shelf-title">Results</h2><div class="grid">` + items.map((it, i) => card(it, i)).join("") + `</div>`;
    bindCards(resultsEl, items);
  } catch (e) { setStatus("Search failed: " + e.message); }
}
$("searchBtn").onclick = doSearch;
$("q").addEventListener("keydown", (e) => { if (e.key === "Enter") doSearch(); });
const goHome = (e) => { if (e) e.preventDefault(); resultsEl.innerHTML = ""; detailEl.innerHTML = ""; loadHome(); };
$("homeLink").onclick = goHome;
$("brandHome").onclick = goHome;

function card(it, i) {
  return `<button class="card" data-idx="${i}">
    <span class="art"><img loading="lazy" src="${esc(thumbOf(it))}" alt=""><span class="veil"><span class="playdot">▶</span></span></span>
    <span class="meta"><b>${esc(it.title)}</b><span>${esc(artistNames(it) || it.author || "")}</span></span>
  </button>`;
}
function bindCards(root, items) {
  root.querySelectorAll(".card").forEach((c) => { c.onclick = () => openResult(items[+c.dataset.idx]); });
}

function openResult(it) {
  const type = it.resultType;
  if (type === "song" || type === "video") play(it.videoId, it.title, artistNames(it));
  else if (type === "album") showAlbum(it.browseId);
  else if (type === "artist") showArtist(it.browseId);
  else if (type === "playlist") showPlaylist(String(it.browseId || "").replace(/^VL/, ""));
  else if (it.videoId) play(it.videoId, it.title, artistNames(it));
  else if (it.browseId) showAlbum(it.browseId);
}

/* ---------- detail views ---------- */
function hero(kind, img, title, sub, firstVid, radioId) {
  return `<div class="hero">
    ${img ? `<img src="${esc(img)}" alt="">` : ""}
    <div><div class="kicker">${esc(kind)}</div><h1>${esc(title)}</h1><div class="sub">${sub}</div>
    <div class="actions">
      ${firstVid ? `<button class="btn-primary" id="heroPlay">▶ Play</button>` : ""}
      ${radioId ? `<button class="btn-ghost" id="heroRadio">Radio</button>` : ""}
    </div></div>
  </div>`;
}
function trackRows(tracks) {
  return `<div class="thead"><span>#</span><span></span><span>Title</span><span>Time</span></div>` + tracks.map((t, i) => `
    <div class="trow" data-vid="${esc(t.videoId || "")}" data-title="${esc(t.title || "")}" data-sub="${esc(artistNames(t))}">
      <span class="n">${i + 1}</span><img loading="lazy" src="${esc(thumbOf(t))}" alt="">
      <span class="tt"><b>${esc(t.title)}</b><span>${esc(artistNames(t))}</span></span>
      <span class="dur">${esc(t.duration || t.length || "")}</span>
    </div>`).join("");
}
function bindRows(root) {
  root.querySelectorAll(".trow[data-vid]").forEach((r) => {
    r.onclick = () => { if (r.dataset.vid) play(r.dataset.vid, r.dataset.title, r.dataset.sub); };
  });
}
const firstVid = (tracks) => (tracks || []).find((t) => t.videoId)?.videoId || null;

async function showAlbum(browseId) {
  setStatus("Loading album…");
  try {
    const a = await api(`/album/${encodeURIComponent(browseId)}`);
    const tracks = a.tracks || [];
    detailEl.innerHTML = hero("Album", thumbOf(a), a.title || "Album",
      `${esc(artistNames({ artists: a.artists }))} · ${esc(a.year || "")} · ${tracks.length} songs`,
      firstVid(tracks), null) + trackRows(tracks);
    bindRows(detailEl);
    const hp = $("heroPlay");
    if (hp && tracks.length) hp.onclick = () => { const t = tracks.find((x) => x.videoId); play(t.videoId, t.title, artistNames(t)); };
    detailEl.scrollIntoView({ behavior: "smooth" });
    setStatus("");
  } catch (e) { setStatus("Album failed: " + e.message); }
}

async function showArtist(channelId) {
  setStatus("Loading artist…");
  try {
    const a = await api(`/artist/${encodeURIComponent(channelId)}`);
    const songs = a.songs?.results || a.songs || [];
    detailEl.innerHTML = hero("Artist", thumbOf(a), a.name || a.title || "Artist", esc(a.subscribers || ""),
      firstVid(songs), channelId) +
      (songs.length ? `<h2 class="shelf-title">Top songs</h2>` + trackRows(songs.slice(0, 10)) : "") +
      ["albums", "singles", "videos"].map((sec) => {
        const s = a[sec]; const items = s?.results || s || [];
        if (!Array.isArray(items) || !items.length) return "";
        return `<h2 class="shelf-title">${esc(s?.title || sec)}</h2><div class="shelf-row">` +
          items.map((it, i) => card(it, i)).join("") + `</div>`;
      }).join("");
    bindRows(detailEl);
    detailEl.querySelectorAll(".shelf-row").forEach((row, ri) => {
      const sec = ["albums", "singles", "videos"][ri];
      const s = a[sec]; const items = s?.results || s || [];
      row.querySelectorAll(".card").forEach((c) => {
        const it = items[+c.dataset.idx];
        c.onclick = () => {
          if (it.videoId) play(it.videoId, it.title, artistNames(it));
          else if (it.browseId) showAlbum(it.browseId);
        };
      });
    });
    const hp = $("heroPlay");
    if (hp) hp.onclick = () => { const t = songs.find((x) => x.videoId); play(t.videoId, t.title, artistNames(t)); };
    const hr = $("heroRadio");
    if (hr) hr.onclick = async () => {
      const t = songs.find((x) => x.videoId);
      if (t) { const w = await api(`/watch?videoId=${encodeURIComponent(t.videoId)}&radio=true&limit=25`); if (w.tracks?.length) play(w.tracks[0].videoId, w.tracks[0].title, artistNames(w.tracks[0])); }
    };
    detailEl.scrollIntoView({ behavior: "smooth" });
    setStatus("");
  } catch (e) { setStatus("Artist failed: " + e.message); }
}

async function showPlaylist(playlistId) {
  setStatus("Loading playlist…");
  try {
    const p = await api(`/playlist/${encodeURIComponent(playlistId)}?limit=100`);
    const tracks = p.tracks || [];
    detailEl.innerHTML = hero("Playlist", thumbOf(p), p.title || "Playlist",
      `${esc(p.author?.name || "")} · ${esc(p.trackCount || tracks.length)} songs`,
      firstVid(tracks), playlistId) + trackRows(tracks);
    bindRows(detailEl);
    const hp = $("heroPlay");
    if (hp && tracks.length) hp.onclick = () => { const t = tracks.find((x) => x.videoId); play(t.videoId, t.title, artistNames(t)); };
    const hr = $("heroRadio");
    if (hr) hr.onclick = async () => {
      const w = await api(`/watch?playlistId=${encodeURIComponent(playlistId)}&limit=25`);
      if (w.tracks?.length) play(w.tracks[0].videoId, w.tracks[0].title, artistNames(w.tracks[0]));
    };
    detailEl.scrollIntoView({ behavior: "smooth" });
    setStatus("");
  } catch (e) { setStatus("Playlist failed: " + e.message); }
}

/* ---------- home shelves ---------- */
async function loadHome() {
  setStatus("Loading home…");
  try {
    const rows = await api("/home?limit=3");
    homeEl.innerHTML = rows.map((row) =>
      `<h2 class="shelf-title">${esc(row.title)}</h2><div class="shelf-row">` + (row.contents || []).map((it) => {
        const bid = it.browseId || it.playlistId || "";
        return `<button class="card" data-browse="${esc(bid)}" data-vid="${esc(it.videoId || "")}">
          <span class="art"><img loading="lazy" src="${esc(thumbOf(it))}" alt=""><span class="veil"><span class="playdot">▶</span></span></span>
          <span class="meta"><b>${esc(it.title)}</b><span>${esc(artistNames(it) || "")}</span></span>
        </button>`;
      }).join("") + `</div>`
    ).join("");
    homeEl.querySelectorAll(".card").forEach((c) => {
      c.onclick = () => {
        if (c.dataset.vid) play(c.dataset.vid, c.textContent.trim().slice(0, 80), "");
        else if (c.dataset.browse) {
          const b = c.dataset.browse;
          if (b.startsWith("UC")) showArtist(b);
          else if (b.startsWith("MPRE")) showAlbum(b);
          else showPlaylist(b.replace(/^VL/, ""));
        }
      };
    });
    setStatus("");
  } catch (e) { setStatus("Home failed: " + e.message); }
}

renderContinue();
loadHome();
