(() => {
"use strict";
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const hasChrome = typeof chrome !== "undefined" && chrome.storage;
const uid = () => Math.random().toString(36).slice(2, 10);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const host = u => { try { return new URL(u).hostname; } catch { return ""; } };
const favicon = u => `https://www.google.com/s2/favicons?sz=64&domain=${encodeURIComponent(host(u))}`;

/* ---------- storage ---------- */
const DEFAULTS = {
  theme: "auto", clock: true,
  bg: { type: "gradient", value: "g0" }, wp: { rotate: false, order: "random", index: -1, lastId: null }, shadeTop: 42, shadeBottom: 23,
  unsplash: { on: false, key: "", sources: ["photoholgic"], lists: {}, lastId: null },
  weather: { on: false, name: "", lat: null, lon: null, unit: "C" },
  dock: true, toured: false, ui: 100,
  shortcuts: [], scSeeded: false, quoteOn: true, quote: null, nextQuote: null, books: [], shelves: [], curShelf: null, notes: [], todos: [], stickies: [], sessions: []
};
let S = structuredClone(DEFAULTS);
const sc = n => Math.round(n * 0.8333 * (S.ui || 100) / 100);
const applyUi = () => document.documentElement.style.setProperty("--ui", (S.ui || 100) / 100);
const store = {
  async load() {
    let saved = {};
    if (hasChrome) saved = await chrome.storage.local.get(["localhome", "marqly"]);
    else saved = { localhome: JSON.parse(localStorage.getItem("localhome") || "null") };
    S = { ...structuredClone(DEFAULTS), ...(saved.localhome || saved.marqly || {}) };
    S.wp = { ...DEFAULTS.wp, ...(S.wp || {}) };
    S.unsplash = { ...structuredClone(DEFAULTS.unsplash), ...(S.unsplash || {}) };
    if (S.unsplash.photos) { S.unsplash.lists.photoholgic = { photos: S.unsplash.photos, t: S.unsplash.fetched || 0 }; delete S.unsplash.photos; delete S.unsplash.fetched; }
  },
  save() {
    if (hasChrome) chrome.storage.local.set({ localhome: S });
    else localStorage.setItem("localhome", JSON.stringify(S));
  }
};

/* ---------- wallpapers ---------- */
const GRADIENTS = {
  g0: "linear-gradient(135deg,#1d2b3a,#2e4a43 55%,#4b6b4f)",
  g1: "linear-gradient(135deg,#3b2a8c,#1a1550)",
  g2: "linear-gradient(135deg,#123a82,#0a1a45)",
  g3: "linear-gradient(135deg,#7a1a6e,#2a0c3a)",
  g4: "linear-gradient(135deg,#0f6b7a,#0a2e3f)",
  g5: "linear-gradient(135deg,#8a5aa8,#d9855b)",
  g6: "linear-gradient(135deg,#8c1d2a,#3a0a12)",
  g7: "linear-gradient(135deg,#0f6b4a,#073322)",
  g8: "linear-gradient(135deg,#8a4a0a,#3a1e05)",
  g9: "linear-gradient(135deg,#1b2a44,#0c1220)",
  g10: "linear-gradient(135deg,#3a3a3f,#18181b)"
};
/* ---- uploaded wallpapers live in IndexedDB (blobs, no size quota issues) ---- */
let _db;
function db() {
  return _db || (_db = new Promise((res, rej) => {
    const r = indexedDB.open("localhome", 2);
    r.onupgradeneeded = () => {
      const d = r.result;
      if (!d.objectStoreNames.contains("wallpapers")) d.createObjectStore("wallpapers", { keyPath: "id" });
      if (!d.objectStoreNames.contains("files")) d.createObjectStore("files", { keyPath: "id" });
    };
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  }));
}
async function tx(mode, fn, store = "wallpapers") {
  const d = await db();
  return new Promise((res, rej) => {
    const t = d.transaction(store, mode), st = t.objectStore(store), req = fn(st);
    t.oncomplete = () => res(req && req.result); t.onerror = () => rej(t.error);
  });
}
const wpAll = async () => ((await tx("readonly", s => s.getAll())) || []).sort((a, b) => a.added - b.added);
const wpGet = id => tx("readonly", s => s.get(id));
const wpAdd = rec => tx("readwrite", s => s.put(rec));
const wpDel = id => tx("readwrite", s => s.delete(id));
const wpClear = () => tx("readwrite", s => s.clear());
const fileGet = id => tx("readonly", s => s.get(id), "files");
const filePut = rec => tx("readwrite", s => s.put(rec), "files");
const fileDel = id => tx("readwrite", s => s.delete(id), "files");
const fileClear = () => tx("readwrite", s => s.clear(), "files");

let currentId = null, liveUrl = null;
async function pickRotation() {
  const all = await wpAll();
  if (!all.length) { currentId = null; return; }
  let id;
  if (S.wp.order === "order") {
    S.wp.index = (S.wp.index + 1) % all.length; id = all[S.wp.index].id;
  } else {
    const pool = all.length > 1 ? all.filter(r => r.id !== S.wp.lastId) : all;
    id = pool[Math.floor(Math.random() * pool.length)].id;
  }
  S.wp.lastId = id; currentId = id; store.save();
}
async function applyBg() {
  const bg = $("#bg"); $("#credit").textContent = "";
  document.documentElement.style.setProperty("--shade-top", S.shadeTop / 100);
  document.documentElement.style.setProperty("--shade-bot", S.shadeBottom / 100);
  if (S.unsplash.on && S.unsplash.key) { const ph = await unsplashPick(); if (ph && await showUnsplash(ph)) return; $("#credit").textContent = ""; }
  let rec = null;
  try {
    if (S.wp.rotate && currentId) rec = await wpGet(currentId);
    else if (S.bg.type === "library") rec = await wpGet(S.bg.id);
  } catch {}
  if (rec) {
    const u = URL.createObjectURL(rec.blob);
    bg.style.background = `center/cover url("${u}")`;
    if (liveUrl) URL.revokeObjectURL(liveUrl);
    liveUrl = u; return;
  }
  if (S.bg.type === "image" && S.bg.value) bg.style.background = `center/cover url("${S.bg.value.replace(/"/g, "%22")}")`;
  else if (S.bg.type === "none") bg.style.background = "#101012";
  else bg.style.background = GRADIENTS[S.bg.type === "gradient" ? S.bg.value : "g0"] || GRADIENTS.g0;
}
/* ---- Unsplash: random photos from one photographer (hotlinked + credited, as the API guidelines ask) ---- */
const UNS = { base: "https://api.unsplash.com", utm: "?utm_source=local_home&utm_medium=referral" };
/* the photo pools you can switch on (any combination) */
const UNS_SOURCES = [
  { id: "photoholgic", label: "@photoholgic", sub: "The photographer's own photos", url: "https://unsplash.com/@photoholgic", path: "/users/photoholgic/photos?per_page=30&order_by=latest&orientation=landscape" },
  { id: "landscape", label: "Landscape collection", sub: "Unsplash collection 11649432", url: "https://unsplash.com/collections/11649432/landscape", path: "/collections/11649432/photos?per_page=30&orientation=landscape" },
  { id: "nature", label: "Nature landscapes", sub: "Search: “nature landscape”", url: "https://unsplash.com/wallpapers/nature/landscape", path: "/search/photos?query=nature%20landscape&orientation=landscape&per_page=30", results: true }
];
const uHeaders = () => ({ Authorization: `Client-ID ${S.unsplash.key}`, "Accept-Version": "v1" });
async function unsplashFetchSource(src, pages = 3) {
  const out = [];
  for (let pg = 1; pg <= pages; pg++) {
    const ctrl = new AbortController(), t = setTimeout(() => ctrl.abort(), 10000);
    let r;
    try { r = await fetch(`${UNS.base}${src.path}&page=${pg}`, { headers: uHeaders(), signal: ctrl.signal }); }
    catch { if (out.length) break; throw new Error("Couldn't reach Unsplash. Check your connection."); }
    finally { clearTimeout(t); }
    if (!r.ok) {
      if (out.length) break;
      throw new Error(r.status === 401 ? "Unsplash rejected that access key." : r.status === 403 ? "Unsplash rate limit reached. Try again in an hour." : r.status === 404 ? `“${src.label}” wasn't found.` : `Unsplash error ${r.status}.`);
    }
    const j = await r.json(), arr = src.results ? j.results : j; if (!Array.isArray(arr) || !arr.length) break;
    arr.forEach(p => { if (p.urls?.raw && (!p.width || !p.height || p.width > p.height)) out.push({ id: p.id, raw: p.urls.raw, name: p.user?.name, userUrl: p.user?.links?.html, dl: p.links?.download_location, color: p.color }); });
    if (arr.length < 30) break;
  }
  return out;
}
async function unsplashLoad(id) {
  const src = UNS_SOURCES.find(s => s.id === id), list = await unsplashFetchSource(src);
  if (!list.length) throw new Error(`“${src.label}” has no landscape photos.`);
  S.unsplash.lists[id] = { photos: list, t: Date.now() }; store.save();
  return list;
}
let uCur = null;
async function unsplashPick() {
  if (uCur) return uCur;
  const u = S.unsplash;
  await Promise.all(u.sources.map(async id => {
    const l = u.lists[id];
    if (l?.photos?.length && Date.now() - l.t < 864e5) return;
    try { await unsplashLoad(id); } catch { if (l?.photos?.length) l.t = Date.now() - 864e5 + 6e5; }   // keep the old list, retry in 10 minutes
  }));
  const all = new Map();
  u.sources.forEach(id => (u.lists[id]?.photos || []).forEach(p => all.set(p.id, p)));
  const list = [...all.values()]; if (!list.length) return null;
  const pool = list.length > 1 ? list.filter(p => p.id !== u.lastId) : list;
  uCur = pool[Math.floor(Math.random() * pool.length)]; u.lastId = uCur.id; store.save();
  if (uCur.dl) fetch(uCur.dl, { headers: uHeaders() }).catch(() => {});   // Unsplash asks apps to report each photo that is used
  return uCur;
}
async function showUnsplash(ph) {
  const w = Math.min(3840, Math.ceil(screen.width * (devicePixelRatio || 1) / 200) * 200) || 2560;
  const url = `${ph.raw}${ph.raw.includes("?") ? "&" : "?"}w=${w}&q=80&fm=jpg&fit=max`;
  $("#bg").style.background = ph.color || "#101012";
  const ok = await new Promise(r => { const im = new Image(); im.onload = () => r(true); im.onerror = () => r(false); im.src = url; setTimeout(() => r(false), 8000); });
  if (!ok) return false;
  $("#bg").style.background = `center/cover url("${url}")`;
  const a = (href, t) => `<a href="${esc(href)}${UNS.utm}" target="_blank" rel="noopener">${esc(t)}</a>`;
  $("#credit").innerHTML = `Photo by ${a(ph.userUrl || "https://unsplash.com/", ph.name || "Unsplash")} on ${a("https://unsplash.com/", "Unsplash")}`;
  return true;
}
async function addWallpaperFiles(files) {
  let n = 0;
  for (const f of files) {
    if (!f.type.startsWith("image/")) continue;
    try {
      const bmp = await createImageBitmap(f);
      const sc = Math.min(1, 2560 / bmp.width), c = document.createElement("canvas");
      c.width = Math.round(bmp.width * sc); c.height = Math.round(bmp.height * sc);
      c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
      const blob = await new Promise(r => c.toBlob(r, "image/jpeg", 0.86));
      await wpAdd({ id: uid(), name: f.name, blob, added: Date.now() + n });
      n++;
    } catch { /* skip unreadable file */ }
  }
  return n;
}
function applyTheme() {
  const dark = S.theme === "dark" || (S.theme === "auto" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.mode = dark ? "dark" : "light";
}
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", applyTheme);

/* ---------- clock ---------- */
function tick() {
  const d = new Date(), h = d.getHours();
  $("#greeting").textContent = h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
  const date = d.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
  const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  $("#date").textContent = `${date} · ${time}`;
}
function applyClock() { $("#clock").style.display = S.clock ? "" : "none"; }

/* ---------- toast ---------- */
let toastT;
function toast(msg) {
  const t = $("#toast"); t.textContent = msg; t.hidden = false;
  clearTimeout(toastT); toastT = setTimeout(() => (t.hidden = true), 2200);
}

/* ---------- library (bookmarks) ---------- */
let library = [];
async function loadLibrary() {
  if (!hasChrome || !chrome.bookmarks) {
    library = [];
  } else {
    const tree = await chrome.bookmarks.getTree();
    const out = [];
    (function walk(n, parent) { if (n.url) out.push({ ...n, folder: parent }); (n.children || []).forEach(c => walk(c, n.title || parent)); })(tree[0], "");
    out.sort((a, b) => (b.dateAdded || 0) - (a.dateAdded || 0));
    library = out;
  }
}


/* ---------- in-page library view (masonry boards with page previews) ---------- */
let libOv = null, libCleanup = null;
function closeLibrary() {
  if (libCleanup) libCleanup(); libCleanup = null;
  if (!libOv) return;
  const ov = libOv; libOv = null;
  ov.classList.add("out"); ov.style.pointerEvents = "none";   // slides back out to the right, then goes away
  setTimeout(() => ov.remove(), 420);
}

/* preview images: read og:image from each page lazily, cache the result */
let ogCache = null, ogTimer = null, ogActive = 0;
const ogWait = [];
async function ogLoad() {
  if (ogCache) return;
  const r = hasChrome ? await chrome.storage.local.get("og") : { og: JSON.parse(localStorage.getItem("og") || "{}") };
  ogCache = r.og || {};
}
function ogSave() {
  clearTimeout(ogTimer);
  ogTimer = setTimeout(() => { if (hasChrome) chrome.storage.local.set({ og: ogCache }); else localStorage.setItem("og", JSON.stringify(ogCache)); }, 800);
}
async function ogFetch(url) {
  const ctrl = new AbortController(), t = setTimeout(() => ctrl.abort(), 7000);
  try {
    const r = await fetch(url, { signal: ctrl.signal, credentials: "omit", redirect: "follow" });
    if (!r.ok || !(r.headers.get("content-type") || "").includes("html")) return null;
    const reader = r.body.getReader(), dec = new TextDecoder();
    let html = "", n = 0;
    while (n < 250000) {
      const { done, value } = await reader.read(); if (done) break;
      n += value.length; html += dec.decode(value, { stream: true });
      if (/<\/head>/i.test(html)) break;
    }
    reader.cancel().catch(() => {});
    const doc = new DOMParser().parseFromString(html, "text/html");
    const pick = s => doc.querySelector(s)?.getAttribute("content");
    const img = pick('meta[property="og:image"]') || pick('meta[property="og:image:url"]') || pick('meta[name="og:image"]') || pick('meta[name="twitter:image"]') || pick('meta[property="twitter:image"]');
    return img ? new URL(img, r.url).href : null;
  } catch { return null; } finally { clearTimeout(t); }
}
async function ogFor(url) {
  await ogLoad();
  const c = ogCache[url];
  if (c && Date.now() - c.t < (c.i ? 30 : 7) * 864e5) return c.i;
  await new Promise(r => { if (ogActive < 4) { ogActive++; r(); } else ogWait.push(r); });
  let img = "";
  try { img = (await ogFetch(url)) || ""; } finally { const n = ogWait.shift(); if (n) n(); else ogActive--; }
  ogCache[url] = { i: img, t: Date.now() }; ogSave();
  return img;
}
const hueOf = s => { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h % 360; };
const cardLabel = b => { try { const u = new URL(b.url); if (/^[a-p]{32}$/.test(u.hostname)) return "Extension"; return u.hostname.replace(/^www\./, "") || u.protocol.replace(":", ""); } catch { return "Link"; } };

const LV_ICONS = {
  back: '<svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg>',
  share: '<svg viewBox="0 0 24 24"><circle cx="18" cy="5" r="2.8"/><circle cx="6" cy="12" r="2.8"/><circle cx="18" cy="19" r="2.8"/><path d="M8.5 13.4l7 4.2M15.5 6.4l-7 4.2"/></svg>',
  filter: '<svg viewBox="0 0 24 24"><path d="M3 7h8M18 7h3M3 17h3M13 17h8"/><circle cx="14.5" cy="7" r="2.6"/><circle cx="9.5" cy="17" r="2.6"/></svg>',
  list: '<svg viewBox="0 0 24 24"><path d="M9 6h12M9 12h12M9 18h12"/><circle cx="4.5" cy="6" r="1" fill="currentColor"/><circle cx="4.5" cy="12" r="1" fill="currentColor"/><circle cx="4.5" cy="18" r="1" fill="currentColor"/></svg>',
  tiles: '<svg viewBox="0 0 24 24"><rect x="3.5" y="3.5" width="7" height="7" rx="1.6"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.6"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.6"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.6"/></svg>',
  more: '<svg viewBox="0 0 24 24" style="fill:currentColor;stroke:none"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg>'
};

function openLibrary() {
  if (libOv) return closeLibrary();
  closeModal();
  const ov = libOv = document.createElement("div");
  ov.className = "lv";
  ov.innerHTML = `
    <div class="lv-head">
      <button class="lv-round" data-a="back" aria-label="Back">${LV_ICONS.back}</button>
      <svg class="lv-folder" viewBox="0 0 28 24"><path fill="#22b8e0" d="M2 4.5A2.5 2.5 0 0 1 4.5 2h6.2c.7 0 1.3.3 1.8.8L14 4.5h9.5A2.5 2.5 0 0 1 26 7v12.5a2.5 2.5 0 0 1-2.5 2.5h-19A2.5 2.5 0 0 1 2 19.5z"/></svg>
      <div class="lv-title"><h2></h2><p></p></div>
      <div class="lv-actions">
        <button class="lv-round" data-a="share" aria-label="Copy links" title="Copy links">${LV_ICONS.share}</button>
        <button class="lv-round" data-a="view" aria-label="Switch view" title="Switch view"></button>
        <button class="lv-round" data-a="more" aria-label="More" title="More">${LV_ICONS.more}</button>
        <div class="lv-menu" hidden><button data-a="refresh">Refresh previews</button><button data-a="clear">Clear preview cache</button></div>
      </div>
    </div>
    <div class="lv-tools"><input class="lv-q" placeholder="Filter your library…" spellcheck="false"><div class="lv-chips" style="display:contents"></div></div>
    <div class="lv-grid"></div>
    <div class="lv-more" hidden><button>Show more</button></div>`;
  document.body.appendChild(ov);

  const grid = $(".lv-grid", ov), title = $("h2", ov), sub = $(".lv-title p", ov), tools = $(".lv-tools", ov), menu = $(".lv-menu", ov), more = $(".lv-more", ov);
  let q = "", folder = "", sort = "new", limit = 240, io = null;
  let view = "tiles"; try { view = localStorage.getItem("libView") === "list" ? "list" : "tiles"; } catch {}
  const viewBtn = $("[data-a=view]", ov);
  const drawViewBtn = () => {
    viewBtn.innerHTML = view === "tiles" ? LV_ICONS.list : LV_ICONS.tiles;
    viewBtn.title = viewBtn.ariaLabel = view === "tiles" ? "Switch to list view" : "Switch to tiled view";
  };

  const counts = {};
  library.forEach(b => { if (b.folder) counts[b.folder] = (counts[b.folder] || 0) + 1; });
  const folders = Object.keys(counts).sort((a, b) => counts[b] - counts[a]).slice(0, 8);
  const drawChips = () => {
    $(".lv-chips", ov).innerHTML =
      [["new", "Newest"], ["old", "Oldest"], ["az", "A–Z"]].map(([v, l]) => `<button class="lv-chip ${sort === v ? "on" : ""}" data-s="${v}">${l}</button>`).join("") +
      (folders.length > 1 ? `<span class="lv-sep"></span><button class="lv-chip ${folder === "" ? "on" : ""}" data-f="">All</button>` +
        folders.map(f => `<button class="lv-chip ${folder === f ? "on" : ""}" data-f="${esc(f)}">${esc(f)}</button>`).join("") : "");
  };
  const rowsNow = () => {
    const s = q.toLowerCase();
    let r = library.filter(b => (!folder || b.folder === folder) && (!s || (b.title + " " + b.url).toLowerCase().includes(s)));
    if (sort === "old") r = r.slice().reverse();
    else if (sort === "az") r = r.slice().sort((a, b) => (a.title || a.url).localeCompare(b.title || b.url));
    return r;
  };
  const colCount = () => {
    const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    return Math.max(1, Math.min(6, Math.floor((ov.clientWidth - 6.2 * rem) / (19.5 * rem))));
  };
  const hydrate = async card => {
    const b = card._b; if (!b) return;
    const src = await ogFor(b.url);
    if (!src || !libOv) return;
    const img = new Image();
    img.referrerPolicy = "no-referrer"; img.decoding = "async"; img.alt = "";
    img.onload = () => {
      if (img.naturalWidth < 160 || img.naturalHeight < 80) return;
      card.className = "lv-card img"; card.removeAttribute("style"); card.replaceChildren(img);
    };
    img.src = src;
  };
  const makeItem = b => {
    const el = document.createElement("article"); el.className = "lv-item";
    const t = b.title || b.url;
    if (!/^https?:/i.test(b.url)) {
      el.innerHTML = `<a class="lv-card txt" href="${esc(b.url)}"><small>${esc(cardLabel(b))}</small><b>${esc(t)}</b></a>`;
      return el;
    }
    el.innerHTML = `<a class="lv-card ph" href="${esc(b.url)}" style="background:hsl(${hueOf(host(b.url))} 32% 17%)"><span class="fav"><img src="${favicon(b.url)}" alt=""></span></a>
      <a class="lv-cap" href="${esc(b.url)}" title="${esc(t)}">${esc(t)}</a>`;
    $(".lv-card", el)._b = b;
    $(".fav img", el).onerror = e => (e.target.style.visibility = "hidden");
    return el;
  };
  const makeRow = b => {
    const el = document.createElement("a"); el.className = "lv-row"; el.href = b.url;
    const t = b.title || b.url, d = b.dateAdded ? new Date(b.dateAdded).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "";
    el.innerHTML = `<img src="${favicon(b.url)}" alt=""><span class="t">${esc(t)}</span><small class="h">${esc(cardLabel(b))}</small><small class="f">${esc(b.folder || "")}</small><small class="d">${esc(d)}</small>`;
    $("img", el).onerror = e => (e.target.style.visibility = "hidden");
    return el;
  };
  const draw = () => {
    if (io) io.disconnect();
    const rows = rowsNow();
    grid.classList.toggle("lv-listmode", view === "list");
    title.textContent = folder || "All bookmarks";
    sub.textContent = `${rows.length} item${rows.length === 1 ? "" : "s"}`;
    grid.innerHTML = "";
    more.hidden = rows.length <= limit;
    if (!rows.length) { grid.innerHTML = `<div class="lv-empty">${library.length ? "Nothing matches that." : "No bookmarks yet."}</div>`; return; }
    if (view === "list") {
      const wrap = document.createElement("div"); wrap.className = "lv-rows";
      rows.slice(0, limit).forEach(b => wrap.appendChild(makeRow(b)));
      grid.appendChild(wrap); return;
    }
    const cols = Array.from({ length: colCount() }, () => { const c = document.createElement("div"); c.className = "lv-col"; grid.appendChild(c); return c; });
    io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { io.unobserve(e.target); hydrate(e.target); } }), { root: ov, rootMargin: "700px 0px" });
    rows.slice(0, limit).forEach(b => {
      const it = makeItem(b);
      const col = cols.reduce((m, c) => (c.offsetHeight < m.offsetHeight ? c : m), cols[0]);
      col.appendChild(it);
      const card = $(".lv-card", it); if (card._b) io.observe(card);
    });
  };

  ov.addEventListener("click", async e => {
    if (!e.target.closest(".lv-actions")) menu.hidden = true;
    const chip = e.target.closest(".lv-chip");
    if (chip) {
      if (chip.dataset.s) sort = chip.dataset.s; else folder = chip.dataset.f;
      limit = 240; drawChips(); draw(); return;
    }
    if (e.target.closest(".lv-more button")) { limit += 240; draw(); return; }
    const a = e.target.closest("[data-a]")?.dataset.a; if (!a) return;
    if (a === "back") closeLibrary();
    else if (a === "view") { view = view === "tiles" ? "list" : "tiles"; try { localStorage.setItem("libView", view); } catch {} drawViewBtn(); draw(); }
    else if (a === "more") menu.hidden = !menu.hidden;
    else if (a === "share") {
      const rows = rowsNow();
      try { await navigator.clipboard.writeText(rows.map(b => `${b.title || b.url}\n${b.url}`).join("\n\n")); toast(`Copied ${rows.length} links`); }
      catch { toast("Couldn’t copy to the clipboard"); }
    } else if (a === "refresh") {
      await ogLoad(); rowsNow().forEach(b => delete ogCache[b.url]); ogSave(); menu.hidden = true; draw(); toast("Refreshing previews…");
    } else if (a === "clear") {
      await ogLoad(); ogCache = {}; ogSave(); menu.hidden = true; draw(); toast("Preview cache cleared");
    }
  });
  $(".lv-q", ov).oninput = e => { q = e.target.value.trim(); limit = 240; draw(); };
  const onResize = () => { if (libOv && view === "tiles" && grid.querySelector(".lv-col") && grid.children.length !== colCount()) draw(); };
  addEventListener("resize", onResize);
  libCleanup = () => { removeEventListener("resize", onResize); if (io) io.disconnect(); };
  drawViewBtn(); drawChips(); draw();
}

