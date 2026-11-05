/* Lucien Home: launcher screens. Data comes from the main process (window.lh). */
"use strict";
const $ = s => document.querySelector(s);
const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const { parseD, days, addDays, ymd, MON } = Calc;
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DOWL = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const S = { settings: null, sum: null, version: "", view: "home", hist: [], fwd: [], featured: "planner", heroPaused: false, alerts: [], calFilter: "all", setPage: "apps", tests: {}, app: { open: null, opened: [] }, maximized: false, pin: "" };
const META = {
  planner: { name: "Lucien Family Planner", short: "Planner", sub: "Lists · Dates · Meals · Shop", art: "art-plan", color: "var(--plan)" },
  budget: { name: "Family Budget Log", short: "Budget", sub: "Spending · Bills · Debt · Plan", art: "art-bud", color: "var(--bud)" }
};

/* ---------------- formatting ---------------- */
const hideMoney = () => S.settings && !S.settings.showMoney;
const money0 = n => (n < 0 ? "−" : "") + "$" + Math.abs(Math.round(n || 0)).toLocaleString("en-US");
const money = n => (n < 0 ? "−" : "") + "$" + Math.abs(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const $m = (n, whole = true) => hideMoney() ? `<span class="blur">$0,000</span>` : esc(whole ? money0(n) : money(n));
const dLabel = s => { const d = parseD(s); return `${DOW[d.getDay()]}, ${MON[d.getMonth()]} ${d.getDate()}`; };
const tLabel = t => { if (!/^\d{1,2}:\d{2}/.test(t || "")) return ""; let [h, m] = t.split(":").map(Number); const ap = h >= 12 ? "PM" : "AM"; h = h % 12 || 12; return `${h}:${String(m).padStart(2, "0")} ${ap}`; };
const ago = ms => { if (!ms) return "not yet"; const m = Math.round((Date.now() - ms) / 60000); return m < 1 ? "just now" : m < 60 ? `${m} min ago` : `${Math.round(m / 60)} hr ago`; };
const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
const whenDays = d => d < 0 ? `${-d} day${d === -1 ? "" : "s"} late` : d === 0 ? "Today" : d === 1 ? "Tomorrow" : `In ${d} days`;
const cover = (kind, cls = "") => { const c = S.settings && S.settings.apps[kind] && S.settings.apps[kind].cover;
  return c ? `<img class="${cls}" src="${esc(fileUrl(c))}" alt="">` : `<svg class="${cls}" width="100%" height="100%" aria-hidden="true"><use href="#${META[kind].art}"/></svg>`; };
const fileUrl = p => "file:///" + String(p).replace(/\\/g, "/").replace(/^\/+/, "").split("/").map(encodeURIComponent).join("/").replace(/^([A-Za-z])%3A/, "$1:");

/* ---------------- data helpers ---------------- */
const P = () => S.sum && S.sum.planner && S.sum.planner.ok ? S.sum.planner : null;
const B = () => S.sum && S.sum.budget && S.sum.budget.ok ? S.sum.budget : null;
const kinds = () => ["planner", "budget"];
function status(kind) {
  const x = S.sum && S.sum[kind];
  if (!S.settings.apps[kind].link) return { cls: "off", text: "Not connected", setup: true };
  if (x && x.needPin) return { cls: "warn", text: "Sign in once with the PIN", setup: true };
  if (!x) return { cls: "off", text: "Checking…" };
  if (x.ok) return x.stale ? { cls: "warn", text: "Offline · last update " + ago(S.sum.at) } : { cls: "good", text: "Connected" + (x.version ? " · Version " + x.version : "") };
  return { cls: "warn", text: x.msg || "Can't connect" };
}
const me = () => (S.settings && S.settings.who) || (B() && B().me) || "";
/* Everything coming up in the next n days, from both apps (bills for Household plus your own) */
function upcoming(n = 7) {
  const out = [];
  const p = P(); if (p) p.countdowns.filter(c => c.days <= n && !(c.kind === "holiday" && c.days > n)).forEach(c => out.push({ src: "planner", kind: c.kind === "holiday" ? "Holiday" : c.label, name: c.name, date: c.start, days: c.days, now: c.now, time: c.time, end: c.end, place: c.place }));
  const seen = new Set();
  for (const v of [S.sum && S.sum.budgetHouse, S.sum && S.sum.budgetMine]) (v ? v.bills : []).forEach(b => {
    const k = b.type + b.id + b.due; if (seen.has(k) || b.days > n) return; seen.add(k);
    out.push({ src: "budget", kind: b.loan ? "Loan payment" : b.owner === "Household" ? "Household bill" : "Your bill", name: b.name, date: b.due, days: b.days, bill: b, late: b.days < 0 });
  });
  return out.sort((a, b) => a.date.localeCompare(b.date) || (a.src === b.src ? 0 : a.src === "budget" ? 1 : -1));
}

/* ---------------- views ---------------- */
function render() {
  const open = S.app.open;
  document.body.classList.toggle("app-open", !!open);
  document.querySelectorAll(".rb[data-view]").forEach(b => b.classList.toggle("on", !open && b.dataset.view === S.view));
  $("#back").disabled = open ? !S.app.canBack : !S.hist.length; $("#fwd").disabled = open ? !S.app.canFwd : !S.fwd.length;
  appBar();
  const v = S.view;
  $("#view").innerHTML = v === "settings" ? settingsHTML() : v === "calendar" ? calendarHTML() : v === "alerts" ? alertsHTML() : homeHTML();
  railApps(); avatar(); badge();
  if (v === "home") startHero();
}
function appBar() {
  const a = S.app, bar = $("#appbar"); bar.hidden = !a.open; if (!a.open) return;
  const web = a.open === "web", host = (() => { try { return new URL(a.url).hostname.replace(/^www\./, ""); } catch (e) { return ""; } })();
  bar.innerHTML = `${web ? `<span class="ai" style="display:grid;place-items:center;background:var(--panel2)"><svg width="14" height="14"><use href="#i-link"/></svg></span>` : `<span class="ai">${cover(a.open)}</span>`}
    <span class="at" title="${esc(a.title)}">${esc(web ? a.title || host : META[a.open].name)}</span>${web && host ? `<span class="ad">${esc(host)}</span>` : ""}
    ${a.loading ? `<span class="ld" aria-label="Loading"></span>` : ""}
    <button data-appnav="reload" title="Reload" aria-label="Reload"><svg><use href="#i-refresh"/></svg></button>
    ${web ? `<button class="txt" data-appnav="browser" title="Open this page in your web browser">Open in browser</button>` : `<button data-appnav="home" title="Back to the app's start" aria-label="App start"><svg><use href="#i-home"/></svg></button>`}
    <button data-closeapp="${a.open}" title="${web ? "Close this page" : "Close the app (it stays signed in)"}" aria-label="Close"><svg><use href="#i-x"/></svg></button>`;
}
function go(view, push = true) {
  if (S.app.open) { lh.closeApp(); S.app.open = null; }
  if (view === S.view) { render(); $("#view").scrollTo({ top: 0 }); return; }
  if (push) { S.hist.push(S.view); S.fwd = []; }
  S.view = view; if (view === "alerts") lh.seenAlerts().then(a => { S.alerts = a; badge(); });
  render(); $("#view").scrollTo({ top: 0, behavior: "instant" });
}
function railApps() {
  $("#railApps").innerHTML = kinds().map(k => { const st = status(k);
    return `<button class="rapp ${S.app.open === k ? "on" : ""}" data-open="${k}" title="${esc(META[k].name)}: ${esc(st.text)}"><span class="face">${cover(k)}</span><i class="${st.cls === "good" ? "" : st.cls === "warn" ? "bad" : "off"}"></i><small>${esc(META[k].short)}</small></button>`; }).join("");
}
function avatar() { const m = me(); const a = $("#avatar"); a.textContent = m ? m[0].toUpperCase() : "?"; a.title = m ? "Signed in as " + m : "Connect your apps in Settings"; }
function badge() { const n = S.alerts.filter(a => !a.seen).length, b = $("#badge"); b.hidden = !n; b.textContent = n > 9 ? "9+" : n; }

/* ---- Home ---- */
function heroArt(kind) {
  const c = S.settings.apps[kind] && S.settings.apps[kind].cover;
  if (c) return `<img class="art" src="${esc(fileUrl(c))}" alt="">`;
  if (kind === "budget") return budgetArt();
  return plannerArt();
}
function plannerArt() {
  const p = P(), hasDue = !!(p && /^\d{4}-\d{2}-\d{2}$/.test(p.due || "") && p.babyDays >= 0), due = hasDue ? parseD(p.due) : new Date();
  const next = p ? p.countdowns.find(c => c.kind !== "holiday" && c.kind !== "baby") : null;
  const baby = p && p.baby;
  const lines = (baby ? [baby.done >= 1, baby.done >= 2, false] : [true, true, false]);
  const chip = next ? `<g transform="translate(930 300) rotate(-3)" filter="url(#sh)"><rect width="250" height="64" rx="16" fill="#2A2766" stroke="#4E4BB8"/><circle cx="34" cy="32" r="16" fill="#F2C15B"/><text x="34" y="38" text-anchor="middle" font-family="Inter" font-weight="800" font-size="14" fill="#2A2766">${next.days}</text>
      <text x="62" y="29" font-family="Inter" font-weight="700" font-size="14" fill="#fff">${esc(next.name.slice(0, 22))}</text><text x="62" y="47" font-family="Inter" font-size="12" fill="#A9A6FF">${esc(dLabel(next.start))}${next.time ? " · " + esc(tLabel(next.time)) : ""}</text></g>` : "";
  return `<svg class="art" viewBox="0 0 1600 440" preserveAspectRatio="xMaxYMid slice" aria-hidden="true">
    <defs><linearGradient id="gh" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#151442"/><stop offset=".6" stop-color="#2E2B85"/><stop offset="1" stop-color="#14123A"/></linearGradient>
      <radialGradient id="ghg" cx=".72" cy=".42" r=".42"><stop offset="0" stop-color="#A9A6FF" stop-opacity=".55"/><stop offset="1" stop-color="#A9A6FF" stop-opacity="0"/></radialGradient>
      <filter id="sh" x="-20%" y="-20%" width="140%" height="160%"><feDropShadow dx="0" dy="18" stdDeviation="18" flood-color="#05041A" flood-opacity=".6"/></filter></defs>
    <rect width="1600" height="440" fill="url(#gh)"/><rect width="1600" height="440" fill="url(#ghg)"/>
    <g fill="#fff" opacity=".35"><circle cx="820" cy="60" r="1.6"/><circle cx="1500" cy="90" r="1.3"/><circle cx="1320" cy="40" r="1"/><circle cx="980" cy="120" r="1.2"/><circle cx="1560" cy="300" r="1.5"/></g>
    <g transform="translate(1040 70) rotate(-5)" filter="url(#sh)"><rect width="250" height="270" rx="26" fill="#F4F3FF"/><rect width="250" height="70" rx="26" fill="#F2C15B"/><rect y="44" width="250" height="26" fill="#F2C15B"/>
      <text x="125" y="48" text-anchor="middle" font-family="Inter" font-weight="800" font-size="28" fill="#2A2766" letter-spacing="4">${MON[due.getMonth()].toUpperCase()}</text>
      <text x="125" y="210" text-anchor="middle" font-family="Inter Display,Inter" font-weight="800" font-size="140" fill="#2A2766">${due.getDate()}</text>
      <text x="125" y="248" text-anchor="middle" font-family="Inter" font-weight="700" font-size="17" fill="#6B69B8" letter-spacing="3">${hasDue ? "BABY DUE" : "TODAY"}</text></g>
    <g transform="translate(1320 150) rotate(7)" filter="url(#sh)"><rect width="200" height="190" rx="20" fill="#1E1B4B" stroke="#8B8CF6" stroke-width="2"/>
      <text x="22" y="40" font-family="Inter" font-weight="800" font-size="15" fill="#C9C7FF" letter-spacing="2">${baby ? `${baby.done} / ${baby.total} DONE` : "BABY PREP"}</text>
      <g stroke-linecap="round" stroke-linejoin="round" fill="none" stroke-width="5">${lines.map((on, i) => on ? `<path d="M24 ${74 + i * 38}l7 7 12-14" stroke="#5DD39E"/>` : `<circle cx="33" cy="${74 + i * 38}" r="8" stroke="#8B8CF6" stroke-width="3"/>`).join("")}</g>
      <g fill="#8B8CF6" opacity=".55"><rect x="58" y="70" width="110" height="9" rx="4.5"/><rect x="58" y="108" width="90" height="9" rx="4.5"/><rect x="58" y="146" width="104" height="9" rx="4.5"/></g></g>
    ${chip}</svg>`;
}
function budgetArt() {
  const b = B(), m = b && b.month;
  const pct = m && m.budget ? Math.max(0, Math.min(1, m.mtd / m.budget)) : .44;
  const left = m && m.remaining != null ? (hideMoney() ? "$•,•••" : money0(m.remaining)) : "";
  const bills = b ? (S.sum.budgetHouse || b).bills.filter(x => x.days <= 7).slice(0, 2) : [];
  return `<svg class="art" viewBox="0 0 1600 440" preserveAspectRatio="xMaxYMid slice" aria-hidden="true">
    <defs><linearGradient id="gbh" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#062520"/><stop offset=".6" stop-color="#0F5C4D"/><stop offset="1" stop-color="#05201B"/></linearGradient>
      <radialGradient id="gbhg" cx=".72" cy=".4" r=".42"><stop offset="0" stop-color="#7FE0C8" stop-opacity=".45"/><stop offset="1" stop-color="#7FE0C8" stop-opacity="0"/></radialGradient>
      <filter id="shb" x="-20%" y="-20%" width="140%" height="160%"><feDropShadow dx="0" dy="18" stdDeviation="18" flood-color="#021210" flood-opacity=".6"/></filter></defs>
    <rect width="1600" height="440" fill="url(#gbh)"/><rect width="1600" height="440" fill="url(#gbhg)"/>
    <g transform="translate(1010 80)" filter="url(#shb)">
      <rect width="330" height="250" rx="24" fill="#0B2D26" stroke="#2E7A68" stroke-width="2"/>
      <g fill="#123F35" stroke="#7FE0C8" stroke-width="2">${[60, 110, 80, 150, 120].map((h, i) => `<rect x="${30 + i * 58}" y="${210 - h}" width="38" height="${h}" rx="6" ${i === 3 ? 'fill="#7FE0C8"' : ""}/>`).join("")}</g>
      <path d="M49 140 107 100l58 22 58-62 58 30" fill="none" stroke="#F2C15B" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></g>
    <g transform="translate(1300 170) rotate(6)" filter="url(#shb)"><rect width="230" height="120" rx="20" fill="#F1F7F5"/>
      <text x="22" y="36" font-family="Inter" font-weight="800" font-size="13" fill="#0F5C4D" letter-spacing="2">${m ? esc(m.label.toUpperCase()) + " · LEFT" : "THIS MONTH"}</text>
      <text x="22" y="80" font-family="Inter Display,Inter" font-weight="800" font-size="40" fill="#0A2E27">${esc(left || "$4,175")}</text>
      <rect x="22" y="94" width="186" height="8" rx="4" fill="#CFE6DF"/><rect x="22" y="94" width="${Math.round(186 * pct)}" height="8" rx="4" fill="#0F8A72"/></g>
    ${bills.map((x, i) => `<g transform="translate(${830 + i * 20} ${250 + i * 76}) rotate(${-3 + i * 4})" filter="url(#shb)"><rect width="230" height="62" rx="15" fill="#0B2D26" stroke="#2E7A68"/><circle cx="32" cy="31" r="15" fill="#F2C15B"/><text x="32" y="36" text-anchor="middle" font-family="Inter" font-weight="800" font-size="13" fill="#3A2A05">${x.days < 0 ? "!" : x.days}</text>
      <text x="58" y="27" font-family="Inter" font-weight="700" font-size="14" fill="#fff">${esc(x.name.slice(0, 20))}</text><text x="58" y="45" font-family="Inter" font-size="12" fill="#9FD9C9">${esc(whenDays(x.days))}${hideMoney() ? "" : " · " + esc(money0(x.amount))}</text></g>`).join("")}
    <g transform="translate(1480 110) rotate(-12)"><circle r="40" fill="#F2C15B"/><circle r="31" fill="none" stroke="#B8860B" stroke-width="3"/><text y="13" text-anchor="middle" font-family="Inter Display,Inter" font-weight="800" font-size="38" fill="#7A5400">$</text></g></svg>`;
}
function heroCopy(kind) {
  const st = status(kind), m = META[kind];
  const fx = S.sum && S.sum[kind];
  if (!st.setup && fx && !fx.ok && fx.offline) return { tags: `<span class="tag" style="background:rgba(242,193,91,.14);color:var(--warn)">Offline</span><span>${kind === "planner" ? "Planner" : "Budget"}</span>`,
    title: m.name, desc: "Can't reach Google right now, so the numbers here can't refresh. The app will open as soon as the internet is back.", meta: `<span class="hstate warn">${esc(fx.msg)}</span>`, btn: "Open", sub: "when you're back online" };
  if (st.setup || (fx && !fx.ok && !fx.stale)) {
    return { tags: `<span class="tag" style="background:rgba(242,193,91,.14);color:var(--warn)">${st.setup ? "Set up" : "Needs attention"}</span><span>${kind === "planner" ? "Planner" : "Budget"}</span>`,
      title: m.name, desc: st.setup ? `Paste the ${kind === "planner" ? "Planner" : "Budget Log"} link once in Settings. After that it opens right here, already signed in, and its dates and bills show up on this page.` : esc(st.text),
      meta: `<span class="hstate ${st.cls}">${esc(st.text)}</span>`, btn: "Connect", sub: "Settings › Apps", setup: true };
  }
  if (kind === "planner") {
    const p = P(); if (!p) return { tags: "", title: m.name, desc: "Loading…", meta: "", btn: "Open", sub: "" };
    const others = p.people.filter(x => x !== p.me);
    const next = p.countdowns.find(c => c.kind !== "holiday");
    const bits = [];
    if (p.baby && p.baby.total) bits.push(`${p.baby.name} is ${p.baby.done} of ${p.baby.total} done`);
    if (next) bits.push(`${next.name} is ${next.days === 0 ? "today" : next.days === 1 ? "tomorrow" : "in " + next.days + " days"}${next.time && next.days <= 1 ? " at " + tLabel(next.time) : ""}`);
    if (p.tonight) bits.push(`tonight is ${p.tonight}`);
    const desc = "Lists, dates, meals and the shopping list" + (p.people.length > 1 ? " for the " + (p.people.length === 2 ? "two" : p.people.length) + " of you" : "") + ". " + (bits.length ? cap(bits.join(", ")) + "." : "");
    return { tags: `<span class="tag">Updated ${esc(ago(S.sum.at))}</span><span>Planner${others.length ? " · shared with " + esc(others.join(" & ")) : ""}</span>`, title: p.appName, desc: esc(desc),
      meta: `${p.babyDays != null && p.babyDays >= 0 ? `<b>Baby in ${p.babyDays} days</b><span>·</span>` : ""}<span>${plural(p.lists.length, "list")}</span><span>·</span><span>${p.itemsLeft} to do</span>${p.version ? `<span>·</span><span>Version ${esc(p.version)}</span>` : ""}<span class="hstate ${st.cls}">${st.cls === "good" ? "✓ Up to date" : esc(st.text)}</span>`,
      btn: "Open", sub: p.me ? `as ${p.me} · opens here` : "opens here" };
  }
  const b = B(); if (!b) return { tags: "", title: m.name, desc: "Loading…", meta: "", btn: "Open", sub: "" };
  const mo = b.month, house = S.sum.budgetHouse || b, week = house.bills.filter(x => x.days <= 7), late = house.bills.filter(x => x.days < 0);
  const moneyBit = hideMoney() ? `${mo.label} so far is hidden on this PC.` : `${mo.label} so far: ${money0(mo.mtd)} spent${mo.budget != null ? ` of ${money0(mo.budget)}` : ""}.`;
  const billBit = late.length ? ` ${plural(late.length, "bill")} past due.` : week.length ? ` ${plural(week.length, "household bill")} due this week, starting with ${week[0].name} ${week[0].days === 0 ? "today" : week[0].days === 1 ? "tomorrow" : "on " + DOWL[parseD(week[0].due).getDay()]}.` : " No household bills due this week.";
  return { tags: `<span class="tag">Updated ${esc(ago(S.sum.at))}</span><span>Budget · Household view</span>`, title: b.appName, desc: esc(moneyBit + billBit),
    meta: `${mo.remaining != null ? `<b>${hideMoney() ? "$•,••• left" : esc(money0(mo.remaining)) + " left"}</b><span>·</span>` : ""}<span>Day ${mo.day} of ${mo.n}</span>${b.version ? `<span>·</span><span>Version ${esc(b.version)}</span>` : ""}<span class="hstate ${st.cls}">${st.cls === "good" ? "✓ Up to date" : esc(st.text)}</span>`,
    btn: "Open", sub: b.me ? `as ${b.me} · opens here` : "opens here" };
}
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
function heroHTML() {
  const ks = kinds(); if (!ks.includes(S.featured)) S.featured = ks[0];
  const k = S.featured, c = heroCopy(k);
  return `<section class="hero" id="hero" aria-label="${esc(META[k].name)}">
    ${heroArt(k)}
    <div class="hcopy">
      <div class="tags">${c.tags}</div>
      <h1>${esc(c.title)}</h1>
      <p>${c.desc}</p>
      <div class="meta">${c.meta}</div>
      <div class="acts">
        <button class="primary" ${c.setup ? `data-go="settings"` : `data-open="${k}"`}><svg><use href="#i-play"/></svg><span><b>${esc(c.btn)}</b><small>${esc(c.sub)}</small></span></button>
        ${c.setup ? "" : `<button class="ghost" data-view-go="calendar"><svg><use href="#i-cal"/></svg>Coming up</button>`}
        <button class="ghost sq" title="Settings for this app" aria-label="Settings for this app" data-go="settings"><svg><use href="#i-set"/></svg></button>
      </div>
    </div>
    <div class="switcher">${ks.map(x => `<button class="thumb ${x === k ? "on" : ""}" data-feature="${x}" aria-label="Show ${esc(META[x].name)}">${cover(x)}<span class="lbl">${esc(META[x].short)}</span></button>`).join("")}</div>
  </section>`;
}
function chipsHTML() {
  const out = [], p = P(), b = B();
  if (b) { const h = S.sum.budgetHouse || b, w = h.bills.filter(x => x.days <= 7), late = h.bills.filter(x => x.days < 0);
    out.push(`<button class="chip ${w.length || late.length ? "hot" : ""}" data-cal="bills"><svg><use href="#i-cash"/></svg>${late.length ? "Bills past due" : "Bills due this week"} <em>${late.length || w.length}</em></button>`); }
  const up = upcoming(7).filter(x => x.src === "planner");
  if (p) out.push(`<button class="chip" data-cal="events"><svg><use href="#i-cal"/></svg>Coming up <em>${up.length}</em></button>`);
  if (p && p.tonight) out.push(`<button class="chip" data-open="planner"><svg><use href="#i-fork"/></svg>Tonight: ${esc(p.tonight)}</button>`);
  if (p) out.push(`<button class="chip" data-open="planner"><svg><use href="#i-cart"/></svg>Shop list <em>${p.shopCount}</em></button>`);
  if (p && p.baby) out.push(`<button class="chip" data-open="planner"><svg><use href="#i-check"/></svg>${esc(p.baby.name)} <em>${p.baby.done}/${p.baby.total}</em></button>`);
  if (b) out.push(`<button class="chip" data-open="budget"><svg><use href="#i-chart"/></svg>Spent in ${esc(b.month.label)} <em>${hideMoney() ? "hidden" : esc(money0(b.month.mtd))}</em></button>`);
  if (b && b.me) out.push(`<button class="chip" data-glance="${esc(b.me)}"><svg><use href="#i-person"/></svg>${esc(b.me)}'s view</button>`);
  return out.length ? `<div class="chips">${out.join("")}</div>` : "";
}
function homeHTML() {
  const needSetup = !S.settings.apps.planner.link || !S.settings.apps.budget.link;
  let h = heroHTML() + chipsHTML();
  if (needSetup) h += `<div class="welcome"><div class="grow"><b>Welcome to Lucien Home</b><p>${!S.settings.apps.planner.link && !S.settings.apps.budget.link ? "Paste your two app links once (the ones that end in /exec) and everything here fills in by itself." : `Connect the ${!S.settings.apps.planner.link ? "Planner" : "Budget Log"} too, to see its dates and bills here.`}</p></div><button class="btn pri" data-go="settings"><svg><use href="#i-link"/></svg>Connect apps</button></div>`;
  h += `<section class="sec"><div class="sh"><h2>Your apps</h2><span>${me() ? `Open signed in as ${esc(me())}. No PIN, no "who are you?"` : "They open right here in Lucien Home."}</span></div>
    <div class="apps2">${kinds().map(appCardHTML).join("")}</div></section>`;
  const up = upcoming(7);
  h += `<section class="sec"><div class="sh"><h2>Coming up</h2><span>From both apps, next 7 days</span><div class="r">${up.length > 3 ? `<button class="arrow" data-ev="-1" aria-label="Earlier"><svg><use href="#i-left"/></svg></button><button class="arrow" data-ev="1" aria-label="Later"><svg><use href="#i-right"/></svg></button>` : ""}<button data-view-go="calendar">See all <svg><use href="#i-right"/></svg></button></div></div>
    ${up.length ? `<div class="ev" id="evrow">${up.slice(0, 12).map(cardHTML).join("")}</div>` : `<div class="empty"><div class="grow">${P() || B() ? "Nothing in the next 7 days. Enjoy the quiet week." : "Connect your apps to see appointments, events and bills here."}</div></div>`}</section>`;
  h += glanceHTML();
  return `<div class="home">${h}</div>`;
}
function appCardHTML(k) {
  const st = status(k), p = P(), b = B();
  let facts = [];
  if (k === "planner" && p) { const nx = p.countdowns.find(c => c.kind !== "holiday"); facts = [
      ["Next up", nx ? `${nx.name} · ${whenDays(nx.days).toLowerCase()}` : "Nothing planned"],
      [p.baby ? p.baby.name : "To do", p.baby ? `${p.baby.done} / ${p.baby.total} done` : plural(p.itemsLeft, "item")],
      ["Tonight", p.tonight || "Not planned"], ["Shop list", plural(p.shopCount, "item")]]; }
  if (k === "budget" && b) { const h = S.sum.budgetHouse || b, nb = h.bills[0]; facts = [
      [`Spent in ${b.month.label}`, hideMoney() ? "hidden" : money0(b.month.mtd) + (b.month.budget != null ? " of " + money0(b.month.budget) : "")],
      ["Next bill", nb ? `${nb.name} · ${whenDays(nb.days).toLowerCase()}` : "None due"],
      ["Bills this week", String(h.bills.filter(x => x.days <= 7).length)],
      ["Debt", hideMoney() ? "hidden" : money0(b.loanTotal + b.cardTotal)]]; }
  const name = (k === "planner" && p && p.appName) || (k === "budget" && b && b.appName) || META[k].name;
  return `<article class="appcard"><button class="art" data-open="${k}" aria-label="Open ${esc(name)}">${S.settings.apps[k].cover ? cover(k) : `<svg viewBox="10 6 280 280" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><use href="#${META[k].art}" width="300" height="400"/></svg>`}</button><div class="bd">
    <h3>${esc(name)}</h3><div class="sub">${esc(META[k].sub)}</div>
    ${facts.length ? `<div class="facts">${facts.map(f => `<div><span>${esc(f[0])}</span><b title="${esc(f[1])}">${esc(f[1])}</b></div>`).join("")}</div>` : `<div class="sub" style="margin-top:6px">${st.setup ? "Add its link in Settings › Apps to see it here." : esc(st.text)}</div>`}
    <div class="foot"><button class="btn pri" ${st.setup ? `data-go="settings"` : `data-open="${k}"`}><svg><use href="#i-play"/></svg>${st.setup ? (st.text.startsWith("Sign in") ? "Sign in" : "Connect") : "Open"}</button>
      <span class="cs st ${st.cls}">${st.cls === "good" ? "● " : st.cls === "warn" ? "▲ " : "○ "}${esc(st.text.replace(/ · Version.*/, ""))}</span></div></div></article>`;
}
function tileHTML(k) {
  const st = status(k);
  return `<div><button class="tile" data-open="${k}" aria-label="Open ${esc(META[k].name)}"><div class="cover">${cover(k)}</div></button>
    <div class="ct">${esc((k === "planner" && P() && P().appName) || (k === "budget" && B() && B().appName) || META[k].name)}</div>
    <div class="cs">${esc(META[k].sub)}</div><div class="cs st ${st.cls}">${st.cls === "good" ? "● " : st.cls === "warn" ? "▲ " : "○ "}${esc(st.text.replace(/ · Version.*/, ""))}</div></div>`;
}
function cardHTML(x) {
  const today = x.days === 0 || x.now, n = x.now && !x.days ? 0 : x.days;
  const big = x.late ? `<b>${-n}</b>day${n === -1 ? "" : "s"} late` : n === 0 ? `<b>Today</b>` : `<b>${n}</b>day${n === 1 ? "" : "s"}`;
  const when = x.src === "budget"
    ? `${dLabel(x.date)}${hideMoney() ? "" : x.bill.split ? ` · split ${money0(x.bill.full / Math.max(1, (B() ? B().people.length : 2)))} each` : x.bill.share ? ` · your half` : ""}`
    : `${dLabel(x.date)}${x.time ? " · " + tLabel(x.time) : ""}${x.end ? " – " + dLabel(x.end).replace(/^\w+, /, "") : ""}`;
  const name = x.src === "budget" ? `${esc(x.name)}${hideMoney() ? "" : " · " + esc(money0(x.bill.full))}` : esc(x.name);
  return `<div class="card ${x.late ? "late" : today ? "today" : ""}"><button class="act" data-open="${x.src}" title="Open ${esc(META[x.src].name)}">Open</button>
    <div class="src" title="${esc(META[x.src].name)}"><i style="background:${META[x.src].color}"></i>${esc(x.kind)}</div>
    <div class="cnt">${big}</div><div><div class="nm" title="${esc(x.name)}">${name}</div><div class="when">${esc(when)}</div></div></div>`;
}
function glanceHTML() {
  const b = B(), p = P();
  if (!b && !p) return "";
  const scope = b ? b.scope : "Household";
  const seg = b ? `<div class="seg" role="group" aria-label="Whose money">${["Household", ...b.people].map(x => `<button data-glance="${esc(x)}" aria-pressed="${x === scope}">${esc(x)}</button>`).join("")}</div>` : "";
  let spent = `<div class="gl"><div class="k">Spent so far</div><div class="none">Connect the Budget Log to see this month's spending.</div></div>`;
  if (b) { const m = b.month, pct = m.budget ? Math.min(100, m.mtd / m.budget * 100) : 0, tick = m.day / m.n * 100;
    spent = `<button class="gl" data-open="budget" style="text-align:left;color:inherit"><div class="k"><span>Spent so far · ${esc(m.label)}</span></div><div class="v">${$m(m.mtd)}${m.budget != null ? `<small>of ${hideMoney() ? "•••" : esc(money0(m.budget))}</small>` : ""}</div>
      ${m.budget != null ? `<div class="track"><i style="width:${pct}%;${m.mtd > m.budget ? "background:var(--bad)" : ""}"></i><b style="left:${tick}%"></b></div><div class="d"><span><b style="color:var(--fg)">${$m(Math.max(0, m.remaining))}</b> left</span><span>${m.left} days to go</span></div>`
        : `<div class="none">No ${esc(m.label)} budget yet${m.forecast ? ` · on pace for ${hideMoney() ? "•••" : esc(money0(m.forecast))}` : ""}.</div>`}</button>`; }
  let debt = "";
  if (b) { const rows = [...b.loans.map(l => [l.name, $m(l.live)]), ...(b.cards.length ? [["Credit cards", $m(b.cardTotal)]] : [])];
    const pay = b.loans.find(l => l.payoff);
    debt = `<button class="gl" data-open="budget" style="text-align:left;color:inherit"><div class="k"><span>Debt</span></div>${rows.length ? `<div class="mini">${rows.slice(0, 3).map(r => `<div><span>${esc(r[0])}</span><b>${r[1]}</b></div>`).join("")}${pay ? `<div><span>${esc(pay.name)} paid off by</span><b>${esc(pay.payoff)}</b></div>` : ""}</div>` : `<div class="none">No loans or cards for ${esc(scope)}.</div>`}</button>`; }
  let week = "";
  const wk = [];
  if (p && p.baby) wk.push([p.baby.name, `${p.baby.done} / ${p.baby.total} done`]);
  if (p) wk.push(["Meals planned", `${p.mealsPlanned} of 7 nights`]);
  if (p) wk.push(["Shop list", plural(p.shopCount, "item")]);
  if (b && b.goals.length) { const g = b.goals[0]; wk.push([g.name, hideMoney() ? "•••" : `${money0(g.saved)} / ${money0(g.target)}`]); }
  if (wk.length) week = `<div class="gl"><div class="k"><span>This week</span></div><div class="mini">${wk.slice(0, 4).map(r => `<div><span>${esc(r[0])}</span><b>${esc(r[1])}</b></div>`).join("")}</div></div>`;
  return `<section class="sec"><div class="sh"><h2>At a glance</h2><span>${esc(scope)} · ${b ? esc(b.month.label) : ""}</span><div class="r">${seg}</div></div>
    <div class="glance">${spent}${debt || ""}${week}</div></section>`;
}
let heroTimer = null;
function startHero() {
  clearInterval(heroTimer);
  const h = $("#hero"); if (!h) return;
  h.addEventListener("mouseenter", () => S.heroPaused = true); h.addEventListener("mouseleave", () => S.heroPaused = false);
  heroTimer = setInterval(() => { if (S.heroPaused || S.view !== "home" || document.hidden || !$("#hero")) return; const ks = kinds(); S.featured = ks[(ks.indexOf(S.featured) + 1) % ks.length]; swapHero(); }, 12000);
}
function swapHero() { const h = $("#hero"); if (!h) return; const t = document.createElement("div"); t.innerHTML = heroHTML(); h.replaceWith(t.firstElementChild); startHero(); }

/* ---- Coming up (full) ---- */
function calendarHTML() {
  const all = upcoming(45).filter(x => S.calFilter === "all" || (S.calFilter === "bills" ? x.src === "budget" : x.src === "planner"));
  const seg = `<div class="seg" role="group" aria-label="Show">${[["all", "Everything"], ["events", "Dates"], ["bills", "Bills"]].map(([k, l]) => `<button data-calf="${k}" aria-pressed="${S.calFilter === k}">${l}</button>`).join("")}</div>`;
  const week = all.filter(x => x.days <= 7), billsDue = all.filter(x => x.src === "budget" && x.days <= 7 && !x.bill.autopay);
  const stats = `<div class="calstats">
    <div class="stat"><div class="k">Next 7 days</div><div class="v">${week.length}</div><div class="d">${plural(week.filter(x => x.src === "planner").length, "date")} · ${plural(week.filter(x => x.src === "budget").length, "bill")}</div></div>
    <div class="stat"><div class="k">Bills to pay this week</div><div class="v">${hideMoney() ? "•••" : esc(money0(billsDue.reduce((a, x) => a + x.bill.amount, 0)))}</div><div class="d">${billsDue.length ? plural(billsDue.length, "bill") + " not on autopay" : "everything is on autopay"}</div></div>
    <div class="stat"><div class="k">Next 45 days</div><div class="v">${all.length}</div><div class="d">${hideMoney() ? "" : esc(money0(all.filter(x => x.src === "budget").reduce((a, x) => a + x.bill.amount, 0))) + " in bills"}</div></div></div>`;
  return `<div class="page"><div class="pagehead"><div><h1>Coming up</h1><p class="lead">Next 45 days from both apps. Bills show Household plus ${esc(me() || "your")}'s own.</p></div>${seg}</div>${stats}
    ${all.length ? boardHTML(all) : `<div class="empty" style="margin-top:18px"><div class="grow">Nothing coming up${S.calFilter === "all" ? "" : " here"}.</div></div>`}</div>`;
}
/* A week board: one column per day for the next 7 days, then next week and later. Columns share the width, so it's flush on any screen. */
function boardHTML(all) {
  const t = (P() && P().today) || (B() && B().today) || ymd(new Date()), cols = [];
  const late = all.filter(x => x.late); if (late.length) cols.push({ key: "late", title: "Past due", sub: "", items: late, cls: "late" });
  for (let i = 0; i < 7; i++) { const d = addDays(t, i), dt = parseD(d);
    cols.push({ key: d, title: i === 0 ? "Today" : i === 1 ? "Tomorrow" : DOWL[dt.getDay()], sub: `${MON[dt.getMonth()]} ${dt.getDate()}`, items: all.filter(x => !x.late && (x.date === d || (i === 0 && x.now && x.date < d))), cls: i === 0 ? "today" : dt.getDay() === 0 || dt.getDay() === 6 ? "wknd" : "" }); }
  const nw = all.filter(x => !x.late && x.days >= 7 && x.days <= 13), lt = all.filter(x => !x.late && x.days > 13);
  if (nw.length) cols.push({ key: "next", title: "Next week", sub: `${dLabel(addDays(t, 7)).replace(/^\w+, /, "")} – ${dLabel(addDays(t, 13)).replace(/^\w+, /, "")}`, items: nw, cls: "later" });
  if (lt.length) cols.push({ key: "later", title: "Later", sub: "next 45 days", items: lt, cls: "later" });
  return `<div class="board" id="board" style="--cols:${cols.length}">${cols.map(c => { const bills = c.items.filter(x => x.src === "budget"), tot = bills.reduce((a, x) => a + x.bill.amount, 0);
    return `<section class="bcol ${c.cls}"><header><div><b>${esc(c.title)}</b><span>${esc(c.sub)}</span></div><em>${c.items.length ? (bills.length && !hideMoney() ? esc(money0(tot)) + " · " : "") + c.items.length : ""}</em></header>
      <div class="bitems">${c.items.length ? c.items.map(x => boardTileHTML(x, c.key === "next" || c.key === "later" || c.key === "late")).join("") : `<div class="free">Nothing planned</div>`}</div></section>`; }).join("")}</div>`;
}
function boardTileHTML(x, showDate) {
  const tags = x.src === "budget" ? [x.bill.split ? "Split" : "", x.bill.share ? "Your half" : "", x.bill.autopay ? "Autopay" : "", x.bill.loan ? "Loan" : ""].filter(Boolean) : [];
  const when = [showDate ? dLabel(x.date) : "", x.src === "planner" && x.time ? tLabel(x.time) : "", x.src === "planner" && x.end ? "until " + dLabel(x.end).replace(/^\w+, /, "") : "", x.src === "planner" ? x.place : ""].filter(Boolean).join(" · ");
  return `<button class="btile ${x.src}" data-open="${x.src}" title="Open ${esc(META[x.src].name)}">
    <div class="bt1"><span class="src"><i style="background:${META[x.src].color}"></i>${esc(x.kind)}</span>${x.src === "budget" ? `<span class="amt">${$m(x.bill.amount, false)}</span>` : ""}</div>
    <div class="bname">${esc(x.name)}</div>${when ? `<div class="bwhen">${esc(when)}</div>` : ""}
    ${tags.length ? `<div class="btags">${tags.map(t => `<span class="tag2">${esc(t)}</span>`).join("")}</div>` : ""}</button>`;
}
function calTileHTML(x) {
  const d = x.now && !x.days ? 0 : x.days, today = d === 0, dt = parseD(x.date);
  const big = x.late ? `<b>${-d}</b><span>day${d === -1 ? "" : "s"} late</span>` : today ? `<b>Today</b>` : d === 1 ? `<b>Tomorrow</b>` : `<b>${d}</b><span>days</span>`;
  const tags = x.src === "budget" ? [x.bill.split ? "Split" : "", x.bill.share ? "Your half" : "", x.bill.autopay ? "Autopay" : "", x.bill.loan ? "Loan" : ""].filter(Boolean) : [];
  const where = x.src === "planner" ? [x.time ? tLabel(x.time) : "", x.end ? "until " + dLabel(x.end) : "", x.place].filter(Boolean).join(" · ") : "";
  return `<article class="ctile ${x.late ? "late" : today ? "today" : ""} ${x.src}">
    <div class="ctop"><span class="src"><i style="background:${META[x.src].color}"></i>${esc(x.kind)}</span>${x.src === "budget" ? `<span class="amt">${$m(x.bill.amount, false)}</span>` : ""}</div>
    <div class="cdate"><div class="cal"><span>${MON[dt.getMonth()]}</span><b>${dt.getDate()}</b></div><div class="cnt">${big}</div></div>
    <div class="cname" title="${esc(x.name)}">${esc(x.name)}</div>
    <div class="cwhen">${esc(DOWL[dt.getDay()])}${where ? " · " + esc(where) : ""}</div>
    <div class="cfoot">${tags.map(t => `<span class="tag2">${esc(t)}</span>`).join("")}<button class="btn sm2" data-open="${x.src}">Open</button></div></article>`;
}

/* ---- Notifications ---- */
function alertsHTML() {
  const a = S.alerts;
  return `<div class="page"><div style="display:flex;align-items:center;gap:12px"><h1 style="flex:1">Notifications</h1>${a.length ? `<button class="btn" data-clear-alerts="1">Clear all</button>` : ""}</div>
    <p class="lead">Reminders Lucien Home has shown: bills due today or tomorrow, and tomorrow's appointments and events.</p>
    ${a.length ? `<div class="alertgrid">` + a.map(x => `<div class="alert ${x.seen ? "" : "new"}"><div class="ic" style="background:${x.app === "budget" ? "rgba(92,201,174,.15);color:var(--bud)" : "rgba(139,140,246,.15);color:var(--plan)"}"><svg><use href="#${x.app === "budget" ? "i-cash" : "i-cal"}"/></svg></div>
      <div class="tx"><b>${esc(x.title)}</b><span>${esc(x.body)}</span></div><time>${esc(new Date(x.at).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }))}</time></div>`).join("") + `</div>`
      : `<div class="empty"><div class="grow">No reminders yet. Turn them on or off in Settings › Notifications.</div><button class="btn" data-go="settings" data-set-page="notify">Notification settings</button></div>`}</div>`;
}

