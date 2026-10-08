/**
 * Trip Weather System - Routing Service
 * Real-time routing powered primarily by Valhalla with live OSM fallback.
 * Strictly zero simulated curves or silent fallback guesses.
 */

const fieldControllers = new Map();

/**
 * Task 8a: Validates that start and destination are at least 500 m apart.
 */
export function validateTripDistance(start, dest) {
  if (!start || !dest || isNaN(start.lat) || isNaN(start.lon) || isNaN(dest.lat) || isNaN(dest.lon)) {
    return { valid: false, distanceKm: 0, error: 'Invalid coordinates provided.' };
  }

  const R = 6371; // Earth radius in km
  const dLat = (dest.lat - start.lat) * Math.PI / 180;
  const dLon = (dest.lon - start.lon) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(start.lat * Math.PI / 180) * Math.cos(dest.lat * Math.PI / 180) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const distanceKm = R * c;

  if (distanceKm < 0.5) {
    return {
      valid: false,
      distanceKm: Math.round(distanceKm * 1000) / 1000,
      error: `Start and destination are only ${Math.round(distanceKm * 1000)} meters apart. They must be at least 500 meters apart.`
    };
  }

  return { valid: true, distanceKm };
}

/**
 * Live search suggestions for India while typing (Task 8b, 8c, 8d).
 * Uses Photon (Komoot OSM high-speed typeahead).
 * Never calls Nominatim while typing. Only keeps countrycode "IN".
 * Does not default subtitle to "India".
 */
export async function searchPlaces(query, fieldKey = 'default') {
  if (!query || query.trim().length < 2) return [];

  // Task 8b: Use one AbortController per input field
  if (fieldControllers.has(fieldKey)) {
    fieldControllers.get(fieldKey).abort();
  }
  const controller = new AbortController();
  fieldControllers.set(fieldKey, controller);

  const cleanQuery = query.trim();

  try {
    const photonUrl = `https://photon.komoot.io/api/?q=${encodeURIComponent(cleanQuery)}&limit=10&lat=20.59&lon=78.96`;
    const res = await fetch(photonUrl, { signal: controller.signal });
    if (res.ok) {
      const data = await res.json();
      if (data && data.features && data.features.length > 0) {
        // Task 8d: Keep only Photon results with countrycode "IN"
        const inFeatures = data.features.filter(f => (f.properties?.countrycode || '').toUpperCase() === 'IN');

        return inFeatures.map((f, i) => {
          const p = f.properties || {};
          const coords = f.geometry?.coordinates || [0, 0];
          const name = p.name || p.city || p.town || cleanQuery;
          const parts = [p.district, p.city, p.state].filter(Boolean).filter(s => s !== name);
          // Task 8d: Do not default the subtitle to "India"
          const subtitle = parts.slice(0, 3).join(', ') || '';

          return {
            id: `photon_${i}_${p.osm_id || Math.random()}`,
            name,
            displayName: subtitle ? `${name}, ${subtitle}` : name,
            subtitle,
            lat: coords[1],
            lon: coords[0]
          };
        });
      }
    }
  } catch (err) {
    if (err.name === 'AbortError') return [];
    console.warn('Photon autocomplete query failed:', err);
  }

  return [];
}

/**
 * Task 8c: Call Nominatim only when the user presses Enter, never while typing.
 * Removed User-Agent header (browsers ignore it).
 */