/* ---------- search ---------- */
const input = $("#search"), sug = $("#suggest");
let sugItems = [], sugIdx = -1;
const looksLikeUrl = s => /^(https?:\/\/|chrome:\/\/|brave:\/\/)/i.test(s) || /^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(s);
function go(text) {
  text = text.trim(); if (!text) return;
  if (looksLikeUrl(text)) location.href = /^[a-z]+:\/\//i.test(text) ? text : "https://" + text;
  else if (hasChrome && chrome.search) chrome.search.query({ text, disposition: "CURRENT_TAB" });
  else location.href = "https://www.google.com/search?q=" + encodeURIComponent(text);
}
function renderSuggest() {
  const q = input.value.trim().toLowerCase();
  if (!q) { sug.hidden = true; return; }
  const matches = library.filter(b => (b.title + " " + b.url).toLowerCase().includes(q)).slice(0, 6);
  sugItems = [...matches.map(b => ({ url: b.url, title: b.title || b.url })), { web: true, title: `Search the web for “${input.value.trim()}”` }];
  sugIdx = -1;
  sug.innerHTML = sugItems.map((s, i) => s.web
    ? `<button data-i="${i}">🔎 <span>${esc(s.title)}</span></button>`
    : `<button data-i="${i}"><img class="ico" src="${favicon(s.url)}" alt=""><span>${esc(s.title)}</span><small>${esc(host(s.url))}</small></button>`).join("");
  sug.hidden = false;
}
const pick = i => { const s = sugItems[i]; if (!s) return go(input.value); s.web ? go(input.value) : (location.href = s.url); };
input.addEventListener("input", renderSuggest);
input.addEventListener("keydown", e => {
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    if (sug.hidden) return; e.preventDefault();
    sugIdx = (sugIdx + (e.key === "ArrowDown" ? 1 : -1) + sugItems.length) % sugItems.length;
    $$("button", sug).forEach((b, i) => b.classList.toggle("on", i === sugIdx));
  } else if (e.key === "Enter") { sugIdx >= 0 ? pick(sugIdx) : go(input.value); }
  else if (e.key === "Escape") { sug.hidden = true; input.blur(); }
});
sug.addEventListener("mousedown", e => { const b = e.target.closest("button"); if (b) pick(+b.dataset.i); });
document.addEventListener("click", e => { if (!e.target.closest(".search-wrap")) sug.hidden = true; });
document.addEventListener("keydown", e => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); input.focus(); input.select(); }
});
$("#kbd").textContent = /Mac/i.test(navigator.platform) ? "⌘K" : "Ctrl K";

