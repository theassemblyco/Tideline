import { searchPlaces, getConditions } from './api.js';
import { moonEvents, solunarPeriods, moonPhase, moonSvg } from './astro.js';
import { analyseTides } from './tides.js';
import { scoreFishing, scoreKayaking, bestWindows, dayScore, rating, DEFAULT_SETTINGS, lightAt } from './scoring.js';

const HOUR = 3600 * 1000;
const $ = sel => document.querySelector(sel);

// ---------- persisted state ----------
const store = {
  get(key, fallback) {
    try { const v = localStorage.getItem('tl:' + key); return v ? JSON.parse(v) : fallback; } catch (_) { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem('tl:' + key, JSON.stringify(value)); } catch (_) { /* storage full or blocked */ }
  },
};

const state = {
  settings: { ...DEFAULT_SETTINGS, ...store.get('settings', {}) },
  favourites: store.get('favourites', []),
  activity: store.get('activity', 'fish'),
  place: store.get('place', null),
  data: null,      // processed forecast
  dayIdx: 0,
};

// ---------- time formatting in the location's timezone ----------
function local(ms) { return new Date(ms + (state.data ? state.data.tzOffset : 0) * 1000); }
function fmtTime(ms) {
  const d = local(ms);
  let h = d.getUTCHours(); const m = d.getUTCMinutes();
  const ap = h < 12 ? 'am' : 'pm'; h = h % 12 || 12;
  return `${h}:${String(m).padStart(2, '0')}${ap}`;
}
function fmtHour(ms) {
  const d = local(ms); let h = d.getUTCHours();
  const ap = h < 12 ? 'a' : 'p'; h = h % 12 || 12;
  return `${h}${ap}`;
}
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MO = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function fmtDate(dateStr) {
  const d = new Date(dateStr + 'T00:00:00Z');
  return { wd: WD[d.getUTCDay()], d: d.getUTCDate(), mo: MO[d.getUTCMonth()] };
}
function localDateStr(ms) { return local(ms).toISOString().slice(0, 10); }

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const CARD = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
const cardinal = deg => (deg == null ? '' : CARD[Math.round(deg / 22.5) % 16]);
const fx = (v, dp = 1) => (v == null || Number.isNaN(v) ? '–' : Number(v).toFixed(dp));

// ---------- processing ----------
function process(raw, place) {
  const tides = raw.tideAvailable ? analyseTides(raw.hours) : { ok: false, extremes: [] };
  const start = raw.hours[0].t, end = raw.hours[raw.hours.length - 1].t + HOUR;
  const events = moonEvents(place.lat, place.lon, start - 12 * HOUR, end + 12 * HOUR);
  const solunar = solunarPeriods(events);
  const ctx = { days: raw.days, solunar, tideOk: tides.ok, marineOk: raw.marineAvailable, settings: state.settings };

  raw.hours.forEach((h, i) => {
    h.fish = scoreFishing(raw.hours, i, ctx);
    h.kayak = scoreKayaking(raw.hours, i, ctx);
    h.light = lightAt(h.t, raw.days);
  });

  const today = new Date(Date.now() + raw.tzOffset * 1000).toISOString().slice(0, 10);
  const days = raw.days.filter(d => d.date >= today).map(d => ({
    ...d,
    hours: raw.hours.filter(h => h.iso.startsWith(d.date)),
    moon: moonPhase(d.sunrise + 6 * HOUR),
  }));
  return { ...raw, tides, events, solunar, days, place };
}

// ---------- loading ----------
async function loadPlace(place, { quiet = false } = {}) {
  state.place = place;
  store.set('place', place);
  $('#welcome').hidden = true;
  $('#place').hidden = false;
  renderHeader();
  if (!quiet) $('#day-detail').innerHTML = '<div class="loading">Loading conditions…</div>';
  $('#days').innerHTML = '';
  hideBanner();

  const cacheKey = `data:${place.lat},${place.lon}`;
  let raw, fromCache = false;
  try {
    raw = await getConditions(place.lat, place.lon);
    store.set(cacheKey, { saved: Date.now(), raw });
  } catch (err) {
    const cached = store.get(cacheKey, null);
    if (!cached) {
      $('#day-detail').innerHTML = `<div class="error">Couldn’t load conditions: ${esc(err.message)}</div>`;
      return;
    }
    raw = cached.raw; fromCache = cached.saved;
  }
  if (state.place !== place) return; // user moved on

  const data = process(raw, place);
  data.raw = raw;
  data.fetched = fromCache || Date.now();
  state.data = data;
  state.dayIdx = Math.min(state.dayIdx, data.days.length - 1);

  const notes = [];
  if (fromCache) notes.push(`Offline – showing data saved ${new Date(fromCache).toLocaleString()}.`);
  if (!raw.tideAvailable) notes.push('No tide data for this spot (inland or outside the ocean model) – tide is left out of the scores.');
  else if (!raw.marineAvailable) notes.push('No wave data for this spot – waves are left out of the kayaking score.');
  if (notes.length) showBanner(notes.join(' '));
  render();
}

