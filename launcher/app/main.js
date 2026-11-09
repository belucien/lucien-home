/* Lucien Home: desktop launcher for Lucien Family Planner and Family Budget Log.
   Everything opens inside this one window: the apps, and any link they open. */
const { app, BrowserWindow, WebContentsView, Tray, Menu, ipcMain, shell, nativeImage, Notification, net, dialog, safeStorage, nativeTheme, session } = require("electron");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { spawn } = require("child_process");
const Calc = require("./renderer/calc.js");

const APP_ID = "com.lucien.home";
const PRODUCT = "Lucien Home";
const ASSETS = path.join(__dirname, "assets");
const REFRESH_MIN = 10;
const RAIL = 64, TOP = 52;            // launcher chrome around an open app
const isWin = process.platform === "win32";

app.setName(PRODUCT);
if (isWin) app.setAppUserModelId(APP_ID);
// Google pages see a normal Chrome browser (no "Electron" in the user agent)
app.userAgentFallback = app.userAgentFallback.replace(/\s*Electron\/\S+/i, "").replace(/\s*lucien[-\w]*\/\S+/i, "");
nativeTheme.themeSource = "dark";

if (!app.requestSingleInstanceLock()) { app.quit(); }

/* ---------------- settings (link codes are encrypted with your Windows account) ---------------- */
const DATA = () => app.getPath("userData");
const SETTINGS_FILE = () => path.join(DATA(), "settings.json");
const DEFAULTS = {
  who: "",
  apps: { planner: { link: "", cover: "" }, budget: { link: "", token: "", cover: "" } },
  notify: { bills: true, events: true, quietStart: "21:30", quietEnd: "07:00" },
  showMoney: true, glanceScope: "Household",
  startWithWindows: false, closeToTray: true, trayTipShown: false, updateFolder: "", autoUpdateCheck: true,
  alerts: [], notified: {}, bounds: null, maximized: false
};
const SECRET = [["apps", "budget", "token"], ["apps", "planner", "link"], ["apps", "budget", "link"]];
function load() {
  try {
    const raw = JSON.parse(fs.readFileSync(SETTINGS_FILE(), "utf8"));
    const s = deepMerge(structuredClone(DEFAULTS), raw);
    SECRET.forEach(([a, b, c]) => { s[a][b][c] = unseal(s[a][b][c]); });
    delete s.apps.fortress; delete s.ownWindow; delete s.appBounds;
    migrate(s);
    return s;
  } catch (e) { return structuredClone(DEFAULTS); }
}
/* 1.0 saved personal links. Keep the plain app link and remember the name / code separately. */
function migrate(s) {
  for (const k of ["planner", "budget"]) {
    const p = splitLink(s.apps[k].link); if (!p.ok) continue;
    if (k === "planner" && p.me && !s.who) s.who = cap(p.me);
    if (k === "budget" && p.u && !s.apps.budget.token) s.apps.budget.token = p.u;
    s.apps[k].link = p.base;
  }
}
function save() {
  try {
    fs.mkdirSync(DATA(), { recursive: true });
    const out = structuredClone(settings);
    SECRET.forEach(([a, b, c]) => { out[a][b][c] = seal(out[a][b][c]); });
    fs.writeFileSync(SETTINGS_FILE(), JSON.stringify(out, null, 2));
  } catch (e) { console.error("save failed", e); }
}
function seal(s) { if (!s) return ""; try { if (safeStorage.isEncryptionAvailable()) return "enc:" + safeStorage.encryptString(s).toString("base64"); } catch (e) {} return s; }
function unseal(s) { if (!s) return ""; if (String(s).startsWith("enc:")) { try { return safeStorage.decryptString(Buffer.from(s.slice(4), "base64")); } catch (e) { return ""; } } return s; }
function deepMerge(a, b) { for (const k of Object.keys(b || {})) { if (b[k] && typeof b[k] === "object" && !Array.isArray(b[k]) && a[k] && typeof a[k] === "object") deepMerge(a[k], b[k]); else a[k] = b[k]; } return a; }
const cap = s => s ? s.charAt(0).toUpperCase() + s.slice(1) : "";