/* ---- Settings ---- */
const SET_PAGES = [["general", "General", "i-gear"], ["apps", "Apps", "i-grid"], ["notify", "Notifications", "i-bell"], ["startup", "Startup & tray", "i-win"], ["updates", "Updates", "i-download"], ["about", "About", "i-info"]];
const tog = (key, on, label) => `<button class="tog" role="switch" aria-checked="${!!on}" aria-label="${esc(label)}" data-tog="${key}"></button>`;
function settingsHTML() {
  const pg = S.setPage, nApps = ["planner", "budget"].filter(k => S.sum && S.sum[k] && S.sum[k].ok).length;
  const nav = SET_PAGES.map(([k, l, ic], i) => `${i === SET_PAGES.length - 1 ? `<div class="ssep"></div>` : ""}<button class="si ${pg === k ? "on" : ""}" data-set-page="${k}"><svg><use href="#${ic}"/></svg>${l}${k === "apps" ? `<em>${nApps} connected</em>` : k === "updates" && S.update ? `<em class="new">${esc(S.update.version)}</em>` : ""}</button>`).join("");
  const body = pg === "updates" ? setUpdates() : pg === "general" ? setGeneral() : pg === "notify" ? setNotify() : pg === "startup" ? setStartup() : pg === "about" ? setAbout() : setApps();
  return `<div class="settings" style="display:grid"><aside class="snav">${nav}</aside><section class="sbody">${body}<div class="saved"><svg><use href="#i-check"/></svg>Changes save automatically</div></section></div>`;
}
function linkBlock(kind) {
  const a = S.settings.apps[kind], t = S.tests[kind], st = status(kind);
  const line = t && t.busy ? `<div class="okline dim">Checking the link…</div>`
    : t && t.res && !t.res.ok && !t.res.needPin ? `<div class="okline bad"><svg><use href="#i-warn"/></svg>${esc(t.res.msg)}</div>`
    : a.link ? `<div class="okline ${st.cls === "good" ? "" : st.cls === "warn" ? "bad" : "dim"}"><svg><use href="#${st.cls === "warn" ? "i-warn" : "i-check"}"/></svg>${esc(st.text)}${st.cls === "good" && me() ? " · opens as " + esc(me()) : ""}</div>` : `<div class="okline dim">Not connected yet.</div>`;
  return `<div class="it" style="display:block"><div class="tx"><b><span class="stepn">1</span>App link</b><span>The link you open the app with, ending in <b>/exec</b>. Find it in the Apps Script editor under Deploy › Manage deployments › Web app.</span></div>
    <div class="field"><input class="inp" id="link-${kind}" type="text" spellcheck="false" placeholder="https://script.google.com/macros/s/…/exec" value="${esc(a.link)}">
      <button class="sbtn" data-paste="${kind}"><svg><use href="#i-link"/></svg>Paste</button><button class="sbtn pri" data-test="${kind}">Save & check</button></div>${line}</div>`;
}
function whoBlock() {
  const people = (S.sum && S.sum.people) || [];
  return `<div class="grp"><h3>Who's using this PC</h3><div class="box"><div class="it"><div class="tx"><b>You are</b><span>The apps open as this person: no "who's using this?" question, and your own bills show up.</span></div>
    ${people.length ? `<div class="seg who" role="group" aria-label="Who's using this PC">${people.map(x => `<button data-who="${esc(x)}" aria-pressed="${x === S.settings.who}">${esc(x)}</button>`).join("")}</div>` : `<span class="okline dim" style="margin:0">Add an app link first</span>`}</div></div></div>`;
}
function signInBlock() {
  const a = S.settings.apps.budget, x = S.sum && S.sum.budget;
  if (!a.link) return "";
  if (a.signedIn && !(x && x.needPin)) return `<div class="it"><div class="tx"><b><span class="stepn">2</span>Signed in</b><span>Lucien Home opens the Budget Log${me() ? " as " + esc(me()) : ""} without asking for the PIN. The PIN itself isn't stored.</span></div><button class="sbtn" data-signout="1">Sign out</button></div>`;
  return `<div class="it" style="display:block"><div class="tx"><b><span class="stepn">2</span>Sign in once with the PIN</b><span>Type the Budget Log PIN one time. Lucien Home then opens it${S.settings.who ? " as " + esc(S.settings.who) : ""} without asking again. The PIN goes only to your own Google script and isn't saved.</span></div>
    <div class="pinrow"><input class="inp" id="pin" type="password" inputmode="numeric" maxlength="10" placeholder="PIN" autocomplete="off"><button class="sbtn pri" data-signin="1">Sign in</button>
    ${S.signErr ? `<span class="okline bad" style="margin:0"><svg><use href="#i-warn"/></svg>${esc(S.signErr)}</span>` : !S.settings.who ? `<span class="okline dim" style="margin:0">Pick who you are above first</span>` : ""}</div></div>`;
}
function coverBlock(kind) {
  const c = S.settings.apps[kind].cover;
  return `<div class="it"><div style="width:54px;height:72px;border-radius:7px;overflow:hidden;border:1px solid var(--line2);flex:none">${cover(kind)}</div><div class="tx"><b>Cover art</b><span>${c ? "Your own picture is used for the tile and the big banner." : "Use your own photo for the tile and the big banner."}</span></div>
    ${c ? `<button class="sbtn" data-cover-reset="${kind}">Use the original</button>` : ""}<button class="sbtn" data-cover="${kind}"><svg><use href="#i-image"/></svg>Change…</button></div>`;
}
function setApps() {
  return `<h1>Apps</h1><p class="lead">${S.settings.family ? "Your family's apps are already connected. You'd only change these to connect different apps." : "Paste each app's normal link once. Everything opens inside Lucien Home."}</p>
    ${whoBlock()}
    <div class="grp"><h3>Lucien Family Planner</h3><div class="box">${linkBlock("planner")}${coverBlock("planner")}</div></div>
    <div class="grp"><h3>Family Budget Log</h3><div class="box">${linkBlock("budget")}${signInBlock()}${coverBlock("budget")}</div></div>
    <div class="grp"><h3>How it works</h3><div class="box">${tog("hideBanner", S.settings.hideBanner, "Hide Google's banner")}</div>
      <div class="it"><div class="tx"><b>Links stay in Lucien Home</b><span>Planner and Budget run right here. Everything you type saves to the same Google Sheet as the phone apps, so everyone sees it on their phone. A link inside an app (a store, a recipe) opens here too.</span></div></div>
    </div></div>`;
}
function setGeneral() {
  return `<h1>General</h1><p class="lead">How the Home screen looks on this PC.</p>
    <div class="grp"><h3>Privacy</h3><div class="box">
      <div class="it"><div class="tx"><b>Show money on the Home screen</b><span>Turn off if others use or can see this PC. Amounts are blurred until you open the Budget Log.</span></div>${tog("showMoney", S.settings.showMoney, "Show money")}</div></div></div>
    <div class="grp"><h3>At a glance</h3><div class="box">
      <div class="it"><div class="tx"><b>Whose money to show</b><span>The spending, debt and goals boxes on Home.</span></div>${B() ? `<div class="seg">${["Household", ...B().people].map(x => `<button data-glance="${esc(x)}" aria-pressed="${x === S.settings.glanceScope}">${esc(x)}</button>`).join("")}</div>` : `<span class="okline dim">Connect the Budget Log first.</span>`}</div></div></div>
    <div class="grp"><h3>Sharing Lucien Home</h3><div class="box"><div class="it" style="display:block"><div class="tx"><b>Giving Lucien Home to someone else</b><span>Send them the same Setup file. It has none of your links or data inside. They paste the links you give them, and only see what those links open.</span></div></div></div></div>`;
}
function setNotify() {
  const n = S.settings.notify;
  return `<h1>Notifications</h1><p class="lead">Windows reminders, even while Lucien Home is in the tray.</p>
    <div class="grp"><h3>Reminders</h3><div class="box">
      <div class="it"><div class="tx"><b>Bills</b><span>The day before a bill is due, and on the day. Household bills plus your own. Autopay bills are skipped.</span></div>${tog("notify.bills", n.bills, "Bill reminders")}</div>
      <div class="it"><div class="tx"><b>Appointments and events</b><span>The day before, and the morning of. Holidays only on the day.</span></div>${tog("notify.events", n.events, "Event reminders")}</div></div></div>
    <div class="grp"><h3>Quiet hours</h3><div class="box">
      <div class="it"><div class="tx"><b>Don't notify between</b><span>Reminders wait until quiet hours end.</span></div><input class="timein" type="time" id="qStart" value="${esc(n.quietStart)}"><span class="okline dim" style="margin:0">and</span><input class="timein" type="time" id="qEnd" value="${esc(n.quietEnd)}"></div></div></div>`;
}
function setStartup() {
  return `<h1>Startup & tray</h1><p class="lead">Keep Lucien Home ready in the background.</p>
    <div class="grp"><h3>Startup</h3><div class="box">
      <div class="it"><div class="tx"><b>Start with Windows</b><span>Opens quietly in the tray when you sign in, so reminders work all day.</span></div>${tog("startWithWindows", S.settings.startWithWindows, "Start with Windows")}</div></div></div>
    <div class="grp"><h3>Closing the window</h3><div class="box">
      <div class="it"><div class="tx"><b>Keep running in the tray</b><span>The X button hides Lucien Home instead of quitting. Right-click the tray icon to quit.</span></div>${tog("closeToTray", S.settings.closeToTray, "Keep running in the tray")}</div></div></div>`;
}
function setUpdates() {
  const u = S.update, gh = S.github || {};
  const where = (S.updateFolders || []);
  if (u && !u.ready) return `<h1>Updates</h1><p class="lead">Lucien Home ${esc(S.version)}.</p><div class="grp"><div class="box"><div class="it upd"><div class="ubadge"><svg><use href="#i-download"/></svg></div><div class="tx"><b>Downloading version ${esc(u.version)}… ${u.progress || 0}%</b><span>It keeps going in the background. When it's done, an Update button appears at the top.</span><div class="pbar"><i style="width:${u.progress || 0}%"></i></div></div></div>${u.notes ? `<div class="it" style="display:block"><div class="tx"><b>What's new</b></div><pre class="notes">${esc(u.notes)}</pre></div>` : ""}</div></div>`;
  return `<h1>Updates</h1><p class="lead">Lucien Home ${esc(S.version)}. New versions install from here, no need to open the installer yourself.</p>
    <div class="grp"><div class="box">
      ${u ? `<div class="it upd"><div class="ubadge"><svg><use href="#i-download"/></svg></div><div class="tx"><b>Version ${esc(u.version)} is ready</b><span>Takes a few seconds. Lucien Home closes, updates and opens again by itself. Your settings and sign-ins stay.</span></div>
          <button class="sbtn pri" data-install-update="1"><svg><use href="#i-download"/></svg>Update now</button></div>
          ${u.notes ? `<div class="it" style="display:block"><div class="tx"><b>What's new</b></div><pre class="notes">${esc(u.notes)}</pre></div>` : ""}`
        : `<div class="it"><div class="ubadge ok"><svg><use href="#i-check"/></svg></div><div class="tx"><b>You're up to date</b><span>Checked ${esc(ago(S.updateChecked))}${gh.error ? " · " + esc(gh.error) : ""}. Lucien Home checks GitHub when it opens and every 30 minutes, downloads new versions in the background, and then shows an Update button.</span></div>
          <button class="sbtn" data-check-update="1"><svg><use href="#i-refresh"/></svg>Check now</button></div>`}
    </div></div>
    <div class="grp"><h3>Where updates come from</h3><div class="box">
      <div class="it"><div class="tx"><b>GitHub</b><span>New versions are published at github.com/${esc(gh.repo || "belucien/lucien-home")}. Everyone with Lucien Home gets them, wherever they are.${gh.latest ? " Newest there: " + esc(gh.latest) + "." : ""}</span></div></div>
      <div class="it" style="display:block"><div class="tx"><b>Also check a folder</b><span>A "Lucien Home Setup" file saved in one of these folders also counts as an update. Handy without internet.</span></div>
        <div class="field"><input class="inp" readonly value="${esc(S.settings.updateFolder || "Desktop › Lucien Home (default)")}"><button class="sbtn" data-pick-update-folder="1"><svg><use href="#i-folder"/></svg>Choose folder…</button>
        ${S.settings.updateFolder ? `<button class="sbtn" data-reset-update-folder="1">Use default</button>` : ""}</div>
        <div class="help">Checked: ${where.map(f => `<button class="link" data-open-folder="${esc(f)}">${esc(f)}</button>`).join(" · ")}</div></div>
      <div class="it"><div class="tx"><b>Check automatically</b><span>When Lucien Home opens and every 30 minutes. Turn off to only check when you click Check now.</span></div>${tog("autoUpdateCheck", S.settings.autoUpdateCheck !== false, "Check automatically")}</div>

    </div></div>`;
}
function setAbout() {
  const p = S.sum && S.sum.planner, b = S.sum && S.sum.budget;
  return `<h1>About</h1><p class="lead">Lucien Home, the desktop launcher for your family apps.</p>
    <div class="grp"><div class="box"><div class="it" style="display:block"><div class="kv">
      <span>Lucien Home</span><b>Version ${esc(S.version)}</b>
      <span>Planner</span><b>${p && p.ok ? "Version " + esc(p.version || "?") : "Not connected"}</b>
      <span>Budget Log</span><b>${b && b.ok ? "Version " + esc(b.version || "?") : "Not connected"}</b>
      <span>Last refresh</span><b>${esc(ago(S.sum && S.sum.at))}</b>
      <span>Settings folder</span><b>${esc(S.dataDir || "")}</b></div>
      <div class="field"><button class="sbtn" data-refresh="1"><svg><use href="#i-refresh"/></svg>Refresh now</button><button class="sbtn" data-open-data="1"><svg><use href="#i-folder"/></svg>Open settings folder</button></div>
      <p class="help">Your links are stored on this PC only, encrypted with your Windows account. Uninstall from Windows Settings › Apps.</p></div></div></div>`;
}