// ---------- rendering ----------
function render() {
  renderHeader();
  renderDays();
  renderDay();
}

function renderHeader() {
  const p = state.place;
  if (!p) return;
  $('#place-name').textContent = p.name;
  const meta = [p.region, `${fx(p.lat, 3)}, ${fx(p.lon, 3)}`];
  if (state.data) meta.push(`Updated ${fmtTime(state.data.fetched)}`);
  $('#place-meta').textContent = meta.filter(Boolean).join(' · ');
  const fav = isFav(p);
  $('#fav-btn').textContent = fav ? '★' : '☆';
  $('#fav-btn').setAttribute('aria-pressed', String(fav));
  $('#rename-btn').hidden = !fav;
  document.querySelectorAll('.activity button').forEach(b =>
    b.setAttribute('aria-selected', String(b.dataset.activity === state.activity)));
}

function renderDays() {
  const { days, place } = state.data;
  const key = state.activity;
  $('#days').innerHTML = days.map((d, i) => {
    const hrs = d.hours.map(h => ({ ...h, result: h[key] }));
    const s = dayScore(hrs);
    const r = rating(s);
    const f = fmtDate(d.date);
    return `<button role="tab" class="day ${r.cls}" data-idx="${i}" aria-selected="${i === state.dayIdx}">
      <span class="wd">${i === 0 ? 'Today' : f.wd}</span>
      <span class="dt">${f.d} ${f.mo}</span>
      ${moonSvg(d.moon.phase, 18, place.lat < 0)}
      <span class="sc">${s}</span>
      <span class="rl">${r.label}</span>
    </button>`;
  }).join('');
}

function renderDay() {
  const data = state.data;
  const day = data.days[state.dayIdx];
  if (!day) return;
  const key = state.activity;
  const now = Date.now();
  const hrs = day.hours.map(h => ({ ...h, result: h[key] }));
  const future = hrs.filter(h => h.t + HOUR > now);
  const windows = bestWindows(future);
  const tidesToday = data.tides.extremes.filter(e => localDateStr(e.t) === day.date);
  const solunarToday = data.solunar.filter(p => localDateStr(p.centre) === day.date);
  const sst = hrs.find(h => h.sst != null)?.sst;

  const windowsHtml = windows.length
    ? windows.map(w => {
        const r = rating(w.peak);
        return `<div class="window ${r.cls}">
          <div class="w-time">${fmtTime(w.start)} – ${fmtTime(w.end)}</div>
          <div class="w-score"><span class="pill ${r.cls}">${w.peak}</span> ${r.label}</div>
          <div class="w-why muted small">${w.reasons.length ? esc(w.reasons.join(' · ')) : ''}</div>
        </div>`;
      }).join('')
    : `<div class="window r-poor"><div class="w-time">No good windows</div>
        <div class="muted small">${future.length ? 'Conditions look poor all day.' : 'This day has passed.'}</div></div>`;

  const summary = `
    <div class="facts">
      <div class="fact"><span class="k">Sun</span><span class="v">↑ ${fmtTime(day.sunrise)} &nbsp; ↓ ${fmtTime(day.sunset)}</span></div>
      <div class="fact"><span class="k">Moon</span><span class="v">${moonSvg(day.moon.phase, 16, data.place.lat < 0)} ${day.moon.name}, ${Math.round(day.moon.fraction * 100)}%</span></div>
      <div class="fact"><span class="k">Tides</span><span class="v">${data.tides.ok
        ? (tidesToday.map(e => `<span class="tide-ev">${e.type === 'high' ? 'H' : 'L'} ${fmtTime(e.t)} <span class="muted">${fx(e.h, 2)}m</span></span>`).join(' ') || '–')
        : '<span class="muted">n/a</span>'}</span></div>
      <div class="fact"><span class="k">Solunar</span><span class="v">${solunarToday.map(p =>
        `<span class="sol ${p.kind}">${p.kind === 'major' ? 'Major' : 'Minor'} ${fmtTime(p.centre)}</span>`).join(' ') || '–'}</span></div>
      ${sst != null ? `<div class="fact"><span class="k">Water</span><span class="v">${fx(sst, 1)} °C</span></div>` : ''}
    </div>`;

  $('#day-detail').innerHTML = `
    <h2 class="section-h">Best ${key === 'fish' ? 'fishing' : 'paddling'} windows</h2>
    <div class="windows">${windowsHtml}</div>
    ${summary}
    <h2 class="section-h">Hour by hour</h2>
    ${chart(day, hrs, tidesToday, solunarToday, now)}
    ${table(hrs, windows, now)}
  `;
}

