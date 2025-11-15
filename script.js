const CONFIG = {
  GEOAPIFY_KEY: "c8c51c2e78994627a53673d16446af31",
  OPENWEATHER_KEY: "50467444f7e17cc0b4ab9403e447be90"
};

function el(id) { return document.getElementById(id); }
function fmtKm(m) { return (m / 1000).toFixed(2) + " km"; }
function fmtTime(sec) {
  if (sec === 0) return "0m";
  if (!sec) return "—";
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/* Map init */
const map = L.map("map", { zoomControl: true }).setView([20.5937, 78.9629], 5);
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19 }).addTo(map);
L.control.scale().addTo(map);
// START = Blue Dot
const startIcon = L.icon({
  iconUrl: "https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-blue.png",
  iconSize: [32, 48],
  iconAnchor: [16, 48],
  popupAnchor: [1, -34]
});

// END = Red Pin
const destIcon = L.icon({
  iconUrl: "https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-red.png",
  iconSize: [32, 48],
  iconAnchor: [16, 48],
  popupAnchor: [1, -34]
});

/* State */
let routeLayer = null;
let animLine = null, animMarker = null, animTimer = null;
let startMarker = null, endMarker = null;
let lastRouteBounds = null;

/* DOM refs */
const startInput = el('startInput'), endInput = el('endInput');
const startSuggest = el('startSuggest'), endSuggest = el('endSuggest');
const routeBtn = el('routeBtn'), saveBtn = el('saveRide'), toggleSaved = el('toggleSaved');
const distanceEl = el('distance'), durationEl = el('duration'), recEl = el('rec');
const startWeatherEl = el('startWeather'), endWeatherEl = el('endWeather');
const hotelsEl = el('hotels'), lastRideEl = el('lastRide');
const savedCountEl = el('savedCount'), favCountEl = el('favCount'), savedList = el('savedList');
const rideNameEl = el('rideName');
const gpsBtn = el('gpsBtn'), recenterBtn = el('recenterBtn'), swapBtn = el('swapBtn');
const themeToggle = el('themeToggle');

/* Input checks */
function checkInputs() {
  const ready = startInput.value.trim() && endInput.value.trim();
  routeBtn.disabled = !ready;
  routeBtn.classList.toggle('disabled', !ready);
  routeBtn.classList.toggle('btn-glow', ready);
}
startInput.addEventListener('input', checkInputs);
endInput.addEventListener('input', checkInputs);
checkInputs();
[startInput, endInput].forEach(i => i.addEventListener('keypress', e => { if (e.key === 'Enter' && !routeBtn.disabled) routeBtn.click(); }));

/* Autocomplete (Geoapify) */
async function geocodeAutocomplete(q) {
  if (!q || !q.trim()) return [];
  if (!CONFIG.GEOAPIFY_KEY || CONFIG.GEOAPIFY_KEY.startsWith('YOUR')) return [];
  try {
    const url = `https://api.geoapify.com/v1/geocode/autocomplete?text=${encodeURIComponent(q)}&limit=8&apiKey=${CONFIG.GEOAPIFY_KEY}`;
    const r = await fetch(url);
    if (!r.ok) return [];
    const j = await r.json();
    return j.features || [];
  } catch (e) { console.warn('autocomplete err', e); return []; }
}

function attachSuggest(input, box) {
  input.addEventListener('input', async () => {
    const q = input.value.trim();
    if (!q) { box.style.display = 'none'; return; }
    const hits = await geocodeAutocomplete(q);
    box.innerHTML = '';
    if (!hits.length) { box.style.display = 'none'; return; }
    hits.forEach(f => {
      const name = f.properties.formatted || f.properties.name || '';
      const div = document.createElement('div');
      div.textContent = name;
      div.addEventListener('click', () => {
        input.value = name;
        input.dataset.lat = f.properties.lat;
        input.dataset.lon = f.properties.lon;
        input.dataset.formatted = name;
        box.style.display = 'none';
        checkInputs();
      });
      box.appendChild(div);
    });
    box.style.display = 'block';
  });

  document.addEventListener('click', e => {
    if (e.target !== input && !box.contains(e.target)) box.style.display = 'none';
  });
}
attachSuggest(startInput, startSuggest);
attachSuggest(endInput, endSuggest);

