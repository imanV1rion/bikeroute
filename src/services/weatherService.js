/**
 * Trip Weather System - Weather Service
 * Connects to Open-Meteo API with 0.1° grid + fetch hour time caching.
 * Batches multi-point queries into a single HTTP request whenever possible.
 */

// In-memory cache: key -> { timestamp, data }
const forecastCache = new Map();
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

let cacheHits = 0;
let cacheMisses = 0;

export function getCacheStats() {
  return {
    hits: cacheHits,
    misses: cacheMisses,
    totalEntries: forecastCache.size,
    ttlMinutes: CACHE_TTL_MS / 60000
  };
}

export function clearCache() {
  forecastCache.clear();
  cacheHits = 0;
  cacheMisses = 0;
}

/**
 * Calculates forecast_days needed for the trip (Task 5d):
 * ceil((departure - now + trip duration + 12 h) / 24) + 1, at most 16.
 */
export function calculateForecastDays(departureDate = new Date(), tripDurationMinutes = 0) {
  const now = Date.now();
  const departureMs = departureDate instanceof Date ? departureDate.getTime() : new Date(departureDate).getTime();
  const durationMs = (tripDurationMinutes || 0) * 60 * 1000;
  const hoursUntilEnd = Math.max(0, (departureMs - now + durationMs + 12 * 3600 * 1000) / (3600 * 1000));
  const days = Math.ceil(hoursUntilEnd / 24) + 1;
  return Math.min(16, Math.max(1, days));
}

/**
 * Creates cache key per Task 5f:
 * grid cell + forecast_days + fetch hour (not the trip start hour).
 */
function createGridCacheKey(lat, lon, forecastDays, fetchHourTimestamp) {
  const roundedLat = (Math.round(lat * 10) / 10).toFixed(1);
  const roundedLon = (Math.round(lon * 10) / 10).toFixed(1);
  return `${roundedLat},${roundedLon}_fd${forecastDays}_fh${fetchHourTimestamp}`;
}

/**
 * Fetches hourly forecast data for a list of sample points along the route.
 * @param {Array<{lat: number, lon: number, id: string}>} points
 * @param {Date} tripStartDate
 * @param {number} tripDurationMinutes
 * @returns {Promise<Map<string, Object>>} Map of pointId -> { status, forecast, cached }
 */
export async function fetchRouteWeather(points, tripStartDate = new Date(), tripDurationMinutes = 0) {
  if (!points || points.length === 0) {
    return new Map();
  }

  const resultMap = new Map();
  const pointsToFetch = [];
  const now = Date.now();
  const forecastDays = calculateForecastDays(tripStartDate, tripDurationMinutes);
  const fetchHourTimestamp = Math.floor(now / (3600 * 1000));

  // 1. Check cache for each point
  for (const pt of points) {
    const key = createGridCacheKey(pt.lat, pt.lon, forecastDays, fetchHourTimestamp);
    const cached = forecastCache.get(key);

    if (cached && (now - cached.timestamp < CACHE_TTL_MS)) {
      resultMap.set(pt.id, {
        status: 'ok',
        forecast: cached.data,
        cached: true,
        cacheTime: cached.timestamp
      });
    } else {
      pointsToFetch.push({ ...pt, cacheKey: key });
    }
  }

  // Count hits per request, not per point (Task 5f)
  if (pointsToFetch.length === 0) {
    cacheHits++;
    return resultMap;
  }

  cacheMisses++;

  // 2. Open-Meteo multi-location query
  // Deduplicate coordinates by 0.1° grid to minimize request payload
  const uniqueCoordinates = new Map();
  for (const pt of pointsToFetch) {
    const gridKey = `${(Math.round(pt.lat * 10) / 10).toFixed(1)},${(Math.round(pt.lon * 10) / 10).toFixed(1)}`;
    if (!uniqueCoordinates.has(gridKey)) {
      uniqueCoordinates.set(gridKey, {
        lat: (Math.round(pt.lat * 1000) / 1000),
        lon: (Math.round(pt.lon * 1000) / 1000),
        gridKey
      });
    }
  }

  const uniqueList = Array.from(uniqueCoordinates.values());
  const lats = uniqueList.map(u => u.lat).join(',');
  const lons = uniqueList.map(u => u.lon).join(',');

  const hourlyParams = [
    'temperature_2m',
    'apparent_temperature',
    'precipitation',
    'precipitation_probability',
    'weather_code',
    'wind_speed_10m',
    'wind_direction_10m',
    'wind_gusts_10m',
    'visibility',
    'snowfall',
    'soil_temperature_0cm',
    'is_day'
  ].join(',');

  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lats}&longitude=${lons}&hourly=${hourlyParams}&forecast_days=${forecastDays}&wind_speed_unit=kmh&timeformat=unixtime`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 9000);

  try {
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`Open-Meteo HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    const responsesArray = Array.isArray(data) ? data : [data];

    // Map responses back to unique coordinate entries
    const gridDataMap = new Map();
    uniqueList.forEach((item, index) => {
      const forecastItem = responsesArray[index];
      gridDataMap.set(item.gridKey, forecastItem);
    });

    // Store in cache and assemble results
    for (const pt of pointsToFetch) {
      const gridKey = `${(Math.round(pt.lat * 10) / 10).toFixed(1)},${(Math.round(pt.lon * 10) / 10).toFixed(1)}`;
      const forecastItem = gridDataMap.get(gridKey);

      if (forecastItem && forecastItem.hourly && forecastItem.hourly.time && forecastItem.hourly.time.length > 0) {
        forecastCache.set(pt.cacheKey, {
          timestamp: now,
          data: forecastItem.hourly
        });

        resultMap.set(pt.id, {
          status: 'ok',
          forecast: forecastItem.hourly,
          cached: false,
          cacheTime: now
        });
      } else {
        // Task 5a: If a point has no forecast, mark it status "missing"
        resultMap.set(pt.id, {
          status: 'missing',
          forecast: null,
          cached: false
        });
      }
    }

    return resultMap;
  } catch (err) {
    clearTimeout(timeoutId);
    console.error('Weather Service Error:', err);
    throw new Error(`Failed to retrieve live forecast from Open-Meteo: ${err.message}. Please check connection or try again.`);
  }
}