function chart(day, hrs, tidesToday, solunarToday, now) {
  // Draw at the container's real pixel width so text stays readable on phones and desktops
  const W = Math.max(300, Math.round(($('#day-detail').clientWidth || 720) - 18));
  const H = 230, top = 26, base = 170, n = hrs.length;
  const tickEvery = W < 420 ? 6 : 3;
  const t0 = hrs[0].t, t1 = hrs[n - 1].t + HOUR;
  const x = t => ((t - t0) / (t1 - t0)) * W;
  const bw = W / n;
  const y = s => base - (s / 100) * (base - top);
  let svg = '';

  // Night shading
  svg += `<rect class="night" x="0" y="${top - 6}" width="${Math.max(0, x(day.sunrise))}" height="${base - top + 6}"/>`;
  svg += `<rect class="night" x="${x(day.sunset)}" y="${top - 6}" width="${Math.max(0, W - x(day.sunset))}" height="${base - top + 6}"/>`;

  // Solunar bands
  for (const p of solunarToday) {
    const a = Math.max(0, x(p.start)), b = Math.min(W, x(p.end));
    if (b > a) svg += `<rect class="sol-band ${p.kind}" x="${a}" y="4" width="${b - a}" height="10" rx="3"><title>${p.kind === 'major' ? 'Major' : 'Minor'} solunar ${fmtTime(p.start)}–${fmtTime(p.end)}</title></rect>`;
  }

  // Score bars
  hrs.forEach((h, i) => {
    const s = h.result.score, r = rating(s);
    const past = h.t + HOUR <= now ? ' past' : '';
    svg += `<rect class="bar ${r.cls}${past}" data-t="${h.t}" x="${i * bw + 1.5}" y="${y(s)}" width="${bw - 3}" height="${base - y(s)}" rx="2"><title>${fmtTime(h.t)} – ${s} (${r.label})</title></rect>`;
  });

  // Tide curve (own scale)
  const seas = hrs.map(h => h.seaFilled ?? h.sea);
  if (seas.every(v => v != null)) {
    const mn = Math.min(...seas), mx = Math.max(...seas), rng = Math.max(0.2, mx - mn);
    const ty = v => base - 28 - ((v - mn) / rng) * (base - top - 46);
    const pts = seas.map((v, i) => `${(i + 0.5) * bw},${ty(v)}`).join(' ');
    svg += `<polyline class="tide-line" points="${pts}"/>`;
    for (const e of tidesToday) {
      const ex = x(e.t), ey = ty(Math.min(mx, Math.max(mn, e.h)));
      svg += `<circle class="tide-dot" cx="${ex}" cy="${ey}" r="3.5"/>`;
      svg += `<text class="tide-lbl" x="${Math.min(W - 30, Math.max(30, ex))}" y="${e.type === 'high' ? ey - 8 : ey + 16}" text-anchor="middle">${e.type === 'high' ? 'H' : 'L'} ${fmtTime(e.t)}</text>`;
    }
  }

  // Now marker
  if (now > t0 && now < t1) svg += `<line class="now" x1="${x(now)}" x2="${x(now)}" y1="${top - 6}" y2="${base}"/>`;

  // Axis
  svg += `<line class="axis" x1="0" x2="${W}" y1="${base}" y2="${base}"/>`;
  hrs.forEach((h, i) => {
    if (local(h.t).getUTCHours() % tickEvery === 0) svg += `<text class="tick" x="${i * bw + bw / 2}" y="${base + 18}" text-anchor="middle">${fmtHour(h.t)}</text>`;
  });

  return `<div class="chart-wrap"><div class="chart-scroll"><svg class="chart" width="${W}" height="${H - 34}" viewBox="0 0 ${W} ${H - 34}" role="img" aria-label="Hourly score chart">${svg}</svg></div>
    <div class="legend small muted">
      <span><i class="lg bar-lg"></i>Score</span>
      <span><i class="lg tide-lg"></i>Tide</span>
      <span><i class="lg sol-major-lg"></i>Major solunar</span>
      <span><i class="lg sol-minor-lg"></i>Minor solunar</span>
      <span><i class="lg night-lg"></i>Night</span>
    </div></div>`;
}

