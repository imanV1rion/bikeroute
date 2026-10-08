/**
 * Trip Weather System - Main Controller & Orchestrator
 * Pure live data mode: centered on India, real-time typing suggestions,
 * and zero preloaded data.
 */

import './style.css';
import { getVehicleProfiles, saveVehicleProfile, resetVehicleProfiles } from './models/vehicleProfiles.js';
import { searchPlaces, geocodePlace, geocodeOnEnter, validateTripDistance, calculateRoute, reverseGeocode } from './services/routingService.js';
import { sampleRoute, enrichWithRealTopography } from './services/sampler.js';
import { fetchDenseElevationProfile } from './services/elevationService.js';
import { fetchRouteWeather, getCacheStats } from './services/weatherService.js';
import { scoreTripRoute } from './services/scoringEngine.js';
import { buildAdvice } from './services/adviceBuilder.js';
import { MapView } from './components/mapView.js';
import { RouteVisualizer } from './components/routeCharts.js';

// Application State (Zero preloaded data)
const state = {
  profiles: getVehicleProfiles(),
  selectedProfileId: 'bicycle',
  startLocation: null,    // { name, displayName, lat, lon }
  endLocation: null,      // { name, displayName, lat, lon }
  currentDepartureTime: new Date(),
  selectedDepartureOffset: 0,
  currentTripData: null,
  activeRouteResult: null,
  activeScoreResult: null,
  activeAdviceResult: null,
  activeAlternativeResult: null,
  weatherDataMap: null,
  samplePoints: []
};

// Component References
let mapView = null;
let visualizer = null;

// Initialize on DOM load
window.addEventListener('DOMContentLoaded', () => {
  initDepartureInput();
  initVehicleGrid();
  initMapAndVisualizer();
  initLiveAutocomplete();
  initLiveLocationButton();
  initTabs();
  initModals();
  setupEventListeners();
  initMobileNavigation();
  renderEmptyState();
});

function initDepartureInput() {
  const input = document.getElementById('input-departure');
  if (input) {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const localIso = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
    input.value = localIso;
    input.min = localIso;
    // Task 5d: Disable departure times beyond available 16-day forecast
    const maxDate = new Date(now.getTime() + 15 * 24 * 3600 * 1000);
    input.max = `${maxDate.getFullYear()}-${pad(maxDate.getMonth() + 1)}-${pad(maxDate.getDate())}T${pad(maxDate.getHours())}:${pad(maxDate.getMinutes())}`;
  }
}

