# 🚀 TrailPilot

![TrailPilot Animated Logo](./trailpilot-logo.svg)

**TrailPilot** — Smart Rider’s Travel Planner: a lightweight web app for planning rides, checking weather, saving routes and viewing nearby hotels on an interactive map built with Leaflet, Geoapify and OpenWeather.

## Quick Links
- Live demo: (add your GitHub Pages URL here)
- Repo: (your repo URL)

## Features
- Autocomplete location search (Geoapify)
- Turn-by-turn routing (Geoapify Routing)
- Start/destination weather (OpenWeather)
- Nearby hotels (Geoapify Places)
- Save / edit / delete saved rides (localStorage)
- Clean dark UI with smooth animations
- Responsive layout

## Setup (local)
1. Clone the repo:
```bash
git clone https://github.com/<your-username>/<your-repo>.git
cd <your-repo>
```

2. Add your API keys in `config.js` or at top of `script.js`:
```js
const CONFIG = {
  GEOAPIFY_KEY: "your_geoapify_key",
  OPENWEATHER_KEY: "your_openweather_key"
};
```

3. Open `index.html` in a browser (or host via a simple HTTP server):
```bash
# python3
python -m http.server 5500
```

## Deployment
Deploy to GitHub Pages (Settings → Pages → Branch: `main` `/root`) or any static host (Netlify, Vercel, Surge).

**Important:** Because this is a client-side app, API keys in the browser are visible. Restrict them by domain in provider console and rotate keys as needed.

## Files
- `index.html` — main page
- `styles.css` — UI styles
- `script.js` — app logic
- `trailpilot-logo.svg` — animated logo (included)

## License
MIT — feel free to reuse and modify for personal projects / portfolio.

---
Made with ❤️ by **Aarish**
