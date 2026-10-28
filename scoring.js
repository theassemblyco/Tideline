// Hour-by-hour scoring for fishing and kayaking.
// Each factor returns 0..1, is multiplied by its weight, and the total (0..100) is then
// reduced by any safety multipliers (storms, strong wind, darkness for paddling, etc.).
// Tweak the weights and thresholds here to suit your spots and target species.

import { solunarStrength, moonPhase } from './astro.js';

export const DEFAULT_SETTINGS = {
  kayakMaxWind: 20,     // km/h – wind above this starts to make paddling hard work
  kayakMaxWave: 1.0,    // m    – significant wave height above this is uncomfortable/unsafe
  fishNight: true,      // include night hours when ranking fishing windows
};

const HOUR = 3600 * 1000;
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
/** 1 at or below `good`, falling linearly to 0 at `bad`. */
const ramp = (x, good, bad) => clamp(1 - (x - good) / (bad - good));

const STORM_CODES = new Set([95, 96, 99]);

/** Light condition at time t: 'dawn', 'dusk', 'day', 'twilight', 'night'. */
export function lightAt(t, days) {
  for (const d of days) {
    if (Math.abs(t - d.sunrise) <= 1.5 * HOUR) return 'dawn';
    if (Math.abs(t - d.sunset) <= 1.5 * HOUR) return 'dusk';
  }
  for (const d of days) {
    if (t > d.sunrise && t < d.sunset) return 'day';
  }
  return 'night';
}

function isDaylight(t, days, marginH = 0.5) {
  return days.some(d => t >= d.sunrise - marginH * HOUR && t <= d.sunset + marginH * HOUR);
}

function pressureTrend(hours, i) {
  const j = Math.max(0, i - 3);
  if (hours[i].pressure == null || hours[j].pressure == null || i === j) return 0;
  return (hours[i].pressure - hours[j].pressure) * 3 / (i - j); // hPa per 3 h
}

export function scoreFishing(hours, i, ctx) {
  const hr = hours[i];
  const { days, solunar, tideOk, settings } = ctx;
  const f = [];

  // Solunar period
  f.push({ key: 'solunar', label: 'Solunar', weight: 22, v: solunarStrength(solunar, hr.t) });

  // Tide: moving water is best; a bonus for the 2 h either side of high tide
  if (tideOk) {
    const nearHigh = hr.hrsFromHigh == null ? 0 : ramp(Math.abs(hr.hrsFromHigh), 1, 3);
    f.push({ key: 'tide', label: 'Tide', weight: 25, v: clamp(0.65 * hr.tideFlow + 0.35 * nearHigh) });
  }

  // Light: dawn & dusk feeding times
  const light = lightAt(hr.t, days);
  const lightV = { dawn: 1, dusk: 1, night: 0.45, day: 0.35 }[light];
  f.push({ key: 'light', label: light === 'dawn' || light === 'dusk' ? `${cap(light)}` : 'Light', weight: 20, v: lightV });

  // Barometric pressure trend: steady or slowly falling is good, rapidly rising (post-front) is poor
  const dp = pressureTrend(hours, i);
  let pV;
  if (dp <= -3) pV = 0.5;
  else if (dp < -0.5) pV = 1;
  else if (dp <= 0.5) pV = 0.75;
  else if (dp <= 1.5) pV = 0.5;
  else pV = 0.25;
  f.push({ key: 'pressure', label: 'Pressure', weight: 10, v: pV });

  // Moon phase: new and full moons bring bigger tides and stronger solunar influence
  f.push({ key: 'moon', label: 'Moon phase', weight: 10, v: moonPhase(hr.t).strength });

  // Comfort: light-to-moderate wind and little rain
  const comfort = 0.6 * ramp(hr.wind, 15, 35) + 0.4 * ramp(hr.rain ?? 0, 0.5, 5);
  f.push({ key: 'weather', label: 'Weather', weight: 13, v: comfort });

  return finish(f, hr, {
    mult: [
      [STORM_CODES.has(hr.code), 0.25, 'Thunderstorm risk'],
      [hr.gust > 50, 0.5, 'Strong gusts'],
      [hr.wind > 35, 0.6, 'Strong wind'],
      [(hr.rain ?? 0) > 8, 0.6, 'Heavy rain'],
      [!settings.fishNight && light === 'night', 0, 'Night (excluded)'],
    ],
  });
}

