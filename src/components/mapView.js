/**
 * Trip Weather System - Map View Component
 * Leaflet map with multi-colored comfort segments, animated wind vectors,
 * sample point weather badges, and interactive inspection popups.
 */

import L from 'leaflet';

export class MapView {
  constructor(containerId) {
    this.containerId = containerId;
    this.map = null;
    this.routeLayers = [];
    this.markerLayers = [];
    this.activePointMarker = null;
    this.currentLocationMarker = null;
    this.initMap();
  }

  initMap() {
    const container = document.getElementById(this.containerId);
    if (!container) return;

    // Use CartoDB Dark Matter for sleek modern dark styling
    // Center default map view on India
    this.map = L.map(this.containerId, {
      zoomControl: true,
      attributionControl: false
    }).setView([22.5937, 78.9629], 5);

    // 100% Free OpenStreetMap Base Layer - No API Key Required
    const osmLayer = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    });

    // Dark Navigation Map Layer - No API Key Required
    const darkLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 16,
      attribution: 'Tiles &copy; Esri'
    });

    // Default to OpenStreetMap
    osmLayer.addTo(this.map);

    // Add clean layer switcher
    const baseMaps = {
      "🗺️ OpenStreetMap": osmLayer,
      "🌙 Dark Navigation": darkLayer
    };
    L.control.layers(baseMaps, null, { position: 'topright' }).addTo(this.map);

    L.control.attribution({ position: 'bottomright' })
      .addAttribution('&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> | Open-Meteo')
      .addTo(this.map);
  }

  clearLayers() {
    this.routeLayers.forEach(layer => this.map.removeLayer(layer));
    this.markerLayers.forEach(layer => this.map.removeLayer(layer));
    if (this.currentLocationMarker) {
      this.map.removeLayer(this.currentLocationMarker);
      this.currentLocationMarker = null;
    }
    this.routeLayers = [];
    this.markerLayers = [];
  }

  renderTrip(tripData, onPointClick) {
    if (!this.map) return;
    this.clearLayers();

    const { route, alternativeRoute, scoredPoints, vehicleProfile } = tripData;
    if (!route || !route.coordinates || route.coordinates.length === 0) return;

    // 1. If alternative route exists, render it with dashed secondary line
    if (alternativeRoute && alternativeRoute.coordinates) {
      const altPolyline = L.polyline(alternativeRoute.coordinates, {
        color: '#64748b',
        weight: 4,
        dashArray: '6, 8',
        opacity: 0.65
      }).addTo(this.map);
      altPolyline.bindTooltip(`Alternative Route (${alternativeRoute.distanceKm} km)`, { sticky: true });
      this.routeLayers.push(altPolyline);
    }

    // 2. Draw Primary Route with dynamic segment comfort coloring
    if (scoredPoints && scoredPoints.length > 1) {
      this.renderComfortSegments(route.coordinates, scoredPoints);
    } else {
      const baseLine = L.polyline(route.coordinates, {
        color: '#3b82f6',
        weight: 6,
        opacity: 0.85
      }).addTo(this.map);
      this.routeLayers.push(baseLine);
    }

    // 3. Render Sample Point Markers
    if (scoredPoints && scoredPoints.length > 0) {
      scoredPoints.forEach((pt, _index) => {
        const marker = this.createPointMarker(pt, vehicleProfile, onPointClick);
        marker.addTo(this.map);
        this.markerLayers.push(marker);
      });
    }

    // 4. Fit bounds
    const bounds = L.latLngBounds(route.coordinates);
    this.map.fitBounds(bounds, { padding: [40, 40] });
  }

  renderComfortSegments(coordinates, scoredPoints) {
    // Segment coordinates by nearest sample points to color each leg by its comfort score
    for (let i = 0; i < scoredPoints.length - 1; i++) {
      const ptA = scoredPoints[i];
      const ptB = scoredPoints[i + 1];
      const legScore = Math.min(ptA.pointScore, ptB.pointScore);

      const color = this.getScoreColor(legScore);
      const subCoords = coordinates.slice(ptA.index, ptB.index + 1);

      if (subCoords.length >= 2) {
        // Outer glow
        const glow = L.polyline(subCoords, {
          color,
          weight: 9,
          opacity: 0.35,
          lineCap: 'round',
          lineJoin: 'round'
        }).addTo(this.map);
        this.routeLayers.push(glow);

        // Core line
        const core = L.polyline(subCoords, {
          color,
          weight: 5,
          opacity: 0.95,
          lineCap: 'round',
          lineJoin: 'round'
        }).addTo(this.map);
        
        core.bindTooltip(`Segment ${ptA.distanceKm} - ${ptB.distanceKm} km · Comfort: ${legScore}/100`, { sticky: true });
        this.routeLayers.push(core);
      }
    }
  }

  createPointMarker(pt, vehicleProfile, onPointClick) {
    const isStart = pt.type === 'start';
    const isEnd = pt.type === 'end';
    const isPass = pt.type === 'mountain_pass' && pt.elevationM !== null;
    const isBridge = false;

    const scoreColor = this.getScoreColor(pt.pointScore);
    const weatherIcon = pt.weather ? this.getWeatherIcon(pt.weather.weatherCode) : '🌤️';
    const temp = pt.weather ? `${Math.round(pt.weather.temperature)}°` : '--';
    const wind = pt.wind;

    // Wind direction arrow (rotation in CSS)
    const windRotation = pt.weather ? (pt.weather.windDirection + 180) % 360 : 0;

    const html = `
      <div class="map-sample-marker ${isStart ? 'marker-start' : ''} ${isEnd ? 'marker-end' : ''} ${isPass ? 'marker-pass' : ''} ${isBridge ? 'marker-bridge' : ''}" style="--marker-color: ${scoreColor}">
        <div class="marker-badge">
          <span class="marker-weather">${weatherIcon}</span>
          <span class="marker-temp">${temp}</span>
        </div>
        <div class="marker-wind-arrow" style="transform: rotate(${windRotation}deg);" title="Wind ${pt.weather ? Math.round(pt.weather.windSpeed) : 0} km/h">
          <svg viewBox="0 0 24 24" width="12" height="12"><path d="M12 2L4 20l8-4 8 4L12 2z" fill="#0f172a"/></svg>
        </div>
        <div class="marker-score" style="background: ${scoreColor}">${pt.pointScore}</div>
      </div>
    `;

    const customIcon = L.divIcon({
      className: 'custom-div-icon',
      html,
      iconSize: [44, 44],
      iconAnchor: [22, 22]
    });

    const marker = L.marker([pt.lat, pt.lon], { icon: customIcon });

    // Popup content
    const popupHtml = `
      <div class="marker-popup">
        <div class="popup-header" style="border-left: 4px solid ${scoreColor};">
          <div class="popup-title">${pt.name}</div>
          <div class="popup-badge" style="background: ${scoreColor}22; color: ${scoreColor}; border: 1px solid ${scoreColor}">
            Score ${pt.pointScore}/100
          </div>
        </div>
        <div class="popup-meta">
          <span>📍 <b>${pt.distanceKm} km</b></span>
          <span>⏱️ ETA: <b>${pt.etaString}</b></span>
          <span>⛰️ Elev: <b>${pt.elevationM !== null && pt.elevationM !== undefined ? `${pt.elevationM}m` : 'Elevation unavailable'}</b></span>
        </div>
        ${pt.weather ? `
          <div class="popup-weather-grid">
            <div class="popup-stat"><span class="lbl">Temp:</span> <span class="val">${pt.weather.temperature.toFixed(1)}°C (feels ${pt.weather.apparentTemperature.toFixed(1)}°)</span></div>
            <div class="popup-stat"><span class="lbl">Precip:</span> <span class="val">${pt.weather.precipitation.toFixed(1)} mm/h (${pt.weather.precipitationProbability}%)</span></div>
            <div class="popup-stat"><span class="lbl">Wind:</span> <span class="val">${Math.round(pt.weather.windSpeed)} km/h (${Math.round(pt.weather.windDirection)}° from ${this.getCardinalDirection(pt.weather.windDirection)})</span></div>
            <div class="popup-stat"><span class="lbl">Heading:</span> <span class="val">${pt.heading}° (${this.getCardinalDirection(pt.heading)})</span></div>
            <div class="popup-stat"><span class="lbl">${wind.headwind >= 0 ? 'Headwind' : 'Tailwind'}:</span> <span class="val ${wind.headwind > 15 ? 'warn-val' : ''}">${Math.abs(wind.headwind).toFixed(1)} km/h</span></div>
            <div class="popup-stat"><span class="lbl">Crosswind:</span> <span class="val ${wind.crosswind > 18 ? 'warn-val' : ''}">${wind.crosswind.toFixed(1)} km/h (${wind.crosswindSigned > 0 ? 'from Right' : 'from Left'})</span></div>
            <div class="popup-stat"><span class="lbl">Gusts:</span> <span class="val">${Math.round(pt.weather.windGusts)} km/h</span></div>
            <div class="popup-stat"><span class="lbl">Visibility:</span> <span class="val">${(pt.weather.visibility / 1000).toFixed(1)} km</span></div>
          </div>
        ` : '<p>No weather data</p>'}

        ${pt.iceProxy && pt.iceProxy.isIceRisk ? `
          <div class="popup-ice-alert">⚠️ Possible road ice proxy detected</div>
        ` : ''}

        ${pt.pointWarnings && pt.pointWarnings.length > 0 ? `
          <div class="popup-warnings">
            ${pt.pointWarnings.map(w => `<div class="warn-pill ${w.severity}">${w.title}</div>`).join('')}
          </div>
        ` : ''}
      </div>
    `;

    marker.bindPopup(popupHtml, { maxWidth: 300, className: 'dark-popup' });

    marker.on('click', () => {
      if (onPointClick) onPointClick(pt);
    });

    return marker;
  }

  zoomToLocation(location, zoomLevel = 13) {
    if (!this.map || !location || isNaN(location.lat) || isNaN(location.lon)) return;

    this.map.flyTo([location.lat, location.lon], zoomLevel, {
      animate: true,
      duration: 1.2
    });

    if (this.currentLocationMarker) {
      this.map.removeLayer(this.currentLocationMarker);
    }

    const livePinIcon = L.divIcon({
      className: 'custom-div-icon',
      html: `
        <div class="live-location-pin">
          <div class="live-pin-pulse"></div>
          <div class="live-pin-dot"></div>
        </div>
      `,
      iconSize: [24, 24],
      iconAnchor: [12, 12]
    });

    this.currentLocationMarker = L.marker([location.lat, location.lon], { icon: livePinIcon })
      .addTo(this.map)
      .bindPopup(`
        <div class="marker-popup">
          <div style="font-weight: 700; font-size: 13px; color: var(--matte-glacier); margin-bottom: 2px;">📍 Current Live Location</div>
          <div style="font-size: 11px; color: var(--text-muted); line-height: 1.3;">${location.displayName || location.name}</div>
          <div style="font-size: 10px; font-family: var(--font-mono); color: var(--text-dim); margin-top: 4px;">${location.lat.toFixed(5)}, ${location.lon.toFixed(5)}</div>
        </div>
      `, { className: 'dark-popup' })
      .openPopup();
  }

  highlightPoint(pt) {
    if (!this.map || !pt) return;
    const currentZoom = this.map.getZoom();
    const targetZoom = Math.max(currentZoom, 11);
    this.map.flyTo([pt.lat, pt.lon], targetZoom, { animate: true, duration: 1 });
  }

  getScoreColor(score) {
    if (score >= 80) return '#10b981'; // emerald
    if (score >= 60) return '#f59e0b'; // amber
    if (score >= 40) return '#f97316'; // orange
    return '#ef4444'; // crimson red
  }

  getWeatherIcon(code) {
    if (code === 0) return '☀️';
    if (code <= 2) return '🌤️';
    if (code === 3) return '☁️';
    if (code >= 45 && code <= 48) return '🌫️';
    if (code >= 51 && code <= 67) return '🌧️';
    if (code >= 71 && code <= 77) return '❄️';
    if (code >= 80 && code <= 82) return '🌦️';
    if (code >= 95) return '⛈️';
    return '⛅';
  }

  getCardinalDirection(deg) {
    const val = Math.floor((deg / 22.5) + 0.5) % 16;
    const cardinals = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
    return cardinals[val] || 'N';
  }

  invalidateSize() {
    if (this.map) {
      setTimeout(() => {
        this.map.invalidateSize();
      }, 50);
    }
  }
}
