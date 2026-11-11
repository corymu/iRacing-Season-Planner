(() => {
const D = window.DATA, KEY = "irsp.v1", CLASSES = "RDCBAP", WEEK = 7 * 864e5;
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const clone = o => JSON.parse(JSON.stringify(o));
const pad = n => String(n).padStart(2, "0");

/* ---------- state ---------- */
function normalize(v) {
  v.owned = v.owned || {}; v.owned.cars = v.owned.cars || []; v.owned.tracks = v.owned.tracks || [];
  v.prefs = v.prefs || {};
  for (const k of ["cars", "series", "tracks"]) { v.prefs[k] = v.prefs[k] || {}; for (const t of ["preferred", "ok"]) v.prefs[k][t] = v.prefs[k][t] || []; }
  v.prefs.settings = Object.assign({ categories: [], license: "C", max_minutes: 120, coverage_classes: [], first_week: 0, exclude_series_keywords: [], exclude_car_keywords: [] }, v.prefs.settings);
  v.prefs.weights = Object.assign({ car: 4, series: 2, track: 1 }, v.prefs.weights);
  return v;
}
function load() { try { const v = JSON.parse(localStorage.getItem(KEY)); if (v && v.prefs && v.owned) return normalize(v); } catch (e) {} return normalize({ owned: clone(D.owned), prefs: clone(D.prefs) }); }
function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {} }
let S = load();
const F = { q: "", cls: [], cats: [], week: 0, liked: false, mode: "garage" };
const CATCOL = { "Sports Car": "#ffb020", "Formula Car": "#2fd4c4", "Oval": "#ff6b6b", "Dirt Oval": "#c98f5e", "Dirt Road": "#9bd34a", "Unranked": "#8b97a4" };
const catColor = c => CATCOL[c] || "#8b97a4";
let view = "calendar";

/* ---------- data ---------- */
const R = D.rows.map(a => { const r = Object.fromEntries(D.cols.map((c, i) => [c, a[i]])); r.base = r.track.split(" - ")[0].trim(); return r; });
const CATS = [...new Set(R.map(r => r.cat))].sort();
const U = { cars: [...new Set(R.flatMap(r => r.cars))].sort(), tracks: [...new Set(R.map(r => r.base))].sort(), series: [...new Set(R.map(r => r.series))].sort() };
const START = Date.parse(R[0].date) - WEEK * (R[0].wk - 1);
const CUR = Math.max(1, Math.min(12, Math.floor((Date.now() - START) / WEEK) + 1));
const dateOf = wk => { const d = new Date(START + WEEK * (wk - 1)); return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }); };

/* ---------- matching (same three tiers as plan_races.py) ---------- */
const tokens = s => String(s).normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(" ").filter(Boolean);
const contains = (h, n) => n.length > 0 && h.some((_, i) => n.every((x, j) => h[i + j] === x));
const tokCache = new Map();
const tk = s => { let t = tokCache.get(s); if (!t) tokCache.set(s, t = tokens(s)); return t; };
function match(entry, names) {
  const e = tokens(entry);
  const tiers = [t => t.length === e.length && t.every((x, i) => x === e[i]), t => contains(t, e), t => e.length > 0 && e.every(x => t.includes(x))];
  for (const hit of tiers) { const f = names.filter(n => hit(tk(n))); if (f.length) return f; }
  return [];
}
const resolve = (entries, names) => new Set(entries.flatMap(e => match(e, names)));

/* ---------- owned lists: store exact names so the checklist can toggle them ---------- */
function exactify() {
  for (const kind of ["cars", "tracks"]) {
    const keep = [], names = new Set();
    for (const e of S.owned[kind]) { const m = match(e, U[kind]); if (m.length) m.forEach(n => names.add(n)); else keep.push(e); }
    S.owned[kind] = [...[...names].sort((a, b) => a.localeCompare(b)), ...keep];
  }
}