/* Resolve location (prefers dataset lat/lon else tries geoapify then nominatim) */
async function geoapifySearch(q) {
  if (!q) return null;
  if (!CONFIG.GEOAPIFY_KEY || CONFIG.GEOAPIFY_KEY.startsWith('YOUR')) return null;
  try {
    const url = `https://api.geoapify.com/v1/geocode/search?text=${encodeURIComponent(q)}&limit=1&apiKey=${CONFIG.GEOAPIFY_KEY}`;
    const r = await fetch(url);
    if (!r.ok) return null;
    const j = await r.json();
    if (j.features && j.features[0]) {
      const p = j.features[0].properties;
      return { lat: parseFloat(p.lat), lon: parseFloat(p.lon), name: p.formatted || q };
    }
  } catch (e) { console.warn('geoapify search err', e); }
  return null;
}
async function nominatimSearch(q) {
  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}&limit=1`;
    const r = await fetch(url);
    if (!r.ok) return null;
    const j = await r.json();
    if (j && j[0]) return { lat: parseFloat(j[0].lat), lon: parseFloat(j[0].lon), name: j[0].display_name };
  } catch (e) { console.warn('nominatim err', e); }
  return null;
}
async function resolveLocation(text, inputField) {
  if (inputField.dataset.lat && inputField.dataset.lon) {
    return { lat: parseFloat(inputField.dataset.lat), lon: parseFloat(inputField.dataset.lon), name: inputField.dataset.formatted || text };
  }
  let g = await geoapifySearch(text);
  if (g) return g;
  return await nominatimSearch(text);
}

/* Routing */
routeBtn.addEventListener('click', () => findRoute(startInput.value, endInput.value));

async function findRoute(sText, eText) {
  if (!sText || !eText) return alert('Enter both locations');
  const s = await resolveLocation(sText, startInput);
  const e = await resolveLocation(eText, endInput);
  if (!s || !e) return alert('Could not resolve locations');
  setMarkers(s, e);
  await doRouting(s, e);
  fetchWeather(s, startWeatherEl, 'Start');
  fetchWeather(e, endWeatherEl, 'Dest');
  fetchHotels(e.lat, e.lon);
  lastRideEl.textContent = `${s.name || sText} → ${e.name || eText}`;
}

function setMarkers(s, e) {
  if (startMarker) map.removeLayer(startMarker);
  if (endMarker) map.removeLayer(endMarker);

  startMarker = L.marker([s.lat, s.lon], { icon: startIcon }).addTo(map).bindPopup("Start Point");
  endMarker = L.marker([e.lat, e.lon], { icon: destIcon }).addTo(map).bindPopup("Destination");

  map.fitBounds([[s.lat, s.lon], [e.lat, e.lon]], { padding: [40, 40] });
}


/* robust extraction and drawing */
function extractSummary(feat) {
  if (!feat || !feat.properties) return null;
  const p = feat.properties;
  if (typeof p.distance === 'number' && typeof p.time === 'number') return { distance: p.distance, time: p.time };
  if (p.summary && typeof p.summary.distance === 'number' && typeof p.summary.time === 'number') return { distance: p.summary.distance, time: p.summary.time };
  if (p.summary && p.summary.route && typeof p.summary.route.distance === 'number' && typeof p.summary.route.time === 'number') return { distance: p.summary.route.distance, time: p.summary.route.time };
  if (p.summary && Array.isArray(p.summary.legs)) {
    const dist = p.summary.legs.reduce((a, l) => a + (l.distance || 0), 0);
    const t = p.summary.legs.reduce((a, l) => a + (l.time || 0), 0);
    if (dist > 0) return { distance: dist, time: t };
  }
  return null;
}
function coordsFromFeature(feat) {
  if (!feat || !feat.geometry) return [];
  const g = feat.geometry;
  if (g.type === 'LineString') return g.coordinates.map(c => [c[1], c[0]]);
  if (g.type === 'MultiLineString') {
    const out = [];
    g.coordinates.forEach(seg => seg.forEach(c => out.push([c[1], c[0]])));
    return out;
  }
  // fallback if nested GeoJSON array
  if (Array.isArray(g.coordinates)) {
    return g.coordinates.flat(2).map(c => [c[1], c[0]]);
  }
  return [];
}

async function doRouting(s, e) {
  stopAnimation();
  try {
    const url = `https://api.geoapify.com/v1/routing?waypoints=${s.lat},${s.lon}|${e.lat},${e.lon}&mode=drive&details=route_details&apiKey=${CONFIG.GEOAPIFY_KEY}`;
    const r = await fetch(url);
    if (!r.ok) throw new Error('Routing API failed: ' + r.status);
    const data = await r.json();
    const feat = data.features && data.features[0];
    if (!feat) throw new Error('No route returned');

    if (routeLayer) map.removeLayer(routeLayer);
    routeLayer = L.geoJSON(feat, { style: { color: '#FF7A3A', weight: 5, opacity: 0.95 } }).addTo(map);
    lastRouteBounds = routeLayer.getBounds();
    map.fitBounds(lastRouteBounds, { padding: [30, 30] });

    const summary = extractSummary(feat);
    if (summary) {
      distanceEl.textContent = 'Distance: ' + fmtKm(summary.distance);
      durationEl.textContent = 'Estimated time: ' + fmtTime(summary.time);
      recEl.textContent = 'Recommendations: ' + getRec(summary);
    } else {
      const straight = map.distance([s.lat, s.lon], [e.lat, e.lon]);
      const est = (straight / 1000) / 60 * 3600;
      distanceEl.textContent = 'Distance (approx): ' + fmtKm(straight);
      durationEl.textContent = 'Estimated time (approx): ' + fmtTime(est);
      recEl.textContent = 'Recommendations: ' + getRec({ distance: straight, time: est });
    }

    // animate a soft trail
    const coords = coordsFromFeature(feat);
    if (coords.length > 1) animateRoute(coords);

  } catch (err) {
    console.error(err);
    distanceEl.textContent = 'Distance: —';
    durationEl.textContent = 'Estimated time: —';
    recEl.textContent = 'Recommendations: —';
    alert('Routing error — check console for details');
  }
}