function table(hrs, windows, now) {
  const inWin = t => windows.some(w => t >= w.start && t < w.end);
  const rows = hrs.map(h => {
    const r = rating(h.result.score);
    const cls = [inWin(h.t) ? 'in-win' : '', h.t + HOUR <= now ? 'past' : ''].join(' ');
    const tide = h.sea != null
      ? `${fx(h.seaFilled ?? h.sea, 2)}m <span class="muted">${h.tideDir === 'rising' ? '↑' : '↓'}</span>`
      : '–';
    const arrow = h.windDir != null
      ? `<span class="arrow" style="transform:rotate(${h.windDir + 180}deg)" title="from ${cardinal(h.windDir)}">↑</span>` : '';
    const waves = h.wave != null ? `${fx(h.wave)}m <span class="muted">${fx(h.wavePeriod, 0)}s</span>` : '–';
    return `<tr class="${cls}" data-t="${h.t}">
      <td class="nowrap">${fmtTime(h.t)}</td>
      <td><span class="pill ${r.cls}">${h.result.score}</span></td>
      <td class="nowrap">${tide}</td>
      <td class="nowrap">${arrow} ${cardinal(h.windDir)} ${fx(h.wind, 0)} <span class="muted">g${fx(h.gust, 0)}</span></td>
      <td class="nowrap">${waves}</td>
      <td class="nowrap">${h.rainProb ?? '–'}%${h.rain ? ` <span class="muted">${fx(h.rain)}mm</span>` : ''}</td>
      <td class="nowrap">${fx(h.pressure, 0)}</td>
      <td class="small warn">${esc(h.result.warnings.join(', '))}</td>
    </tr>`;
  }).join('');
  return `<div class="table-wrap"><table class="hours">
    <thead><tr><th>Time</th><th>Score</th><th>Tide</th><th>Wind km/h</th><th>Waves</th><th>Rain</th><th>hPa</th><th></th></tr></thead>
    <tbody>${rows}</tbody></table></div>`;
}

// ---------- favourites ----------
const sameSpot = (a, b) => a && b && Math.abs(a.lat - b.lat) < 1e-4 && Math.abs(a.lon - b.lon) < 1e-4;
const isFav = p => state.favourites.some(f => sameSpot(f, p));

function renderFavs() {
  $('#favourites').innerHTML = state.favourites.map((f, i) =>
    `<span class="fav-chip${sameSpot(f, state.place) ? ' active' : ''}">
      <button class="fav-go" data-i="${i}">${esc(f.name)}</button>
      <button class="fav-x" data-i="${i}" aria-label="Remove ${esc(f.name)}">×</button>
    </span>`).join('');
}

function toggleFav() {
  const p = state.place;
  if (!p) return;
  if (isFav(p)) state.favourites = state.favourites.filter(f => !sameSpot(f, p));
  else state.favourites.push({ ...p });
  store.set('favourites', state.favourites);
  renderFavs(); renderHeader();
}

// ---------- banner ----------
function showBanner(msg) { const b = $('#banner'); b.textContent = msg; b.hidden = false; }
function hideBanner() { $('#banner').hidden = true; }