/* ---------- engine ---------- */
let myCars, myTracks, badCar, items, first, tierCache;
function tier(kind, name) {
  const k = kind + "|" + name;
  if (tierCache.has(k)) return tierCache.get(k);
  let pts = 0;
  for (const [t, p] of [["preferred", 2], ["ok", 1]]) if (S.prefs[kind][t].some(e => match(e, [name]).length)) { pts = p; break; }
  tierCache.set(k, pts); return pts;
}
function scoreWith(r, cars) {
  const w = S.prefs.weights;
  const tiers = { car: cars.length ? Math.max(...cars.map(c => tier("cars", c))) : 0, series: tier("series", r.series), track: tier("tracks", r.base) };
  return { tiers, score: w.car * tiers.car + w.series * tiers.series + w.track * tiers.track };
}
function compute() {
  const st = S.prefs.settings;
  tierCache = new Map();
  myCars = resolve(S.owned.cars, U.cars); myTracks = resolve(S.owned.tracks, U.tracks);
  badCar = st.exclude_car_keywords.map(k => k.toLowerCase());
  const badSeries = st.exclude_series_keywords.map(k => k.toLowerCase());
  first = st.first_week || CUR;
  const lic = CLASSES.indexOf(st.license);
  const pool = R.filter(r => st.categories.includes(r.cat) && r.wk >= first && r.wk <= 12
    && !(CLASSES.includes(r.cls) && CLASSES.indexOf(r.cls) > lic)
    && !(r.mins != null && r.mins > st.max_minutes)
    && !badSeries.some(k => r.series.toLowerCase().includes(k)));
  items = pool.map((r, id) => {
    const cars = r.cars.filter(c => !badCar.some(k => c.toLowerCase().includes(k)));
    const mine = cars.filter(c => myCars.has(c));
    const trackOk = myTracks.has(r.base), runnable = trackOk && mine.length > 0;
    return { ...r, id, cars, mine, trackOk, runnable, ...scoreWith(r, runnable ? mine : cars) };
  });
}
function coverage() {
  const want = S.prefs.settings.coverage_classes, out = [];
  for (let wk = first; wk <= 12; wk++) {
    const mine = items.filter(r => r.wk === wk && r.runnable);
    const cov = mine.filter(r => want.includes(r.cls));
    const liked = mine.filter(r => r.score > 0).sort((a, b) => b.score - a.score);
    let fix = "";
    if (!cov.length) {
      const opts = [];
      for (const r of items) {
        if (r.wk !== wk || !want.includes(r.cls)) continue;
        if (!r.trackOk && r.mine.length) opts.push([scoreWith(r, r.mine).score, `track ${r.base} → ${r.series} (${r.len})`]);
        else if (r.trackOk && r.cars.length && !r.mine.length) {
          const best = Math.max(...r.cars.map(c => scoreWith(r, [c]).score));
          opts.push([best, `${r.cars.length === 1 ? "car " + r.cars[0] : "one of: " + r.cars.slice(0, 3).join(", ")} → ${r.series} (${r.len})`]);
        }
      }
      opts.sort((a, b) => b[0] - a[0]);
      fix = opts.length ? opts[0][1] : "no one-purchase fix";
    }
    out.push({ wk, status: cov.length ? (liked.length ? "OK" : "OK (unlisted series)") : "MISSING " + want.join("/"), fix, races: liked, missing: !cov.length });
  }
  return out;
}

/* ---------- render helpers ---------- */
const prefCount = r => Object.values(r.tiers).filter(t => t === 2).length;
const tierCls = r => { const n = prefCount(r); return n >= 2 ? "g" : n === 1 ? "b" : ""; };
const splitSeries = s => { const i = s.indexOf(" by "); return i > 0 ? [s.slice(0, i), s.slice(i + 4)] : [s, ""]; };
const layout = r => r.track.includes(" - ") ? r.track.split(" - ").slice(1).join(" - ") : "";

function filtered() {
  const q = F.q.trim().toLowerCase();
  return items.filter(r => (F.mode === "all" || r.runnable)
    && (!F.week || r.wk === F.week) && (!F.cats.length || F.cats.includes(r.cat)) && (!F.cls.length || F.cls.includes(r.cls)) && (!F.liked || r.score > 0)
    && (!q || (r.series + " " + r.track + " " + r.cars.join(" ")).toLowerCase().includes(q)));
}

function cellHTML(r) {
  const car = r.runnable ? r.mine.join(", ") : r.cars[0] + (r.cars.length > 1 ? ` +${r.cars.length - 1}` : "");
  const lay = layout(r);
  const need = r.runnable ? "" : `<span class="need">${!r.trackOk && !r.mine.length ? "need car + track" : !r.trackOk ? "need track" : "need car"}</span>`;
  return `<button class="cell ${tierCls(r)} ${r.runnable ? "" : "locked"}" data-open="${r.id}" aria-label="${esc(r.series)}, week ${r.wk}: ${esc(car)} at ${esc(r.track)}">
    <span class="car">${esc(car)}</span>
    <span class="trk">${esc(r.base)}${lay ? ` <em>· ${esc(lay)}</em>` : ""}</span>
    <span class="meta">${esc(r.len)} <span class="cls ${r.cls}">${r.cls}</span>${need}${r.runnable ? `<span class="sc">${r.score}</span>` : ""}</span></button>`;
}