/* route animation */
function animateRoute(latlngs) {
  stopAnimation();
  animLine = L.polyline([], { color: '#FFD5B8', weight: 6, opacity: 0.9 }).addTo(map);
  animMarker = L.marker(latlngs[0], { icon: L.divIcon({ className: 'anim-marker', html: '🏍️', iconSize: [28, 28], iconAnchor: [14, 14] }) }).addTo(map);
  let i = 0;
  animTimer = setInterval(() => {
    if (i >= latlngs.length) { stopAnimation(); return; }
    animLine.addLatLng(latlngs[i]);
    animMarker.setLatLng(latlngs[i]);
    i++;
  }, 12);
}
function stopAnimation() {
  if (animTimer) { clearInterval(animTimer); animTimer = null; }
  if (animMarker) { map.removeLayer(animMarker); animMarker = null; }
  if (animLine) { map.removeLayer(animLine); animLine = null; }
}

/* recommendations */
function getRec(p) {
  const km = (p.distance || 0) / 1000;
  const rec = [];
  if (km > 200) rec.push('Long ride — take breaks every 2 hours.');
  if (km > 500) rec.push('Hydrate & check tyre pressure.');
  if (km > 800) rec.push('Plan an overnight stop; avoid night riding.');
  return rec.length ? rec.join(' ') : 'No special recommendations.';
}

/* weather & hotels */
async function fetchWeather(p, box, label) {
  box.innerHTML = 'Loading...';
  if (!CONFIG.OPENWEATHER_KEY || CONFIG.OPENWEATHER_KEY.startsWith('YOUR')) { box.innerHTML = `<strong>${label}:</strong> Provide OPENWEATHER_KEY`; return; }
  try {
    const url = `https://api.openweathermap.org/data/2.5/weather?lat=${p.lat}&lon=${p.lon}&units=metric&appid=${CONFIG.OPENWEATHER_KEY}`;
    const r = await fetch(url);
    if (!r.ok) throw new Error('weather fail');
    const j = await r.json();
    const city = j.name || '';
    const desc = j.weather?.[0]?.description || 'N/A';
    const temp = j.main?.temp != null ? j.main.temp + '°C' : 'N/A';
    box.innerHTML = `<strong>${label}${city ? (' (' + city + ')') : ''}:</strong><br>${desc}, ${temp}`;
  } catch (e) { console.warn(e); box.innerHTML = `<strong>${label}:</strong> Weather unavailable`; }
}

async function fetchHotels(lat, lon) {
  hotelsEl.innerHTML = '<li>Loading...</li>';
  if (!CONFIG.GEOAPIFY_KEY || CONFIG.GEOAPIFY_KEY.startsWith('YOUR')) { hotelsEl.innerHTML = '<li>Provide GEOAPIFY_KEY</li>'; return; }
  try {
    const url = `https://api.geoapify.com/v2/places?categories=accommodation.hotel&filter=circle:${lon},${lat},5000&limit=6&apiKey=${CONFIG.GEOAPIFY_KEY}`;
    const r = await fetch(url);
    if (!r.ok) throw new Error('places fail');
    const j = await r.json();
    hotelsEl.innerHTML = '';
    if (j.features && j.features.length) {
      j.features.forEach(f => {
        const li = document.createElement('li');
        li.textContent = f.properties.name || 'Hotel';
        hotelsEl.appendChild(li);
      });
    } else hotelsEl.innerHTML = '<li>No hotels found nearby.</li>';
  } catch (e) { console.warn(e); hotelsEl.innerHTML = '<li>Failed to load hotels.</li>'; }
}

/* SAVE / RENDER saved routes */
function loadSaved() { return JSON.parse(localStorage.getItem('rides') || '[]'); }
function saveAll(arr) { localStorage.setItem('rides', JSON.stringify(arr)); renderSaved(); updateCounts(); }
function updateCounts() { const r = loadSaved(); savedCountEl.textContent = r.length; favCountEl.textContent = r.filter(x => x.favorite).length; }