function initVehicleGrid() {
  const container = document.getElementById('vehicle-selector-grid');
  if (!container) return;
  container.innerHTML = '';

  Object.values(state.profiles).forEach(p => {
    const btn = document.createElement('button');
    btn.className = `vehicle-btn ${p.id === state.selectedProfileId ? 'active' : ''}`;
    btn.dataset.id = p.id;
    btn.innerHTML = `
      <span class="v-icon">${p.icon}</span>
      <span class="v-name">${p.name.split(' ')[0]}</span>
    `;
    btn.addEventListener('click', () => {
      document.querySelectorAll('.vehicle-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.selectedProfileId = p.id;
      updateVehicleLabel(p);
      // Re-run analysis if route is already active
      if (state.activeRouteResult) {
        runTripAnalysis();
      }
    });
    container.appendChild(btn);
  });

  const active = state.profiles[state.selectedProfileId];
  if (active) updateVehicleLabel(active);
}

function updateVehicleLabel(profile) {
  const lbl = document.getElementById('vehicle-desc-label');
  if (lbl) {
    lbl.textContent = `${profile.defaultSpeedKmH} km/h base`;
    lbl.title = profile.description;
  }
}

function initMapAndVisualizer() {
  mapView = new MapView('map-container');
  visualizer = new RouteVisualizer('chart-route-profile', 'chart-departure-matrix');
}

/**
 * Live search suggestions while typing for India
 */
function initLiveAutocomplete() {
  setupFieldAutocomplete('input-start', 'suggestions-start', 'loader-start', 'start', (selected) => {
    state.startLocation = selected;
  });

  setupFieldAutocomplete('input-end', 'suggestions-end', 'loader-end', 'destination', (selected) => {
    state.endLocation = selected;
  });
}

function setupFieldAutocomplete(inputId, dropdownId, loaderId, fieldKey, onSelect) {
  const input = document.getElementById(inputId);
  const dropdown = document.getElementById(dropdownId);
  const loader = document.getElementById(loaderId);
  if (!input || !dropdown) return;

  let debounceTimer = null;
  let activeIndex = -1;
  let currentItems = [];

  const closeDropdown = () => {
    dropdown.style.display = 'none';
    dropdown.innerHTML = '';
    activeIndex = -1;
    currentItems = [];
  };

  input.addEventListener('input', () => {
    const query = input.value.trim();
    clearTimeout(debounceTimer);

    if (query.length < 2) {
      closeDropdown();
      if (loader) loader.style.display = 'none';
      return;
    }

    if (loader) loader.style.display = 'inline-block';

    debounceTimer = setTimeout(async () => {
      const results = await searchPlaces(query, fieldKey);
      if (loader) loader.style.display = 'none';

      if (!results || results.length === 0) {
        dropdown.innerHTML = `<div style="padding: 10px; font-size: 12px; color: var(--text-dim); text-align: center;">No matches found in India</div>`;
        dropdown.style.display = 'block';
        currentItems = [];
        return;
      }

      currentItems = results;
      dropdown.innerHTML = results.map((item, idx) => `
        <div class="suggestion-item" data-index="${idx}">
          <div class="suggestion-title">📍 ${item.name}</div>
          <div class="suggestion-subtitle">${item.subtitle}</div>
        </div>
      `).join('');

      dropdown.style.display = 'block';

      dropdown.querySelectorAll('.suggestion-item').forEach(el => {
        el.addEventListener('mousedown', (e) => {
          e.preventDefault();
          const idx = parseInt(el.dataset.index, 10);
          const chosen = currentItems[idx];
          if (chosen) {
            input.value = chosen.name;
            onSelect(chosen);
            closeDropdown();
          }
        });
      });
    }, 280);
  });

  // Keyboard navigation
  input.addEventListener('keydown', async (e) => {
    if (dropdown.style.display !== 'block' || currentItems.length === 0) {
      if (e.key === 'Enter') {
        const val = input.value.trim();
        if (val) {
          const res = await geocodeOnEnter(val);
          if (res) onSelect(res);
        }
        runTripAnalysis();
      }
      return;
    }

    const items = dropdown.querySelectorAll('.suggestion-item');
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      activeIndex = (activeIndex + 1) % items.length;
      updateActiveItem(items, activeIndex);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      activeIndex = (activeIndex - 1 + items.length) % items.length;
      updateActiveItem(items, activeIndex);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (activeIndex >= 0 && activeIndex < currentItems.length) {
        const chosen = currentItems[activeIndex];
        input.value = chosen.name;
        onSelect(chosen);
        closeDropdown();
      } else {
        closeDropdown();
        const val = input.value.trim();
        if (val) {
          const res = await geocodeOnEnter(val);
          if (res) onSelect(res);
        }
      }
      runTripAnalysis();
    } else if (e.key === 'Escape') {
      closeDropdown();
    }
  });

  // Provide quick GPS location option when focusing on empty start field
  if (fieldKey === 'start') {
    input.addEventListener('focus', () => {
      if (!input.value.trim()) {
        dropdown.innerHTML = `
          <div class="suggestion-item" id="opt-quick-live-gps">
            <div class="suggestion-title" style="color: var(--matte-glacier);">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink: 0;">
                <circle cx="12" cy="12" r="10"/>
                <line x1="22" y1="12" x2="18" y2="12"/>
                <line x1="6" y1="12" x2="2" y2="12"/>
                <line x1="12" y1="6" x2="12" y2="2"/>
                <line x1="12" y1="22" x2="12" y2="18"/>
                <circle cx="12" cy="12" r="3"/>
              </svg>
              <span>Use Current Live Location</span>
            </div>
            <div class="suggestion-subtitle">Detect GPS coordinates via browser location</div>
          </div>
        `;
        dropdown.style.display = 'block';

        dropdown.querySelector('#opt-quick-live-gps')?.addEventListener('mousedown', (e) => {
          e.preventDefault();
          closeDropdown();
          document.getElementById('btn-use-live-location')?.click();
        });
      }
    });
  }

  // Close when clicking outside
  document.addEventListener('click', (e) => {
    if (!input.contains(e.target) && !dropdown.contains(e.target)) {
      closeDropdown();
    }
  });
}

/**
 * Live GPS Location Detection Handler
 */
