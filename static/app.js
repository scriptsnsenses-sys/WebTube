/* YTMusic player — same-origin FastAPI backend.
   Queue engine (YouTube IFrame API, auto-advance), user playlists (localStorage),
   right-click menu, recent searches, continue listening. */
const $ = (id) => document.getElementById(id);
const statusEl = $("status"), resultsEl = $("results"), detailEl = $("detail"), homeEl = $("home");

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const setStatus = (t) => { statusEl.textContent = t || ""; };
const artistNames = (it) => (it?.artists || []).map((a) => a.name).join(", ");
const ytThumb = (vid) => vid ? `https://i.ytimg.com/vi/${vid}/hqdefault.jpg` : "";
const normTrack = (t) => ({ videoId: t.videoId, title: t.title || t.videoId, sub: artistNames(t) || t.author || "" });

function thumbOf(it) {
  if (!it) return "";
  if (Array.isArray(it.thumbnails) && it.thumbnails.length) return it.thumbnails[it.thumbnails.length - 1].url;
  const th = it.thumbnail;
  if (typeof th === "string") return th;
  if (th && Array.isArray(th.thumbnails) && th.thumbnails.length) return th.thumbnails[th.thumbnails.length - 1].url;
  if (it.videoId) return ytThumb(it.videoId);
  return "";
}
/* "Artist • Album • 2:56 • 282M plays" like the reference */
function subLine(t) {
  const parts = [];
  const an = artistNames(t) || t.author || "";
  if (an) parts.push(an);
  const al = t.album?.name || (typeof t.album === "string" ? t.album : "");
  if (al) parts.push(al);
  const d = t.duration || t.length || "";
  if (d) parts.push(d);
  let v = t.views ?? t.plays ?? "";
  if (v && typeof v === "string" && !/plays?$/i.test(v) && !/^\d+$/.test(v)) v += " plays";
  if (v) parts.push(v);
  return parts.join(" • ");
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
let toastTimer = null;
function toast(msg) {
  const el = $("toast");
  el.textContent = msg;
  el.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add("hidden"), 2200);
}

/* ================= queue engine (auto-advance) ================= */
let queue = [];   // [{videoId, title, sub}]
let qIndex = -1;
let ytPlayer = null, ytReady = false, pendingVid = null;

function loadYTAPI() {
  if (window.YT && window.YT.Player) { ytReady = true; return; }
  if (document.querySelector('script[data-ytapi]')) return;
  const s = document.createElement("script");
  s.dataset.ytapi = "1";
  s.src = "https://www.youtube.com/iframe_api";
  document.head.appendChild(s);
}
window.onYouTubeIframeAPIReady = () => {
  ytReady = true;
  if (pendingVid) { createPlayer(pendingVid); pendingVid = null; }
};
function createPlayer(videoId) {
  ytPlayer = new window.YT.Player("ytplayer", {
    videoId,
    playerVars: { autoplay: 1, rel: 0 },
    events: { onStateChange: onPlayerState },
  });
}
function onPlayerState(e) {
  if (window.YT && e.data === window.YT.PlayerState.ENDED) advance();
}
function loadCurrent() {
  const t = queue[qIndex];
  if (!t) return;
  $("nowPlaying").textContent = t.title;
  $("nowSub").textContent = t.sub;
  $("ptumb").src = ytThumb(t.videoId);
  renderQueue();
  if (ytPlayer && ytPlayer.loadVideoById) ytPlayer.loadVideoById(t.videoId);
  else if (ytReady) createPlayer(t.videoId);
  else { pendingVid = t.videoId; loadYTAPI(); }
}
function advance() {
  if (qIndex + 1 < queue.length) { qIndex++; loadCurrent(); pushPlayed(queue[qIndex]); renderContinue(); }
  else setStatus("Queue ended");
}
/* play a track; optionally make it part of a list (auto-advance continues through it) */
function play(videoId, title, sub, list, idx) {
  if (!videoId) return;
  if (Array.isArray(list) && list.length) {
    queue = list.map(normTrack).filter((t) => t.videoId);
    qIndex = Math.max(0, idx || 0);
    if (!queue[qIndex] || queue[qIndex].videoId !== videoId) {
      const found = queue.findIndex((t) => t.videoId === videoId);
      qIndex = found >= 0 ? found : 0;
    }
  } else {
    queue = [normTrack({ videoId, title, sub: "" })];
    queue[0].title = title || videoId;
    queue[0].sub = sub || "";
    qIndex = 0;
  }
  $("player").classList.remove("hidden");
  $("sheet").classList.remove("hidden");
  $("upnext").dataset.loaded = "";
  loadCurrent();
  showPane("upnext");
  pushPlayed(videoId, title, sub);
  renderContinue();
}
function playNextTrack(t) {
  t = normTrack(t);
  if (!t.videoId) return;
  if (qIndex < 0) { play(t.videoId, t.title, t.sub); return; }
  queue = queue.filter((x, i) => i === qIndex || x.videoId !== t.videoId);
  queue.splice(qIndex + 1, 0, t);
  renderQueue();
  toast(`Playing next: ${t.title}`);
}
function renderQueue() {
  const box = $("upnext");
  box.dataset.loaded = "1";
  box.innerHTML = queue.length ? queue.map((t, i) => `
    <div class="qitem${i === qIndex ? " current" : ""}" data-i="${i}">
      <img loading="lazy" src="${esc(ytThumb(t.videoId))}"><div><b>${esc(t.title)}</b><span>${esc(t.sub)}</span></div>
    </div>`).join("") : "<div class='qitem'>Queue is empty — play something!</div>";
  box.querySelectorAll(".qitem[data-i]").forEach((el) => {
    el.onclick = () => { qIndex = +el.dataset.i; loadCurrent(); };
    el.oncontextmenu = (e) => { e.preventDefault(); openCtx(queue[+el.dataset.i], e.clientX, e.clientY); };
  });
}
async function loadRadio(videoId) {
  try {
    const w = await api(`/watch?videoId=${encodeURIComponent(videoId)}&limit=25`);
    queue = (w.tracks || []).map(normTrack).filter((t) => t.videoId);
    qIndex = 0;
    renderQueue();
  } catch (e) { setStatus("Queue failed: " + e.message); }
}