export async function geocodeOnEnter(query) {
  if (!query || query.trim().length < 2) return null;
  const cleanQuery = query.trim();

  try {
    const nominatimUrl = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(cleanQuery)}&countrycodes=in&limit=5&addressdetails=1`;
    const res = await fetch(nominatimUrl, {
      headers: {
        'Accept': 'application/json'
      }
    });

    if (res.ok) {
      const data = await res.json();
      if (data && data.length > 0) {
        const item = data[0];
        const addr = item.address || {};
        const name = addr.city || addr.town || addr.village || addr.suburb || item.name || item.display_name.split(',')[0];
        const stateOrDistrict = [addr.county || addr.state_district, addr.state].filter(Boolean).join(', ');

        return {
          id: `nom_${item.place_id}`,
          name,
          displayName: item.display_name,
          subtitle: stateOrDistrict || '',
          lat: parseFloat(item.lat),
          lon: parseFloat(item.lon)
        };
      }
    }
  } catch (err) {
    console.warn('Nominatim geocode on Enter failed:', err);
  }

  return null;
}

/**
 * Geocodes an address query using Photon or geocodeOnEnter
 */
export async function geocodePlace(query) {
  if (!query || query.trim().length < 2) return null;
  const places = await searchPlaces(query);
  if (places && places.length > 0) {
    return places[0];
  }
  return await geocodeOnEnter(query);
}

/**
 * Reverse geocodes [lat, lon] coordinates into a human-readable location
 */
export async function reverseGeocode(lat, lon) {
  try {
    const photonUrl = `https://photon.komoot.io/reverse?lat=${lat}&lon=${lon}`;
    const res = await fetch(photonUrl);
    if (res.ok) {
      const data = await res.json();
      if (data && data.features && data.features.length > 0) {
        const p = data.features[0].properties || {};
        const name = p.name || p.city || p.locality || p.district || 'Current Location';
        const parts = [p.locality, p.district, p.city, p.state].filter(Boolean).filter(s => s !== name);
        const subtitle = parts.slice(0, 2).join(', ');
        return {
          id: `gps_${Date.now()}`,
          name,
          displayName: subtitle ? `${name}, ${subtitle}` : name,
          subtitle: subtitle || 'Current GPS Location',
          lat: parseFloat(lat),
          lon: parseFloat(lon),
          isLiveLocation: true
        };
      }
    }
  } catch (err) {
    console.warn('Photon reverse geocode failed:', err);
  }

  const latStr = parseFloat(lat).toFixed(4);
  const lonStr = parseFloat(lon).toFixed(4);
  return {
    id: `gps_${Date.now()}`,
    name: `Live Location (${latStr}, ${lonStr})`,
    displayName: `Current GPS Location (${latStr}, ${lonStr})`,
    subtitle: 'Current GPS Location',
    lat: parseFloat(lat),
    lon: parseFloat(lon),
    isLiveLocation: true
  };
}

/**
 * Decodes Valhalla 6-digit precision encoded polyline into [lat, lon] coordinates.
 */
export function decodeValhallaShape(encoded, precision = 6) {
  let index = 0, lat = 0, lng = 0;
  const coordinates = [];
  const factor = Math.pow(10, precision);

  while (index < encoded.length) {
    let byte, shift = 0, result = 0;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    const deltaLat = ((result & 1) ? ~(result >> 1) : (result >> 1));
    lat += deltaLat;

    shift = 0;
    result = 0;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    const deltaLng = ((result & 1) ? ~(result >> 1) : (result >> 1));
    lng += deltaLng;

    coordinates.push([lat / factor, lng / factor]);
  }
  return coordinates;
}

/**
 * Calculates real-time routes using Valhalla as primary server with OSRM backup.
 * Strictly throws an error if routing servers fail — NO silent fake fallbacks.
 */