/* ---------- shortcuts ---------- */
const PRESETS = [
  { title: "WhatsApp", url: "https://web.whatsapp.com" },
  { title: "YouTube", url: "https://www.youtube.com" },
  { title: "ChatGPT", url: "https://chatgpt.com" },
  { title: "Gemini", url: "https://gemini.google.com" },
  { title: "Claude", url: "https://claude.ai" },
  { title: "Gmail", url: "https://mail.google.com" }
];
const scIcon = u => `https://www.google.com/s2/favicons?sz=128&domain_url=${encodeURIComponent(u)}`;
/* brand icons (Simple Icons glyphs, bundled so they work offline); anything else falls back to the site's favicon */
const BRANDS = {"whatsapp":{"bg":"#25D366","fg":"#ffffff","d":"M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52s.198-.298.298-.497c.099-.198.05-.371-.025-.52s-.669-1.612-.916-2.207c-.242-.579-.487-.5-.669-.51a13 13 0 0 0-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074s2.096 3.2 5.077 4.487c.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413s.248-1.289.173-1.413c-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.82 9.82 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.82 11.82 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.9 11.9 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.82 11.82 0 0 0-3.48-8.413"},"youtube":{"bg":"#ffffff","fg":"#FF0000","d":"M23.498 6.186a3.02 3.02 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.02 3.02 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.02 3.02 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.02 3.02 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814M9.545 15.568V8.432L15.818 12z"},"gemini":{"bg":"#ffffff","fg":"url(#gmG)","d":"M11.04 19.32Q12 21.51 12 24q0-2.49.93-4.68.96-2.19 2.58-3.81t3.81-2.55Q21.51 12 24 12q-2.49 0-4.68-.93a12.3 12.3 0 0 1-3.81-2.58 12.3 12.3 0 0 1-2.58-3.81Q12 2.49 12 0q0 2.49-.96 4.68-.93 2.19-2.55 3.81a12.3 12.3 0 0 1-3.81 2.58Q2.49 12 0 12q2.49 0 4.68.96 2.19.93 3.81 2.55t2.55 3.81"},"claude":{"bg":"#D97757","fg":"#ffffff","d":"m4.714 15.956 4.718-2.648.079-.23-.08-.128h-.23l-.79-.048-2.695-.073-2.337-.097-2.265-.122-.57-.121-.535-.704.055-.353.48-.321.685.06 1.518.104 2.277.157 1.651.098 2.447.255h.389l.054-.158-.133-.097-.103-.098-2.356-1.596-2.55-1.688-1.336-.972-.722-.491L2 6.223l-.158-1.008.656-.722.88.06.224.061.893.686 1.906 1.476 2.49 1.833.364.304.146-.104.018-.072-.164-.274-1.354-2.446-1.445-2.49-.644-1.032-.17-.619a3 3 0 0 1-.103-.729L6.287.133 6.7 0l.995.134.42.364.619 1.415L9.735 4.14l1.555 3.03.455.898.243.832.09.255h.159V9.01l.127-1.706.237-2.095.23-2.695.08-.76.376-.91.747-.492.583.28.48.685-.067.444-.286 1.851-.558 2.903-.365 1.942h.213l.243-.242.983-1.306 1.652-2.064.728-.82.85-.904.547-.431h1.032l.759 1.129-.34 1.166-1.063 1.347-.88 1.142-1.263 1.7-.79 1.36.074.11.188-.02 2.853-.606 1.542-.28 1.84-.315.832.388.09.395-.327.807-1.967.486-2.307.462-3.436.813-.043.03.049.061 1.548.146.662.036h1.62l3.018.225.79.522.473.638-.08.485-1.213.62-1.64-.389-3.825-.91-1.31-.329h-.183v.11l1.093 1.068 2.003 1.81 2.508 2.33.127.578-.321.455-.34-.049-2.204-1.657-.85-.747-1.925-1.62h-.127v.17l.443.649 2.343 3.521.122 1.08-.17.353-.607.213-.668-.122-1.372-1.924-1.415-2.168-1.141-1.943-.14.08-.674 7.254-.316.37-.728.28-.607-.461-.322-.747.322-1.476.388-1.924.316-1.53.285-1.9.17-.632-.012-.042-.14.018-1.432 1.967-2.18 2.945-1.724 1.845-.413.164-.716-.37.066-.662.401-.589 2.386-3.036 1.439-1.882.929-1.086-.006-.158h-.055L4.138 18.56l-1.13.146-.485-.456.06-.746.231-.243 1.907-1.312Z"},"gmail":{"bg":"#ffffff","fg":"#EA4335","d":"M24 5.457v13.909c0 .904-.732 1.636-1.636 1.636h-3.819V11.73L12 16.64l-6.545-4.91v9.273H1.636A1.636 1.636 0 0 1 0 19.366V5.457c0-2.023 2.309-3.178 3.927-1.964L5.455 4.64 12 9.548l6.545-4.91 1.528-1.145C21.69 2.28 24 3.434 24 5.457"}};
const BRAND_HOSTS = [[/(^|\.)whatsapp\.com$/, "whatsapp"], [/(^|\.)youtube\.com$|^youtu\.be$/, "youtube"], [/^gemini\.google\.com$/, "gemini"], [/^claude\.ai$/, "claude"], [/^mail\.google\.com$|^gmail\.com$/, "gmail"]];
const ICON_CDN = "https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/";
/* Dashboard Icons (full-colour app logos). Several names are tried in order; if none loads we use the bundled glyph tile. */
const BRAND_CAND = { whatsapp: ["whatsapp"], youtube: ["youtube"], gemini: ["google-gemini", "gemini"], claude: ["claude-ai", "claude"], gmail: ["gmail"], chatgpt: ["chatgpt"] };
BRAND_HOSTS.push([/^chatgpt\.com$|(^|\.)openai\.com$/, "chatgpt"]);
const glyphHtml = k => {
  const b = BRANDS[k]; if (!b) return `<span class="brand" style="background:#10a37f;color:#fff;font-size:1.3rem;font-weight:700">${k[0].toUpperCase()}</span>`;
  const grad = b.fg.startsWith("url") ? '<defs><linearGradient id="gmG" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#4285F4"/><stop offset=".55" stop-color="#9B72CB"/><stop offset="1" stop-color="#D96570"/></linearGradient></defs>' : "";
  return `<span class="brand" style="background:${b.bg};color:${b.fg}"><svg viewBox="0 0 24 24" aria-hidden="true">${grad}<path fill="${b.fg.startsWith("url") ? b.fg : "currentColor"}" d="${b.d}"/></svg></span>`;
};
const scIconHtml = u => {
  const h = host(u), k = (BRAND_HOSTS.find(([re]) => re.test(h)) || [])[1];
  if (!k) return `<img src="${scIcon(u)}" alt="" draggable="false">`;
  return `<img class="brandimg" data-k="${k}" data-c="0" src="${ICON_CDN}${BRAND_CAND[k][0]}.svg" alt="" draggable="false">`;
};
document.addEventListener("error", e => {
  const i = e.target; if (!(i instanceof HTMLImageElement) || !i.dataset.k) return;
  const list = BRAND_CAND[i.dataset.k], n = +i.dataset.c + 1;
  if (n < list.length) { i.dataset.c = n; i.src = `${ICON_CDN}${list[n]}.svg`; }
  else i.outerHTML = glyphHtml(i.dataset.k);
}, true);
/* tray that slides out of the dock, to the left of the shortcuts button */
function renderTray() {
  const box = $("#scTrayIn");
  box.innerHTML = S.shortcuts.map(s => `<a class="sc-tile" data-id="${s.id}" draggable="true" href="${esc(s.url)}" title="${esc(s.title)}">${scIconHtml(s.url)}</a>`).join("") +
    `<button class="sc-tile sc-add" id="scManage" title="Add or remove shortcuts">+</button>`;
  $$(".sc-tile img:not([data-k])", box).forEach(i => i.onerror = () => { i.parentNode.textContent = (i.parentNode.title[0] || "•").toUpperCase(); });
  $("#scManage").onclick = openShortcutManager;
}
/* drag the icons to reorder them */
(() => {
  const box = $("#scTrayIn"); let drag = null;
  box.addEventListener("dragstart", e => {
    const t = e.target.closest(".sc-tile[data-id]"); if (!t) return;
    drag = t; t.classList.add("drag"); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", t.dataset.id);
  });
  box.addEventListener("dragover", e => {
    if (!drag) return; e.preventDefault(); e.dataTransfer.dropEffect = "move";
    const br = box.getBoundingClientRect();
    if (e.clientX < br.left + 36) box.scrollLeft -= 14; else if (e.clientX > br.right - 36) box.scrollLeft += 14;
    const t = e.target.closest(".sc-tile[data-id]"); if (!t || t === drag) return;
    const r = t.getBoundingClientRect();
    t.parentNode.insertBefore(drag, e.clientX > r.left + r.width / 2 ? t.nextSibling : t);
  });
  box.addEventListener("drop", e => { if (drag) e.preventDefault(); });
  box.addEventListener("dragend", () => {
    if (!drag) return;
    drag.classList.remove("drag"); drag = null;
    const order = $$(".sc-tile[data-id]", box).map(a => S.shortcuts.find(s => s.id === a.dataset.id)).filter(Boolean);
    if (order.length === S.shortcuts.length) { S.shortcuts = order; store.save(); }
  });
})();
function setTray(open) {
  $("#scTray").classList.toggle("open", open);
  $("#dock .d-links").classList.toggle("on", open);
  $("#scTray").setAttribute("aria-hidden", String(!open));
}
const trayOpen = () => $("#scTray").classList.contains("open");
document.addEventListener("click", e => { if (trayOpen() && !e.target.closest("#dock")) setTray(false); });
document.addEventListener("keydown", e => { if (e.key === "Escape" && trayOpen()) setTray(false); });
$("#scTrayIn").addEventListener("wheel", e => { const s = e.currentTarget; if (s.scrollWidth > s.clientWidth && Math.abs(e.deltaY) > Math.abs(e.deltaX)) { s.scrollLeft += e.deltaY; e.preventDefault(); } }, { passive: false });