function openSheet() { $("sheet").classList.remove("hidden"); }
function showPane(which) {
  $("tabQueue").classList.toggle("active", which === "upnext");
  $("tabLyrics").classList.toggle("active", which === "lyrics");
  $("upnext").classList.toggle("hidden", which !== "upnext");
  $("lyrics").classList.toggle("hidden", which !== "lyrics");
}
$("tabQueue").onclick = () => { showPane("upnext"); renderQueue(); };
$("tabLyrics").onclick = () => { showPane("lyrics"); if (queue[qIndex]) loadLyrics(queue[qIndex].videoId); };
$("watchBtn").onclick = () => { $("sheet").classList.toggle("hidden"); };
$("hideBtn").onclick = () => {
  $("player").classList.add("hidden"); $("sheet").classList.add("hidden");
  try { ytPlayer && ytPlayer.stopVideo && ytPlayer.stopVideo(); } catch { /* ignore */ }
  queue = []; qIndex = -1;
};
$("upnextBtn").onclick = () => { openSheet(); showPane("upnext"); renderQueue(); };
$("lyricsBtn").onclick = () => {
  if (qIndex < 0) return;
  openSheet(); showPane("lyrics"); loadLyrics(queue[qIndex].videoId);
};
async function loadLyrics(videoId) {
  const box = $("lyrics");
  box.textContent = "Loading lyrics…";
  try {
    const d = await api(`/lyrics?videoId=${encodeURIComponent(videoId)}`);
    const text = Array.isArray(d.lyrics) ? d.lyrics.map((l) => l.text).join("\n") : (d.lyrics || "");
    box.innerHTML = esc(text || "No lyrics text returned.") + (d.source ? `<span class="src">${esc(d.source)}</span>` : "");
  } catch (e) { box.textContent = "Lyrics unavailable: " + e.message; }
}

