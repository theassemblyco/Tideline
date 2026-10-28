// Moon phase and solunar periods, computed locally with SunCalc (vendor/suncalc.js, loaded globally).
//
// Solunar theory (John Alden Knight): fish and game are most active when the moon is
//  - directly overhead (transit) or directly underfoot  -> MAJOR periods (~2 h)
//  - rising or setting                                  -> MINOR periods (~1 h)

const SunCalc = globalThis.SunCalc;
const RAD = Math.PI / 180;
const MOON_HORIZON = 0.133 * RAD; // apparent horizon for the moon's centre (as used by SunCalc)
const STEP = 5 * 60 * 1000;       // sample every 5 minutes

/** All moon events between startMs and endMs: rise, set, transit (overhead), underfoot. */
export function moonEvents(lat, lon, startMs, endMs) {
  const t = [], alt = [];
  for (let ms = startMs - STEP; ms <= endMs + STEP; ms += STEP) {
    t.push(ms);
    alt.push(SunCalc.getMoonPosition(new Date(ms), lat, lon).altitude);
  }
  const events = [];
  for (let i = 1; i < t.length - 1; i++) {
    const a0 = alt[i - 1], a1 = alt[i], a2 = alt[i + 1];
    // Horizon crossings between i and i+1
    if ((a1 - MOON_HORIZON) * (a2 - MOON_HORIZON) < 0 || a1 === MOON_HORIZON) {
      const f = (MOON_HORIZON - a1) / (a2 - a1);
      events.push({ type: a2 > a1 ? 'rise' : 'set', t: t[i] + f * STEP });
    }
    // Upper / lower culmination (parabolic refinement)
    if ((a1 > a0 && a1 >= a2) || (a1 < a0 && a1 <= a2)) {
      const denom = a0 - 2 * a1 + a2;
      const off = denom !== 0 ? 0.5 * (a0 - a2) / denom : 0;
      events.push({ type: a1 > a0 ? 'transit' : 'underfoot', t: t[i] + off * STEP, alt: a1 });
    }
  }
  return events.filter(e => e.t >= startMs && e.t <= endMs).sort((a, b) => a.t - b.t);
}

/** Solunar periods derived from moon events. */
export function solunarPeriods(events) {
  return events.map(e => {
    const major = e.type === 'transit' || e.type === 'underfoot';
    const half = major ? 60 : 30; // minutes either side
    return {
      kind: major ? 'major' : 'minor',
      source: e.type,
      centre: e.t,
      start: e.t - half * 60000,
      end: e.t + half * 60000,
    };
  });
}

/** 0..1 solunar strength at time ms (1 = centre of a major period). */
export function solunarStrength(periods, ms) {
  let best = 0;
  for (const p of periods) {
    const dtMin = Math.abs(ms - p.centre) / 60000;
    // Peak at centre, fading to zero at twice the period half-width
    const half = p.kind === 'major' ? 60 : 30;
    const peak = p.kind === 'major' ? 1 : 0.7;
    const v = peak * Math.max(0, 1 - Math.max(0, dtMin - half * 0.5) / (half * 1.5));
    if (v > best) best = v;
  }
  return best;
}

export function moonPhase(ms) {
  const { fraction, phase } = SunCalc.getMoonIllumination(new Date(ms));
  return { fraction, phase, name: phaseName(phase), strength: (1 + Math.cos(4 * Math.PI * phase)) / 2 };
}

function phaseName(p) {
  if (p < 0.0339 || p >= 0.9661) return 'New moon';
  if (p < 0.2161) return 'Waxing crescent';
  if (p < 0.2839) return 'First quarter';
  if (p < 0.4661) return 'Waxing gibbous';
  if (p < 0.5339) return 'Full moon';
  if (p < 0.7161) return 'Waning gibbous';
  if (p < 0.7839) return 'Last quarter';
  return 'Waning crescent';
}

/** Small SVG of the moon's appearance. Mirrored in the southern hemisphere. */
export function moonSvg(phase, size = 22, southern = false) {
  const r = 10, c = 12;
  const k = Math.cos(2 * Math.PI * phase);
  const rx = Math.abs(k) * r;
  const waxing = phase < 0.5;
  const crescent = k > 0; // terminator on the same side as the lit limb
  let d;
  if (waxing) {
    d = `M${c} ${c - r} A${r} ${r} 0 0 1 ${c} ${c + r} A${rx} ${r} 0 0 ${crescent ? 0 : 1} ${c} ${c - r}Z`;
  } else {
    d = `M${c} ${c - r} A${r} ${r} 0 0 0 ${c} ${c + r} A${rx} ${r} 0 0 ${crescent ? 1 : 0} ${c} ${c - r}Z`;
  }
  const flip = southern ? ` transform="translate(24 0) scale(-1 1)"` : '';
  return `<svg class="moon" width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true">` +
    `<circle cx="${c}" cy="${c}" r="${r}" class="moon-dark"/>` +
    `<path d="${d}" class="moon-lit"${flip}/></svg>`;
}