/* ---------------- links: just the normal /exec link (personal links still work) ---------------- */
function splitLink(link) {
  link = String(link || "").trim();
  if (!link) return { ok: false, msg: "No link yet.", empty: true };
  let u; try { u = new URL(link); } catch (e) { return { ok: false, msg: "That doesn't look like a web link." }; }
  if (u.hostname !== "script.google.com" || !/^\/macros\/(s|u\/\d+\/s)\//.test(u.pathname)) return { ok: false, msg: "Paste the app's Google link. It starts with https://script.google.com/macros/s/ and ends in /exec." };
  if (/\/dev$/.test(u.pathname)) return { ok: false, msg: "That's the editor's test link (/dev). Use the one that ends in /exec (Deploy › Manage deployments)." };
  if (!/\/exec$/.test(u.pathname)) return { ok: false, msg: "The link should end in /exec." };
  return { ok: true, base: u.origin + u.pathname, me: u.searchParams.get("me") || "", u: u.searchParams.get("u") || "" };
}

let settings = structuredClone(DEFAULTS);   // replaced by load() once the app is ready

/* Family copy: the family installer carries the two app links (never the PIN). */
function importFamily() {
  const f = path.join(__dirname, "family.json");
  if (settings.apps.planner.link || settings.apps.budget.link || !fs.existsSync(f)) return;
  try {
    const fam = JSON.parse(fs.readFileSync(f, "utf8"));
    if (fam.planner && splitLink(fam.planner).ok) settings.apps.planner.link = splitLink(fam.planner).base;
    if (fam.budget && splitLink(fam.budget).ok) settings.apps.budget.link = splitLink(fam.budget).base;
    settings.family = { name: String(fam.name || "Family"), people: Array.isArray(fam.people) ? fam.people.map(String) : [] };
    settings.firstRun = true; save();
  } catch (e) { console.error("family import failed", e); }
}

/* ---------------- live summaries ---------------- */
const state = { raw: { planner: null, budget: null }, at: 0, busy: false };
const OLD = { planner: "This Planner doesn't have the launcher update yet. Paste the new Code.gs into it, then deploy a new version.",
              budget: "This Budget Log doesn't have the launcher update yet. Paste the new Code.gs and Index.html into it, then deploy a new version." };
async function getJson(url, opts) {
  const r = await net.fetch(url, Object.assign({ redirect: "follow", headers: { "Cache-Control": "no-cache" } }, opts || {}));
  const text = await r.text();
  try { return JSON.parse(text); } catch (e) { return { __html: /<html/i.test(text) }; }
}
async function fetchFeed(kind, link, token) {
  const p = splitLink(link);
  if (!p.ok) return { ok: false, msg: p.msg, setup: !!p.empty };
  if (kind === "budget" && !(token || p.u)) return { ok: false, needPin: true, msg: "Sign in once with the Budget Log PIN.", base: p.base };
  const feed = p.base + "?api=summary" + (kind === "budget" ? "&u=" + encodeURIComponent(token || p.u) : "");
  try {
    const d = await getJson(feed);
    if (d.__html !== undefined) return d.__html ? { ok: false, old: true, msg: OLD[kind] } : { ok: false, msg: "The app sent back something unexpected." };
    if (d.error) { const m = String(d.error); return { ok: false, msg: m.replace(/^LINK:\s*/, ""), needPin: kind === "budget" && /^LINK:/.test(m) }; }
    if (d.app !== kind) return { ok: false, msg: kind === "planner" ? "That link opens the Budget Log. Paste the Planner's link here." : "That link opens the Planner. Paste the Budget Log's link here." };
    return { ok: true, data: d };
  } catch (e) { return { ok: false, msg: "Can't reach Google right now. Check the internet connection.", offline: true }; }
}
function shape() {
  const out = { at: state.at };
  const P = state.raw.planner, B = state.raw.budget;
  out.planner = P && P.ok ? Calc.planner(P.data, { me: settings.who }) : (P || { ok: false, setup: true });
  out.budget = B && B.ok ? Object.assign(Calc.budget(B.data, settings.glanceScope), { me: B.data.me }) : (B || { ok: false, setup: true });
  if (out.budget.ok) { const me = B.data.me; out.budgetMine = me ? Calc.budget(B.data, me) : null; out.budgetHouse = Calc.budget(B.data, "Household"); }
  out.people = (P && P.ok && P.data.people) || (B && B.ok && B.data.people) || [];
  // calendar history and future: Jan 1 last year → Dec 31 next year
  const y = new Date().getFullYear();
  try { out.timeline = Calc.timeline(P && P.ok ? P.data : null, B && B.ok ? B.data : null, settings.who || (B && B.ok && B.data.me) || "", (y - 1) + "-01-01", (y + 1) + "-12-31"); } catch (e) { console.error(e); out.timeline = []; }
  return out;
}
/* The last good feeds are kept on this PC (encrypted with your Windows account) so Home shows up instantly when Lucien Home opens. */
const CACHE_FILE = () => path.join(DATA(), "cache.dat");
function saveCache() {
  try { const keep = {}; for (const k of ["planner", "budget"]) if (state.raw[k] && state.raw[k].ok) keep[k] = state.raw[k];
    if (!keep.planner && !keep.budget) return;
    const txt = seal(JSON.stringify({ at: state.at, raw: keep, key: cacheKey() })); if (!txt.startsWith("enc:") && isWin) return;
    fs.writeFileSync(CACHE_FILE(), txt); } catch (e) {}
}
const cacheKey = () => [splitLink(settings.apps.planner.link).base || "", splitLink(settings.apps.budget.link).base || "", settings.who || ""].join("|");
function loadCache() {
  try { const c = JSON.parse(unseal(fs.readFileSync(CACHE_FILE(), "utf8")) || "null"); if (!c || c.key !== cacheKey()) return false;
    for (const k of ["planner", "budget"]) if (c.raw[k]) state.raw[k] = Object.assign(c.raw[k], { stale: true, cached: true });
    state.at = c.at || 0; return true; } catch (e) { return false; }
}
async function refresh() {
  if (state.busy) return shape();
  state.busy = true;
  try {
    const a = settings.apps;
    const [p, b] = await Promise.all([fetchFeed("planner", a.planner.link), fetchFeed("budget", a.budget.link, a.budget.token)]);
    const keep = (old, nw) => nw.ok || !(old && old.ok && nw.offline) ? nw : Object.assign(old, { stale: true });
    state.raw.planner = keep(state.raw.planner, p); state.raw.budget = keep(state.raw.budget, b);
    for (const k of ["planner", "budget"]) if (state.raw[k] && state.raw[k].ok && !state.raw[k].offline && (k === "planner" ? p : b).ok) { delete state.raw[k].stale; delete state.raw[k].cached; }
    state.at = Date.now(); saveCache();
  } finally { state.busy = false; }
  const s = shape();
  try { checkAlerts(s); } catch (e) { console.error(e); }
  send("summaries", s); updateTray(s); warmViews();
  return s;
}
let timer = null;
function schedule() { clearInterval(timer); timer = setInterval(refresh, REFRESH_MIN * 60 * 1000); }

/* ---------------- notifications ---------------- */
function quiet() {
  const n = new Date(), m = n.getHours() * 60 + n.getMinutes();
  const toM = s => { const [h, mm] = String(s).split(":").map(Number); return h * 60 + (mm || 0); };
  const a = toM(settings.notify.quietStart), b = toM(settings.notify.quietEnd);
  return a > b ? (m >= a || m < b) : (m >= a && m < b);
}
const timeLabel = t => { if (!/^\d{1,2}:\d{2}/.test(t || "")) return ""; let [h, m] = t.split(":").map(Number); const ap = h >= 12 ? "PM" : "AM"; h = h % 12 || 12; return `${h}:${String(m).padStart(2, "0")} ${ap}`; };
const money = n => "$" + Math.round(n).toLocaleString("en-US");
function checkAlerts(s) {
  const today = Calc.ymd(new Date()), list = [];
  if (settings.notify.bills && s.budget.ok) {
    const seen = new Set();
    for (const v of [s.budgetHouse, s.budgetMine]) (v ? v.bills : []).forEach(b => {
      if (b.days > 1 || seen.has(b.type + b.id + b.due)) return; seen.add(b.type + b.id + b.due);
      const when = b.days < 0 ? `was due ${-b.days} day${b.days === -1 ? "" : "s"} ago` : b.days === 0 ? "is due today" : "is due tomorrow";
      list.push({ key: `bill:${b.type}:${b.id}:${b.due}:${b.days <= 0 ? "d" : "t"}`, app: "budget", title: `${b.name} ${when}`, body: `${money(b.full)}${b.split ? ` (split ${money(b.full / Math.max(1, s.people.length || 2))} each)` : ""}${b.loan ? " · loan payment" : ""}.` });
    });
  }
  if (settings.notify.events && s.planner.ok) s.planner.countdowns.filter(c => c.days === 0 || c.days === 1).forEach(c => {
    if (c.kind === "holiday" && c.days === 1) return;
    list.push({ key: `ev:${c.id}:${c.start}:${c.days}`, app: "planner", title: c.days === 0 ? `Today: ${c.name}` : `Tomorrow: ${c.name}`, body: [c.time ? timeLabel(c.time) : "", c.place].filter(Boolean).join(" · ") || c.label });
  });
  const fresh = list.filter(a => !settings.notified[a.key]);
  if (!fresh.length) return;
  if (quiet() || !Notification.isSupported()) return;   // try again after quiet hours
  fresh.forEach(a => {
    settings.notified[a.key] = today;
    settings.alerts.unshift({ ...a, at: Date.now(), seen: false });
    const n = new Notification({ title: a.title, body: a.body, icon: path.join(ASSETS, a.app + ".png") });
    n.on("click", () => { showMain(); openApp(a.app); });
    n.show();
  });
  settings.alerts = settings.alerts.slice(0, 40);
  const cutoff = Calc.addDays(today, -40); for (const k of Object.keys(settings.notified)) if (settings.notified[k] < cutoff) delete settings.notified[k];
  save(); send("alerts", settings.alerts);
}

/* ---------------- the window ---------------- */
let win = null, tray = null, quitting = false;
function send(ch, v) { if (win && !win.isDestroyed()) win.webContents.send(ch, v); }
function createMain(show = true) {
  const b = settings.bounds || { width: 1380, height: 880 };
  win = new BrowserWindow({
    ...b, minWidth: 1000, minHeight: 660, show: false, frame: false, backgroundColor: "#0A0C0F", title: PRODUCT,
    icon: path.join(ASSETS, isWin ? "icon.ico" : "icon.png"),
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  win.loadFile(path.join(__dirname, "renderer", "index.html"));
  win.once("ready-to-show", () => { if (settings.maximized) win.maximize(); if (show) win.show(); });
  const keep = () => { if (!win.isMaximized() && !win.isMinimized()) settings.bounds = win.getBounds(); layout(); };
  win.on("resize", keep); win.on("move", keep);
  const maxState = () => { settings.maximized = win.isMaximized(); send("maximized", win.isMaximized()); setTimeout(layout, 30); };
  win.on("maximize", maxState); win.on("unmaximize", maxState); win.on("enter-full-screen", maxState); win.on("leave-full-screen", maxState);
  win.on("close", e => {
    save();
    if (!quitting && settings.closeToTray) {
      e.preventDefault(); win.hide();
      if (!settings.trayTipShown && Notification.isSupported()) { settings.trayTipShown = true; save();
        new Notification({ title: "Lucien Home is still running", body: "It's in the tray by the clock, so reminders keep working. Right-click it to quit.", icon: path.join(ASSETS, "icon.png") }).show(); }
    }
  });
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) openWeb(url); return { action: "deny" }; });
  win.webContents.on("will-navigate", e => e.preventDefault());
}
function showMain(view) { if (!win || win.isDestroyed()) createMain(); if (win.isMinimized()) win.restore(); win.show(); win.focus(); if (view) { closeApp(); send("nav", view); } }
app.on("browser-window-focus", () => { if (Date.now() - lastCheck > 10 * 60 * 1000) checkUpdate(false); });