function initLiveLocationButton() {
  const btn = document.getElementById('btn-use-live-location');
  const inputStart = document.getElementById('input-start');
  const loader = document.getElementById('loader-start');

  if (!btn || !inputStart) return;

  btn.addEventListener('click', async () => {
    if (!('geolocation' in navigator)) {
      showInlineMessage('Geolocation is not supported by your browser.', true);
      return;
    }

    btn.classList.add('loading');
    btn.disabled = true;
    if (loader) loader.style.display = 'inline-block';
    const originalPlaceholder = inputStart.placeholder;
    inputStart.placeholder = 'Acquiring live GPS coordinates...';

    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const lat = pos.coords.latitude;
          const lon = pos.coords.longitude;

          if (loader) loader.style.display = 'inline-block';
          const location = await reverseGeocode(lat, lon);

          state.startLocation = location;
          inputStart.value = location.name;
          inputStart.placeholder = originalPlaceholder;
          btn.classList.remove('loading');
          btn.classList.add('success');
          btn.disabled = false;
          if (loader) loader.style.display = 'none';

          // Smoothly zoom map directly into current GPS location
          mapView?.zoomToLocation(location, 14);

          showInlineMessage(`📍 Live location acquired: ${location.displayName}`, false);
        } catch (err) {
          console.error('Reverse geocode error:', err);
          btn.classList.remove('loading');
          btn.disabled = false;
          if (loader) loader.style.display = 'none';
          inputStart.placeholder = originalPlaceholder;
          showInlineMessage(`Could not resolve address for coordinates: ${err.message}`, true);
        }
      },
      (err) => {
        btn.classList.remove('loading');
        btn.disabled = false;
        if (loader) loader.style.display = 'none';
        inputStart.placeholder = originalPlaceholder;

        let errMsg = 'Failed to acquire live GPS location.';
        if (err.code === err.PERMISSION_DENIED) {
          errMsg = 'Location permission was denied. Please allow location access in your browser or type a city name.';
        } else if (err.code === err.POSITION_UNAVAILABLE) {
          errMsg = 'Current position unavailable. Please check your GPS signal or network connection.';
        } else if (err.code === err.TIMEOUT) {
          errMsg = 'GPS request timed out. Please try again.';
        }
        showInlineMessage(errMsg, true);
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 60000
      }
    );
  });
}

function updateActiveItem(items, index) {
  items.forEach((item, i) => {
    item.classList.toggle('active', i === index);
  });
}

function renderEmptyState() {
  const profileContainer = document.getElementById('chart-route-profile');
  const departureContainer = document.getElementById('chart-departure-matrix');
  const pointsTbody = document.getElementById('points-table-body');

  const emptyMsg = `
    <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 140px; text-align: center; color: var(--text-dim); padding: 20px;">
      <div style="font-size: 28px; margin-bottom: 8px;">🇮🇳 🗺️</div>
      <div style="font-size: 13px; font-weight: 600; color: var(--text-muted); margin-bottom: 4px;">Live India Route & Weather Engine</div>
      <div style="font-size: 11px; max-width: 420px; line-height: 1.4;">
        Type any origin and destination above (e.g. Mumbai, Bengaluru, New Delhi, Manali, Goa) to calculate live routes, wind vectors, and comfort scores.
      </div>
    </div>
  `;

  if (profileContainer) profileContainer.innerHTML = emptyMsg;
  if (departureContainer) departureContainer.innerHTML = emptyMsg;
  if (pointsTbody) {
    pointsTbody.innerHTML = `<tr><td colspan="8" style="text-align: center; padding: 20px; color: var(--text-dim);">No active trip. Enter locations to inspect route checkpoints.</td></tr>`;
  }
}

function initTabs() {
  const tabs = document.querySelectorAll('.panel-tab');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');

      const targetId = tab.dataset.tab;
      document.querySelectorAll('.tab-pane').forEach(p => {
        p.style.display = p.id === targetId ? 'block' : 'none';
      });
    });
  });
}

function initModals() {
  // Vehicle tuning modal
  const btnOpenTuning = document.getElementById('btn-open-tuning');
  const modalTuning = document.getElementById('modal-tuning');
  const btnCloseTuning = document.getElementById('btn-close-tuning');
  const profileSelect = document.getElementById('modal-profile-select');

  btnOpenTuning?.addEventListener('click', () => {
    renderProfileTuningModal();
    modalTuning?.classList.add('active');
  });

  btnCloseTuning?.addEventListener('click', () => {
    modalTuning?.classList.remove('active');
  });

  document.getElementById('btn-reset-profiles')?.addEventListener('click', () => {
    if (confirm('Reset all vehicle profile weights and limits to original defaults?')) {
      state.profiles = resetVehicleProfiles();
      initVehicleGrid();
      renderProfileTuningModal();
      if (state.activeRouteResult) runTripAnalysis();
    }
  });

  document.getElementById('btn-save-profile-changes')?.addEventListener('click', () => {
    saveProfileTuningChanges();
    modalTuning?.classList.remove('active');
    initVehicleGrid();
    if (state.activeRouteResult) runTripAnalysis();
  });

  profileSelect?.addEventListener('change', () => {
    renderProfileTuningHazards(profileSelect.value);
  });
}

