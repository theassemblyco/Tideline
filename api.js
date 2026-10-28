// Data access: Open-Meteo geocoding, weather forecast and marine (swell + tide) APIs.
// All free, no API key, CORS-enabled. Attribution required: "Weather data by Open-Meteo.com" (CC BY 4.0).

const GEO_URL = 'https://geocoding-api.open-meteo.com/v1/search';
const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
const MARINE_URL = 'https://marine-api.open-meteo.com/v1/marine';

export const FORECAST_DAYS = 7;

export async function searchPlaces(query) {
  const url = `${GEO_URL}?name=${encodeURIComponent(query)}&count=8&language=en&format=json`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Place search failed (${res.status})`);
  const json = await res.json();
  return (json.results || []).map(p => ({
    name: p.name,
    region: [p.admin1, p.country].filter(Boolean).join(', '),
    lat: round(p.latitude, 4),
    lon: round(p.longitude, 4),
  }));
}

/**
 * Fetches weather + marine data and merges them into one hourly series.
 * Returns { tzOffset, timezone, hours: [...], days: [{date, sunrise, sunset}], marineAvailable }
 * Each hour: { t (epoch ms), iso (local time string), temp, rainProb, rain, code, pressure,
 *              cloud, wind, gust, windDir, wave, wavePeriod, waveDir, swell, swellPeriod, swellDir, sea, sst }
 */
export async function getConditions(lat, lon) {
  const common = `latitude=${lat}&longitude=${lon}&timezone=auto&past_days=1&forecast_days=${FORECAST_DAYS}`;

  const wxUrl = `${FORECAST_URL}?${common}&wind_speed_unit=kmh` +
    '&hourly=temperature_2m,precipitation_probability,precipitation,weather_code,pressure_msl,cloud_cover,wind_speed_10m,wind_gusts_10m,wind_direction_10m' +
    '&daily=sunrise,sunset';
  const marineUrl = `${MARINE_URL}?${common}&cell_selection=sea` +
    '&hourly=wave_height,wave_period,wave_direction,swell_wave_height,swell_wave_period,swell_wave_direction,sea_level_height_msl,sea_surface_temperature';

  const [wxRes, marineRes] = await Promise.allSettled([fetchJson(wxUrl), fetchJson(marineUrl)]);
  if (wxRes.status !== 'fulfilled') throw wxRes.reason;
  const wx = wxRes.value;
  const marine = marineRes.status === 'fulfilled' ? marineRes.value : null;

  const tzOffset = wx.utc_offset_seconds || 0;
  const H = wx.hourly;
  const M = marine && marine.hourly ? marine.hourly : null;
  const marineIndex = new Map();
  if (M) M.time.forEach((iso, i) => marineIndex.set(iso, i));

  const hours = H.time.map((iso, i) => {
    const mi = marineIndex.get(iso);
    const m = key => (M && mi !== undefined && M[key] ? M[key][mi] : null);
    return {
      t: localIsoToEpoch(iso, tzOffset),
      iso,
      temp: H.temperature_2m[i],
      rainProb: H.precipitation_probability[i],
      rain: H.precipitation[i],
      code: H.weather_code[i],
      pressure: H.pressure_msl[i],
      cloud: H.cloud_cover[i],
      wind: H.wind_speed_10m[i],
      gust: H.wind_gusts_10m[i],
      windDir: H.wind_direction_10m[i],
      wave: m('wave_height'),
      wavePeriod: m('wave_period'),
      waveDir: m('wave_direction'),
      swell: m('swell_wave_height'),
      swellPeriod: m('swell_wave_period'),
      swellDir: m('swell_wave_direction'),
      sea: m('sea_level_height_msl'),
      sst: m('sea_surface_temperature'),
    };
  });

  const days = wx.daily.time.map((date, i) => ({
    date,
    sunrise: localIsoToEpoch(wx.daily.sunrise[i], tzOffset),
    sunset: localIsoToEpoch(wx.daily.sunset[i], tzOffset),
  }));

  const marineAvailable = !!M && hours.filter(h => h.wave != null).length > hours.length * 0.5;
  const tideAvailable = !!M && hours.filter(h => h.sea != null).length > hours.length * 0.8;

  return { tzOffset, timezone: wx.timezone, hours, days, marineAvailable, tideAvailable,
    marineError: marineRes.status === 'rejected' ? String(marineRes.reason.message || marineRes.reason) : null };
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) {
    let msg = `Request failed (${res.status})`;
    try { const j = await res.json(); if (j.reason) msg = j.reason; } catch (_) { /* ignore */ }
    throw new Error(msg);
  }
  return res.json();
}

// Open-Meteo returns local wall-clock times ("2026-10-29T14:00") plus a UTC offset.
export function localIsoToEpoch(iso, tzOffsetSec) {
  return Date.parse(iso + (iso.length === 16 ? ':00Z' : 'Z')) - tzOffsetSec * 1000;
}

function round(x, dp) { const f = 10 ** dp; return Math.round(x * f) / f; }