function calGrid(rows) {
  const weeks = []; for (let w = first; w <= 12; w++) if (!F.week || w === F.week) weeks.push(w);
  const by = new Map();
  for (const r of rows) { if (!by.has(r.series)) by.set(r.series, []); by.get(r.series).push(r); }
  const catOrder = c => { const i = S.prefs.settings.categories.indexOf(c); return i < 0 ? 99 : i; };
  const order = [...by.keys()].sort((a, b) => catOrder(by.get(a)[0].cat) - catOrder(by.get(b)[0].cat) || Math.max(...by.get(b).map(r => r.score)) - Math.max(...by.get(a).map(r => r.score)) || a.localeCompare(b));
  if (!order.length) return `<div class="none empty-state"><div>No races match these filters.<br><button class="btn" data-clear>Clear filters</button></div></div>`;
  let h = `<div class="cal ${weeks.length === 1 ? "one" : ""}" style="--n:${weeks.length}"><div class="corner lbl">Series · ${order.length}</div>`;
  for (const w of weeks) h += `<button class="ch ${w === CUR ? "now" : ""}" data-week="${F.week ? 0 : w}" title="${F.week ? "Back to all weeks" : "Show only week " + w}" aria-label="${F.week ? "Back to all weeks" : "Show only week " + w}"><b>WK ${w}</b>${dateOf(w)}${w === CUR ? ' <span class="pill hot">now</span>' : ""}<span class="go">${F.week ? "← all weeks" : "focus →"}</span></button>`;
  let lastCat = null;
  for (const s of order) {
    const list = by.get(s), [name, sponsor] = splitSeries(s), cat = list[0].cat, col = catColor(cat);
    if (cat !== lastCat) {
      lastCat = cat;
      const inCat = order.filter(x => by.get(x)[0].cat === cat);
      h += `<div class="catband" style="--c:${col}"><div class="cb-in"><i></i><b>${esc(cat)}</b><span>${inCat.length} series · ${inCat.reduce((n, x) => n + by.get(x).length, 0)} races</span></div></div>`;
    }
    h += `<div class="rl" style="--c:${col}"><strong>${esc(name)}</strong>${sponsor ? `<small>by ${esc(sponsor)}</small>` : ""}<div class="tags"><span class="cls ${list[0].cls}">${list[0].cls}</span></div></div>`;
    for (const w of weeks) {
      const hit = list.filter(r => r.wk === w);
      h += `<div class="slot ${hit.length ? "" : "empty"}">${hit.map(cellHTML).join("")}</div>`;
    }
  }
  return h + "</div>";
}

const noGarage = () => !S.owned.cars.length && !S.owned.tracks.length;
function onboard() {
  const st = S.prefs.settings;
  return `<div class="onboard"><h2>Start by telling the planner what you own</h2>
    <ol><li><b>Set your license</b> in the top right (now <b>${esc(st.license)}</b>) so you only see races you can enter.</li>
    <li><b>Tick your cars and tracks</b> in the Garage. The calendar fills with races you can run.</li>
    <li><b>Mark favorites</b> in Settings to rank the races you want most.</li></ol>
    <div class="row"><button class="btn primary" data-goto="garage">Open Garage</button><button class="btn" data-showall>See every eligible race first</button></div></div>`;
}
const calBody = () => noGarage() && F.mode === "garage" ? onboard() : calGrid(filtered());

function stats() {
  const run = items.filter(r => r.runnable), cov = coverage();
  const miss = cov.filter(w => w.missing).length;
  return `<div class="stats">
    <div class="stat"><b>${run.length}</b><span>races you can run, week ${first}–12</span></div>
    <div class="stat"><b>${run.filter(r => r.score > 0).length}</b><span>in cars, series or tracks you like</span></div>
    <div class="stat ${miss ? "warn" : ""}"><b>${miss}</b><span>weeks with no ${esc(S.prefs.settings.coverage_classes.join("/") || "class")} race</span></div>
    <div class="stat"><b>${myCars.size}<small style="color:var(--dim)"> / </small>${myTracks.size}</b><span>cars / tracks owned that this season uses</span></div></div>`;
}