function setupEventListeners() {
  document.getElementById('btn-calculate')?.addEventListener('click', () => {
    runTripAnalysis();
  });

  window.addEventListener('resize', () => {
    mapView?.invalidateSize();
    if (state.activeScoreResult && state.activeRouteResult) {
      visualizer.renderProfile(state.activeScoreResult.scoredPoints, state.activeRouteResult.distanceKm, (pt) => {
        mapView.highlightPoint(pt);
      });
    }
  });
}

/**
 * Mobile-first responsive view orchestrator (<1024px)
 */
function initMobileNavigation() {
  const navBtns = document.querySelectorAll('.mobile-nav-btn');
  const appBody = document.querySelector('.app-body');

  navBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const view = btn.dataset.view;
      setMobileView(view);
    });
  });

  function setMobileView(view) {
    navBtns.forEach(b => b.classList.toggle('active', b.dataset.view === view));
    if (appBody) {
      appBody.classList.remove('view-setup', 'view-map', 'view-analysis');
      appBody.classList.add(`view-${view}`);
    }

    if (view === 'map') {
      mapView?.invalidateSize();
    } else if (view === 'analysis') {
      mapView?.invalidateSize();
      if (state.activeScoreResult && state.activeRouteResult) {
        visualizer?.renderProfile(state.activeScoreResult.scoredPoints, state.activeRouteResult.distanceKm, (pt) => {
          mapView?.highlightPoint(pt);
        });
      }
    }
  }

  // Set default view on load
  setMobileView('setup');
}

/**
 * Display inline message or error in the control panel
 */
export function showInlineMessage(message, isError = true) {
  const banner = document.getElementById('inline-error-banner');
  if (!banner) return;
  if (!message) {
    banner.style.display = 'none';
    banner.textContent = '';
    return;
  }
  banner.textContent = message;
  banner.style.display = 'block';
  if (isError) {
    banner.style.border = '1px solid rgba(239, 68, 68, 0.4)';
    banner.style.background = 'rgba(239, 68, 68, 0.15)';
    banner.style.color = '#fca5a5';
  } else {
    banner.style.border = '1px solid rgba(16, 185, 129, 0.4)';
    banner.style.background = 'rgba(16, 185, 129, 0.15)';
    banner.style.color = '#6ee7b7';
  }
}

/**
 * 100% Live Orchestration:
 * 1. Live Geocoding -> 2. Live Routing -> 3. Route Sampling -> 4. Live Open-Meteo Weather -> 5. Scoring -> 6. Advice
 */
