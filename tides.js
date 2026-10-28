// Tide analysis from the hourly modelled sea level (Open-Meteo marine "sea_level_height_msl").
// The model is ~8 km resolution and includes tides + surge, so times/heights are approximate,
// especially inside estuaries, rivers and enclosed bays. Not for navigation.

const HOUR = 3600 * 1000;

/**
 * Adds to each hour:
 *   tideFlow   0..1  how hard the tide is running relative to the local tidal cycle
 *   tideDir    'rising' | 'falling'
 *   hrsToHigh  hours to the nearest high tide (signed: negative = before high)
 * Returns { extremes: [{type:'high'|'low', t, h}], ok }
 */
export function analyseTides(hours) {
  const h = hours.map(x => x.sea);
  const valid = h.filter(v => v != null).length;
  if (valid < h.length * 0.8) return { ok: false, extremes: [] };

  // Fill isolated gaps by linear interpolation
  for (let i = 0; i < h.length; i++) {
    if (h[i] == null) {
      let a = i - 1; while (a >= 0 && h[a] == null) a--;
      let b = i + 1; while (b < h.length && h[b] == null) b++;
      if (a >= 0 && b < h.length) h[i] = h[a] + (h[b] - h[a]) * (i - a) / (b - a);
      else h[i] = a >= 0 ? h[a] : h[b];
    }
  }

  // High / low waters with parabolic interpolation between hourly samples
  const extremes = [];
  for (let i = 1; i < h.length - 1; i++) {
    const a = h[i - 1], b = h[i], c = h[i + 1];
    const isHigh = b > a && b >= c;
    const isLow = b < a && b <= c;
    if (!isHigh && !isLow) continue;
    const denom = a - 2 * b + c;
    const off = denom !== 0 ? 0.5 * (a - c) / denom : 0;
    extremes.push({ type: isHigh ? 'high' : 'low', t: hours[i].t + off * HOUR, h: b - 0.25 * (a - c) * off });
  }
  // Drop tiny wiggles (surge noise) – keep alternating extremes with > 5 cm difference
  const clean = [];
  for (const e of extremes) {
    const last = clean[clean.length - 1];
    if (last && last.type === e.type) {
      if ((e.type === 'high' && e.h > last.h) || (e.type === 'low' && e.h < last.h)) clean[clean.length - 1] = e;
    } else if (last && Math.abs(e.h - last.h) < 0.05) {
      clean.pop();
    } else {
      clean.push(e);
    }
  }

  // Rate of change, normalised against the strongest flow within ±7 h (roughly one tidal half-cycle each side)
  const rate = h.map((_, i) => {
    const a = h[Math.max(0, i - 1)], c = h[Math.min(h.length - 1, i + 1)];
    const span = Math.min(h.length - 1, i + 1) - Math.max(0, i - 1);
    return (c - a) / span;
  });
  hours.forEach((hr, i) => {
    let max = 0;
    for (let j = Math.max(0, i - 7); j <= Math.min(h.length - 1, i + 7); j++) max = Math.max(max, Math.abs(rate[j]));
    hr.tideFlow = max > 0 ? Math.abs(rate[i]) / max : 0;
    hr.tideDir = rate[i] >= 0 ? 'rising' : 'falling';
    hr.seaFilled = h[i];
    let near = null;
    for (const e of clean) {
      if (e.type !== 'high') continue;
      const d = (hr.t - e.t) / HOUR;
      if (near === null || Math.abs(d) < Math.abs(near)) near = d;
    }
    hr.hrsFromHigh = near;
  });

  return { ok: true, extremes: clean };
}