function calendarView() {
  const st = S.prefs.settings;
  return `<h1>Racing calendar</h1><p class="sub">Every week of ${esc(D.season)} you can race, one row per series. Click a race for the full picture.</p>
  ${stats()}
  <div class="filters">
    <div class="sflabel"><label class="lbl" for="q">Search</label><input class="search" id="q" type="search" placeholder="Series, track or car" value="${esc(F.q)}"></div>
    <div class="chipset" role="group" aria-label="Category">${S.prefs.settings.categories.map(c => `<button class="fc cat" style="--c:${catColor(c)}" data-fk="cat${esc(c)}" data-cat="${esc(c)}" aria-pressed="${F.cats.includes(c)}"><i></i>${esc(c)} <span>${items.filter(r => r.cat === c && (F.mode === "all" || r.runnable)).length}</span></button>`).join("")}</div>
    <div class="chipset" role="group" aria-label="Class">${[...CLASSES].filter(c => CLASSES.indexOf(c) <= CLASSES.indexOf(st.license)).map(c => `<button class="fc" data-fk="cls${c}" data-cls="${c}" aria-pressed="${F.cls.includes(c)}">${c}</button>`).join("")}</div>
    <button class="fc" data-fk="liked" data-liked aria-pressed="${F.liked}">Liked only</button>
    <div class="seg" role="group" aria-label="Which races"><button data-fk="m1" data-mode="garage" aria-pressed="${F.mode === "garage"}">My garage</button><button data-fk="m2" data-mode="all" aria-pressed="${F.mode === "all"}">All eligible</button></div>
    <div class="legend"><span><i style="background:var(--g)"></i>2+ preferred</span><span><i style="background:var(--b)"></i>1 preferred</span><span><i style="background:var(--line)"></i>runnable</span></div>
  </div>
  <div class="calwrap" id="calwrap" tabindex="0" aria-label="Racing calendar grid">${calBody()}</div>`;
}

function coverageView() {
  const cov = coverage();
  return `<h1>Weekly coverage</h1><p class="sub">Each remaining week with the races you like and can run, best first. Weeks with no ${esc(S.prefs.settings.coverage_classes.join("/"))} race show the cheapest single purchase that fixes them.</p>
  <div class="weeks">${cov.map(w => `<section class="week ${w.missing ? "miss" : ""}"><div class="wh"><b>WK ${w.wk}</b><span>${dateOf(w.wk)}${w.wk === CUR ? " · this week" : ""}</span>
    <span class="pill ${w.missing ? "bad" : w.status === "OK" ? "ok" : "warn"}">${esc(w.status)}</span></div>
    ${w.missing ? `<div class="fix"><b>Fix:</b> ${esc(w.fix)}</div>` : ""}
    ${w.races.length ? w.races.map(r => `<button class="rrow" data-open="${r.id}"><span class="n">${r.score}</span><span>${esc(r.series)}<br><small>Class ${r.cls}</small></span><span>${esc(r.track)}</span><span>${esc(r.len)}</span><span>${esc(r.mine.join(", "))}</span></button>`).join("") : `<div class="none">No liked race you can run this week.</div>`}</section>`).join("")}</div>`;
}

