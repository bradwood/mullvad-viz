/* Mullvad Viz - frontend script
   - Hash-based navigation: #/map, #/ownership, #/protocols
   - Fetches data from /api/relays and renders:
     - Map (Leaflet)
     - Ownership chart (Chart.js)
     - Protocols chart (Chart.js)
*/

let mapInstance;
let markersLayer;
let ownershipChartInstance;
let protocolChartInstance;

// Fetch relays data from backend
async function fetchRelays() {
  try {
    const res = await fetch('/api/relays');
    if (res.ok) {
      const data = await res.json();
      return Array.isArray(data) ? data : [];
    }
  } catch (e) {
    console.warn('Failed to fetch relays data:', e);
  }
  return [];
}

 // Initialize Leaflet map
function ensureMap() {
  if (!mapInstance) {
    mapInstance = L.map('map').setView([20, 0], 2);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors'
    }).addTo(mapInstance);
    // Use marker cluster group for scalable rendering of many servers
    // chunkedLoading improves performance for very large datasets
    markersLayer = L.markerClusterGroup ? L.markerClusterGroup({ chunkedLoading: true }) : L.layerGroup();
    markersLayer.addTo(mapInstance);
  }
  return mapInstance;
}

 // Render markers for relays
function renderMap(relays) {
  const map = ensureMap();
  // markerClusterGroup and LayerGroup both support clearLayers()
  if (markersLayer && typeof markersLayer.clearLayers === 'function') markersLayer.clearLayers();

  if (!Array.isArray(relays)) return;

  const coords = [];

  relays.forEach(r => {
    // Skip relays with unresolved coordinates (null) or invalid numbers.
    if (r.lat == null || r.lon == null) return;
    const lat = Number(r.lat);
    const lon = Number(r.lon);
    // Skip non-finite or explicit 0,0 fallbacks.
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || (lat === 0 && lon === 0)) return;

    const ownership = (r.ownership || 'Mullvad').toString();
    const isActive = (typeof r.active === 'boolean') ? r.active : true;

    // color by ownership when active, gray when offline
    const color = !isActive ? '#9ca3af' : (ownership.toLowerCase() === 'mullvad' ? '#1f78b4' : '#6b7280');
    const fillOpacity = isActive ? 0.95 : 0.5;
    const radius = isActive ? 6 : 5;

    // Create a small circle marker; wrap in a regular Marker for clustering compatibility
    const circle = L.circleMarker([lat, lon], {
      radius: radius,
      color: color,
      fillColor: color,
      fillOpacity: fillOpacity,
      weight: 1,
      opacity: isActive ? 1 : 0.7
    });

    // Use a lightweight tooltip (shows on hover) and a richer popup on click
    const tooltipText = `${r.id || r.city || 'Server'} — ${r.country || ''} ${isActive ? '• Online' : '• Offline'}`;
    circle.bindTooltip(tooltipText, { direction: 'top', offset: [0, -6], permanent: false, opacity: 0.9 });

    const popupContent = `
      <div style="font-size:13px;">
        <strong style="display:block;margin-bottom:6px;">${r.id || r.city || 'Server'}</strong>
        <div>${r.city ? `${r.city}` : ''} ${r.country ? (r.countryCode ? `(${r.countryCode})` : '') : ''}</div>
        <div style="margin-top:6px;"><strong>Ownership:</strong> ${ownership}</div>
        <div><strong>Status:</strong> ${isActive ? 'Online' : 'Offline'}</div>
        <div><strong>Protocols:</strong> ${Array.isArray(r.protocols) && r.protocols.length ? r.protocols.join(', ') : 'N/A'}</div>
      </div>
    `;
    circle.bindPopup(popupContent, { maxWidth: 320 });

    // Add to cluster / layer group
    if (markersLayer && typeof markersLayer.addLayer === 'function') markersLayer.addLayer(circle);
    else circle.addTo(map);

    coords.push([lat, lon]);
  });

  // Fit bounds if possible with padding and a conservative max zoom
  if (coords.length) {
    const bounds = coords.map(c => L.latLng(c[0], c[1]));
    if (bounds.length > 0) {
      try {
        map.fitBounds(bounds, { padding: [60, 60], maxZoom: 8 });
      } catch (e) {
        // ignore fit errors
      }
    }
  }
}

// Ownership chart
function renderOwnership(relays) {
  const counts = { Mullvad: 0, Rented: 0 };
  relays.forEach(r => {
    const v = (r.ownership || 'Mullvad').toString().toLowerCase();
    if (v === 'mullvad') counts.Mullvad += 1;
    else if (v === 'rented') counts.Rented += 1;
    else counts.Mullvad += 1;
  });

  const ctx = document.getElementById('ownershipChart').getContext('2d');
  if (ownershipChartInstance) ownershipChartInstance.destroy();
  ownershipChartInstance = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: ['Mullvad', 'Rented'],
      datasets: [{
        data: [counts.Mullvad, counts.Rented],
        backgroundColor: ['#1f78b4', '#6b7280']
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { position: 'bottom' } }
    }
  });
}

// Protocols chart
function renderProtocols(relays) {
  const countOpenVPN = relays.filter(r =>
    Array.isArray(r.protocols) &&
    r.protocols.map(p => p.toString().toLowerCase()).includes('openvpn')
  ).length;

  const countWireGuard = relays.filter(r =>
    Array.isArray(r.protocols) &&
    r.protocols.map(p => p.toString().toLowerCase()).includes('wireguard')
  ).length;

  const ctx = document.getElementById('protocolChart').getContext('2d');
  if (protocolChartInstance) protocolChartInstance.destroy();
  protocolChartInstance = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: ['OpenVPN', 'WireGuard'],
      datasets: [{
        label: '# of servers',
        data: [countOpenVPN, countWireGuard],
        backgroundColor: ['#3b82f6', '#10b981']
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        y: { beginAtZero: true }
      }
    }
  });
}

// Hash-based navigation
function updateActiveNav(hash) {
  document.querySelectorAll('.nav-link').forEach(n => n.classList.remove('active'));
  const mapNav = document.getElementById('nav-map');
  const ownershipNav = document.getElementById('nav-ownership');
  const protocolsNav = document.getElementById('nav-protocols');
  switch (hash) {
    case '#/ownership':
      ownershipNav.classList.add('active');
      break;
    case '#/protocols':
      protocolsNav.classList.add('active');
      break;
    default:
      mapNav.classList.add('active');
  }
}

function showView(hash) {
  document.getElementById('view-map').style.display = (hash === '#/map') ? 'block' : 'none';
  document.getElementById('view-ownership').style.display = (hash === '#/ownership') ? 'block' : 'none';
  document.getElementById('view-protocols').style.display = (hash === '#/protocols') ? 'block' : 'none';
}

function onHashChange() {
  const hash = location.hash || '#/map';
  showView(hash);
  updateActiveNav(hash);
}

async function init() {
  const relays = await fetchRelays();
  renderMap(relays);
  renderOwnership(relays);
  renderProtocols(relays);
  window.addEventListener('hashchange', onHashChange);
  onHashChange();
}

document.addEventListener('DOMContentLoaded', init);