function openShortcutManager() {
  openModal("Manage shortcuts", { id: "shortcut-manage", w: 700, h: 640, body: `<div class="m-body"><h2>Shortcuts</h2>
    <div class="scg" id="scGrid"></div>
    <div class="sub-label" style="margin-top:1.4rem">Quick add</div><div class="presets" id="scPresets"></div>
    <div class="sub-label">Or add your own</div>
    <div class="url-row"><input id="scTitle" class="input" placeholder="Name (optional)"><input id="scUrl" class="input" placeholder="https://example.com"><button class="btn primary" id="scSave">Add</button></div></div>`,
    mount(m) {
      const draw = () => {
        $("#scGrid", m).innerHTML = S.shortcuts.length ? S.shortcuts.map(s => `<a class="scg-item" href="${esc(s.url)}" title="${esc(s.url)}"><button class="x" data-id="${s.id}" title="Remove">✕</button>
          <div class="scg-tile">${scIconHtml(s.url)}</div><span>${esc(s.title)}</span></a>`).join("")
          : `<div class="muted" style="grid-column:1/-1;padding:.6rem 0">No shortcuts yet. Add some below.</div>`;
        $$(".scg-tile img:not([data-k])", m).forEach(i => i.onerror = () => { i.parentNode.textContent = (i.closest(".scg-item").querySelector("span").textContent[0] || "•").toUpperCase(); });
        $$("#scGrid .x", m).forEach(b => b.onclick = e => { e.preventDefault(); e.stopPropagation(); S.shortcuts = S.shortcuts.filter(s => s.id !== b.dataset.id); store.save(); draw(); renderTray(); });
        const left = PRESETS.filter(p => !S.shortcuts.some(s => host(s.url) === host(p.url)));
        $("#scPresets", m).innerHTML = left.length ? left.map((p, i) => `<button class="preset" data-i="${i}">${scIconHtml(p.url)}${esc(p.title)}</button>`).join("") : `<span class="muted">All the quick ones are already added.</span>`;
        $$(".preset", m).forEach(b => b.onclick = () => { S.shortcuts.push({ id: uid(), ...left[+b.dataset.i] }); store.save(); draw(); renderTray(); });
      };
      const add = () => {
        let url = $("#scUrl", m).value.trim(); if (!url) return;
        if (!/^[a-z]+:\/\//i.test(url)) url = "https://" + url;
        S.shortcuts.push({ id: uid(), title: $("#scTitle", m).value.trim() || host(url), url });
        $("#scTitle", m).value = $("#scUrl", m).value = ""; store.save(); draw(); renderTray();
      };
      $("#scSave", m).onclick = add;
      $("#scUrl", m).onkeydown = e => e.key === "Enter" && add();
      draw();
    } });
}

/* ---------- bookshelf (Your library) ---------- */
const BOOK_COLORS = ["#7b2d2d", "#1f3a5f", "#2f5d46", "#b9892f", "#5b3a63", "#2a6b6b", "#2c2c30", "#a9784a", "#e6dcc3"];
const BOOK_FONTS = ["Playfair Display", "Cinzel", "Cormorant Garamond", "IM Fell English", "Special Elite", "Caveat"];
const inkFor = hex => { const n = parseInt(hex.slice(1), 16), l = (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255; return l > 0.62 ? "#2a2218" : "#f3e7c9"; };
const openUrl = u => { if (hasChrome && chrome.tabs) chrome.tabs.create({ url: u }); else window.open(u, "_blank"); };
async function openFile(id) {
  const rec = await fileGet(id);
  if (!rec) return toast("That file is missing");
  const u = URL.createObjectURL(rec.blob);
  if (!window.open(u, "_blank")) { const a = document.createElement("a"); a.href = u; a.download = rec.name; a.click(); }
  setTimeout(() => URL.revokeObjectURL(u), 120000);
}
const fmtSize = n => n > 1048576 ? (n / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round(n / 1024)) + " KB";
const FILE_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M7 3h8l4 4v14H7z M15 3v4h4"/></svg>';

function bookHtml(b) {
  const h = hueOf(b.id), font = BOOK_FONTS.includes(b.font) ? b.font : BOOK_FONTS[0];
  return `<button class="book" data-id="${b.id}" title="${esc(b.title || "Untitled")}${b.author ? " — " + esc(b.author) : ""} (click to open · right-click to edit)" style="--bc:${b.color};--bt:${inkFor(b.color)};--bh:${80 + (h % 21)};--bw:${(3 + ((h >> 3) % 6) * 0.2).toFixed(1)}rem;--bf:'${font}',serif">
    <span class="b-title">${esc(b.title || "Untitled")}</span></button>`;
}
/* ---- shelves: each shelf is one row of books; switching slides the rows up or down ---- */
function ensureShelves() {
  if (!Array.isArray(S.shelves) || !S.shelves.length) S.shelves = [{ id: uid(), name: "My shelf" }];
  if (!S.shelves.some(s => s.id === S.curShelf)) S.curShelf = S.shelves[0].id;
  S.books.forEach(b => { if (!S.shelves.some(s => s.id === b.shelf)) b.shelf = S.shelves[0].id; });
}
const shelfIdx = () => S.shelves.findIndex(s => s.id === S.curShelf);
const curShelf = () => S.shelves[shelfIdx()];
function shelfPane(id) {
  const p = document.createElement("div"); p.className = "shelf-scroll"; p.dataset.shelf = id;
  p.innerHTML = `<div class="shelf-row">${S.books.filter(b => b.shelf === id).map(bookHtml).join("")}<button class="book new" title="New book"><span>+</span></button></div>`;
  return p;
}
function drawShelfNav() {
  const n = S.shelves.length;
  $("#shelfName").textContent = curShelf().name;
  $("#shelfCount").textContent = `${shelfIdx() + 1}/${n}`;
  $("#shelfPrev").disabled = $("#shelfNext").disabled = n < 2;
}
function renderShelf() {
  ensureShelves();
  const stage = $("#shelfStage"), old = $(".shelf-scroll", stage), keep = old && old.dataset.shelf === S.curShelf ? old.scrollLeft : 0;
  stage.innerHTML = ""; const p = shelfPane(S.curShelf); stage.appendChild(p); p.scrollLeft = keep;
  drawShelfNav();
}
let shelfBusy = false;
function switchShelf(id, dir) {
  const stage = $("#shelfStage"), old = $(".shelf-scroll", stage);
  S.curShelf = id; store.save(); drawShelfNav();
  const neu = shelfPane(id);
  if (!old) { stage.appendChild(neu); return; }
  shelfBusy = true;
  neu.style.transform = `translateY(${dir * 100}%)`; stage.appendChild(neu); void neu.offsetHeight;
  old.style.transform = `translateY(${-dir * 100}%)`; neu.style.transform = "translateY(0)";
  setTimeout(() => { old.remove(); neu.style.transform = ""; shelfBusy = false; }, 470);
}
function stepShelf(step) {
  const n = S.shelves.length; if (shelfBusy || n < 2) return;
  switchShelf(S.shelves[(shelfIdx() + step + n) % n].id, step > 0 ? 1 : -1);
}
function renameShelf() {
  const btn = $("#shelfName"), s = curShelf(), inp = document.createElement("input"); let done = false;
  inp.className = "sn-input"; inp.maxLength = 30; inp.value = s.name; btn.replaceWith(inp); inp.focus(); inp.select();
  const end = ok => { if (done) return; done = true; if (ok && inp.value.trim()) s.name = inp.value.trim(); store.save(); inp.replaceWith(btn); drawShelfNav(); };
  inp.onblur = () => end(true);
  inp.onkeydown = e => { if (e.key === "Enter") end(true); else if (e.key === "Escape") end(false); };
}
function addShelf() {
  if (shelfBusy) return;
  const s = { id: uid(), name: `Shelf ${S.shelves.length + 1}` };
  S.shelves.push(s); switchShelf(s.id, 1); renameShelf();
}
function deleteShelf() {
  const n = S.shelves.length, s = curShelf(), i = shelfIdx();
  if (n < 2) return toast("Keep at least one shelf");
  const count = S.books.filter(b => b.shelf === s.id).length;
  if (!confirm(`Delete the shelf “${s.name}”?${count ? ` Its ${count} book${count > 1 ? "s" : ""} will move to the neighbouring shelf.` : ""}`)) return;
  const nb = S.shelves[i + 1] || S.shelves[i - 1], dir = S.shelves[i + 1] ? 1 : -1;
  S.books.forEach(b => { if (b.shelf === s.id) b.shelf = nb.id; });
  S.shelves = S.shelves.filter(x => x !== s); switchShelf(nb.id, dir);
}
function newBook() {
  const b = { id: uid(), title: "New book", color: BOOK_COLORS[S.books.length % BOOK_COLORS.length], font: BOOK_FONTS[0], links: [], author: "", shelf: S.curShelf };
  S.books.push(b); store.save(); renderShelf();
  const p = $("#shelfStage .shelf-scroll"); p.scrollLeft = p.scrollWidth;
  openBook(b.id, true);
}
const stageEl = $("#shelfStage");
stageEl.addEventListener("click", e => {
  if (e.target.closest(".book.new")) return newBook();
  const bk = e.target.closest(".book[data-id]"); if (!bk) return;
  const b = S.books.find(x => x.id === bk.dataset.id);
  b && b.links.length ? openBookView(b.id) : openBook(bk.dataset.id);
});
stageEl.addEventListener("contextmenu", e => {
  const bk = e.target.closest(".book[data-id]"); if (!bk) return;
  e.preventDefault(); openBook(bk.dataset.id);
});
stageEl.addEventListener("wheel", e => {
  const s = e.target.closest(".shelf-scroll"); if (!s || s.scrollWidth <= s.clientWidth || Math.abs(e.deltaY) < Math.abs(e.deltaX)) return;
  s.scrollLeft += e.deltaY; e.preventDefault();
}, { passive: false });
$("#newBook").onclick = newBook;
$("#shelfAdd").onclick = addShelf;
$("#shelfPrev").onclick = () => stepShelf(-1);
$("#shelfNext").onclick = () => stepShelf(1);
$("#shelfName").onclick = e => { e.stopPropagation(); $("#shelfMenu").hidden = !$("#shelfMenu").hidden; };
$("#shelfMenu").onclick = e => {
  const a = e.target.closest("button")?.dataset.a; if (!a) return;
  $("#shelfMenu").hidden = true; a === "rename" ? renameShelf() : deleteShelf();
};
document.addEventListener("click", e => { if (!e.target.closest("#shelfMenu")) $("#shelfMenu").hidden = true; });

function openBookView(id) {
  const b = S.books.find(x => x.id === id); if (!b) return;
  if (current === "book" || current === "bookview") closeModal();
  const font = BOOK_FONTS.includes(b.font) ? b.font : BOOK_FONTS[0], links = b.links.filter(l => l.kind !== "file");
  openModal("Book", { id: "bookview", w: 600, h: 640, body: `<div class="m-body bv">
    <div class="bv-cover" style="--bc:${b.color};--bt:${inkFor(b.color)};--bf:'${font}',serif">
      <h2>${esc(b.title || "Untitled")}</h2>${b.author ? `<p>${esc(b.author)}</p>` : ""}</div>
    <div class="bv-bar"><span class="muted">${b.links.length} item${b.links.length === 1 ? "" : "s"}</span><span>
      ${links.length > 1 ? `<button class="btn" id="bvAll">Open all links</button> ` : ""}<button class="btn" id="bvEdit">Edit</button></span></div>
    <div id="bvList">${b.links.map(l => `<button class="bk-item bv-item" data-id="${l.id}">
      <span class="bk-ico">${l.kind === "file" ? FILE_SVG : `<img src="${favicon(l.url)}" alt="">`}</span>
      <div class="bk-it"><b>${esc(l.title)}</b><small>${l.kind === "file" ? esc(l.name) + " · " + fmtSize(l.size || 0) : esc(l.url)}</small></div></button>`).join("")}</div></div>`,
    mount(m) {
      $$(".bv-item img", m).forEach(im => im.onerror = () => (im.style.visibility = "hidden"));
      $$(".bv-item", m).forEach(r => r.onclick = () => { const l = b.links.find(x => x.id === r.dataset.id); l.kind === "file" ? openFile(l.fileId) : openUrl(l.url); });
      $("#bvEdit", m).onclick = () => openBook(b.id);
      const all = $("#bvAll", m); if (all) all.onclick = () => links.forEach(l => openUrl(l.url));
    } });
}
function openBook(id, fresh) {
  const b = S.books.find(x => x.id === id); if (!b) return;
  if (current === "book" || current === "bookview") closeModal();
  openModal("Edit book", { id: "book", w: 680, h: 740, body: `<div class="m-body bk">
    <input id="bkTitle" class="input bk-title" maxlength="60" placeholder="Book title" spellcheck="false">
    <input id="bkAuthor" class="input bk-author" maxlength="40" placeholder="Author (optional)" spellcheck="false">
    <select id="bkShelf" class="input bk-shelf" title="Move to another shelf" hidden></select>
    <div class="bk-opts"><div class="swatches" id="bkColors"></div><select id="bkFont" class="input"></select></div>
    <div class="sub-label" id="bkCount"></div>
    <div id="bkLinks"></div>
    <div class="add-row"><input id="bkUrl" placeholder="Paste a link…"><button class="btn" id="bkAddUrl">Add link</button></div>
    <label class="row-btn" style="cursor:pointer">${FILE_SVG.replace("<svg", '<svg width="22" height="22"')}Add files (PDF, HTML, anything)<input type="file" id="bkFile" multiple hidden></label>
    <div class="bk-foot"><button class="btn danger" id="bkDel" style="background:none;padding-left:0">Delete this book</button><button class="btn primary" id="bkDone">Done</button></div></div>`,
    mount(m) {
      const t = $("#bkTitle", m);
      const spine = () => { store.save(); renderShelf(); };
      const styleTitle = () => { t.style.fontFamily = `'${BOOK_FONTS.includes(b.font) ? b.font : BOOK_FONTS[0]}',serif`; };
      t.value = b.title; styleTitle();
      t.oninput = () => { b.title = t.value; spine(); };
      const au = $("#bkAuthor", m); au.value = b.author || ""; au.oninput = () => { b.author = au.value; spine(); };
      const sh = $("#bkShelf", m);
      if (S.shelves.length > 1) { sh.hidden = false; sh.innerHTML = S.shelves.map(s => `<option value="${s.id}" ${s.id === b.shelf ? "selected" : ""}>Shelf: ${esc(s.name)}</option>`).join(""); sh.onchange = () => { b.shelf = sh.value; spine(); }; }
      $("#bkDone", m).onclick = () => { closeModal(); if (b.links.length) openBookView(b.id); };
      $("#bkFont", m).innerHTML = BOOK_FONTS.map(f => `<option ${f === b.font ? "selected" : ""}>${f}</option>`).join("");
      $("#bkFont", m).onchange = e => { b.font = e.target.value; styleTitle(); spine(); };
      const drawColors = () => {
        $("#bkColors", m).innerHTML = BOOK_COLORS.map(c => `<button class="sw ${c === b.color ? "on" : ""}" data-c="${c}" style="background:${c};width:1.7rem;height:1.7rem"></button>`).join("");
        $$("#bkColors .sw", m).forEach(s => s.onclick = () => { b.color = s.dataset.c; spine(); drawColors(); });
      };
      drawColors();
      const drawLinks = () => {
        $("#bkCount", m).textContent = b.links.length ? `Inside this book (${b.links.length})` : "Nothing inside yet — add links or files below.";
        $("#bkLinks", m).innerHTML = b.links.map(l => `<div class="bk-item" data-id="${l.id}">
          <span class="bk-ico">${l.kind === "file" ? FILE_SVG : `<img src="${favicon(l.url)}" alt="">`}</span>
          <div class="bk-it"><input class="bk-name" value="${esc(l.title)}" spellcheck="false"><small>${l.kind === "file" ? esc(l.name) + " · " + fmtSize(l.size || 0) : esc(l.url)}</small></div>
          <button class="btn" data-a="open">Open</button><button class="btn danger" data-a="del" title="Remove">✕</button></div>`).join("");
        $$(".bk-item", m).forEach(r => {
          const l = b.links.find(x => x.id === r.dataset.id);
          $(".bk-name", r).oninput = e => { l.title = e.target.value; store.save(); };
          const im = $("img", r); if (im) im.onerror = () => (im.style.visibility = "hidden");
          $("[data-a=open]", r).onclick = () => (l.kind === "file" ? openFile(l.fileId) : openUrl(l.url));
          $("[data-a=del]", r).onclick = async () => { if (l.kind === "file") await fileDel(l.fileId); b.links = b.links.filter(x => x !== l); spine(); drawLinks(); };
        });
      };
      drawLinks();
      const addUrl = () => {
        let u = $("#bkUrl", m).value.trim(); if (!u) return;
        if (!/^[a-z][a-z0-9+.-]*:/i.test(u)) u = "https://" + u;
        b.links.push({ id: uid(), kind: "link", title: host(u) || u, url: u });
        $("#bkUrl", m).value = ""; spine(); drawLinks();
      };
      $("#bkAddUrl", m).onclick = addUrl;
      $("#bkUrl", m).onkeydown = e => e.key === "Enter" && addUrl();
      $("#bkFile", m).onchange = async e => {
        const files = [...e.target.files]; if (!files.length) return;
        for (const f of files) {
          const fid = uid();
          await filePut({ id: fid, name: f.name, blob: f, added: Date.now() });
          b.links.push({ id: uid(), kind: "file", title: f.name.replace(/\.[^.]+$/, ""), name: f.name, size: f.size, mime: f.type, fileId: fid });
        }
        spine(); drawLinks(); toast(`Added ${files.length} file${files.length > 1 ? "s" : ""}`);
      };
      $("#bkDel", m).onclick = async () => {
        if (!confirm(`Delete “${b.title || "Untitled"}” and everything saved inside it?`)) return;
        for (const l of b.links) if (l.kind === "file") await fileDel(l.fileId);
        S.books = S.books.filter(x => x !== b); store.save(); renderShelf(); closeModal();
      };
      if (fresh) { t.focus(); t.select(); }
    } });
}

/* ---------- modal system ---------- */
let current = null;
const DOT_X = { notes: 0, todos: 0, stickies: 0, settings: 0 };
function closeModal() { $("#modalHost").innerHTML = ""; current = null; $("#dockDot").classList.remove("on"); }
function openModal(title, o) {
  closeLibrary();
  if (current === o.id) return closeModal();
  $("#modalHost").innerHTML = "";
  const m = document.createElement("div");
  m.className = "modal";
  const W = Math.min(sc(o.w), innerWidth - 24), H = Math.min(sc(o.h), innerHeight - sc(140));
  Object.assign(m.style, { width: W + "px", height: H + "px", left: (o.x ?? (innerWidth - W) / 2) + "px", top: (o.y ?? Math.max(16, (innerHeight - H) / 2 - sc(40))) + "px" });
  m.innerHTML = `<div class="m-head"><button class="m-close" aria-label="Close"><svg viewBox="0 0 10 10"><path d="M1.5 1.5l7 7M8.5 1.5l-7 7" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" fill="none"/></svg></button>${esc(title)}</div>${o.body}`;
  $("#modalHost").appendChild(m);
  $(".m-close", m).onclick = closeModal;
  current = o.id;
  const btn = $(`#dock [data-app="${o.id}"]`);
  placeDot();
  o.mount && o.mount(m);
}
document.addEventListener("keydown", e => { if (e.key === "Escape") { if (libOv) closeLibrary(); else if (current) closeModal(); } });

/* ---------- Notes ---------- */
function openNotes() {
  openModal("Notes", { id: "notes", w: 1020, h: 720, body: `<div class="m-body"><h2>Notes</h2>
    <textarea id="newNote" class="input" rows="1" placeholder="Take a note…"></textarea>
    <div id="noteList"></div></div>`,
    mount(m) {
      const list = $("#noteList", m), nn = $("#newNote", m);
      const draw = () => {
        list.innerHTML = S.notes.length ? S.notes.map(n => `<div class="note" data-id="${n.id}">
          <textarea rows="2">${esc(n.text)}</textarea>
          <div class="row"><button data-a="stick">Stick to desktop</button><button data-a="del">Delete</button></div></div>`).join("")
          : `<div class="big-empty"><div>No notes yet — write your first one above.</div></div>`;
        $$(".note textarea", list).forEach(t => { autosize(t); t.oninput = () => { const n = S.notes.find(x => x.id === t.closest(".note").dataset.id); n.text = t.value; autosize(t); store.save(); }; });
        $$(".note button", list).forEach(b => b.onclick = () => {
          const id = b.closest(".note").dataset.id, n = S.notes.find(x => x.id === id);
          if (b.dataset.a === "del") { S.notes = S.notes.filter(x => x.id !== id); }
          else { addSticky(n.text); toast("Stuck to your new tab"); }
          store.save(); draw();
        });
      };
      nn.addEventListener("keydown", e => {
        if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); const t = nn.value.trim(); if (!t) return; S.notes.unshift({ id: uid(), text: t }); nn.value = ""; store.save(); draw(); }
      });
      nn.focus(); draw();
    } });
}
function autosize(t) { t.style.height = "auto"; t.style.height = t.scrollHeight + "px"; }