/* ---------- garage (owned checklist) ---------- */
const G = { kind: "cars", q: "", show: "all", cats: [] };
const GI = { cars: [], tracks: [] };
(function () {
  const info = { cars: new Map(), tracks: new Map() };
  for (const r of R) for (const [kind, names] of [["cars", r.cars], ["tracks", [r.base]]]) for (const n of names) {
    const d = info[kind].get(n) || { cats: {}, series: new Set() };
    d.cats[r.cat] = (d.cats[r.cat] || 0) + 1; d.series.add(r.series); info[kind].set(n, d);
  }
  for (const kind of ["cars", "tracks"]) GI[kind] = [...info[kind]].map(([name, d]) => ({ name, cat: Object.entries(d.cats).sort((a, b) => b[1] - a[1])[0][0], n: d.series.size }))
    .sort((a, b) => a.name.localeCompare(b.name));
})();
const owns = (kind, name) => (kind === "cars" ? myCars : myTracks).has(name);
function garageItems() {
  const ql = G.q.trim().toLowerCase();
  return GI[G.kind].map((it, i) => ({ ...it, i })).filter(it => (!G.cats.length || G.cats.includes(it.cat))
    && (G.show === "all" || (G.show === "owned") === owns(G.kind, it.name)) && (!ql || it.name.toLowerCase().includes(ql)));
}
function garageList() {
  const items = garageItems(), by = new Map();
  for (const it of items) { if (!by.has(it.cat)) by.set(it.cat, []); by.get(it.cat).push(it); }
  const cats = [...by.keys()].sort((a, b) => a.localeCompare(b));
  if (!cats.length) return `<div class="none empty-state"><div>Nothing matches.<br><button class="btn" data-gclear>Clear filters</button></div></div>`;
  return cats.map(c => {
    const list = by.get(c), all = GI[G.kind].filter(it => it.cat === c), own = all.filter(it => owns(G.kind, it.name)).length;
    return `<section class="ggroup" style="--c:${catColor(c)}"><header><i></i><b>${esc(c)}</b><span>${own} of ${all.length} owned</span>
      <div class="gbtns"><button class="btn sm" data-gall="${esc(c)}">Select shown</button><button class="btn sm" data-gnone="${esc(c)}">Clear shown</button></div></header>
      <div class="gitems">${list.map(it => `<label class="gitem ${owns(G.kind, it.name) ? "on" : ""}"><input type="checkbox" data-own="${it.i}" ${owns(G.kind, it.name) ? "checked" : ""}><span class="nm">${esc(it.name)}</span><small>${it.n} series</small></label>`).join("")}</div></section>`;
  }).join("");
}
function garageCount() { const t = GI[G.kind].length, o = GI[G.kind].filter(it => owns(G.kind, it.name)).length; return `<b>${o}</b> of ${t} ${G.kind} owned`; }
function garageView() {
  const cats = [...new Set(GI[G.kind].map(it => it.cat))].sort();
  return `<h1>Garage</h1><p class="sub">Tick every car and track you own. The calendar only shows races you can run with them. Owning a track covers all its layouts.</p>
  <div class="filters">
    <div class="seg" role="group" aria-label="What to list"><button data-fk="gk1" data-gkind="cars" aria-pressed="${G.kind === "cars"}">Cars</button><button data-fk="gk2" data-gkind="tracks" aria-pressed="${G.kind === "tracks"}">Tracks</button></div>
    <div class="sflabel"><label class="lbl" for="gq">Search</label><input class="search" id="gq" type="search" placeholder="Name" value="${esc(G.q)}"></div>
    <div class="seg" role="group" aria-label="Show"><button data-fk="gs1" data-gshow="all" aria-pressed="${G.show === "all"}">All</button><button data-fk="gs2" data-gshow="owned" aria-pressed="${G.show === "owned"}">Owned</button><button data-fk="gs3" data-gshow="not" aria-pressed="${G.show === "not"}">Not owned</button></div>
    <span class="gcount" id="gcount">${garageCount()}</span></div>
  <div class="filters"><span class="lbl">Category</span><div class="chipset">${cats.map(c => `<button class="fc cat" style="--c:${catColor(c)}" data-fk="gc${esc(c)}" data-gcat="${esc(c)}" aria-pressed="${G.cats.includes(c)}"><i></i>${esc(c)}</button>`).join("")}</div></div>
  <div id="glist">${garageList()}</div>`;
}
function setOwn(kind, name, on) {
  const a = S.owned[kind], i = a.indexOf(name);
  if (on && i < 0) a.push(name); else if (!on && i >= 0) a.splice(i, 1);
}
function gRefresh() { save(); compute(); const y = window.scrollY; $("#glist").innerHTML = garageList(); $("#gcount").innerHTML = garageCount(); window.scrollTo(0, y); }