async function runTripAnalysis() {
  showInlineMessage('');
  const startInput = document.getElementById('input-start');
  const endInput = document.getElementById('input-end');
  const startStr = startInput.value.trim();
  const endStr = endInput.value.trim();

  if (!startStr || !endStr) {
    showInlineMessage('Please enter both a start location and destination in India.');
    return;
  }

  const loading = document.getElementById('loading-overlay');
  const loadingMsg = document.getElementById('loading-message');
  loading?.classList.add('active');
  if (loadingMsg) loadingMsg.textContent = 'Resolving live coordinates in India...';

  try {
    const profile = state.profiles[state.selectedProfileId];
    const wantAlternatives = document.getElementById('check-alternatives').checked;

    // Read departure time
    const depVal = document.getElementById('input-departure').value;
    const departureTime = depVal ? new Date(depVal) : new Date();
    state.currentDepartureTime = departureTime;
    state.selectedDepartureOffset = 0;

    // 1. Resolve coordinates from selected state or live geocode
    let startCoords = state.startLocation;
    let endCoords = state.endLocation;

    if (!startCoords || (startCoords.name !== startStr && !startCoords.isLiveLocation)) {
      startCoords = await geocodePlace(startStr);
    }
    if (!endCoords || endCoords.name !== endStr) {
      endCoords = await geocodePlace(endStr);
    }

    if (!startCoords) {
      throw new Error(`Could not find coordinates for origin: "${startStr}". Please select from suggestions or refine search.`);
    }
    if (!endCoords) {
      throw new Error(`Could not find coordinates for destination: "${endStr}". Please select from suggestions or refine search.`);
    }

    // Task 8a: Validation if start and destination are less than 500 m apart
    const distCheck = validateTripDistance(startCoords, endCoords);
    if (!distCheck.valid) {
      showInlineMessage(distCheck.error);
      return;
    }

    // 2. Live Routing Service
    if (loadingMsg) loadingMsg.textContent = `Routing from ${startCoords.name.split(',')[0]} to ${endCoords.name.split(',')[0]} for ${profile.name}...`;
    const routes = await calculateRoute(startCoords, endCoords, profile.id, wantAlternatives);
    const primaryRoute = routes[0];
    const altRoute = routes.length > 1 ? routes[1] : null;
    state.activeRouteResult = primaryRoute;

    // 3. Sampler (every 25 min along real road geometry, at most 40, at least 2)
    const customSpeedVal = parseFloat(document.getElementById('input-custom-speed')?.value);
    const customSpeed = (!isNaN(customSpeedVal) && customSpeedVal > 0) ? customSpeedVal : null;
    const samplePoints = sampleRoute(primaryRoute, profile, customSpeed);
    state.samplePoints = samplePoints;

    let altPoints = [];
    if (altRoute) {
      altPoints = sampleRoute(altRoute, profile, customSpeed);
    }
    const combinedPoints = [...samplePoints, ...altPoints];

    // 4. Real Topographical Elevation Service (Dense profile every 2-3 km, Open-Meteo in chunks <= 100)
    if (loadingMsg) loadingMsg.textContent = 'Fetching route elevation profile every 2-3 km...';
    const denseProfile = await fetchDenseElevationProfile(primaryRoute.coordinates, 2.5);
    enrichWithRealTopography(samplePoints, denseProfile);
    if (altRoute) {
      const altDenseProfile = await fetchDenseElevationProfile(altRoute.coordinates, 2.5);
      enrichWithRealTopography(altPoints, altDenseProfile);
      altRoute.denseElevationProfile = altDenseProfile;
      altRoute.elevationProfile = altDenseProfile.map(p => p.elevationM);
    }

    // Attach real elevation profile to route for charting
    primaryRoute.denseElevationProfile = denseProfile;
    primaryRoute.elevationProfile = denseProfile.map(p => p.elevationM);

    // 5. Live Open-Meteo Weather Service (Single batched HTTP call, 0.1° grid cache, unixtime)
    if (loadingMsg) loadingMsg.textContent = `Querying live Open-Meteo weather across ${samplePoints.length} route checkpoints...`;

    const weatherMap = await fetchRouteWeather(combinedPoints, departureTime, primaryRoute.durationMinutes);
    state.weatherDataMap = weatherMap;

    // 6. Scoring Engine (with strict caps on high/critical hazard warnings)
    if (loadingMsg) loadingMsg.textContent = 'Calculating comfort scores, wind vectors, and ice proxy...';
    const scoreResult = scoreTripRoute(samplePoints, weatherMap, profile, departureTime, primaryRoute);
    state.activeScoreResult = scoreResult;

    // Score alternative route if requested
    let altScoreResult = null;
    if (altRoute && altPoints.length > 0) {
      altScoreResult = scoreTripRoute(altPoints, weatherMap, profile, departureTime, altRoute);
      state.activeAlternativeResult = {
        route: altRoute,
        scoreResult: altScoreResult
      };
    } else {
      state.activeAlternativeResult = null;
    }

    // 6. Advice Builder (Verdict, Warnings, 10-Hour Best Departure Matrix)
    const advice = buildAdvice(scoreResult, samplePoints, weatherMap, profile, departureTime);
    state.activeAdviceResult = advice;

    // Package current trip
    state.currentTripData = {
      id: `trip_${Date.now()}`,
      name: `${startCoords.name.split(',')[0]} → ${endCoords.name.split(',')[0]}`,
      startName: startCoords.name,
      endName: endCoords.name,
      departureTime: departureTime.toISOString(),
      vehicleProfile: profile,
      route: primaryRoute,
      alternativeRoute: altRoute,
      scoredPoints: scoreResult.scoredPoints,
      scoreResult,
      advice,
      altScoreResult
    };

    // 7. Update UI
    renderTripResults(state.currentTripData);
    updateCacheStatsUI();

  } catch (err) {
    console.error('Live analysis failed:', err);
    showInlineMessage(`Trip Analysis: ${err.message}`);
  } finally {
    loading?.classList.remove('active');
  }
}

/**
 * Updates all visual components on screen
 */