/* ---------------- search ---------------- */
function searchItems() {
  const out = [];
  kinds().forEach(k => out.push({ t: META[k].name, s: "Open app", act: () => lh.open(k), c: META[k].color }));
  upcoming(60).forEach(x => out.push({ t: x.name, s: `${x.kind} · ${dLabel(x.date)} · ${whenDays(x.days)}`, act: () => lh.open(x.src), c: META[x.src].color }));
  const p = P(); if (p) p.lists.forEach(l => out.push({ t: l.name, s: `Planner list · ${l.done} of ${l.total} done`, act: () => lh.open("planner"), c: META.planner.color }));
  SET_PAGES.forEach(([k, l]) => out.push({ t: l, s: "Settings", act: () => { S.setPage = k; go("settings"); }, c: "var(--muted)" }));
  [["Coming up", "calendar"], ["Notifications", "alerts"], ["Home", "home"]].forEach(([l, v]) => out.push({ t: l, s: "Page", act: () => go(v), c: "var(--muted)" }));
  return out;
}
let sRes = [], sIdx = 0;
function openSearch() { lh.cover(true); $("#searchOv").hidden = false; $("#q").value = ""; doSearch(); setTimeout(() => $("#q").focus(), 10); }
function closeSearch() { $("#searchOv").hidden = true; lh.cover(false); }
function doSearch() {
  const q = $("#q").value.trim().toLowerCase(), all = searchItems();
  sRes = (q ? all.filter(x => (x.t + " " + x.s).toLowerCase().includes(q)) : all).slice(0, 12); sIdx = 0; paintRes();
}
function paintRes() { $("#results").innerHTML = sRes.length ? sRes.map((x, i) => `<button class="res ${i === sIdx ? "on" : ""}" data-res="${i}"><i class="dot" style="background:${x.c}"></i><div class="tx"><b>${esc(x.t)}</b><span>${esc(x.s)}</span></div>${i === sIdx ? "<kbd>Enter</kbd>" : ""}</button>`).join("") : `<div class="noresults">No matches</div>`; }
$("#q").addEventListener("input", doSearch);
$("#q").addEventListener("keydown", e => {
  if (e.key === "ArrowDown") { sIdx = Math.min(sRes.length - 1, sIdx + 1); paintRes(); e.preventDefault(); }
  else if (e.key === "ArrowUp") { sIdx = Math.max(0, sIdx - 1); paintRes(); e.preventDefault(); }
  else if (e.key === "Enter" && sRes[sIdx]) { closeSearch(); sRes[sIdx].act(); }
  else if (e.key === "Escape") closeSearch();
});
$("#searchOv").addEventListener("click", e => { if (e.target.id === "searchOv") closeSearch(); const r = e.target.closest("[data-res]"); if (r) { closeSearch(); sRes[+r.dataset.res].act(); } });
$("#searchBtn").addEventListener("click", openSearch);
document.addEventListener("keydown", e => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); openSearch(); }
  if (e.key === "Escape" && !$("#searchOv").hidden) closeSearch();
  if (e.altKey && e.key === "ArrowLeft") $("#back").click();
  if (e.altKey && e.key === "ArrowRight") $("#fwd").click();
});