/* ---------- settings ---------- */
const LISTS = {};
function listRef(key) {
  const [t, a, b] = key.split(":");
  if (t === "p") return S.prefs[a][b];
  if (t === "o") return S.owned[a];
  return S.prefs.settings[a];
}
function editor(key, label, kind, dot, ownedList) {
  const arr = listRef(key);
  const chips = arr.map((e, i) => {
    let m = "", c = "";
    if (kind) { const n = match(e, U[kind]).length; if (!n) { m = ownedList ? "unused" : "no match"; c = ownedList ? "" : "zero"; } else if (n > 6 && !ownedList) { m = n + " · broad"; c = "broad"; } else m = n > 1 ? String(n) : ""; }
    return `<span class="chip ${c}">${esc(e)}${m ? ` <span class="m">${m}</span>` : ""}<button data-rm="${key}" data-i="${i}" aria-label="Remove ${esc(e)}">×</button></span>`;
  }).join("");
  return `<div class="editor"><div class="lab">${dot ? `<span class="dot" style="background:${dot}"></span>` : ""}${label}</div>
    <div class="chips">${chips}<input data-add="${key}" ${kind ? `list="dl-${kind}"` : ""} placeholder="Add…" aria-label="Add to ${label}" autocomplete="off"></div></div>`;
}
function checks(name, opts, sel) {
  return `<div class="checks">${opts.map(o => `<label><input type="checkbox" data-chk="${name}" value="${esc(o)}" ${sel.includes(o) ? "checked" : ""}>${esc(o)}</label>`).join("")}</div>`;
}
function settingsView() {
  const st = S.prefs.settings, w = S.prefs.weights;
  const tastes = (kind, title) => `<div class="card"><h2>${title}</h2>${editor(`p:${kind}:preferred`, "Preferred", kind, "var(--g)")}${editor(`p:${kind}:ok`, "OK", kind, "var(--b)")}</div>`;
  return `<h1>Settings</h1><p class="sub">Everything the calendar scores against. Changes apply instantly and stay in this browser.</p>
  <div class="card"><h2>Racer profile</h2><div class="fields">
    <div class="field"><label for="lic">License</label><select id="lic" data-set="license">${[...CLASSES].map(c => `<option ${c === st.license ? "selected" : ""}>${c}</option>`).join("")}</select></div>
    <div class="field"><label for="mm">Max minutes</label><input id="mm" type="number" min="0" data-set="max_minutes" value="${st.max_minutes}"></div>
    <div class="field"><label for="fw">First week (0 = this week)</label><input id="fw" type="number" min="0" max="12" data-set="first_week" value="${st.first_week}"></div>
    <div class="field"><label for="wc">Weight · car</label><input id="wc" type="number" min="0" data-w="car" value="${w.car}"></div>
    <div class="field"><label for="ws">Weight · series</label><input id="ws" type="number" min="0" data-w="series" value="${w.series}"></div>
    <div class="field"><label for="wt">Weight · track</label><input id="wt" type="number" min="0" data-w="track" value="${w.track}"></div></div>
    <div class="fields" style="margin-top:16px"><div class="field"><span class="lab">Categories</span>${checks("categories", CATS, st.categories)}</div>
    <div class="field"><span class="lab">Coverage classes (flag weeks missing these)</span>${checks("coverage_classes", [...CLASSES], st.coverage_classes)}</div></div>
    <div style="margin-top:16px" class="fields">${editor("s:exclude_series_keywords", "Skip series containing", null)}${editor("s:exclude_car_keywords", "Never count cars containing", null)}</div></div>
  <div class="sgrid">${tastes("cars", "Cars you like")}${tastes("series", "Series you like")}${tastes("tracks", "Tracks you like")}</div>
  <div class="card"><h2>Garage</h2><p>${S.owned.cars.length} cars and ${S.owned.tracks.length} tracks marked as owned.</p><button class="btn" data-tab="garage">Edit in Garage</button></div>
  <div class="card"><h2>Save and sync</h2><p>Edits live in this browser. Export them as the TOML files <code>plan_races.py</code> reads, to keep both in sync.</p>
    <div class="row"><button class="btn primary" data-export="prefs">Download preferences.toml</button><button class="btn" data-export="owned">Download owned.toml</button><button class="btn danger" data-reset>Reset to file defaults</button></div></div>`;
}

/* ---------- drawer ---------- */
let lastOpener = null;
function openDrawer(id, opener) {
  const r = items[id]; if (!r) return;
  lastOpener = opener; const w = S.prefs.weights, [name, sponsor] = splitSeries(r.series), lay = layout(r);
  const bars = [["Car", r.tiers.car, w.car], ["Series", r.tiers.series, w.series], ["Track", r.tiers.track, w.track]].map(([l, t, wt]) =>
    `<div class="bar"><span>${l}</span><div class="track"><i style="width:${t * 50}%"></i></div><b>${["–", "ok", "pref"][t]} ×${wt}</b></div>`).join("");
  const d = $("#drawer");
  d.innerHTML = `<button class="x" data-close aria-label="Close">×</button>
    <span class="pill ${r.runnable ? "ok" : "warn"}">${r.runnable ? "You can run this" : "Not runnable yet"}</span>
    <h2 id="dtitle">${esc(name)}</h2><div class="hint" style="margin:0">${sponsor ? "by " + esc(sponsor) : ""}</div>
    <dl class="dl"><dt>Week</dt><dd>${r.wk} · ${dateOf(r.wk)}</dd><dt>Track</dt><dd>${esc(r.base)}${lay ? `<br><span style="color:var(--mute)">${esc(lay)}</span>` : ""}<br><span class="${r.trackOk ? "" : "need"}">${r.trackOk ? "owned" : "not owned"}</span></dd>
    <dt>Length</dt><dd>${esc(r.len)}</dd><dt>Class</dt><dd><span class="cls ${r.cls}">${r.cls}</span> &nbsp;min licence ${esc(r.lic)}</dd><dt>Category</dt><dd>${esc(r.cat)}</dd></dl>
    <h2>Score ${r.score}</h2>${bars}
    <h2 style="margin-top:22px">Cars</h2><ul class="carlist">${[...r.cars].sort((a, b) => myCars.has(b) - myCars.has(a)).map(c => `<li class="${myCars.has(c) ? "own" : ""}">${esc(c)}<span class="tag">${myCars.has(c) ? "owned" : "not owned"}${tier("cars", c) ? " · " + (tier("cars", c) === 2 ? "preferred" : "ok") : ""}</span></li>`).join("")}</ul>`;
  $("#scrim").hidden = false; d.hidden = false; $("[data-close]", d).focus();
}
function closeDrawer() { $("#drawer").hidden = true; $("#scrim").hidden = true; if (lastOpener && document.contains(lastOpener)) lastOpener.focus(); }