/* ================= right-click menu ================= */
let ctxTrack = null;
function openCtx(track, x, y) {
  ctxTrack = normTrack(track);
  if (!ctxTrack.videoId) return;
  const m = $("ctxmenu");
  m.classList.remove("hidden");
  m.style.left = Math.min(x, window.innerWidth - 190) + "px";
  m.style.top = Math.min(y, window.innerHeight - 110) + "px";
}
function closeCtx() { $("ctxmenu").classList.add("hidden"); ctxTrack = null; }
document.addEventListener("click", (e) => { if (!e.target.closest("#ctxmenu") && !e.target.closest(".dots")) closeCtx(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape") { closeCtx(); closePlModal(); } });
$("ctxNext").onclick = () => { if (ctxTrack) playNextTrack(ctxTrack); closeCtx(); };
$("ctxAdd").onclick = () => { if (ctxTrack) openPlModal(ctxTrack); closeCtx(); };

/* ================= user playlists (localStorage) ================= */
const PL_KEY = "ytm_user_playlists";
const getPlaylists = () => { try { return JSON.parse(localStorage.getItem(PL_KEY)) || []; } catch { return []; } };
const savePlaylists = (p) => { try { localStorage.setItem(PL_KEY, JSON.stringify(p)); } catch { /* ignore */ } };
function createPlaylist(name) {
  name = (name || "").trim();
  if (!name) return null;
  const pls = getPlaylists();
  const pl = { id: "pl_" + Date.now(), name, tracks: [] };
  pls.unshift(pl);
  savePlaylists(pls);
  return pl;
}
function addTrackToPlaylist(plId, track) {
  const pls = getPlaylists();
  const pl = pls.find((p) => p.id === plId);
  if (!pl) return false;
  track = normTrack(track);
  if (!pl.tracks.some((t) => t.videoId === track.videoId)) pl.tracks.push(track);
  savePlaylists(pls);
  return true;
}
let plModalTrack = null;
function openPlModal(track) {
  plModalTrack = normTrack(track);
  $("pltarget").textContent = `${plModalTrack.title} — ${plModalTrack.sub}`;
  renderPlModal();
  $("plmodal").classList.remove("hidden");
}
function closePlModal() { $("plmodal").classList.add("hidden"); plModalTrack = null; }
function renderPlModal() {
  const pls = getPlaylists();
  $("pllist").innerHTML = pls.length ? pls.map((p) => `
    <div class="plrow" data-id="${esc(p.id)}"><span>📝</span><span class="plname">${esc(p.name)}</span><span class="plcount">${p.tracks.length} songs</span></div>
  `).join("") : `<div class="recent-empty">No playlists yet — create one below.</div>`;
  $("pllist").querySelectorAll(".plrow").forEach((el) => {
    el.onclick = () => {
      if (addTrackToPlaylist(el.dataset.id, plModalTrack)) {
        const p = getPlaylists().find((x) => x.id === el.dataset.id);
        toast(`Added to ${p.name}`);
        closePlModal();
      }
    };
  });
}
$("plcreate").onclick = () => {
  const pl = createPlaylist($("plname").value);
  if (!pl) return;
  $("plname").value = "";
  if (plModalTrack) {
    addTrackToPlaylist(pl.id, plModalTrack);
    toast(`Added to ${pl.name}`);
    closePlModal();
  } else renderPlModal();
};
$("plclose").onclick = closePlModal;
$("plmodal").addEventListener("click", (e) => { if (e.target.id === "plmodal") closePlModal(); });

/* ================= library view ================= */
function showLibrary() {
  resultsEl.innerHTML = ""; homeEl.innerHTML = "";
  const pls = getPlaylists();
  detailEl.innerHTML = `<h2 class="shelf-title">Your library</h2>
    <div><button class="btn-primary" id="libNew">＋ New playlist</button></div>
    <div class="grid" style="margin-top:14px">` + (pls.length ? pls.map((p) => `
      <button class="card" data-id="${esc(p.id)}">
        <span class="art"><img src="${esc(p.tracks.length ? ytThumb(p.tracks[0].videoId) : "")}" alt=""><span class="veil"><span class="playdot">▶</span></span></span>
        <span class="meta"><b>${esc(p.name)}</b><span>${p.tracks.length} songs</span></span>
      </button>`).join("") : `<div style="color:var(--muted)">No playlists yet. Right-click any song → Add to playlist.</div>`) + `</div>`;
  detailEl.querySelectorAll(".card[data-id]").forEach((c) => { c.onclick = () => showUserPlaylist(c.dataset.id); });
  $("libNew").onclick = () => { plModalTrack = null; $("pltarget").textContent = ""; renderPlModal(); $("plmodal").classList.remove("hidden"); };
  detailEl.scrollIntoView();
  setStatus("");
}
function showUserPlaylist(id) {
  const pl = getPlaylists().find((p) => p.id === id);
  if (!pl) { showLibrary(); return; }
  detailEl.innerHTML = hero("Playlist", pl.tracks.length ? ytThumb(pl.tracks[0].videoId) : "", pl.name,
    `${pl.tracks.length} songs · yours`, pl.tracks.length ? pl.tracks[0].videoId : null, null) +
    trackRows(pl.tracks, true);
  bindRows(detailEl, pl.tracks);
  detailEl.querySelectorAll("[data-rm]").forEach((b) => {
    b.onclick = (e) => {
      e.stopPropagation();
      const pls = getPlaylists();
      const p = pls.find((x) => x.id === id);
      p.tracks.splice(+b.dataset.rm, 1);
      savePlaylists(pls);
      showUserPlaylist(id);
    };
  });
  const hp = $("heroPlay");
  if (hp && pl.tracks.length) hp.onclick = () => play(pl.tracks[0].videoId, pl.tracks[0].title, pl.tracks[0].sub, pl.tracks, 0);
  detailEl.scrollIntoView({ behavior: "smooth" });
  setStatus("");
}
$("libLink").onclick = (e) => { e.preventDefault(); showLibrary(); };

/* ================= recent searches ================= */
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

/* ================= continue listening ================= */
const RP_KEY = "ytm_recently_played";
const getPlayed = () => { try { return JSON.parse(localStorage.getItem(RP_KEY)) || []; } catch { return []; } };
function pushPlayed(t) {
  const track = typeof t === "string" ? { videoId: t, title: t, sub: "" } : normTrack(t);
  if (!track.videoId) return;
  if (typeof t !== "string" && t.title) { track.title = t.title; track.sub = t.sub || track.sub; }
  const list = getPlayed().filter((x) => x.videoId !== track.videoId);
  list.unshift({ ...track, at: Date.now() });
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
    c.oncontextmenu = (e) => { e.preventDefault(); openCtx({ videoId: c.dataset.vid, title: c.dataset.title, artists: [{ name: c.dataset.sub }] }, e.clientX, e.clientY); };
  });
}

/* ================= search ================= */
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
  detailEl.innerHTML = ""; homeEl.innerHTML = ""; $("continue").innerHTML = "";
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
const goHome = (e) => { if (e) e.preventDefault(); resultsEl.innerHTML = ""; detailEl.innerHTML = ""; renderContinue(); loadHome(); };
$("homeLink").onclick = goHome;
$("brandHome").onclick = goHome;

function card(it, i) {
  return `<button class="card" data-idx="${i}" ${it.videoId ? `data-vid="${esc(it.videoId)}" data-title="${esc(it.title || "")}" data-sub="${esc(artistNames(it) || it.author || "")}"` : ""}>
    <span class="art"><img loading="lazy" src="${esc(thumbOf(it))}" alt=""><span class="veil"><span class="playdot">▶</span></span></span>
    <span class="meta"><b>${esc(it.title)}</b><span>${esc(artistNames(it) || it.author || "")}</span></span>
  </button>`;
}
function bindCards(root, items) {
  const playable = items.map(normTrack).filter((t) => t.videoId);
  root.querySelectorAll(".card").forEach((c) => {
    const it = items[+c.dataset.idx];
    c.onclick = () => openResult(it, playable);
    c.oncontextmenu = (e) => {
      if (!it.videoId) return;
      e.preventDefault();
      openCtx(it, e.clientX, e.clientY);
    };
  });
}
function openResult(it, playable) {
  const type = it.resultType;
  if (type === "song" || type === "video") {
    const idx = (playable || []).findIndex((t) => t.videoId === it.videoId);
    play(it.videoId, it.title, artistNames(it), playable, idx);
  }
  else if (type === "album") showAlbum(it.browseId);
  else if (type === "artist") showArtist(it.browseId);
  else if (type === "playlist") showPlaylist(String(it.browseId || "").replace(/^VL/, ""));
  else if (it.videoId) play(it.videoId, it.title, artistNames(it), playable, (playable || []).findIndex((t) => t.videoId === it.videoId));
  else if (it.browseId) showAlbum(it.browseId);
}

/* ================= detail views ================= */
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
/* screenshot-style rows: square thumb | Title / Artist • Album • time • plays | ⋮ */
function trackRows(tracks, removable) {
  return tracks.map((t, i) => `
    <div class="trow" data-vid="${esc(t.videoId || "")}" data-title="${esc(t.title || "")}" data-sub="${esc(artistNames(t))}">
      <img loading="lazy" src="${esc(thumbOf(t))}" alt="">
      <span class="tt"><b>${esc(t.title)}</b><span>${esc(subLine(t))}</span></span>
      ${removable ? `<button class="dots" data-rm="${i}" title="Remove">✕</button>` : `<button class="dots" data-menu="${i}" title="More">⋮</button>`}
    </div>`).join("");
}
function bindRows(root, tracks) {
  root.querySelectorAll(".trow[data-vid]").forEach((r) => {
    const i = tracks.findIndex((t) => t.videoId === r.dataset.vid);
    r.onclick = (e) => {
      if (e.target.closest(".dots")) return;
      if (r.dataset.vid) play(r.dataset.vid, r.dataset.title, r.dataset.sub, tracks, i >= 0 ? i : 0);
    };
    r.oncontextmenu = (e) => {
      e.preventDefault();
      openCtx({ videoId: r.dataset.vid, title: r.dataset.title, artists: [{ name: r.dataset.sub }] }, e.clientX, e.clientY);
    };
  });
  root.querySelectorAll(".dots[data-menu]").forEach((b) => {
    b.onclick = (e) => {
      e.stopPropagation();
      const row = b.closest(".trow");
      const rect = b.getBoundingClientRect();
      openCtx({ videoId: row.dataset.vid, title: row.dataset.title, artists: [{ name: row.dataset.sub }] }, rect.left - 150, rect.bottom + 4);
    };
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
    bindRows(detailEl, tracks);
    const hp = $("heroPlay");
    if (hp && tracks.length) hp.onclick = () => { const t = tracks.find((x) => x.videoId); play(t.videoId, t.title, artistNames(t), tracks, tracks.indexOf(t)); };
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
    bindRows(detailEl, songs);
    detailEl.querySelectorAll(".shelf-row").forEach((row, ri) => {
      const sec = ["albums", "singles", "videos"][ri];
      const s = a[sec]; const items = s?.results || s || [];
      bindCards(row, items);
    });
    const hp = $("heroPlay");
    if (hp) hp.onclick = () => { const t = songs.find((x) => x.videoId); play(t.videoId, t.title, artistNames(t), songs, songs.indexOf(t)); };
    const hr = $("heroRadio");
    if (hr) hr.onclick = async () => {
      const t = songs.find((x) => x.videoId);
      if (t) {
        play(t.videoId, t.title, artistNames(t));
        await loadRadio(t.videoId);
      }
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
    bindRows(detailEl, tracks);
    const hp = $("heroPlay");
    if (hp && tracks.length) hp.onclick = () => { const t = tracks.find((x) => x.videoId); play(t.videoId, t.title, artistNames(t), tracks, tracks.indexOf(t)); };
    const hr = $("heroRadio");
    if (hr) hr.onclick = async () => {
      const w = await api(`/watch?playlistId=${encodeURIComponent(playlistId)}&limit=25`);
      if (w.tracks?.length) {
        queue = w.tracks.map(normTrack).filter((t) => t.videoId);
        qIndex = 0;
        loadCurrent();
        showPane("upnext");
      }
    };
    detailEl.scrollIntoView({ behavior: "smooth" });
    setStatus("");
  } catch (e) { setStatus("Playlist failed: " + e.message); }
}

/* ================= home ================= */
async function loadHome() {
  setStatus("Loading home…");
  try {
    const rows = await api("/home?limit=3");
    homeEl.innerHTML = rows.map((row) =>
      `<h2 class="shelf-title">${esc(row.title)}</h2><div class="shelf-row">` + (row.contents || []).map((it) => {
        const bid = it.browseId || it.playlistId || "";
        return `<button class="card" data-browse="${esc(bid)}" data-vid="${esc(it.videoId || "")}" data-title="${esc(it.title || "")}" data-sub="${esc(artistNames(it) || "")}">
          <span class="art"><img loading="lazy" src="${esc(thumbOf(it))}" alt=""><span class="veil"><span class="playdot">▶</span></span></span>
          <span class="meta"><b>${esc(it.title)}</b><span>${esc(artistNames(it) || "")}</span></span>
        </button>`;
      }).join("") + `</div>`
    ).join("");
    homeEl.querySelectorAll(".card").forEach((c) => {
      c.onclick = () => {
        if (c.dataset.vid) play(c.dataset.vid, c.dataset.title, c.dataset.sub);
        else if (c.dataset.browse) {
          const b = c.dataset.browse;
          if (b.startsWith("UC")) showArtist(b);
          else if (b.startsWith("MPRE")) showAlbum(b);
          else showPlaylist(b.replace(/^VL/, ""));
        }
      };
      c.oncontextmenu = (e) => {
        if (!c.dataset.vid) return;
        e.preventDefault();
        openCtx({ videoId: c.dataset.vid, title: c.dataset.title, artists: [{ name: c.dataset.sub }] }, e.clientX, e.clientY);
      };
    });
    setStatus("");
  } catch (e) { setStatus("Home failed: " + e.message); }
}

renderContinue();
loadHome();