function renderSaved() {
  savedList.innerHTML = '';
  const arr = loadSaved();
  if (!arr.length) {
    savedList.innerHTML = '<div class="saved-item"><div class="meta">No saved rides</div></div>';
    return;
  }
  arr.forEach((r, i) => {
    const div = document.createElement('div'); div.className = 'saved-item';
    const meta = document.createElement('div'); meta.className = 'meta';
    meta.innerHTML = `<strong>${r.name || ('Ride ' + (i + 1))}</strong><small>${r.s || r.start} → ${r.e || r.end}</small>`;
    const actions = document.createElement('div'); actions.className = 'actions';
    const go = document.createElement('button'); go.className = 'action-btn'; go.textContent = '🗺️'; go.title = 'Go'; go.onclick = () => { startInput.value = r.s || r.start; endInput.value = r.e || r.end; checkInputs(); findRoute(startInput.value, endInput.value); };
    const del = document.createElement('button'); del.className = 'action-btn'; del.textContent = '❌'; del.title = 'Delete'; del.onclick = () => { if (confirm('Delete this saved ride?')) { const arr2 = loadSaved(); arr2.splice(i, 1); saveAll(arr2); } };
    const fav = document.createElement('button'); fav.className = 'action-btn'; fav.textContent = r.favorite ? '★' : '☆'; fav.title = 'Favorite'; fav.onclick = () => { r.favorite = !r.favorite; const arr2 = loadSaved(); arr2[i] = r; saveAll(arr2); };
    actions.append(go, del, fav);
    div.append(meta, actions);
    savedList.appendChild(div);
  });
}
saveBtn.addEventListener('click', () => {
  const s = startInput.value.trim(), e = endInput.value.trim();
  if (!s || !e) return alert('Enter locations to save');
  const arr = loadSaved();
  arr.push({ name: rideNameEl.value.trim() || `${s} → ${e}`, s, e, favorite: false });
  saveAll(arr);
  rideNameEl.value = '';
  alert('Saved');
});
toggleSaved.addEventListener('click', () => {
  if (savedList.classList.contains('collapsed')) { savedList.classList.remove('collapsed'); savedList.classList.add('expanded'); toggleSaved.textContent = 'Collapse'; }
  else { savedList.classList.remove('expanded'); savedList.classList.add('collapsed'); toggleSaved.textContent = 'Expand'; }
});

/* map buttons: GPS / recenter / swap */
gpsBtn && gpsBtn.addEventListener('click', useGPS);
recenterBtn && recenterBtn.addEventListener('click', () => { if (lastRouteBounds) map.fitBounds(lastRouteBounds, { padding: [30, 30] }); else map.setView([20.5937, 78.9629], 5); });
swapBtn && swapBtn.addEventListener('click', () => { const a = startInput.value; startInput.value = endInput.value; endInput.value = a; checkInputs(); });

/* GPS */
function useGPS() {
  if (!navigator.geolocation) return alert('Geolocation not supported');
  navigator.geolocation.getCurrentPosition(async pos => {
    const lat = pos.coords.latitude, lon = pos.coords.longitude;
    // reverse quick name
    let name = `My location`;
    if (CONFIG.GEOAPIFY_KEY && !CONFIG.GEOAPIFY_KEY.startsWith('YOUR')) {
      try {
        const url = `https://api.geoapify.com/v1/geocode/reverse?lat=${lat}&lon=${lon}&apiKey=${CONFIG.GEOAPIFY_KEY}`;
        const r = await fetch(url);
        if (r.ok) { const j = await r.json(); if (j.features && j.features[0]) name = j.features[0].properties.formatted || name; }
      } catch (e) { }
    }
    startInput.value = name;
    startInput.dataset.lat = lat;
    startInput.dataset.lon = lon;
    checkInputs();
    map.setView([lat, lon], 14);
    if (startMarker) map.removeLayer(startMarker);
    startMarker = L.marker([lat, lon]).addTo(map).bindPopup('You are here').openPopup();
  }, err => alert('Geolocation error: ' + (err.message || err.code)), { enableHighAccuracy: true });
}

/* theme toggle */
themeToggle && themeToggle.addEventListener('click', () => {
  document.body.classList.toggle('light');
  themeToggle.textContent = document.body.classList.contains('light') ? '🌞' : '🌙';
});

/* fallback if click outside to hide suggest — handled, but ensure visibility style */
document.addEventListener('click', e => {
  if (!startSuggest.contains(e.target) && e.target !== startInput) startSuggest.style.display = 'none';
  if (!endSuggest.contains(e.target) && e.target !== endInput) endSuggest.style.display = 'none';
});

/* Clean up animation on interaction */
map.on('movestart', () => stopAnimation());
map.on('click', () => stopAnimation());

/* Init render */
renderSaved();
updateCounts();