export function scoreKayaking(hours, i, ctx) {
  const hr = hours[i];
  const { days, tideOk, settings, marineOk } = ctx;
  const maxW = settings.kayakMaxWind, maxWave = settings.kayakMaxWave;
  const f = [];

  f.push({ key: 'wind', label: 'Wind', weight: 35, v: ramp(hr.wind, maxW * 0.45, maxW * 1.3) });
  f.push({ key: 'gust', label: 'Gusts', weight: 10, v: ramp(hr.gust, maxW * 0.9, maxW * 2) });
  if (marineOk && hr.wave != null) {
    f.push({ key: 'waves', label: 'Waves', weight: 20, v: ramp(hr.wave, maxWave * 0.3, maxWave * 1.4) });
  }
  if (tideOk) f.push({ key: 'tide', label: 'Gentle tide', weight: 10, v: 1 - 0.7 * hr.tideFlow });
  f.push({ key: 'rain', label: 'Dry', weight: 10, v: ramp(hr.rainProb ?? 0, 20, 80) });
  const light = lightAt(hr.t, days);
  const daylight = isDaylight(hr.t, days);
  f.push({ key: 'light', label: 'Daylight', weight: 15, v: daylight ? (light === 'day' ? 1 : 0.85) : 0 });

  return finish(f, hr, {
    mult: [
      [STORM_CODES.has(hr.code), 0.1, 'Thunderstorm risk'],
      [!daylight, 0.3, 'Dark'],
      [hr.wind > maxW * 1.5, 0.3, 'Too windy'],
      [hr.gust > Math.max(40, maxW * 2.2), 0.4, 'Strong gusts'],
      [marineOk && hr.wave != null && hr.wave > maxWave * 1.5, 0.3, 'Big seas'],
    ],
  });
}

function finish(factors, hr, { mult }) {
  const wSum = factors.reduce((s, x) => s + x.weight, 0);
  let score = factors.reduce((s, x) => s + x.v * x.weight, 0) / wSum * 100;
  const warnings = [];
  for (const [cond, m, label] of mult) {
    if (cond) { score *= m; warnings.push(label); }
  }
  return { score: Math.round(score), factors, warnings };
}

export function rating(score) {
  if (score >= 75) return { label: 'Excellent', cls: 'r-excellent' };
  if (score >= 60) return { label: 'Good', cls: 'r-good' };
  if (score >= 45) return { label: 'Fair', cls: 'r-fair' };
  return { label: 'Poor', cls: 'r-poor' };
}

/** Best windows within a list of scored hours (all from one day). */
export function bestWindows(dayHours, maxWindows = 3) {
  if (!dayHours.length) return [];
  const peak = Math.max(...dayHours.map(h => h.result.score));
  if (peak < 35) return [];
  const threshold = Math.max(45, peak - 10);
  const windows = [];
  let cur = null;
  dayHours.forEach((h, idx) => {
    const ok = h.result.score >= threshold;
    if (ok && cur && idx === cur.lastIdx + 1) {
      cur.hours.push(h); cur.lastIdx = idx;
    } else if (ok) {
      cur = { hours: [h], lastIdx: idx };
      windows.push(cur);
    }
  });
  return windows
    .map(w => {
      const best = w.hours.reduce((a, b) => (b.result.score > a.result.score ? b : a));
      return {
        start: w.hours[0].t,
        end: w.hours[w.hours.length - 1].t + HOUR,
        peak: best.result.score,
        reasons: topReasons(w.hours),
      };
    })
    .sort((a, b) => b.peak - a.peak)
    .slice(0, maxWindows)
    .sort((a, b) => a.start - b.start);
}

function topReasons(hours) {
  // Average each factor across the window and report the strongest contributors
  const acc = {};
  for (const h of hours) for (const f of h.result.factors) {
    acc[f.key] = acc[f.key] || { label: f.label, sum: 0, w: f.weight };
    acc[f.key].sum += f.v;
    acc[f.key].label = f.label;
  }
  return Object.values(acc)
    .map(a => ({ label: a.label, v: a.sum / hours.length, w: a.w }))
    .filter(a => a.v >= 0.7)
    .sort((a, b) => b.v * b.w - a.v * a.w)
    .slice(0, 3)
    .map(a => a.label);
}

/** Day summary score: best 3-hour rolling average. */
export function dayScore(dayHours) {
  if (!dayHours.length) return 0;
  let best = 0;
  for (let i = 0; i <= Math.max(0, dayHours.length - 3); i++) {
    const w = dayHours.slice(i, i + 3);
    best = Math.max(best, w.reduce((s, h) => s + h.result.score, 0) / w.length);
  }
  return Math.round(best);
}

function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