/* ---------------- apps open inside the launcher ---------------- */
const TITLES = { planner: "Lucien Family Planner", budget: "Family Budget Log", web: "Web page" };
const views = {};             // planner, budget, web → WebContentsView
let current = null, covered = false;
const FRAME_CSS = `(()=>{if(document.getElementById('lh-css'))return;const s=document.createElement('style');s.id='lh-css';
  s.textContent='::-webkit-scrollbar{width:10px;height:10px}::-webkit-scrollbar-track{background:transparent}::-webkit-scrollbar-thumb{background:rgba(140,150,165,.32);border-radius:10px;border:2px solid transparent;background-clip:padding-box}::-webkit-scrollbar-thumb:hover{background:rgba(160,170,185,.5);background-clip:padding-box;border:2px solid transparent}::-webkit-scrollbar-corner{background:transparent}';
  (document.head||document.documentElement).appendChild(s);})()`;
function layout() {
  if (!win || win.isDestroyed()) return;
  const [w, h] = win.getContentSize();
  for (const k of Object.keys(views)) {
    const v = views[k];
    v.setBounds({ x: RAIL, y: TOP, width: Math.max(0, w - RAIL), height: Math.max(0, h - TOP) });
    v.setVisible(k === current && !covered);
  }
}
function appState() {
  const v = current && views[current], wc = v && v.webContents;
  return { open: current, title: current === "web" ? (wc && wc.getTitle()) || "Web page" : current ? TITLES[current] : "", url: wc ? wc.getURL() : "",
           canBack: !!(wc && wc.navigationHistory.canGoBack()) || (current === "web" && !!webFrom && !!views[webFrom]), from: current === "web" ? webFrom : null, canFwd: !!(wc && wc.navigationHistory.canGoForward()), loading: !!(wc && wc.isLoading()), opened: Object.keys(views) };
}
const pushState = () => send("app", appState());
function makeView(kind) {
  const local = kind !== "web";
  const v = new WebContentsView({ webPreferences: local
    ? { partition: "persist:" + kind, preload: path.join(__dirname, "app-preload.js"), contextIsolation: true, nodeIntegration: false, sandbox: true }
    : { partition: "persist:web", contextIsolation: true, nodeIntegration: false, sandbox: true } });
  v.setBackgroundColor("#0A0C0F");
  const wc = v.webContents;
  const dress = () => { if (!wc.isDestroyed()) wc.executeJavaScript(FRAME_CSS).catch(() => {}); };
  wc.on("did-finish-load", () => { dress(); pushState(); });
  wc.on("did-navigate", pushState); wc.on("did-navigate-in-page", pushState); wc.on("page-title-updated", pushState);
  wc.on("did-start-loading", pushState); wc.on("did-stop-loading", pushState);
  if (!local) wc.on("did-fail-load", (e, code, desc, url, isMain) => { if (isMain && code !== -3 && !wc.isDestroyed()) wc.loadFile(path.join(__dirname, "renderer", "offline.html"), { query: { u: url || "" } }); });
  // links the apps open (a store page, a recipe site…) open inside the launcher too
  wc.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) openWeb(url); return { action: "deny" }; });
  if (local) wc.on("will-navigate", (e, url) => { if (!url.startsWith("file:")) { e.preventDefault(); if (/^https?:/.test(url)) openWeb(url); } });
  views[kind] = v; win.contentView.addChildView(v);
  return v;
}
/* Load both apps in the background once, so opening them is instant */
let warmed = false;
function warmViews() {
  if (warmed || !win || win.isDestroyed()) return; warmed = true;
  setTimeout(() => { for (const k of ["planner", "budget"]) if (!views[k] && splitLink(settings.apps[k].link).ok && !(k === "budget" && !settings.apps.budget.token)) {
    makeView(k).webContents.loadFile(path.join(__dirname, "apps", k, "index.html")); } layout(); }, 1500);
}
let webFrom = null;            // the app a web page was opened from: Back / Close return to it
function openApp(kind) {
  if (!win || win.isDestroyed()) createMain();
  if (kind !== "web") {
    if (!splitLink(settings.apps[kind].link).ok) { showMain("settings"); send("toast", "Add the app's link in Settings › Apps first."); return; }
    if (!views[kind]) makeView(kind).webContents.loadFile(path.join(__dirname, "apps", kind, "index.html"));
  }
  if (!views[kind]) return;
  current = kind; covered = false; layout(); views[kind].webContents.focus(); pushState();
}
function openWeb(url) {
  if (current === "planner" || current === "budget") webFrom = current;
  else if (current !== "web") webFrom = null;
  if (views.web) { win.contentView.removeChildView(views.web); views.web.webContents.close(); delete views.web; }   // fresh history for each link
  const v = makeView("web");
  v.webContents.loadURL(url);
  current = "web"; covered = false; layout(); pushState();
}
function closeApp(kind) {
  const ret = kind === "web" && current === "web" && webFrom && views[webFrom] ? webFrom : null;
  if (kind && views[kind]) { win.contentView.removeChildView(views[kind]); views[kind].webContents.close(); delete views[kind]; }
  if (kind === "web" || !kind) webFrom = null;
  if (ret) { current = ret; covered = false; layout(); views[ret].webContents.focus(); pushState(); return; }
  if (!kind || kind === current) current = null;
  layout(); pushState();
}