function renderTripResults(tripData) {
  const { route, scoreResult, advice, vehicleProfile, altScoreResult } = tripData;

  // 1. Map View
  mapView.renderTrip(tripData, (selectedPoint) => {
    mapView.highlightPoint(selectedPoint);
  });

  // 2. Verdict Card
  document.getElementById('section-verdict').style.display = 'block';
  document.getElementById('score-duration-label').textContent = `${route.distanceKm} km · ${Math.round(route.durationMinutes / 60)}h ${route.durationMinutes % 60}m`;

  let etaBasis = 'profile speed';
  if (route.activeSpeedBasis === 'your-speed' || route.customSpeedKmH) {
    etaBasis = 'your speed';
  } else if (route.activeSpeedBasis === 'route-engine' || route.speedBasis === 'route-engine') {
    etaBasis = 'route engine time';
  }

  const routeSourceBadge = route.routeSourceBadge || (route.routeSource === 'valhalla' ? `Valhalla (${vehicleProfile.id})` : (route.routeSource === 'osm-bike' ? 'OSM bike server' : (route.routeSource === 'osm-foot' ? 'OSM foot server' : 'Approximate: car routing')));

  const verdictContainer = document.getElementById('verdict-container');
  verdictContainer.innerHTML = `
    <div class="verdict-card ${advice.verdictClass}">
      <div class="verdict-top">
        <div>
          <div class="verdict-badge" style="color: ${advice.verdictColor}">${advice.verdict}</div>
          <div style="font-size: 11px; color: var(--text-muted); display: flex; align-items: center; gap: 6px; margin-top: 2px;">
            <span>${vehicleProfile.name} Forecast</span>
            <span class="route-source-badge" style="font-size: 10px; padding: 1px 6px; border-radius: 3px; background: rgba(56, 189, 248, 0.15); color: var(--accent-cyan); border: 1px solid rgba(56, 189, 248, 0.3); font-weight: 500;">${routeSourceBadge}</span>
          </div>
        </div>
        <div class="score-circle" style="background: ${advice.verdictColor}22; border: 2px solid ${advice.verdictColor}; color: ${advice.verdictColor}">
          <span class="score-num">${advice.tripScore}</span>
          <span class="score-lbl">Score</span>
        </div>
      </div>
      <div class="verdict-summary">${advice.verdictSummary}</div>
      <div class="score-formula-bar">
        <span>Formula: <b>60% Avg (${scoreResult.avgScore})</b> + <b>40% Worst (${scoreResult.minScore})</b></span>
        ${scoreResult.worstPoint ? `<span>Bottleneck: km ${scoreResult.worstPoint.distanceKm}</span>` : ''}
      </div>
      <div class="score-formula-bar" style="margin-top: 4px; font-size: 11px; display: flex; justify-content: space-between;">
        <span>ETA based on: <strong style="color: var(--accent-cyan);">${etaBasis}</strong></span>
        <span>${scoreResult.forecastCoverage ? scoreResult.forecastCoverage.text : ''}</span>
      </div>
    </div>
  `;

  // EV & Second pass recalculation callout
  const secondPassContainer = document.getElementById('second-pass-container');
  let secondPassHtml = '';

  if (vehicleProfile.id === 'bicycle') {
    secondPassHtml += `
      <div class="second-pass-badge">
        <span>💨</span>
        <span><b>2-Pass Dynamic ETA:</b> Speed adjusted dynamically for headwind & terrain resistance.</span>
      </div>
    `;
  } else if (vehicleProfile.id === 'ev' && scoreResult.evStats) {
    const ev = scoreResult.evStats;
    secondPassHtml += `
      <div class="second-pass-badge" style="border-color: rgba(129, 140, 248, 0.4); color: #a5b4fc;">
        <span>⚡</span>
        <span><b>EV Range Model:</b> ${ev.headline} (Avg ~${ev.estimatedWhPerKm} Wh/km).</span>
      </div>
    `;
  }

  // Alternative route weather recommendation
  if (altScoreResult) {
    const diff = altScoreResult.tripScore - scoreResult.tripScore;
    const isAltBetter = diff > 4;
    secondPassHtml += `
      <div class="second-pass-badge" style="border-color: ${isAltBetter ? 'rgba(16, 185, 129, 0.4)' : 'rgba(255,255,255,0.1)'}; color: ${isAltBetter ? '#6ee7b7' : 'var(--text-muted)'}">
        <span>🔀</span>
        <span><b>Alternative Route:</b> Comfort Score ${altScoreResult.tripScore}/100 (${isAltBetter ? `Recommended: +${diff} pts better weather!` : 'Primary route has superior weather.'})</span>
      </div>
    `;
  }

  secondPassContainer.innerHTML = secondPassHtml;

  // Best Departure Recommendation Callout
  const depCallout = document.getElementById('departure-callout');
  depCallout.innerHTML = `
    <div style="background: rgba(30, 41, 59, 0.7); border: 1px solid var(--border-glass); border-radius: var(--radius-sm); padding: 10px 12px; font-size: 12px;">
      <div style="font-weight: 700; color: var(--accent-cyan); margin-bottom: 2px;">🕒 Departure Time Analysis</div>
      <div style="color: var(--text-muted); line-height: 1.4;">${advice.departureRecommendation}</div>
      <button class="primary-btn mobile-jump-map-btn" id="btn-jump-map-mobile" style="margin-top: 10px; padding: 8px 12px; font-size: 12px;">
        🗺️ View Route on Map
      </button>
    </div>
  `;

  document.getElementById('btn-jump-map-mobile')?.addEventListener('click', () => {
    document.getElementById('mobile-btn-map')?.click();
  });


  // 4. Hazard Warnings Feed
  const hazardsSec = document.getElementById('section-hazards');
  const warningsCont = document.getElementById('warnings-container');
  const countBadge = document.getElementById('warnings-count-badge');

  if (advice.warnings.length > 0) {
    hazardsSec.style.display = 'block';
    countBadge.textContent = advice.warnings.length;
    warningsCont.innerHTML = advice.warnings.map(w => `
      <div class="warning-item severity-${w.severity}" style="cursor: pointer;" data-lat="${w.lat}" data-lon="${w.lon}">
        <div class="warning-header">
          <span class="warning-title">${w.title}</span>
          <span class="warning-loc">km ${w.distanceKm} · ${w.etaString}</span>
        </div>
        <div class="warning-detail">${w.detail}</div>
      </div>
    `).join('');

    warningsCont.querySelectorAll('.warning-item').forEach(item => {
      item.addEventListener('click', () => {
        const lat = parseFloat(item.dataset.lat);
        const lon = parseFloat(item.dataset.lon);
        mapView.highlightPoint({ lat, lon });
      });
    });
  } else {
    hazardsSec.style.display = 'none';
  }

  // 5. Bottom Tabs Visualizations
  visualizer.renderProfile(scoreResult.scoredPoints, route.distanceKm, (pt) => {
    mapView.highlightPoint(pt);
  });

  visualizer.renderDepartureTimeline(advice.departureWindows, state.selectedDepartureOffset, (offset) => {
    handleSelectDepartureOffset(offset);
  });

  // Sample points table
  renderSamplePointsTable(scoreResult.scoredPoints);
}