/* ---------------- toast ---------------- */
let toastT = null;
function toast(msg) { const t = $("#toast"); t.textContent = msg; t.classList.add("on"); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove("on"), 3600); }

/* ---------------- events ---------------- */
function setByPath(key, val) { const patch = {}; let o = patch; const ks = key.split("."); ks.slice(0, -1).forEach(k => { o = o[k] = {}; }); o[ks[ks.length - 1]] = val; return patch; }
async function savePatch(patch) { S.settings = await lh.save(patch); }
document.addEventListener("click", async e => {
  const b = e.target.closest("button, [data-open]"); if (!b) return;
  const d = b.dataset;
  if (d.view) return go(d.view);
  if (d.viewGo) return go(d.viewGo);
  if (d.go) { if (d.setPage) S.setPage = d.setPage; return go(d.go); }
  if (d.setPage) { S.setPage = d.setPage; return render(); }
  if (d.open) { const k = d.open, st = status(k); if (st.setup) { S.setPage = "apps"; return go("settings"); } S.app.open = k; render(); return lh.open(k); }
  if (d.closeapp) { await lh.closeApp(d.closeapp === "web" ? "web" : undefined); return; }
  if (d.appnav) return lh.appNav(d.appnav);
  if (d.ev) { const r = $("#evrow"); if (r) r.scrollBy({ left: +d.ev * r.clientWidth, behavior: "smooth" }); return; }
  if (d.win) return lh.win(d.win);
  if (d.who) { await savePatch({ who: d.who }); return render(); }
  if (d.signin) return signIn();
  if (d.installUpdate || d.updbtn) return doUpdate();
  if (d.checkUpdate) { const r = await lh.checkUpdate(); applyUpdate(r); toast(r.update ? `Version ${r.update.version} is ready` : "You're up to date"); return; }
  if (d.pickUpdateFolder) { const r = await lh.pickUpdateFolder(); if (r) { S.settings = r.settings; applyUpdate(r); } return; }
  if (d.resetUpdateFolder) { await savePatch({ updateFolder: "" }); const r = await lh.checkUpdate(); applyUpdate(r); return; }
  if (d.openFolder) return lh.openFolder(d.openFolder);
  if (d.signout) { S.settings = await lh.signOut(); return render(); }
  if (d.feature) { S.featured = d.feature; S.heroPaused = true; return swapHero(); }
  if (d.cal) { S.calFilter = d.cal; return go("calendar"); }
  if (d.calf) { S.calFilter = d.calf; return render(); }
  if (d.glance) { await savePatch({ glanceScope: d.glance }); return; }
  if (d.tog) { const cur = d.tog.split(".").reduce((o, k) => o[k], S.settings); await savePatch(setByPath(d.tog, !cur)); return render(); }
  if (d.test) return testLink(d.test);
  if (d.paste) { try { const t = await navigator.clipboard.readText(); $("#link-" + d.paste).value = t.trim(); testLink(d.paste); } catch (err) { toast("Couldn't read the clipboard. Click the box and press Ctrl+V."); } return; }
  if (d.cover) { const s = await lh.pickCover(d.cover); if (s) { S.settings = s; render(); toast("Cover updated"); } return; }
  if (d.coverReset) { S.settings = await lh.resetCover(d.coverReset); return render(); }
  if (d.refresh) return doRefresh();
  if (d.openData) return lh.openData();
  if (d.clearAlerts) { S.alerts = await lh.clearAlerts(); return render(); }
});
document.addEventListener("change", async e => {
  const t = e.target;
  if (t.id === "qStart" || t.id === "qEnd") await savePatch({ notify: { [t.id === "qStart" ? "quietStart" : "quietEnd"]: t.value } });
});
document.addEventListener("keydown", e => { if (e.key === "Enter" && e.target.id && e.target.id.startsWith("link-")) testLink(e.target.id.slice(5)); if (e.key === "Enter" && e.target.id === "pin") signIn(); });
async function signIn() {
  const pin = ($("#pin") || {}).value || "";
  if (!/^\d{4,10}$/.test(pin)) { S.signErr = "Type the PIN (numbers only)."; return render(); }
  if (!S.settings.who) { S.signErr = "Pick who you are first."; return render(); }
  S.signErr = ""; const btn = $("[data-signin]"); if (btn) { btn.disabled = true; btn.textContent = "Signing in…"; }
  const r = await lh.signIn(pin, S.settings.who);
  if (r.ok) { const st = await lh.state(); S.settings = st.settings; S.sum = st.summaries; toast(`Signed in as ${r.me}`); } else S.signErr = r.msg;
  render();
}
async function testLink(kind) {
  const v = $("#link-" + kind).value.trim();
  S.tests[kind] = { busy: true }; render();
  const res = await lh.test(kind, v);
  S.tests[kind] = { res };
  const st = await lh.state(); S.settings = st.settings; if (st.summaries) S.sum = st.summaries;
  if (res.ok) toast(`${META[kind].name} connected`); else if (res.needPin) toast("Link saved. Now sign in once with the PIN.");
  render();
  const i = $("#link-" + kind); if (i && !res.ok && !res.needPin) i.value = v;
}
$("#back").addEventListener("click", () => { if (S.app.open) return lh.appNav("back"); if (!S.hist.length) return; S.fwd.push(S.view); go(S.hist.pop(), false); });
$("#fwd").addEventListener("click", () => { if (S.app.open) return lh.appNav("fwd"); if (!S.fwd.length) return; S.hist.push(S.view); go(S.fwd.pop(), false); });
$("#view").addEventListener("scroll", () => $("#topbar").classList.toggle("solid", $("#view").scrollTop > 24), { passive: true });
function maxIcon(m) { S.maximized = m; $("#maxIc").innerHTML = m ? '<rect x="2.5" y=".5" width="7" height="7" fill="none" stroke="currentColor"/><path d="M.5 2.5v7h7" fill="none" stroke="currentColor"/>' : '<rect x=".5" y=".5" width="9" height="9" fill="none" stroke="currentColor"/>'; $("#maxBtn").title = m ? "Restore" : "Maximize"; }
$("#refreshBtn").addEventListener("click", doRefresh);
async function doRefresh() { const r = $("#refreshBtn"); r.classList.add("spin"); try { S.sum = await lh.refresh(); render(); toast("Updated"); } finally { r.classList.remove("spin"); } }
window.addEventListener("focus", () => { if (S.sum && Date.now() - S.sum.at > 2 * 60 * 1000) lh.refresh(); });