/* ---------------- updates ----------------
   1) GitHub: the newest release of belucien/lucien-home downloads in the background, then "Restart to update".
   2) A "Lucien Home Setup x.y.z.exe" saved in the updates folder (Desktop › Lucien Home, Downloads, or a chosen folder). */
const REPO = "belucien/lucien-home";
const SETUP_RE = /^Lucien Home Setup (\d+)\.(\d+)\.(\d+)\.exe$/i;
const newer = (a, b) => { const x = a.split(".").map(Number), y = b.split(".").map(Number); for (let i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); } return false; };
const UPDIR = () => path.join(DATA(), "updates");
function updateFolders() {
  const list = [settings.updateFolder, path.join(app.getPath("desktop"), "Lucien Home"), path.join(os.homedir(), "Desktop", "Lucien Home"),
    path.join(os.homedir(), "OneDrive", "Desktop", "Lucien Home"), app.getPath("downloads")];
  return [...new Set(list.filter(Boolean).map(p => path.normalize(p)))];
}
let update = null, lastCheck = 0, watchers = [], dl = null, ghInfo = null, ghError = "";
function localUpdate() {
  let best = null;
  for (const dir of [UPDIR(), ...updateFolders()]) {
    let names = []; try { names = fs.readdirSync(dir); } catch (e) { continue; }
    for (const f of names) {
      const m = SETUP_RE.exec(f); if (!m) continue;
      const v = `${+m[1]}.${+m[2]}.${+m[3]}`;
      if (!newer(v, app.getVersion()) || (best && !newer(v, best.version))) continue;
      const file = path.join(dir, f); let st; try { st = fs.statSync(file); } catch (e) { continue; }
      if (st.size < 20 * 1024 * 1024) continue;   // still copying
      let notes = ""; try { notes = fs.readFileSync(path.join(dir, `Lucien Home ${v} - What's new.txt`), "utf8").trim().slice(0, 4000); } catch (e) {}
      if (!notes && ghInfo && ghInfo.version === v) notes = ghInfo.notes;
      best = { version: v, file, notes, ready: true, source: dir === UPDIR() ? "github" : "folder" };
    }
  }
  return best;
}
function publish(manual) {
  const before = JSON.stringify(update);
  update = localUpdate() || (dl ? { version: dl.version, notes: dl.notes, ready: false, progress: dl.progress, source: "github" } : null);
  lastCheck = Date.now();
  if (JSON.stringify(update) !== before || manual) send("update", updatePayload());
  if (update && update.ready && settings.notifyUpdate !== update.version && Notification.isSupported() && !manual) {
    settings.notifyUpdate = update.version; save();
    const n = new Notification({ title: `Lucien Home ${update.version} is ready`, body: "Click Update in the top bar. It installs in a few seconds and reopens.", icon: path.join(ASSETS, "icon.png") });
    n.on("click", () => showMain("settings:updates")); n.show();
  }
  return update;
}
const updatePayload = () => ({ update, current: app.getVersion(), checked: lastCheck, folders: updateFolders(), github: { repo: REPO, error: ghError, latest: ghInfo && ghInfo.version } });
async function checkGitHub() {
  try {
    const r = await net.fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { Accept: "application/vnd.github+json", "User-Agent": "Lucien-Home" } });
    if (r.status === 404) { ghError = ""; ghInfo = null; return; }   // no releases yet
    if (!r.ok) throw new Error("GitHub said " + r.status);
    const rel = await r.json();
    const v = String(rel.tag_name || "").replace(/^v/i, "");
    // GitHub turns spaces in file names into dots, so accept "Lucien Home Setup", "Lucien.Home.Setup" and "Lucien-Home-Setup"
    const asset = (rel.assets || []).find(a => /^Lucien[ ._-]Home[ ._-]Setup[ ._-]\d+\.\d+\.\d+\.exe$/i.test(a.name) && !/family/i.test(a.name));
    ghError = ""; ghInfo = asset ? { version: v, notes: String(rel.body || "").trim().slice(0, 4000), url: asset.browser_download_url, size: asset.size, name: asset.name, digest: asset.digest || "" } : null;
    if (ghInfo && newer(v, app.getVersion()) && !localUpdate() && !dl) download(ghInfo);
  } catch (e) { ghError = "Couldn't check GitHub right now."; }
}
async function download(info) {
  fs.mkdirSync(UPDIR(), { recursive: true });
  const final = path.join(UPDIR(), `Lucien Home Setup ${info.version}.exe`), part = final + ".part";
  dl = { version: info.version, notes: info.notes, progress: 0 }; publish(false);
  try {
    const r = await net.fetch(info.url, { headers: { "User-Agent": "Lucien-Home" } });
    if (!r.ok || !r.body) throw new Error("download " + r.status);
    const out = fs.createWriteStream(part), hash = require("crypto").createHash("sha256");
    const reader = r.body.getReader(); let got = 0, lastSent = 0;
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      const buf = Buffer.from(value); hash.update(buf); got += buf.length;
      if (!out.write(buf)) await new Promise(res => out.once("drain", res));
      dl.progress = info.size ? Math.min(99, Math.round(got / info.size * 100)) : 0;
      if (Date.now() - lastSent > 700) { lastSent = Date.now(); send("update", Object.assign(updatePayload(), { update: { version: info.version, ready: false, progress: dl.progress, source: "github" } })); }
    }
    await new Promise(res => out.end(res));
    if (info.size && got !== info.size) throw new Error("incomplete download");
    if (info.digest && /^sha256:/i.test(info.digest) && hash.digest("hex") !== info.digest.slice(7).toLowerCase()) throw new Error("checksum mismatch");
    fs.renameSync(part, final);
    try { fs.readdirSync(UPDIR()).forEach(f => { if (f !== path.basename(final)) fs.unlinkSync(path.join(UPDIR(), f)); }); } catch (e) {}
  } catch (e) { try { fs.unlinkSync(part); } catch (er) {} ghError = "The update download didn't finish. It will try again later."; }
  dl = null; publish(false);
}
async function checkUpdate(manual) {
  if (settings.autoUpdateCheck !== false || manual) await checkGitHub();
  return publish(manual);
}
function watchUpdates() {
  watchers.forEach(w => { try { w.close(); } catch (e) {} }); watchers = [];
  let t = null; const poke = () => { clearTimeout(t); t = setTimeout(() => publish(false), 4000); };
  for (const dir of updateFolders()) { try { watchers.push(fs.watch(dir, poke)); } catch (e) {} }
}
function installUpdate() {
  const u = localUpdate();
  if (!u) return { ok: false, msg: dl ? "Still downloading the update." : "No newer version found." };
  if (!isWin) return { ok: false, msg: "Updating from inside the launcher works on Windows." };
  try { const child = spawn(u.file, ["/S", "/RELAUNCH"], { detached: true, stdio: "ignore", windowsHide: true }); child.unref(); }
  catch (e) { return { ok: false, msg: "Couldn't start the installer: " + e.message }; }
  settings.updatedFrom = app.getVersion(); save();
  setTimeout(() => { quitting = true; app.quit(); }, 700);
  return { ok: true, version: u.version };
}