function handleSelectDepartureOffset(offset) {
  state.selectedDepartureOffset = offset;
  const candidateStartTime = new Date(state.currentDepartureTime.getTime() + offset * 3600000);
  
  const profile = state.profiles[state.selectedProfileId];
  const scoreResult = scoreTripRoute(state.samplePoints, state.weatherDataMap, profile, candidateStartTime);
  state.activeScoreResult = scoreResult;

  const advice = buildAdvice(scoreResult, state.samplePoints, state.weatherDataMap, profile, candidateStartTime);
  state.activeAdviceResult = advice;

  state.currentTripData.scoredPoints = scoreResult.scoredPoints;
  state.currentTripData.scoreResult = scoreResult;
  state.currentTripData.advice = advice;

  renderTripResults(state.currentTripData);
}

function renderSamplePointsTable(points) {
  const tbody = document.getElementById('points-table-body');
  const countTab = document.getElementById('points-count-tab');
  if (!tbody) return;
  countTab.textContent = points.length;

  tbody.innerHTML = points.map(pt => {
    const w = pt.weather;
    const scoreCol = mapView.getScoreColor(pt.pointScore);
    const tempStr = (w && w.temperature !== null && !w.outOfRange) ? `${w.temperature.toFixed(1)}°` : (w?.outOfRange ? 'Out of Range' : 'No forecast');
    const precipStr = (w && w.precipitation !== null && !w.outOfRange) ? `${w.precipitation.toFixed(1)} mm` : '--';
    const headwindStr = (pt.wind && pt.wind.headwind !== null && !w?.outOfRange) ? `${pt.wind.headwind.toFixed(0)} km/h` : '--';
    const crosswindStr = (pt.wind && pt.wind.crosswind !== null && !w?.outOfRange) ? `${pt.wind.crosswind.toFixed(0)} km/h` : '--';
    const statusNotice = pt.isMissing ? `<span style="color: #fb923c; font-size: 11px;">No forecast at km ${Math.round(pt.distanceKm)}</span>` : (w?.outOfRange ? `<span style="color: #f87171; font-size: 11px;">Out of range</span>` : '');

    return `
      <tr style="border-bottom: 1px solid rgba(255,255,255,0.04); cursor: pointer;" class="table-pt-row" data-id="${pt.id}">
        <td style="padding: 6px; font-weight: 600;">${pt.name} ${statusNotice}</td>
        <td style="padding: 6px; font-family: var(--font-mono);">${pt.distanceKm} km</td>
        <td style="padding: 6px;">${pt.etaString} ${pt.isLowConfidence ? '<span title="Low confidence forecast (>7 days)">⚠️</span>' : ''}</td>
        <td style="padding: 6px;">${tempStr}</td>
        <td style="padding: 6px;">${precipStr}</td>
        <td style="padding: 6px; color: ${pt.wind?.headwind > 15 ? '#f87171' : 'inherit'}">${headwindStr}</td>
        <td style="padding: 6px; color: ${pt.wind?.crosswind > 18 ? '#f87171' : 'inherit'}">${crosswindStr}</td>
        <td style="padding: 6px;"><b style="color: ${scoreCol}">${pt.pointScore}</b></td>
      </tr>
    `;
  }).join('');

  tbody.querySelectorAll('.table-pt-row').forEach(row => {
    row.addEventListener('click', () => {
      const ptId = row.dataset.id;
      const pt = points.find(p => p.id === ptId);
      if (pt) mapView.highlightPoint(pt);
    });
  });
}