// ---------- events ----------
function bind() {
  $('#search-form').addEventListener('submit', async e => {
    e.preventDefault();
    const q = $('#search-input').value.trim();
    if (!q) return;
    const coord = q.match(/^\s*(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)\s*$/);
    if (coord) {
      const lat = +coord[1], lon = +coord[2];
      if (Math.abs(lat) <= 90 && Math.abs(lon) <= 180) {
        $('#search-results').hidden = true;
        selectPlace({ name: `Pin ${lat.toFixed(3)}, ${lon.toFixed(3)}`, region: 'Custom location', lat, lon });
        return;
      }
    }
    const list = $('#search-results');
    list.hidden = false;
    list.innerHTML = '<li class="muted">Searching…</li>';
    try {
      const results = await searchPlaces(q);
      list._results = results;
      list.innerHTML = results.length
        ? results.map((r, i) => `<li><button data-i="${i}"><strong>${esc(r.name)}</strong> <span class="muted">${esc(r.region)}</span></button></li>`).join('')
        : '<li class="muted">No places found. Try a nearby town, or paste coordinates (e.g. -25.917, 153.003).</li>';
    } catch (err) {
      list.innerHTML = `<li class="error">${esc(err.message)}</li>`;
    }
  });

  $('#search-results').addEventListener('click', e => {
    const b = e.target.closest('button[data-i]');
    if (!b) return;
    const p = $('#search-results')._results[+b.dataset.i];
    $('#search-results').hidden = true;
    $('#search-input').value = '';
    selectPlace(p);
  });

  $('#locate-btn').addEventListener('click', () => {
    if (!navigator.geolocation) return showBanner('Location is not available in this browser.');
    navigator.geolocation.getCurrentPosition(
      pos => selectPlace({ name: 'My location', region: '', lat: +pos.coords.latitude.toFixed(4), lon: +pos.coords.longitude.toFixed(4) }),
      err => showBanner(`Couldn’t get your location: ${err.message}`),
      { enableHighAccuracy: false, timeout: 15000 });
  });

  $('#favourites').addEventListener('click', e => {
    const go = e.target.closest('.fav-go'), x = e.target.closest('.fav-x');
    if (go) selectPlace(state.favourites[+go.dataset.i]);
    if (x) {
      state.favourites.splice(+x.dataset.i, 1);
      store.set('favourites', state.favourites);
      renderFavs(); renderHeader();
    }
  });

  $('#fav-btn').addEventListener('click', toggleFav);
  $('#rename-btn').addEventListener('click', () => {
    const name = prompt('Name this spot', state.place.name);
    if (!name) return;
    state.place = { ...state.place, name: name.trim() };
    state.favourites = state.favourites.map(f => (sameSpot(f, state.place) ? { ...f, name: state.place.name } : f));
    store.set('favourites', state.favourites);
    store.set('place', state.place);
    if (state.data) state.data.place = state.place;
    renderFavs(); renderHeader();
  });
  $('#refresh-btn').addEventListener('click', () => state.place && loadPlace(state.place, { quiet: true }));

  document.querySelectorAll('.activity button').forEach(b => b.addEventListener('click', () => {
    state.activity = b.dataset.activity;
    store.set('activity', state.activity);
    if (state.data) render(); else renderHeader();
  }));

  $('#days').addEventListener('click', e => {
    const b = e.target.closest('.day');
    if (!b) return;
    state.dayIdx = +b.dataset.idx;
    renderDays(); renderDay();
  });

  $('#day-detail').addEventListener('click', e => {
    const bar = e.target.closest('.bar');
    if (!bar) return;
    const row = document.querySelector(`tr[data-t="${bar.dataset.t}"]`);
    if (row) {
      row.scrollIntoView({ behavior: 'smooth', block: 'center' });
      row.classList.remove('flash'); void row.offsetWidth; row.classList.add('flash');
    }
  });

  // Settings
  const s = state.settings;
  $('#set-wind').value = s.kayakMaxWind;
  $('#set-wave').value = s.kayakMaxWave;
  $('#set-night').checked = s.fishNight;
  const onSettings = () => {
    const w = parseFloat($('#set-wind').value), v = parseFloat($('#set-wave').value);
    if (w > 0) s.kayakMaxWind = w;
    if (v > 0) s.kayakMaxWave = v;
    s.fishNight = $('#set-night').checked;
    store.set('settings', s);
    if (state.data) { const raw = state.data.raw, fetched = state.data.fetched; state.data = process(raw, state.place); state.data.raw = raw; state.data.fetched = fetched; render(); }
  };
  ['#set-wind', '#set-wave', '#set-night'].forEach(id => $(id).addEventListener('change', onSettings));
}

function selectPlace(p) {
  state.dayIdx = 0;
  loadPlace(p);
  renderFavs();
}

// Redraw the chart when the screen size changes (e.g. phone rotation)
let resizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => { if (state.data) renderDay(); }, 200);
});

// ---------- start ----------
bind();
renderFavs();
renderHeader();
if (state.place) loadPlace(state.place);

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

// Refresh automatically if the app is reopened after an hour or more
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && state.place && state.data && Date.now() - state.data.fetched > HOUR) {
    loadPlace(state.place, { quiet: true });
  }
});