/* ---------------- tray ---------------- */
function updateTray(s) {
  if (!tray) return;
  const parts = [];
  if (s && s.budget && s.budget.ok) { const due = (s.budgetHouse || s.budget).bills.filter(b => b.days <= 7).length; if (due) parts.push(`${due} bill${due === 1 ? "" : "s"} due this week`); }
  if (s && s.planner && s.planner.ok) { const c = s.planner.countdowns.find(c => c.kind !== "holiday"); if (c) parts.push(`${c.name} ${c.days === 0 ? "today" : c.days === 1 ? "tomorrow" : "in " + c.days + " days"}`); }
  tray.setToolTip([PRODUCT, ...parts].join("\n"));
}
function buildTray() {
  tray = new Tray(nativeImage.createFromPath(path.join(ASSETS, isWin ? "tray.ico" : "tray.png")));
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "Open Lucien Home", click: () => showMain() },
    { type: "separator" },
    { label: "Lucien Family Planner", click: () => { showMain(); openApp("planner"); } },
    { label: "Family Budget Log", click: () => { showMain(); openApp("budget"); } },
    { type: "separator" },
    { label: "Refresh now", click: () => refresh() },
    { label: "Check for updates", click: () => { showMain("settings:updates"); checkUpdate(true); } },
    { label: "Settings", click: () => showMain("settings") },
    { type: "separator" },
    { label: "Quit Lucien Home", click: () => { quitting = true; app.quit(); } }
  ]));
  tray.on("click", () => showMain());
  updateTray(null);
}