/* ---------- toml export ---------- */
const q = s => JSON.stringify(s);
const arr = a => a.length ? "[" + a.map(q).join(", ") + "]" : "[]";
function download(name, text) { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([text], { type: "text/plain" })); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); }
function tomlPrefs() {
  const s = S.prefs.settings, p = S.prefs, w = p.weights;
  const sec = k => `[${k}]\npreferred = ${arr(p[k].preferred)}\nok = ${arr(p[k].ok)}\n`;
  return `[settings]\ncategories = ${arr(s.categories)}\nlicense = ${q(s.license)}\nmax_minutes = ${s.max_minutes}\ncoverage_classes = ${arr(s.coverage_classes)}\nfirst_week = ${s.first_week}\nexclude_series_keywords = ${arr(s.exclude_series_keywords)}\nexclude_car_keywords = ${arr(s.exclude_car_keywords)}\n\n[weights]\ncar = ${w.car}\nseries = ${w.series}\ntrack = ${w.track}\n\n${sec("cars")}\n${sec("series")}\n${sec("tracks")}`;
}
const tomlOwned = () => `cars = [\n${S.owned.cars.map(c => "    " + q(c) + ",").join("\n")}\n]\n\ntracks = [\n${S.owned.tracks.map(c => "    " + q(c) + ",").join("\n")}\n]\n`;

/* ---------- shell ---------- */
const TABS = [["calendar", "Calendar"], ["coverage", "Coverage"], ["garage", "Garage"], ["settings", "Settings"]];
function render() {
  const fk = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.fk || (document.activeElement.dataset.add ? "add:" + document.activeElement.dataset.add : "") : "";
  const cw = $("#calwrap"), pos = cw ? [cw.scrollLeft, cw.scrollTop] : null, sy = window.scrollY;
  $("#tabs").innerHTML = TABS.map(([id, l]) => `<button class="tab" data-tab="${id}" ${view === id ? 'aria-current="page"' : ""}>${l}</button>`).join("");
  const st = S.prefs.settings, fw = st.first_week || CUR;
  $("#season").innerHTML = `<span class="sn">${esc(D.season)}</span>
    <label class="sel hot"><span class="k">Week</span><span class="v">${fw}${fw === CUR ? " · now" : ""}</span><select data-fk="topWeek" data-topweek aria-label="Start week">${Array.from({ length: 12 }, (_, i) => i + 1).map(w => `<option value="${w}" ${w === fw ? "selected" : ""}>${w}${w === CUR ? " · now" : ""}</option>`).join("")}</select></label>
    <label class="sel"><span class="k">License</span><span class="v">${esc(st.license)}</span><select data-fk="topLic" data-set="license" aria-label="License class">${[...CLASSES].map(c => `<option ${c === st.license ? "selected" : ""}>${c}</option>`).join("")}</select></label>`;
  $("#app").innerHTML = view === "settings" ? settingsView() : view === "garage" ? garageView() : view === "coverage" ? coverageView() : calendarView();
  const n = $("#calwrap"); if (n && pos) { n.scrollLeft = pos[0]; n.scrollTop = pos[1]; }
  window.scrollTo(0, sy);
  if (fk) { const el = fk.startsWith("add:") ? $(`[data-add="${fk.slice(4)}"]`) : $(`[data-fk="${fk}"]`); if (el) el.focus(); }
}
function changed() { save(); compute(); render(); }
function addTo(key, val) { val = val.trim(); if (!val) return; const a = listRef(key); if (!a.some(x => x.toLowerCase() === val.toLowerCase())) a.push(val); changed(); }