/* ---------------- first open: who are you, then the Budget PIN once ---------------- */
let wStep = "who", wErr = "";
function maybeWelcome() {
  const st = S.settings; if (!st) return;
  const need = st.apps.planner.link && (!st.who || (st.apps.budget.link && !st.apps.budget.signedIn));
  if (st.firstRun && need) { wStep = st.who ? "pin" : "who"; $("#welcomeOv").hidden = false; paintWelcome(); }
}
function paintWelcome() {
  const box = $("#welcomeOv .wbox"), st = S.settings;
  const people = (S.sum && S.sum.people && S.sum.people.length ? S.sum.people : (st.family && st.family.people) || []);
  if (wStep === "who") box.innerHTML = `<div class="wlogo"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#04141D" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/></svg></div>
    <h2 id="wTitle">Welcome to Lucien Home</h2><p>Your family's Planner and Budget are already connected. Who's using this PC?</p>
    <div class="wpeople">${people.length ? people.map(p => `<button class="wperson" data-wwho="${esc(p)}"><span>${esc(p[0])}</span>${esc(p)}</button>`).join("") : `<div class="okline dim">Connecting to your apps…</div>`}</div>
    <button class="wskip" data-wskip="1">Set up later</button>`;
  else box.innerHTML = `<div class="wlogo"><svg width="26" height="26"><use href="#i-cash"/></svg></div>
    <h2 id="wTitle">Hi ${esc(st.who)}. One last step</h2><p>Type the Budget Log PIN once. Lucien Home won't ask again. The PIN goes only to your own Google script and isn't saved on this PC.</p>
    <div class="pinrow" style="justify-content:center"><input class="inp" id="wpin" type="password" inputmode="numeric" maxlength="10" placeholder="PIN" autocomplete="off"><button class="sbtn pri" data-wsignin="1">Sign in</button></div>
    ${wErr ? `<div class="okline bad" style="justify-content:center"><svg><use href="#i-warn"/></svg>${esc(wErr)}</div>` : ""}
    <button class="wskip" data-wskip="1">Skip. I'll use the Planner for now</button>`;
  const pin = $("#wpin"); if (pin) setTimeout(() => pin.focus(), 30);
}
async function welcomeDone() { $("#welcomeOv").hidden = true; await savePatch({ firstRun: false }); render(); }
$("#welcomeOv").addEventListener("click", async e => {
  const b = e.target.closest("button"); if (!b) return;
  if (b.dataset.wwho) { await savePatch({ who: b.dataset.wwho }); if (S.settings.apps.budget.link && !S.settings.apps.budget.signedIn) { wStep = "pin"; paintWelcome(); } else welcomeDone(); }
  if (b.dataset.wskip) welcomeDone();
  if (b.dataset.wsignin) wSignIn();
});
$("#welcomeOv").addEventListener("keydown", e => { if (e.key === "Enter" && e.target.id === "wpin") wSignIn(); });
async function wSignIn() {
  const pin = ($("#wpin") || {}).value || "";
  if (!/^\d{4,10}$/.test(pin)) { wErr = "Type the PIN (numbers only)."; return paintWelcome(); }
  const b = $("[data-wsignin]"); b.disabled = true; b.textContent = "Signing in…";
  const r = await lh.signIn(pin, S.settings.who);
  if (r.ok) { const st = await lh.state(); S.settings = st.settings; S.sum = st.summaries; toast(`Signed in as ${r.me}. You're all set.`); welcomeDone(); }
  else { wErr = r.msg; paintWelcome(); }
}