/* ---------- To-dos ---------- */
let todoFilter = "all";
function openTodos() {
  openModal("To-dos", { id: "todos", w: 840, h: 700, x: Math.max(16, innerWidth / 2 - sc(100)), y: sc(60), body: `<div class="m-body">
    <div class="m-title-row"><div><h2 style="margin-bottom:4px">To-dos</h2><div class="muted" id="todoCount"></div></div>
    <div class="seg" id="todoSeg"><button data-f="all">All</button><button data-f="active">Active</button><button data-f="done">Done</button></div></div>
    <div class="add-row"><input id="todoIn" placeholder="Add a task…"><button class="btn" id="todoAdd">Add</button></div>
    <div id="todoList"></div></div>`,
    mount(m) {
      const draw = () => {
        const open = S.todos.filter(t => !t.done).length;
        $("#todoCount", m).textContent = `${open} open · ${S.todos.length - open} done`;
        $$("#todoSeg button", m).forEach(b => b.classList.toggle("on", b.dataset.f === todoFilter));
        const list = S.todos.filter(t => todoFilter === "all" || (todoFilter === "done") === t.done);
        $("#todoList", m).innerHTML = list.length ? list.map(t => `<div class="todo ${t.done ? "done" : ""}" data-id="${t.id}">
            <input type="checkbox" ${t.done ? "checked" : ""}><span>${esc(t.text)}</span><button title="Delete">✕</button></div>`).join("")
          : `<div class="big-empty"><div><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M3 6l1.5 1.5L7 5M3 12l1.5 1.5L7 11M3 18l1.5 1.5L7 17M10 6.5h11M10 12.5h11M10 18.5h11"/></svg><b>${todoFilter === "done" ? "Nothing done yet" : "Nothing to do"}</b>Add your first task above.</div></div>`;
        $$(".todo", m).forEach(r => {
          const t = S.todos.find(x => x.id === r.dataset.id);
          $("input", r).onchange = e => { t.done = e.target.checked; store.save(); draw(); };
          $("button", r).onclick = () => { S.todos = S.todos.filter(x => x !== t); store.save(); draw(); };
        });
      };
      const add = () => { const v = $("#todoIn", m).value.trim(); if (!v) return; S.todos.unshift({ id: uid(), text: v, done: false }); $("#todoIn", m).value = ""; store.save(); draw(); };
      $("#todoAdd", m).onclick = add;
      $("#todoIn", m).onkeydown = e => e.key === "Enter" && add();
      $$("#todoSeg button", m).forEach(b => b.onclick = () => { todoFilter = b.dataset.f; draw(); });
      $("#todoIn", m).focus(); draw();
    } });
}