/**
 * WMO Weather Code interpreter
 */
export function interpretWeatherCode(code) {
  switch (code) {
    case 0: return { label: 'Clear sky', icon: '☀️', severity: 'none' };
    case 1: return { label: 'Mainly clear', icon: '🌤️', severity: 'none' };
    case 2: return { label: 'Partly cloudy', icon: '⛅', severity: 'none' };
    case 3: return { label: 'Overcast', icon: '☁️', severity: 'low' };
    case 45: return { label: 'Fog', icon: '🌫️', severity: 'medium' };
    case 48: return { label: 'Depositing rime fog', icon: '🌫️', severity: 'medium' };
    case 51: return { label: 'Light drizzle', icon: '🌦️', severity: 'low' };
    case 53: return { label: 'Moderate drizzle', icon: '🌧️', severity: 'medium' };
    case 55: return { label: 'Dense drizzle', icon: '🌧️', severity: 'medium' };
    case 56: return { label: 'Light freezing drizzle', icon: '🌨️', severity: 'high' };
    case 57: return { label: 'Dense freezing drizzle', icon: '🌨️', severity: 'high' };
    case 61: return { label: 'Slight rain', icon: '🌦️', severity: 'low' };
    case 63: return { label: 'Moderate rain', icon: '🌧️', severity: 'medium' };
    case 65: return { label: 'Heavy rain', icon: '⛈️', severity: 'high' };
    case 66: return { label: 'Light freezing rain', icon: '🌨️', severity: 'high' };
    case 67: return { label: 'Heavy freezing rain', icon: '🌨️', severity: 'critical' };
    case 71: return { label: 'Slight snow', icon: '🌨️', severity: 'medium' };
    case 73: return { label: 'Moderate snow', icon: '❄️', severity: 'high' };
    case 75: return { label: 'Heavy snow', icon: '❄️', severity: 'critical' };
    case 77: return { label: 'Snow grains', icon: '🌨️', severity: 'medium' };
    case 80: return { label: 'Slight rain showers', icon: '🌦️', severity: 'low' };
    case 81: return { label: 'Moderate rain showers', icon: '🌧️', severity: 'medium' };
    case 82: return { label: 'Violent rain showers', icon: '⛈️', severity: 'critical' };
    case 85: return { label: 'Slight snow showers', icon: '🌨️', severity: 'medium' };
    case 86: return { label: 'Heavy snow showers', icon: '❄️', severity: 'critical' };
    case 95: return { label: 'Thunderstorm', icon: '⛈️', severity: 'critical' };
    case 96: return { label: 'Thunderstorm with slight hail', icon: '⛈️', severity: 'critical' };
    case 99: return { label: 'Thunderstorm with heavy hail', icon: '⛈️', severity: 'critical' };
    default: return { label: 'Variable conditions', icon: '🌤️', severity: 'none' };
  }
}