/* ---------------- start ---------------- */
lh.onSummaries(s => { S.sum = s; if (!$("#welcomeOv").hidden) paintWelcome(); const typing = document.activeElement && document.activeElement.matches("input"); if (!typing) render(); });
lh.onAlerts(a => { S.alerts = a; badge(); if (S.view === "alerts") render(); });
lh.onNav(v => { if (v === "settings") S.setPage = "apps"; if (v.startsWith("settings:")) { S.setPage = v.split(":")[1]; v = "settings"; } go(v); });
lh.onToast(m => toast(m));
lh.onApp(a => { const was = S.app.open; S.app = a; if (!!was !== !!a.open || was !== a.open) render(); else { appBar(); railApps(); $("#back").disabled = a.open ? !a.canBack : !S.hist.length; $("#fwd").disabled = a.open ? !a.canFwd : !S.fwd.length; } });
lh.onMaximized(maxIcon);
lh.onUpdate(applyUpdate);
function applyUpdate(r) {
  if (!r) return; S.update = r.update; if (r.checked) S.updateChecked = r.checked; if (r.folders) S.updateFolders = r.folders; if (r.github) S.github = r.github;
  const b = $("#updBtn"); b.hidden = !(S.update && S.update.ready); if (S.update) { b.innerHTML = `<svg><use href="#i-download"/></svg>Update <span>${esc(S.update.version)}</span>`; b.title = `Install Lucien Home ${S.update.version}`; b.dataset.updbtn = "1"; }
  $("#udot").hidden = !(S.update && S.update.ready);
  if (S.view === "settings") render();
}
async function doUpdate() {
  const b = $("#updBtn"); b.disabled = true; b.innerHTML = `<span class="ld"></span>Updating…`;
  const r = await lh.installUpdate();
  if (r.ok) toast(`Installing ${r.version}. Lucien Home will reopen in a moment.`); else { toast(r.msg); b.disabled = false; applyUpdate({ update: S.update }); }
}
setInterval(() => { if (S.view === "home" && !document.hidden) { const h = $("#hero .tags .tag"); if (h && /^Updated/.test(h.textContent)) h.textContent = "Updated " + ago(S.sum && S.sum.at); } }, 30000);
(async () => {
  const st = await lh.state();
  S.settings = st.settings; S.sum = st.summaries; S.version = st.version; S.dataDir = st.dataDir; S.alerts = st.settings.alerts || []; S.app = st.app || S.app;
  maxIcon(!!st.maximized); render();
  applyUpdate({ update: st.update, checked: st.updateChecked, folders: st.updateFolders, github: st.github });
  maybeWelcome();
  if (st.justUpdated) toast(`Updated to ${st.justUpdated.to}`);
})();