/* ---------- Stickies ---------- */
const STICKY_COLORS = ["#fde68a", "#fbcfe8", "#bbf7d0", "#bfdbfe", "#ddd6fe"];
function addSticky(text = "") {
  S.stickies.push({ id: uid(), text, color: STICKY_COLORS[S.stickies.length % STICKY_COLORS.length], x: sc(80) + (S.stickies.length % 6) * sc(30), y: sc(140) + (S.stickies.length % 6) * sc(30) });
  store.save(); renderStickies();
}
function renderStickies() {
  const layer = $("#stickyLayer"); layer.innerHTML = "";
  S.stickies.forEach(s => {
    const el = document.createElement("div");
    el.className = "sticky"; el.style.cssText = `left:${s.x}px;top:${s.y}px;background:${s.color}`;
    el.innerHTML = `<header><button data-a="color" title="Change color">●</button><button data-a="del" title="Delete">✕</button></header><textarea placeholder="Type here…">${esc(s.text)}</textarea>`;
    const ta = $("textarea", el);
    ta.oninput = () => { s.text = ta.value; store.save(); };
    $("[data-a=del]", el).onclick = () => { S.stickies = S.stickies.filter(x => x !== s); store.save(); renderStickies(); if (current === "stickies") closeModal(), openStickies(); };
    $("[data-a=color]", el).onclick = () => { s.color = STICKY_COLORS[(STICKY_COLORS.indexOf(s.color) + 1) % STICKY_COLORS.length]; el.style.background = s.color; store.save(); };
    $("header", el).onpointerdown = e => {
      if (e.target.closest("button")) return;
      const dx = e.clientX - s.x, dy = e.clientY - s.y; e.target.setPointerCapture(e.pointerId);
      const mv = ev => { s.x = Math.max(0, Math.min(innerWidth - sc(120), ev.clientX - dx)); s.y = Math.max(0, Math.min(innerHeight - sc(60), ev.clientY - dy)); el.style.left = s.x + "px"; el.style.top = s.y + "px"; };
      const up = () => { removeEventListener("pointermove", mv); removeEventListener("pointerup", up); store.save(); };
      addEventListener("pointermove", mv); addEventListener("pointerup", up);
    };
    layer.appendChild(el);
  });
}
function openStickies() {
  openModal("Stickies", { id: "stickies", w: 630, h: 660, x: Math.max(16, innerWidth / 2 - sc(100)), y: sc(90), body: `<div class="m-body">
    <p class="muted" style="font-size:16px;line-height:1.5;margin-top:0">Stickies float on your new tab. They are notes; position and color stay on this device.</p>
    <button class="btn white" id="newSticky">New Sticky</button>
    <div id="stickyList" style="margin-top:28px"></div></div>`,
    mount(m) {
      const draw = () => {
        $("#stickyList", m).innerHTML = S.stickies.length ? S.stickies.map(s => `<div class="sess" data-id="${s.id}">
          <span style="width:14px;height:14px;border-radius:4px;background:${s.color}"></span><div>${esc((s.text || "Empty sticky").slice(0, 70))}</div><button class="btn danger">Delete</button></div>`).join("")
          : `<p class="muted" style="font-size:17px;line-height:1.5">No stickies yet. Create one, or open a note and stick it to the desktop.</p>`;
        $$(".sess .btn", m).forEach(b => b.onclick = () => { S.stickies = S.stickies.filter(x => x.id !== b.closest(".sess").dataset.id); store.save(); renderStickies(); draw(); });
      };
      $("#newSticky", m).onclick = () => { addSticky(); draw(); };
      draw();
    } });
}

/* ---------- Sessions ---------- */
const GROUP_COLORS = { grey: "#9aa0a6", blue: "#8ab4f8", red: "#f28b82", yellow: "#fdd663", green: "#81c995", pink: "#ff8bcb", purple: "#c58af9", cyan: "#78d9ec", orange: "#fcad70" };
async function restoreTabs(tabs, groups) {
  const made = [];
  for (const t of tabs) made.push(await chrome.tabs.create({ url: t.url, active: false }));
  if (!chrome.tabGroups || !groups?.length) return;
  for (const g of groups) {
    const ids = made.filter((_, i) => tabs[i].g === g.key).map(t => t.id);
    if (!ids.length) continue;
    try {
      const gid = await chrome.tabs.group({ tabIds: ids });
      await chrome.tabGroups.update(gid, { title: g.title || "", color: g.color || "grey", collapsed: !!g.collapsed });
    } catch { /* leave the tabs ungrouped */ }
  }
}
function openSessions() {
  openModal("Sessions", { id: "sessions", w: 640, h: 620, body: `<div class="m-body"><h2>Sessions</h2>
    <p class="muted" style="margin-top:-8px">Saved when you press Save &amp; close. Tab groups are kept too.</p><div id="sessList"></div></div>`,
    mount(m) {
      const draw = () => {
        $("#sessList", m).innerHTML = S.sessions.length ? S.sessions.map(s => {
          const gs = s.groups || [];
          return `<div class="sess" data-id="${s.id}">
          <div><b>${esc(s.name)}</b><br><span class="muted">${s.tabs.length} tabs${gs.length ? ` · ${gs.length} group${gs.length > 1 ? "s" : ""}` : ""}</span>
          ${gs.length ? `<span class="sg-chips">${gs.map(g => `<button class="sg-chip" data-g="${esc(g.key)}" title="Restore just this group"><i style="background:${GROUP_COLORS[g.color] || GROUP_COLORS.grey}"></i>${esc(g.title || "Untitled group")} <small>${s.tabs.filter(t => t.g === g.key).length}</small></button>`).join("")}</span>` : ""}</div>
          <button class="btn primary" data-a="open">Restore</button><button class="btn danger" data-a="del">Delete</button></div>`;
        }).join("")
          : `<div class="big-empty"><div>No sessions yet.<b>Save &amp; close</b>stores your open tabs so you can restore them later.</div></div>`;
        $$(".sess .btn", m).forEach(b => b.onclick = () => {
          const s = S.sessions.find(x => x.id === b.closest(".sess").dataset.id);
          if (b.dataset.a === "del") { S.sessions = S.sessions.filter(x => x !== s); store.save(); draw(); }
          else restoreTabs(s.tabs, s.groups);
        });
        $$(".sg-chip", m).forEach(c => c.onclick = () => {
          const s = S.sessions.find(x => x.id === c.closest(".sess").dataset.id), g = s.groups.find(x => x.key === c.dataset.g);
          restoreTabs(s.tabs.filter(t => t.g === g.key), [g]);
        });
      };
      draw();
    } });
}
async function saveAndClose() {
  if (!hasChrome || !chrome.tabs) return toast("Needs the tabs permission");
  const tabs = await chrome.tabs.query({ currentWindow: true });
  const me = await chrome.tabs.getCurrent();
  const keep = tabs.filter(t => t.id !== me?.id && t.url && !/^(chrome|brave|edge):\/\/newtab/.test(t.url));
  if (!keep.length) return toast("No other tabs to save");
  let groups = [];
  if (chrome.tabGroups && tabs.length) {
    try {
      const used = new Set(keep.map(t => t.groupId).filter(g => g != null && g >= 0));
      groups = (await chrome.tabGroups.query({ windowId: tabs[0].windowId })).filter(g => used.has(g.id))
        .map(g => ({ key: "g" + g.id, title: g.title || "", color: g.color || "grey", collapsed: !!g.collapsed }));
    } catch { groups = []; }
  }
  S.sessions.unshift({ id: uid(), name: new Date().toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }),
    tabs: keep.map(t => { const o = { title: t.title, url: t.url }; if (t.groupId >= 0 && groups.some(g => g.key === "g" + t.groupId)) o.g = "g" + t.groupId; return o; }), groups });
  store.save();
  await chrome.tabs.remove(keep.map(t => t.id));
  toast(`Saved ${keep.length} tabs${groups.length ? ` and ${groups.length} group${groups.length > 1 ? "s" : ""}` : ""}`); updateTabCount();
}
async function updateTabCount() {
  if (!hasChrome || !chrome.tabs) return;
  const t = await chrome.tabs.query({ currentWindow: true });
  $("#tabCount").textContent = `${t.length} tabs`;
}