function updateCacheStatsUI() {
  const stats = getCacheStats();
  const label = document.getElementById('cache-stats-label');
  if (label) {
    const total = stats.hits + stats.misses;
    const rate = total > 0 ? Math.round((stats.hits / total) * 100) : 0;
    label.textContent = `0.1° Cache: ${stats.hits} hits (${rate}%) · ${stats.totalEntries} cells`;
  }
}

/**
 * Profile Tuning Modal Functions
 */
function renderProfileTuningModal() {
  const select = document.getElementById('modal-profile-select');
  if (!select) return;
  select.innerHTML = '';

  Object.values(state.profiles).forEach(p => {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = `${p.icon} ${p.name}`;
    if (p.id === state.selectedProfileId) opt.selected = true;
    select.appendChild(opt);
  });

  renderProfileTuningHazards(select.value);
}

function renderProfileTuningHazards(profileId) {
  const container = document.getElementById('modal-profile-hazards-editor');
  if (!container) return;
  const p = state.profiles[profileId];
  if (!p) return;

  const html = `
    <div style="margin-bottom: 12px; display: flex; gap: 12px;">
      <label style="font-size: 12px; color: var(--text-muted);">Base Speed (km/h):
        <input type="number" id="tuning-base-speed" class="number-input" value="${p.defaultSpeedKmH}" style="margin-left: 6px;"/>
      </label>
    </div>
    <table class="profile-tuning-table">
      <thead>
        <tr>
          <th>Hazard</th>
          <th>Weight</th>
          <th>Min Limit</th>
          <th>Max Limit</th>
          <th>Unit</th>
        </tr>
      </thead>
      <tbody>
        ${Object.entries(p.hazards).map(([key, h]) => `
          <tr data-hazard="${key}">
            <td><b>${h.label}</b></td>
            <td><input type="number" step="0.1" class="number-input h-weight" value="${h.weight}"/></td>
            <td><input type="number" step="0.5" class="number-input h-min" value="${h.minThreshold}"/></td>
            <td><input type="number" step="0.5" class="number-input h-max" value="${h.maxThreshold}"/></td>
            <td style="color: var(--text-dim);">${h.unit}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;

  container.innerHTML = html;
}

function saveProfileTuningChanges() {
  const profileId = document.getElementById('modal-profile-select').value;
  const p = state.profiles[profileId];
  if (!p) return;

  const newSpeed = parseFloat(document.getElementById('tuning-base-speed').value);
  if (!isNaN(newSpeed) && newSpeed > 0) p.defaultSpeedKmH = newSpeed;

  const rows = document.querySelectorAll('#modal-profile-hazards-editor tbody tr');
  rows.forEach(row => {
    const key = row.dataset.hazard;
    if (p.hazards[key]) {
      const w = parseFloat(row.querySelector('.h-weight').value);
      const min = parseFloat(row.querySelector('.h-min').value);
      const max = parseFloat(row.querySelector('.h-max').value);
      if (!isNaN(w)) p.hazards[key].weight = w;
      if (!isNaN(min)) p.hazards[key].minThreshold = min;
      if (!isNaN(max)) p.hazards[key].maxThreshold = max;
    }
  });

  saveVehicleProfile(p);
  state.profiles = getVehicleProfiles();
}