document.addEventListener("click", e => {
  const t = e.target.closest("button,[data-open]"); if (!t) { if (e.target.id === "scrim") closeDrawer(); return; }
  const d = t.dataset;
  if (d.tab) { view = d.tab; location.hash = d.tab; render(); window.scrollTo(0, 0); }
  else if (d.open != null) openDrawer(+d.open, t);
  else if (t.hasAttribute("data-close")) closeDrawer();
  else if (d.gkind) { G.kind = d.gkind; G.cats = []; render(); }
  else if (d.gshow) { G.show = d.gshow; render(); }
  else if (d.gcat) { G.cats = G.cats.includes(d.gcat) ? G.cats.filter(c => c !== d.gcat) : [...G.cats, d.gcat]; render(); }
  else if (t.hasAttribute("data-gclear")) { G.q = ""; G.show = "all"; G.cats = []; render(); }
  else if (d.gall != null || d.gnone != null) { const on = d.gall != null, cat = on ? d.gall : d.gnone; garageItems().filter(it => it.cat === cat).forEach(it => setOwn(G.kind, it.name, on)); gRefresh(); }
  else if (t.hasAttribute("data-goto")) { view = d.goto; location.hash = d.goto; render(); window.scrollTo(0, 0); }
  else if (t.hasAttribute("data-showall")) { F.mode = "all"; render(); }
  else if (t.hasAttribute("data-clear")) { F.q = ""; F.week = 0; F.cls = []; F.cats = []; F.liked = false; render(); }
  else if (d.week != null) { F.week = +d.week; render(); }
  else if (d.cat) { F.cats = F.cats.includes(d.cat) ? F.cats.filter(c => c !== d.cat) : [...F.cats, d.cat]; render(); }
  else if (d.cls) { F.cls = F.cls.includes(d.cls) ? F.cls.filter(c => c !== d.cls) : [...F.cls, d.cls]; render(); }
  else if (t.hasAttribute("data-liked")) { F.liked = !F.liked; render(); }
  else if (d.mode) { F.mode = d.mode; render(); }
  else if (d.rm) { listRef(d.rm).splice(+d.i, 1); changed(); }
  else if (d.export) download(d.export === "prefs" ? "preferences.toml" : "owned.toml", d.export === "prefs" ? tomlPrefs() : tomlOwned());
  else if (t.hasAttribute("data-reset")) { if (confirm("Replace your browser edits with the values from owned.toml and preferences.toml?")) { S = normalize({ owned: clone(D.owned), prefs: clone(D.prefs) }); exactify(); changed(); } }
});
document.addEventListener("input", e => {
  if (e.target.id === "gq") { G.q = e.target.value; $("#glist").innerHTML = garageList(); return; }
  if (e.target.id === "q") { F.q = e.target.value; const cw = $("#calwrap"); cw.innerHTML = calBody(); }
});
document.addEventListener("change", e => {
  const t = e.target, d = t.dataset;
  if (d.own != null) { const it = GI[G.kind][+d.own]; setOwn(G.kind, it.name, t.checked); gRefresh(); return; }
  if (d.add != null) { addTo(d.add, t.value); return; }
  if (d.topweek != null) { S.prefs.settings.first_week = +t.value === CUR ? 0 : +t.value; F.week = 0; changed(); }
  else if (d.set) { const v = t.type === "number" ? Math.max(0, parseInt(t.value, 10) || 0) : t.value; S.prefs.settings[d.set] = v; if (d.set === "license") F.cls = F.cls.filter(c => CLASSES.indexOf(c) <= CLASSES.indexOf(v)); changed(); }
  else if (d.w) { S.prefs.weights[d.w] = Math.max(0, parseFloat(t.value) || 0); changed(); }
  else if (d.chk) { const a = S.prefs.settings[d.chk]; const i = a.indexOf(t.value); if (t.checked && i < 0) a.push(t.value); if (!t.checked && i >= 0) a.splice(i, 1); changed(); }
});
document.addEventListener("keydown", e => {
  if (e.key === "Escape" && !$("#drawer").hidden) closeDrawer();
  if (e.key === "Enter" && e.target.dataset && e.target.dataset.add != null) { e.preventDefault(); addTo(e.target.dataset.add, e.target.value); }
});
window.addEventListener("hashchange", () => { const h = location.hash.slice(1); if (TABS.some(t => t[0] === h) && h !== view) { view = h; render(); } });

for (const k of ["cars", "tracks", "series"]) $("#dl-" + k).innerHTML = U[k].map(n => `<option value="${esc(n)}">`).join("");
exactify(); save();
const h0 = location.hash.slice(1); if (TABS.some(t => t[0] === h0)) view = h0;
compute(); render();
})();