/* ---------- Weather ---------- */
const WMO = c => c === 0 ? "☀️" : c <= 2 ? "⛅" : c === 3 ? "☁️" : c <= 48 ? "🌫️" : c <= 57 ? "🌦️" : c <= 67 ? "🌧️" : c <= 77 ? "❄️" : c <= 82 ? "🌧️" : c <= 86 ? "🌨️" : "⛈️";
async function loadWeather() {
  const el = $("#weather"), w = S.weather;
  if (!w.on || w.lat == null) { el.hidden = true; return; }
  try {
    const r = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${w.lat}&longitude=${w.lon}&current=temperature_2m,weather_code&temperature_unit=${w.unit === "F" ? "fahrenheit" : "celsius"}`);
    const j = await r.json();
    el.textContent = `${WMO(j.current.weather_code)} ${Math.round(j.current.temperature_2m)}°${w.unit}${w.name ? " · " + w.name : ""}`;
    el.hidden = false;
  } catch { el.hidden = true; }
}

/* ---------- Settings ---------- */
let settingsTab = "Appearance";
function openSettings() {
  openModal("Settings", { id: "settings", w: 1080, h: 735, body: `<div class="set" style="height:calc(100% - 62px)"><div class="set-nav" id="setNav"></div><div class="set-pane" id="setPane"></div></div>`,
    mount(m) {
      const nav = $("#setNav", m), pane = $("#setPane", m);
      const draw = () => {
        nav.innerHTML = ["Appearance", "Wallpaper", "Weather", "General"].map(t => `<button class="${t === settingsTab ? "on" : ""}">${t}</button>`).join("");
        $$("button", nav).forEach(b => b.onclick = () => { settingsTab = b.textContent; draw(); });
        ({ Appearance, Wallpaper, Weather, General })[settingsTab](pane, draw);
      };
      draw();
    } });
}
const toggle = (on, id) => `<button class="switch ${on ? "on" : ""}" id="${id}" role="switch" aria-checked="${on}"></button>`;

function Appearance(p, redraw) {
  p.innerHTML = `<div class="s-row"><b>Theme</b><div class="seg" id="themeSeg">
    ${["light", "dark", "auto"].map(t => `<button data-t="${t}" class="${S.theme === t ? "on" : ""}">${t[0].toUpperCase() + t.slice(1)}</button>`).join("")}</div></div>
    <div class="s-row"><div><b>Interface size</b><small><span id="uiVal">${S.ui}</span>% — scales the whole page.</small></div><input type="range" id="uiRange" min="70" max="140" step="5" value="${S.ui}" style="width:180px"></div>
    <div class="s-row"><div><b>Clock &amp; greeting</b><small>Show the greeting and time above search.</small></div>${toggle(S.clock, "clockSw")}</div>`;
  $$("#themeSeg button", p).forEach(b => b.onclick = () => { S.theme = b.dataset.t; store.save(); applyTheme(); redraw(); });
  $("#uiRange", p).oninput = e => { S.ui = +e.target.value; $("#uiVal", p).textContent = S.ui; applyUi(); store.save(); };
  $("#clockSw", p).onclick = () => { S.clock = !S.clock; store.save(); applyClock(); redraw(); };
}
function Wallpaper(p, redraw) {
  const sw = Object.keys(GRADIENTS).map(k => `<button class="sw ${S.bg.type === "gradient" && S.bg.value === k && !S.wp.rotate ? "on" : ""}" data-k="${k}" style="background:${GRADIENTS[k]}" title="Color"></button>`).join("");
  const un = S.unsplash, cnt = id => un.lists[id]?.photos?.length ? ` · ${un.lists[id].photos.length} photos` : "";
  p.innerHTML = `
    <div class="unsplash-box">
      <div class="s-row"><div><b>Unsplash wallpapers</b><small>A random landscape photo from the sources below, a new one on every tab.</small></div>${toggle(un.on, "unSw")}</div>
      <div class="un-sources" id="unSources">${UNS_SOURCES.map(s => `<label class="un-src"><input type="checkbox" data-s="${s.id}" ${un.sources.includes(s.id) ? "checked" : ""}><span><b>${s.label}</b><small><a href="${s.url}${UNS.utm}" target="_blank" rel="noopener">${s.sub}</a>${cnt(s.id)}</small></span></label>`).join("")}</div>
      <div class="url-row"><input class="input" id="unKey" type="password" autocomplete="off" placeholder="Unsplash Access Key" value="${esc(un.key)}"><button class="btn primary" id="unSave">Save &amp; test</button></div>
      <small class="muted" id="unMsg">Needs a free Access Key: <a href="https://unsplash.com/oauth/applications" target="_blank" rel="noopener">create an app</a> and paste its Access Key. It stays on this computer.</small>
    </div>
    <div class="s-row"><div><b>Change on every new tab</b><small>Cycle through the wallpapers you upload below.</small></div>${toggle(S.wp.rotate, "rotSw")}</div>
    <div class="s-row" style="${S.wp.rotate ? "" : "opacity:.5"}"><b>Order</b><div class="seg" id="ordSeg">
      <button data-o="random" class="${S.wp.order === "random" ? "on" : ""}">Random</button>
      <button data-o="order" class="${S.wp.order === "order" ? "on" : ""}">In order</button></div></div>
    <label class="row-btn" style="cursor:pointer"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="9" cy="9" r="1.6"/><path d="M21 15l-5-5-9 9"/></svg>Upload wallpapers (select several)<input type="file" id="file" accept="image/*" multiple hidden></label>
    <div class="sub-label" id="wpCount">Your wallpapers</div>
    <div class="thumbs" id="thumbs"></div>
    <div class="sub-label">Colors</div>
    <div class="swatches"><button class="sw none ${S.bg.type === "none" && !S.wp.rotate ? "on" : ""}" data-k="none">–</button>${sw}</div>
    <div class="url-row"><input class="input" id="imgUrl" placeholder="…or paste an image URL"><button class="btn primary" id="setUrl">Set</button></div>
    <div class="collapse"><header id="shadeHead"><span>Image shade</span><span class="muted">Top ${S.shadeTop}% · Bottom ${S.shadeBottom}% ⌄</span></header>
      <div class="inner" id="shadeInner" hidden>
        <label>Top <input type="range" min="0" max="90" value="${S.shadeTop}" id="shTop"></label>
        <label>Bottom <input type="range" min="0" max="90" value="${S.shadeBottom}" id="shBot"></label></div></div>
    <button class="btn danger" id="rmAll" style="background:none;padding-left:0">Delete all uploaded wallpapers</button>`;

  const drawThumbs = async () => {
    const all = await wpAll(), box = $("#thumbs", p);
    $("#wpCount", p).textContent = all.length ? `Your wallpapers (${all.length})` : "Your wallpapers";
    if (!all.length) { box.innerHTML = `<div class="thumb-empty">No wallpapers yet. Upload a few images to use them as a slideshow.</div>`; return; }
    box.innerHTML = "";
    all.forEach(r => {
      const d = document.createElement("div"), u = URL.createObjectURL(r.blob);
      d.className = "thumb" + (!S.wp.rotate && S.bg.type === "library" && S.bg.id === r.id ? " on" : "");
      d.style.backgroundImage = `url("${u}")`; d.title = r.name || "Wallpaper";
      d.innerHTML = `<button class="x" title="Delete">✕</button>`;
      d.onclick = async e => {
        if (e.target.closest(".x")) {
          await wpDel(r.id);
          if (S.bg.type === "library" && S.bg.id === r.id) S.bg = { type: "gradient", value: "g0" };
          if (currentId === r.id) await pickRotation();
          store.save(); applyBg(); drawThumbs(); return;
        }
        S.unsplash.on = false; S.wp.rotate = false; S.bg = { type: "library", id: r.id }; store.save(); applyBg(); redraw();
      };
      box.appendChild(d);
    });
  };
  drawThumbs();

  const hasPhotos = () => un.sources.some(id => un.lists[id]?.photos?.length);
  $("#unSw", p).onclick = () => {
    if (!un.on) {
      if (!un.key || !hasPhotos()) return toast("Paste your Unsplash Access Key and press Save & test first");
      un.on = true; S.wp.rotate = false; uCur = null;
    } else un.on = false;
    store.save(); applyBg(); redraw();
  };
  $$("#unSources input", p).forEach(cb => cb.onchange = async () => {
    const id = cb.dataset.s, set = new Set(un.sources), msg = $("#unMsg", p);
    if (cb.checked) set.add(id); else { if (set.size < 2) { cb.checked = true; return toast("Keep at least one source selected"); } set.delete(id); }
    un.sources = [...set];
    if (cb.checked && un.key && !un.lists[id]?.photos?.length) {
      msg.textContent = "Loading…";
      try { await unsplashLoad(id); }
      catch (e) { un.sources = un.sources.filter(x => x !== id); cb.checked = false; msg.textContent = e.message; store.save(); return; }
    }
    uCur = null; store.save(); if (un.on) applyBg(); redraw();
  });
  $("#unSave", p).onclick = async () => {
    const key = $("#unKey", p).value.trim(), msg = $("#unMsg", p); if (!key) return;
    const prev = un.key; un.key = key; msg.textContent = "Testing…";
    const res = await Promise.allSettled(un.sources.map(unsplashLoad)), bad = res.filter(r => r.status === "rejected");
    if (bad.length === res.length) { un.key = prev; msg.textContent = bad[0].reason.message; return; }
    un.sources = un.sources.filter((_, i) => res[i].status === "fulfilled");
    un.on = true; S.wp.rotate = false; uCur = null; store.save();
    toast(bad.length ? `Connected, but ${bad.length} source${bad.length > 1 ? "s" : ""} failed: ${bad[0].reason.message}` : "Unsplash connected"); applyBg(); redraw();
  };
  $("#rotSw", p).onclick = async () => {
    const all = await wpAll();
    if (!S.wp.rotate && !all.length) return toast("Upload at least one wallpaper first");
    S.wp.rotate = !S.wp.rotate; if (S.wp.rotate) S.unsplash.on = false;
    if (S.wp.rotate && !currentId) await pickRotation();
    store.save(); applyBg(); redraw();
  };
  $$("#ordSeg button", p).forEach(b => b.onclick = () => { S.wp.order = b.dataset.o; store.save(); redraw(); });
  $("#file", p).onchange = async e => {
    const files = [...e.target.files]; if (!files.length) return;
    toast(`Adding ${files.length} image${files.length > 1 ? "s" : ""}…`);
    const n = await addWallpaperFiles(files);
    toast(n ? `Added ${n} wallpaper${n > 1 ? "s" : ""}` : "No usable images found");
    if (S.wp.rotate && !currentId) { await pickRotation(); applyBg(); }
    drawThumbs();
  };
  $$(".sw", p).forEach(b => b.onclick = () => { S.unsplash.on = false; S.wp.rotate = false; S.bg = b.dataset.k === "none" ? { type: "none" } : { type: "gradient", value: b.dataset.k }; store.save(); applyBg(); redraw(); });
  $("#setUrl", p).onclick = () => { const v = $("#imgUrl", p).value.trim(); if (!v) return; S.unsplash.on = false; S.wp.rotate = false; S.bg = { type: "image", value: v }; store.save(); applyBg(); toast("Wallpaper set"); redraw(); };
  $("#shadeHead", p).onclick = () => { const i = $("#shadeInner", p); i.hidden = !i.hidden; };
  const sh = () => { S.shadeTop = +$("#shTop", p).value; S.shadeBottom = +$("#shBot", p).value; applyBg(); store.save(); $("#shadeHead span:last-child", p).textContent = `Top ${S.shadeTop}% · Bottom ${S.shadeBottom}% ⌄`; };
  $("#shTop", p).oninput = sh; $("#shBot", p).oninput = sh;
  $("#rmAll", p).onclick = async () => {
    if (!confirm("Delete every uploaded wallpaper?")) return;
    await wpClear(); currentId = null; S.wp.rotate = false; S.wp.lastId = null; S.wp.index = -1;
    if (S.bg.type === "library") S.bg = { type: "gradient", value: "g0" };
    store.save(); applyBg(); redraw();
  };
}
function Weather(p, redraw) {
  const w = S.weather;
  p.innerHTML = `<div class="s-row" style="background:var(--modal-2);padding:16px 20px;border-radius:16px"><div><b>Top bar weather</b><small>Shown in the top bar</small></div>${toggle(w.on, "wxSw")}</div>
    <div class="s-row" style="margin-bottom:10px"><div><b>Location</b><small>${w.name ? esc(w.name) : "Use your position, or search below"}</small></div><button class="btn" id="geo">📍 Use current location</button></div>
    <input class="input" id="city" placeholder="Search for a city…"><div class="cities" id="cities"></div>
    <div class="s-row" style="margin-top:26px"><b>Temperature unit</b><div class="seg" id="unitSeg"><button data-u="C" class="${w.unit === "C" ? "on" : ""}">°C</button><button data-u="F" class="${w.unit === "F" ? "on" : ""}">°F</button></div></div>`;
  const commit = () => { store.save(); loadWeather(); redraw(); };
  $("#wxSw", p).onclick = () => { w.on = !w.on; commit(); };
  $$("#unitSeg button", p).forEach(b => b.onclick = () => { w.unit = b.dataset.u; commit(); });
  $("#geo", p).onclick = () => navigator.geolocation.getCurrentPosition(
    pos => { w.lat = pos.coords.latitude; w.lon = pos.coords.longitude; w.name = "Current location"; w.on = true; commit(); },
    () => toast("Location blocked. Search for a city instead."));
  let t;
  $("#city", p).oninput = e => {
    clearTimeout(t); const q = e.target.value.trim(); if (q.length < 2) return ($("#cities", p).innerHTML = "");
    t = setTimeout(async () => {
      try {
        const j = await (await fetch(`https://geocoding-api.open-meteo.com/v1/search?count=5&name=${encodeURIComponent(q)}`)).json();
        $("#cities", p).innerHTML = (j.results || []).map((c, i) => `<button data-i="${i}">${esc(c.name)}${c.admin1 ? ", " + esc(c.admin1) : ""}, ${esc(c.country || "")}</button>`).join("") || `<div class="muted" style="padding:10px">No matches.</div>`;
        $$("#cities button", p).forEach(b => b.onclick = () => { const c = j.results[+b.dataset.i]; w.lat = c.latitude; w.lon = c.longitude; w.name = c.name; w.on = true; commit(); });
      } catch { toast("Couldn't reach the weather service"); }
    }, 300);
  };
}
function General(p, redraw) {
  p.innerHTML = `<div class="s-row"><div><b>Daily quote</b><small>Show a motivational quote under your library.</small></div>${toggle(S.quoteOn, "quoteSw")}</div>
    <div class="s-row"><div><b>Notes, to-dos &amp; stickies</b><small>Show the Notes, To-dos and Stickies apps in the dock.</small></div>${toggle(S.dock, "dockSw")}</div>
    <div class="s-row"><div><b>Tour</b><small>Replay the welcome tour.</small></div><button class="btn" id="tour">Replay tour</button></div>
    <hr style="border:0;border-top:1px solid var(--line);margin:0 0 20px">
    <button class="btn danger" id="reset" style="background:none">Reset all data</button>`;
  $("#quoteSw", p).onclick = () => { S.quoteOn = !S.quoteOn; store.save(); if (S.quoteOn) loadQuote(); else showQuote(); redraw(); };
  $("#dockSw", p).onclick = () => { S.dock = !S.dock; store.save(); applyDock(); redraw(); };
  $("#tour", p).onclick = () => { closeModal(); startTour(); };
  $("#reset", p).onclick = async () => { if (confirm("Delete notes, to-dos, stickies, books, sessions and settings from this extension?")) { await wpClear(); await fileClear(); S = structuredClone(DEFAULTS); store.save(); location.reload(); } };
}
function applyDock() { $$("#dock .d-notes,#dock .d-todos,#dock .d-stick,#dock .sep").forEach(e => (e.style.display = S.dock ? "" : "none")); }
$("#dock").addEventListener("click", e => {
  const b = e.target.closest("button[data-app]"); if (!b) return;
  if (b.dataset.app === "shortcuts") { closeModal(); return setTray(!trayOpen()); }
  setTray(false);
  ({ notes: openNotes, todos: openTodos, stickies: openStickies, settings: openSettings })[b.dataset.app]();
});

