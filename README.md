# Tideline – best times to fish or kayak

An installable web app (PWA) that pulls together **tides, solunar periods, moon phase, weather and swell** and gives
you an hour-by-hour score for the next 7 days at any location, with separate scores for **fishing** and **kayaking**.

- Search any place, paste coordinates from Google Maps (`-25.917, 153.003`), or use your current location
- Star spots to save them as favourites
- 7-day strip with a daily score and the moon phase
- Best windows for each day, with the reasons (e.g. "Tide · Solunar · Dusk")
- Chart of hourly scores with the tide curve, solunar periods and night shading
- Hourly table: tide, wind and gusts, waves, rain, pressure, warnings
- Works offline with the last forecast you loaded
- No API keys, no accounts, no server, no build step

## Put it on GitHub and install it on your phone

1. Create a new repository on GitHub (e.g. `tideline`). Public is simplest; GitHub Pages on private repos needs a paid plan.
2. Upload these files: on the new repo page click **uploading an existing file**, drag in everything from this folder
   (keep the folder structure), and commit.
   Or with git:
   ```bash
   git remote add origin https://github.com/<your-username>/tideline.git
   git push -u origin main
   ```
3. In the repo go to **Settings → Pages**, set **Source: Deploy from a branch**, branch **main**, folder **/ (root)**, and save.
4. After a minute the app is live at `https://<your-username>.github.io/tideline/`.
5. Install it:
   - **Android (Chrome):** open the link → ⋮ menu → **Install app** / **Add to Home screen**
   - **iPhone (Safari):** open the link → Share → **Add to Home Screen**
   - **Windows/Mac (Chrome or Edge):** click the install icon in the address bar

It then opens full-screen like a normal app, with its own icon.

### Run it on your computer instead
Because it uses a service worker it needs to be served over http, not opened as a file:
```bash
cd tideline
python -m http.server 8000
# then open http://localhost:8000
```

## How the scores work

Every hour gets a 0–100 score from weighted factors, then safety penalties are applied. All of this lives in
[`js/scoring.js`](js/scoring.js) — change the weights and thresholds to suit your spots and target species.

**Fishing**

| Factor | Weight | Best when |
|---|---|---|
| Tide | 25 | Water is moving hard, with a bonus 2 h either side of high tide |
| Solunar | 22 | Inside a major (moon overhead/underfoot, ±1 h) or minor (moonrise/moonset, ±30 min) period |
| Light | 20 | Within 1.5 h of sunrise or sunset |
| Weather | 13 | Wind under 15 km/h and little rain |
| Pressure | 10 | Steady or slowly falling barometer (rapid rise after a front scores low) |
| Moon phase | 10 | Near new or full moon (bigger tides) |

Penalties: thunderstorms, gusts over 50 km/h, wind over 35 km/h, heavy rain, and night (if you switch night off in Settings).

**Kayaking**

| Factor | Weight | Best when |
|---|---|---|
| Wind | 35 | Below about half your "max comfortable wind" setting |
| Daylight | 15 | Daytime |
| Waves | 20 | Below about a third of your "max comfortable waves" setting |
| Gusts | 10 | Gusts close to the mean wind |
| Tide | 10 | Slack or gentle tidal flow |
| Dry | 10 | Low chance of rain |

Penalties: thunderstorms, darkness, wind or waves well beyond your limits.

Ratings: **75+ Excellent**, **60+ Good**, **45+ Fair**, otherwise Poor.

## Data sources

| What | Source |
|---|---|
| Place search | [Open-Meteo Geocoding API](https://open-meteo.com/en/docs/geocoding-api) |
| Weather, wind, pressure, rain, sunrise/sunset | [Open-Meteo Forecast API](https://open-meteo.com/en/docs) |
| Waves, swell, water temperature, sea level (tides) | [Open-Meteo Marine API](https://open-meteo.com/en/docs/marine-weather-api) |
| Moon position, phase, rise/set, solunar periods | Calculated in the app with [SunCalc](https://github.com/mourner/suncalc) (BSD-2, `vendor/`) |

Open-Meteo is free for non-commercial use with attribution (kept in the app footer).

### About the tides
High and low tide times come from Open-Meteo's modelled sea level, taken from the nearest open-water grid cell
(about 8 km). On open coast this is usually close, but **inside rivers, estuaries and enclosed bays the real tide can be
an hour or more later and a different height**. Use the tide line as a guide to *when the water is moving*, and check the
official [BOM tide predictions](http://www.bom.gov.au/australia/tides/) or MSQ tables before you rely on it.
**Not for navigation.**

If you later want port-accurate tide times, a tide API such as WorldTides or Stormglass can be swapped in by
replacing the `sea` values in `js/api.js`.

## Project layout

```
index.html            App page
css/style.css         Styles (light and dark mode)
js/app.js             UI, favourites, settings, chart and table
js/api.js             Open-Meteo requests
js/tides.js           High/low tide detection and tidal flow
js/astro.js           Moon phase, moon events, solunar periods
js/scoring.js         Fishing and kayaking scoring – tweak me
vendor/suncalc.js     Moon/sun maths library
sw.js                 Service worker (offline support)
manifest.webmanifest  Install details (name, icons, colours)
icons/                App icons
```

When you change any file, bump `VERSION` in `sw.js` so installed copies update.
