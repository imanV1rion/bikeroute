/**
 * Trip Weather System - Real-time Elevation Service
 * Queries the official Open-Meteo Elevation API for 100% genuine topographical data.
 * Zero simulated curves or fallback constants (elevation is null if unavailable).
 */

import { computeHaversine } from './routingService.js';

/**
 * Fetches real elevations for an array of coordinates from Open-Meteo Elevation API.
 * Respects Open-Meteo's max 100 coordinates per request limit.
 * If fetch fails, returns null for each coordinate (never 50).
 * @param {Array<{lat: number, lon: number}>} points
 * @returns {Promise<Array<number|null>>} Elevations in meters or null
 */
export async function fetchRealElevations(points) {
  if (!points || points.length === 0) return [];

  const CHUNK_SIZE = 100;
  const results = [];

  for (let i = 0; i < points.length; i += CHUNK_SIZE) {
    const chunk = points.slice(i, i + CHUNK_SIZE);
    const lats = chunk.map(p => (Math.round(p.lat * 1000) / 1000).toFixed(3)).join(',');
    const lons = chunk.map(p => (Math.round(p.lon * 1000) / 1000).toFixed(3)).join(',');

    const url = `https://api.open-meteo.com/v1/elevation?latitude=${lats}&longitude=${lons}`;

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timeout);

      if (res.ok) {
        const data = await res.json();
        if (data && Array.isArray(data.elevation)) {
          const mapped = data.elevation.map(e => (e !== null && e !== undefined && !isNaN(e)) ? Math.round(e) : null);
          results.push(...mapped);
          continue;
        }
      }
      results.push(...chunk.map(() => null));
    } catch (err) {
      console.warn('Real-time Open-Meteo elevation query error:', err.message);
      results.push(...chunk.map(() => null));
    }
  }

  return results;
}

/**
 * Builds a dense elevation profile along the route polyline (every 2-3 km).
 * @param {Array<[number, number]>} coordinates [[lat, lon], ...]
 * @param {number} stepKm Interval between dense points (default 2.5 km)
 * @returns {Promise<Array<{distanceKm: number, lat: number, lon: number, elevationM: number|null}>>}
 */
export async function fetchDenseElevationProfile(coordinates, stepKm = 2.5) {
  if (!coordinates || coordinates.length === 0) return [];

  const cumulativeKm = [0];
  let runningDist = 0;
  for (let i = 1; i < coordinates.length; i++) {
    const d = computeHaversine(
      coordinates[i - 1][0], coordinates[i - 1][1],
      coordinates[i][0], coordinates[i][1]
    );
    runningDist += d;
    cumulativeKm.push(runningDist);
  }

  const densePoints = [];
  let lastSampledKm = 0;

  densePoints.push({
    distanceKm: 0,
    lat: coordinates[0][0],
    lon: coordinates[0][1]
  });

  for (let i = 1; i < coordinates.length - 1; i++) {
    const distFromLast = cumulativeKm[i] - lastSampledKm;
    if (distFromLast >= stepKm) {
      densePoints.push({
        distanceKm: Math.round(cumulativeKm[i] * 10) / 10,
        lat: coordinates[i][0],
        lon: coordinates[i][1]
      });
      lastSampledKm = cumulativeKm[i];
    }
  }

  const lastIdx = coordinates.length - 1;
  if (lastIdx > 0) {
    densePoints.push({
      distanceKm: Math.round(cumulativeKm[lastIdx] * 10) / 10,
      lat: coordinates[lastIdx][0],
      lon: coordinates[lastIdx][1]
    });
  }

  const elevations = await fetchRealElevations(densePoints);
  return densePoints.map((pt, idx) => ({
    ...pt,
    elevationM: elevations[idx] ?? null
  }));
}