export async function calculateRoute(start, end, vehicleType = 'bicycle', requestAlternatives = true) {
  // Valhalla costing mapping
  const valhallaCostingMap = {
    bicycle: 'bicycle',
    motorcycle: 'motorcycle',
    car: 'auto',
    truck: 'truck',
    ev: 'auto',
    pedestrian: 'pedestrian'
  };

  const costing = valhallaCostingMap[vehicleType] || 'auto';

  // 1. Try Primary: Valhalla Live Routing
  try {
    const valhallaUrl = 'https://valhalla1.openstreetmap.de/route';
    const body = {
      locations: [
        { lat: start.lat, lon: start.lon },
        { lat: end.lat, lon: end.lon }
      ],
      costing,
      directions_options: { units: 'kilometers' }
    };
    if (requestAlternatives) {
      body.alternates = 1;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 9000);
    const res = await fetch(valhallaUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    clearTimeout(timeout);

    if (res.ok) {
      const data = await res.json();
      if (data.trip && data.trip.legs && data.trip.legs.length > 0) {
        const leg = data.trip.legs[0];
        const coordinates = decodeValhallaShape(leg.shape, 6);
        const distanceKm = Math.round(data.trip.summary.length * 10) / 10;
        const durationMinutes = Math.round(data.trip.summary.time / 60);

        const primaryRoute = {
          id: 'route_1',
          name: `Primary Route (Valhalla)`,
          distanceKm,
          durationMinutes,
          coordinates,
          start,
          end,
          vehicleType,
          routeSource: 'valhalla',
          routeSourceBadge: `Valhalla (${vehicleType})`,
          speedBasis: 'route-engine',
          isApproximate: false,
          impliedSpeedKmH: durationMinutes > 0 ? Math.round((distanceKm / (durationMinutes / 60)) * 10) / 10 : 0,
          rawResponse: data
        };

        const routes = [primaryRoute];

        // 4c: Get alternatives from Valhalla with "alternates" option for same costing
        if (requestAlternatives && data.alternates && Array.isArray(data.alternates)) {
          data.alternates.forEach((alt, idx) => {
            if (alt.trip && alt.trip.legs && alt.trip.legs.length > 0) {
              const altLeg = alt.trip.legs[0];
              const altCoords = decodeValhallaShape(altLeg.shape, 6);
              const altDist = Math.round(alt.trip.summary.length * 10) / 10;
              const altDur = Math.round(alt.trip.summary.time / 60);
              routes.push({
                id: `route_${idx + 2}`,
                name: `Alternative Route ${idx + 1} (Valhalla)`,
                distanceKm: altDist,
                durationMinutes: altDur,
                coordinates: altCoords,
                start,
                end,
                vehicleType,
                routeSource: 'valhalla',
                routeSourceBadge: `Valhalla (${vehicleType})`,
                speedBasis: 'route-engine',
                isApproximate: false,
                impliedSpeedKmH: altDur > 0 ? Math.round((altDist / (altDur / 60)) * 10) / 10 : 0
              });
            }
          });
        }

        return routes;
      }
    } else {
      // 4a: Log the exact Valhalla failure (HTTP status and response body)
      const errText = await res.text();
      console.warn(`Valhalla routing failure: HTTP ${res.status} ${res.statusText} - ${errText}`);
    }
  } catch (valhallaErr) {
    console.warn('Valhalla routing error, switching to OSM-hosted servers:', valhallaErr.message);
  }

  // 2. Try Secondary: OSM-Hosted Routing Servers (routed-bike, routed-foot, routed-car)
  // https://routing.openstreetmap.de/routed-bike/route/v1/driving/...
  // https://routing.openstreetmap.de/routed-foot/route/v1/driving/...
  // https://routing.openstreetmap.de/routed-car/route/v1/driving/...
  const serversToTry = [];
  if (vehicleType === 'bicycle') {
    serversToTry.push({ server: 'routed-bike', source: 'osm-bike', badge: 'OSM bike server', speedBasis: 'profile', approx: false });
    serversToTry.push({ server: 'routed-car', source: 'osm-car-approx', badge: 'Approximate: car routing', speedBasis: 'profile', approx: true });
  } else if (vehicleType === 'pedestrian') {
    serversToTry.push({ server: 'routed-foot', source: 'osm-foot', badge: 'OSM foot server', speedBasis: 'profile', approx: false });
    serversToTry.push({ server: 'routed-car', source: 'osm-car-approx', badge: 'Approximate: car routing', speedBasis: 'profile', approx: true });
  } else if (vehicleType === 'car') {
    serversToTry.push({ server: 'routed-car', source: 'osm-car-approx', badge: 'OSM car server', speedBasis: 'route-engine', approx: false });
  } else {
    serversToTry.push({ server: 'routed-car', source: 'osm-car-approx', badge: 'Approximate: car routing', speedBasis: 'route-engine', approx: true });
  }

  const coordsParam = `${start.lon},${start.lat};${end.lon},${end.lat}`;

  for (const s of serversToTry) {
    // Removed steps=true per Task 4b
    const osmUrl = `https://routing.openstreetmap.de/${s.server}/route/v1/driving/${coordsParam}?overview=full&geometries=geojson&alternatives=${requestAlternatives ? 'true' : 'false'}`;

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 9000);
      const res = await fetch(osmUrl, { signal: controller.signal });
      clearTimeout(timeout);

      if (res.ok) {
        const data = await res.json();
        if (data.routes && data.routes.length > 0) {
          return data.routes.map((r, idx) => {
            const distKm = Math.round((r.distance / 1000) * 10) / 10;
            const durMin = Math.round(r.duration / 60);

            return {
              id: `route_${idx + 1}`,
              name: idx === 0 ? `Primary Route (${s.badge})` : `Alternative Route ${idx}`,
              distanceKm: distKm,
              durationMinutes: durMin,
              coordinates: r.geometry.coordinates.map(c => [c[1], c[0]]),
              start,
              end,
              vehicleType,
              routeSource: s.source,
              routeSourceBadge: s.badge,
              speedBasis: s.speedBasis,
              isApproximate: s.approx,
              impliedSpeedKmH: durMin > 0 ? Math.round((distKm / (durMin / 60)) * 10) / 10 : 0,
              rawResponse: data
            };
          });
        }
      }
    } catch (osmErr) {
      console.error(`OSM routing (${s.server}) failed:`, osmErr.message);
    }
  }

  // 3. NO SILENT FALLBACK: Throw clear error so user is notified of live network failure
  throw new Error(`Unable to reach live routing servers (Valhalla & OSM) for "${start.name}" → "${end.name}". Please verify connectivity or pick nearby locations.`);
}

export function computeHaversine(lat1, lon1, lat2, lon2) {
  const R = 6371; // km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export function calculateHeading(lat1, lon1, lat2, lon2) {
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const y = Math.sin(dLon) * Math.cos(lat2 * Math.PI / 180);
  const x =
    Math.cos(lat1 * Math.PI / 180) * Math.sin(lat2 * Math.PI / 180) -
    Math.sin(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.cos(dLon);
  const brng = Math.atan2(y, x) * 180 / Math.PI;
  return (brng + 360) % 360;
}