/* ---------- tour ---------- */
const STEPS = [
  { sel: ".search", t: "Search everything", d: "Type to search your bookmarks or the web. Press Ctrl/⌘ K from anywhere on this page." },
  { sel: "#library", t: "Your library", d: "Shelves of books: use the arrows to slide between shelves. Click a book to open it; right-click to edit it, recolor it, and keep links, PDFs and files inside. Your bookmarks live behind the bookmark button, top right." },
  { sel: "#dock", t: "Shortcuts, notes, to-dos & stickies", d: "Open your favourite sites, jot things down, track tasks, or pin a sticky note right on your new tab." },
  { sel: ".bottombar", t: "Save & close", d: "Save every open tab as a session and close them. Restore from Sessions any time." }
];
function startTour(i = 0) {
  const host = $("#tourHost"); host.innerHTML = "";
  if (i >= STEPS.length) { S.toured = true; store.save(); return; }
  const s = STEPS[i], r = $(s.sel).getBoundingClientRect();
  const hl = document.createElement("div"); hl.className = "tour-hl";
  Object.assign(hl.style, { left: r.left - 8 + "px", top: r.top - 8 + "px", width: r.width + 16 + "px", height: r.height + 16 + "px" });
  const card = document.createElement("div"); card.className = "tour-card";
  card.innerHTML = `<h3>${s.t}</h3><p>${s.d}</p><div class="acts"><button class="btn" data-a="skip">Skip</button><button class="btn primary" data-a="next">${i === STEPS.length - 1 ? "Done" : "Next"}</button></div>`;
  host.append(hl, card);
  const cw = card.offsetWidth, ch = card.offsetHeight, below = r.bottom + 16 + ch < innerHeight;
  card.style.left = Math.max(12, Math.min(innerWidth - cw - 12, r.left + r.width / 2 - cw / 2)) + "px";
  card.style.top = below ? r.bottom + 16 + "px" : Math.max(12, r.top - ch - 16) + "px";
  $("[data-a=next]", card).onclick = () => startTour(i + 1);
  $("[data-a=skip]", card).onclick = () => { host.innerHTML = ""; S.toured = true; store.save(); };
}

/* ---------- misc buttons ---------- */
$("#logo").onclick = openLibrary;
$("#saveClose").onclick = saveAndClose;
$("#sessionsBtn").onclick = openSessions;

/* ---------- quotes (ZenQuotes, with an offline fallback) ---------- */
const QUOTES = [
  ["The only way to do great work is to love what you do.", "Steve Jobs"],
  ["It always seems impossible until it's done.", "Nelson Mandela"],
  ["Whether you think you can, or you think you can't, you're right.", "Henry Ford"],
  ["The best time to plant a tree was twenty years ago. The second best time is now.", "Chinese proverb"],
  ["You miss 100% of the shots you don't take.", "Wayne Gretzky"],
  ["We are what we repeatedly do. Excellence, then, is not an act, but a habit.", "Will Durant"],
  ["Well done is better than well said.", "Benjamin Franklin"],
  ["Fall seven times, stand up eight.", "Japanese proverb"],
  ["A journey of a thousand miles begins with a single step.", "Lao Tzu"],
  ["He who has a why to live can bear almost any how.", "Friedrich Nietzsche"],
  ["Courage is not the absence of fear, but the triumph over it.", "Nelson Mandela"],
  ["Start where you are. Use what you have. Do what you can.", "Arthur Ashe"],
  ["The secret of getting ahead is getting started.", "Mark Twain"],
  ["Energy and persistence conquer all things.", "Benjamin Franklin"],
  ["Small deeds done are better than great deeds planned.", "Peter Marshall"],
  ["Don't count the days, make the days count.", "Muhammad Ali"],
  ["Act as if what you do makes a difference. It does.", "William James"],
  ["Hope is being able to see that there is light despite all of the darkness.", "Desmond Tutu"],
  ["Everything you've ever wanted is on the other side of fear.", "George Addair"],
  ["You have power over your mind, not outside events. Realize this, and you will find strength.", "Marcus Aurelius"]
];
const dayKey = () => { const d = new Date(); return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; };
function showQuote() {
  const box = $("#quote"); box.hidden = !S.quoteOn || !S.quote;
  if (!S.quote) return;
  $("#qText").textContent = "“" + S.quote.q + "”";
  $("#qAuthor").textContent = S.quote.a ? "— " + S.quote.a : "";
  $("#qCredit").hidden = S.quote.src !== "zen";
}
const localQuote = avoid => {
  let i = Math.floor(Math.random() * QUOTES.length);
  if (QUOTES[i][0] === avoid) i = (i + 1) % QUOTES.length;
  return { q: QUOTES[i][0], a: QUOTES[i][1], src: "local" };
};
async function fetchQuote(avoid) {
  const ctrl = new AbortController(), t = setTimeout(() => ctrl.abort(), 6000);
  try {
    const j = await (await fetch("https://zenquotes.io/api/random", { signal: ctrl.signal })).json(), x = Array.isArray(j) ? j[0] : null;
    if (x && x.q && !/too many requests/i.test(x.q) && x.q.length < 220 && x.q.trim() !== avoid) return { q: x.q.trim(), a: (x.a || "").trim(), src: "zen" };
  } catch { /* offline or rate limited: fall back below */ } finally { clearTimeout(t); }
  return localQuote(avoid);
}
/* every new tab shows the quote that was fetched in the background during the previous one, so it is instant and always fresh */
async function loadQuote(force) {
  if (!S.quoteOn) return showQuote();
  if (force) { S.quote = await fetchQuote(S.quote?.q); store.save(); return showQuote(); }
  S.quote = S.nextQuote || localQuote(S.quote?.q);
  S.nextQuote = null; store.save(); showQuote();
  S.nextQuote = await fetchQuote(S.quote.q); store.save();
}
$("#qNew").onclick = async () => { $("#qNew").classList.add("spin"); await loadQuote(true); $("#qNew").classList.remove("spin"); };

/* ---------- adaptive layout: when the window is too short for the normal stack, change the layout instead of shrinking things ----------
   level 0: dock along the bottom (normal)
   level 1: dock moves to the left edge, standing vertically
   level 2: dock stays left and the quote moves up into the top-left corner */
function layoutFits() {
  const c = $(".center"), cs = getComputedStyle(c);
  const avail = c.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
  let need = 0;
  for (const el of c.children) {
    const s = getComputedStyle(el); if (s.display === "none" || s.position === "fixed") continue;
    need += el.offsetHeight + parseFloat(s.marginTop) + parseFloat(s.marginBottom);
  }
  return need <= avail + 1;
}
function placeDot() {
  const dot = $("#dockDot"), btn = current && $(`#dock [data-app="${current}"]`);
  if (!btn) return dot.classList.remove("on");
  const dr = $("#dock").getBoundingClientRect(), br = btn.getBoundingClientRect(), vert = document.documentElement.dataset.lay !== "0";
  if (vert) { dot.style.top = (br.top - dr.top + br.height / 2 - 2) + "px"; dot.style.left = ""; }
  else { dot.style.left = (br.left - dr.left + br.width / 2 - 2) + "px"; dot.style.top = ""; }
  dot.classList.add("on");
}
let fitQueued = false;
function fitLayout() {
  const root = document.documentElement;
  for (const lvl of [0, 1, 2]) { root.dataset.lay = lvl; if (layoutFits()) break; }
  placeDot();
}
const queueFit = () => { if (fitQueued) return; fitQueued = true; requestAnimationFrame(() => { fitQueued = false; fitLayout(); }); };
addEventListener("resize", queueFit); document.addEventListener("fullscreenchange", queueFit);
if (document.fonts) document.fonts.ready.then(queueFit);
new MutationObserver(queueFit).observe($("#quote"), { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["hidden"] });

/* ---------- fullscreen: nudge the content toward the centre ---------- */
const isFs = () => !!document.fullscreenElement || matchMedia("(display-mode: fullscreen)").matches || (innerHeight >= screen.height - 2 && innerWidth >= screen.width - 2);
const syncFs = () => { document.documentElement.toggleAttribute("data-fs", isFs()); };
addEventListener("resize", syncFs); document.addEventListener("fullscreenchange", syncFs); syncFs();

/* ---------- init ---------- */
(async function init() {
  await store.load();
  applyUi(); applyTheme(); applyClock(); applyDock();
  if (S.wp.rotate) await pickRotation();
  applyBg();
  tick(); setInterval(tick, 15000);
  if (!S.scSeeded) { if (!S.shortcuts.length) S.shortcuts = PRESETS.map(p => ({ id: uid(), ...p })); S.scSeeded = true; store.save(); }
  renderTray(); renderShelf(); renderStickies(); loadQuote(); queueFit();
  loadLibrary(); loadWeather(); updateTabCount();
  if (hasChrome && chrome.tabs) { chrome.tabs.onCreated.addListener(updateTabCount); chrome.tabs.onRemoved.addListener(updateTabCount); }
  if (hasChrome && chrome.bookmarks) ["onCreated", "onRemoved", "onChanged"].forEach(ev => chrome.bookmarks[ev].addListener(loadLibrary));
})();
})();