/* ---------------- start with Windows + Start-menu shortcut id (needed for Windows notifications) ---------------- */
function applyStartup() {
  if (!isWin && process.platform !== "darwin") return;
  try { app.setLoginItemSettings({ openAtLogin: !!settings.startWithWindows, args: ["--hidden"], name: PRODUCT }); } catch (e) {}
}
function fixShortcut() {
  if (!isWin) return;
  const lnk = path.join(app.getPath("appData"), "Microsoft", "Windows", "Start Menu", "Programs", PRODUCT + ".lnk");
  try { if (fs.existsSync(lnk)) shell.writeShortcutLink(lnk, "update", { appUserModelId: APP_ID }); } catch (e) {}
}

/* ---------------- renderer API ---------------- */
function publicSettings() { const s = structuredClone(settings); delete s.notified; s.apps.budget.signedIn = !!s.apps.budget.token; delete s.apps.budget.token; return s; }
ipcMain.handle("checkUpdate", async () => { await checkUpdate(true); return updatePayload(); });
ipcMain.handle("installUpdate", () => installUpdate());
ipcMain.handle("pickUpdateFolder", async () => { const r = await dialog.showOpenDialog(win, { title: "Where new versions of Lucien Home are saved", properties: ["openDirectory"] }); if (r.canceled || !r.filePaths[0]) return null; settings.updateFolder = r.filePaths[0]; save(); watchUpdates(); await checkUpdate(true); return Object.assign(updatePayload(), { settings: publicSettings() }); });
ipcMain.handle("openFolder", (e, p) => { if (p && updateFolders().includes(path.normalize(p))) shell.openPath(p); });
ipcMain.handle("state", async () => ({ update, updateChecked: lastCheck, updateFolders: updateFolders(), github: updatePayload().github, justUpdated: takeJustUpdated(), settings: publicSettings(), summaries: state.at ? shape() : null, version: app.getVersion(), platform: process.platform, dataDir: DATA(), maximized: win ? win.isMaximized() : false, app: appState() }));
ipcMain.handle("refresh", () => refresh());
/* The Planner / Budget screens save through here, straight to the app's own Google script. */
const READS = new Set(["getData", "getAll", "unlock"]);
let soon = null;
ipcMain.handle("rpc", async (e, kind, fn, args) => {
  if (!views[kind] || e.sender !== views[kind].webContents) return { error: "Not allowed." };
  const p = splitLink(settings.apps[kind].link);
  if (!p.ok) return { error: "Add the app's link in Lucien Home › Settings › Apps." };
  try {
    const d = await getJson(p.base, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify({ api: "rpc", fn, args }) });
    if (d.__html !== undefined) return { error: d.__html ? OLD[kind] : "The app sent back something unexpected." };
    if (!READS.has(fn) && !d.error) { clearTimeout(soon); soon = setTimeout(refresh, 2500); }   // keep Home in step
    return d;
  } catch (err) { return { error: "Can't reach Google right now. Check the internet connection, then try again." }; }
});
ipcMain.handle("appLocation", (e, kind) => {
  const parameter = {};
  if (kind === "planner" && settings.who) parameter.me = settings.who.toLowerCase();
  if (kind === "budget" && settings.apps.budget.token) parameter.u = settings.apps.budget.token;
  const parameters = {}; for (const k of Object.keys(parameter)) parameters[k] = [parameter[k]];
  return { parameter, parameters, hash: "" };
});
ipcMain.handle("open", (e, kind) => openApp(kind));
ipcMain.handle("closeApp", (e, kind) => closeApp(kind));
ipcMain.handle("cover", (e, on) => { covered = !!on; layout(); });
ipcMain.handle("appNav", (e, what) => {
  const v = current && views[current]; if (!v) return;
  const wc = v.webContents;
  if (what === "return" || (what === "back" && current === "web" && !wc.navigationHistory.canGoBack())) return closeApp("web");
  if (what === "back" && wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack();
  if (what === "fwd" && wc.navigationHistory.canGoForward()) wc.navigationHistory.goForward();
  if (what === "reload") wc.reload();
  if (what === "home" && current !== "web") wc.loadFile(path.join(__dirname, "apps", current, "index.html"));
  if (what === "browser") { const u = wc.getURL(); if (/^https:/.test(u)) shell.openExternal(u); }
});
ipcMain.handle("win", (e, what) => {
  if (!win) return;
  if (what === "min") win.minimize();
  if (what === "max") win.isMaximized() ? win.unmaximize() : win.maximize();
  if (what === "close") win.close();
});
ipcMain.handle("save", (e, patch) => {
  const key = () => JSON.stringify([settings.apps.planner.link, settings.apps.budget.link, settings.apps.budget.token, settings.who]);
  const before = key(), scopeBefore = settings.glanceScope;
  deepMerge(settings, patch || {}); save(); applyStartup();
  if (before !== key()) { // the app links or person changed: reopen apps with the new link
    for (const k of ["planner", "budget"]) if (views[k]) closeApp(k);
    refresh();
  } else if (settings.glanceScope !== scopeBefore) send("summaries", shape());
  return publicSettings();
});
/* Check a pasted link. A personal link is split into the plain link + who / code. */
ipcMain.handle("test", async (e, kind, link) => {
  const p = splitLink(link);
  if (!p.ok) return p;
  const r = await fetchFeed(kind, p.base, kind === "budget" ? (p.u || settings.apps.budget.token) : "");
  if (r.ok || r.needPin) {
    const patch = { apps: { [kind]: { link: p.base } } };
    if (kind === "planner" && p.me && !settings.who) patch.who = cap(p.me);
    if (kind === "budget" && p.u) patch.apps.budget.token = p.u;
    if (kind === "budget" && link && splitLink(settings.apps.budget.link).base !== p.base && !p.u) patch.apps.budget.token = "";
    deepMerge(settings, patch); save(); refresh();
  }
  if (!r.ok) return Object.assign({ ok: false }, r);
  return { ok: true, version: r.data.version || "", name: r.data.appName || "", people: r.data.people || [], me: kind === "budget" ? r.data.me : settings.who };
});
/* Budget Log sign-in: the PIN is sent once, straight to your own Google script, and never stored. */
ipcMain.handle("signIn", async (e, pin, who) => {
  const p = splitLink(settings.apps.budget.link);
  if (!p.ok) return { ok: false, msg: "Paste the Budget Log's link first." };
  if (!who) return { ok: false, msg: "Pick who is using this PC first." };
  try {
    const d = await getJson(p.base, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify({ api: "connect", pin: String(pin || ""), person: who }) });
    if (d.__html !== undefined) return { ok: false, msg: d.__html ? OLD.budget : "The Budget Log sent back something unexpected." };
    if (d.error) return { ok: false, msg: String(d.error).replace(/^PIN:\s*/, "") };
    settings.apps.budget.token = d.token; if (!settings.who) settings.who = d.me; save();
    if (views.budget) closeApp("budget");
    await refresh();
    return { ok: true, me: d.me };
  } catch (err) { return { ok: false, msg: "Can't reach Google right now. Check the internet connection." }; }
});
ipcMain.handle("signOut", async () => { settings.apps.budget.token = ""; save(); if (views.budget) closeApp("budget"); await refresh(); return publicSettings(); });
ipcMain.handle("seenAlerts", () => { settings.alerts.forEach(a => a.seen = true); save(); return settings.alerts; });
ipcMain.handle("clearAlerts", () => { settings.alerts = []; save(); return []; });
ipcMain.handle("pickCover", async (e, kind) => {
  const r = await dialog.showOpenDialog(win, { title: "Pick a cover picture", properties: ["openFile"], filters: [{ name: "Pictures", extensions: ["jpg", "jpeg", "png", "webp", "gif"] }] });
  if (r.canceled || !r.filePaths[0]) return null;
  const dir = path.join(DATA(), "covers"); fs.mkdirSync(dir, { recursive: true });
  const dest = path.join(dir, kind + "-" + Date.now() + path.extname(r.filePaths[0]).toLowerCase());
  fs.copyFileSync(r.filePaths[0], dest);
  const old = settings.apps[kind].cover; if (old && old.startsWith(dir)) try { fs.unlinkSync(old); } catch (err) {}
  settings.apps[kind].cover = dest; save(); return publicSettings();
});
ipcMain.handle("resetCover", (e, kind) => { settings.apps[kind].cover = ""; save(); return publicSettings(); });
ipcMain.handle("openData", () => shell.openPath(DATA()));

function takeJustUpdated() { const f = settings.updatedFrom; if (f && f !== app.getVersion()) { settings.updatedFrom = ""; save(); return { from: f, to: app.getVersion() }; } return null; }

/* ---------------- start ---------------- */
app.on("second-instance", () => showMain());
app.whenReady().then(() => {
  settings = load(); importFamily(); loadCache();
  session.fromPartition("persist:apps").setPermissionRequestHandler((wc, perm, cb) => cb(["clipboard-sanitized-write", "notifications", "media", "fullscreen"].includes(perm)));
  createMain(!process.argv.includes("--hidden"));
  buildTray(); applyStartup(); fixShortcut(); schedule();
  checkUpdate(false); watchUpdates(); setInterval(() => { if (settings.autoUpdateCheck) checkUpdate(false); }, 30 * 60 * 1000);
  refresh();
});
app.on("before-quit", () => { quitting = true; save(); });
app.on("window-all-closed", () => { if (!settings.closeToTray) app.quit(); });
app.on("activate", () => showMain());
