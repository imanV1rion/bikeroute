import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  fetchRouteWeather,
  clearCache,
  getCacheStats
} from '../src/services/weatherService.js';
import * as weatherService from '../src/services/weatherService.js';
import {
  interpolateHourlyForecast,
  scoreTripRoute,
  calculateCheckpointEtas
} from '../src/services/scoringEngine.js';
import { DEFAULT_PROFILES } from '../src/models/vehicleProfiles.js';

describe('TASK 5: No Fake or Hidden Data', () => {
  beforeEach(() => {
    clearCache();
    vi.restoreAllMocks();
  });

  it('no function may return synthetic weather', async () => {
    // createSyntheticFallback must not exist
    expect(weatherService.createSyntheticFallback).toBeUndefined();

    // Mock fetch returning empty response
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [{}] // no hourly data
    }));

    const points = [{ id: 'pt-1', lat: 28.6, lon: 77.2, distanceKm: 5 }];
    const result = await fetchRouteWeather(points, new Date());
    const ptResult = result.get('pt-1');

    expect(ptResult.status).toBe('missing');
    expect(ptResult.forecast).toBeNull();
    expect(ptResult.isSynthetic).toBeUndefined();
  });

  it('interpolateHourlyForecast returns null for missing fields, not defaults', () => {
    const hourlyData = {
      time: [1700000000, 1700003600],
      temperature_2m: [null, null],
      apparent_temperature: [null, null],
      precipitation: [null, null],
      wind_speed_10m: [null, null],
      visibility: [null, null]
    };
    const target = new Date(1700001800 * 1000);
    const interp = interpolateHourlyForecast(hourlyData, target);

    expect(interp).not.toBeNull();
    expect(interp.temperature).toBeNull();
    expect(interp.apparentTemperature).toBeNull();
    expect(interp.precipitation).toBeNull();
    expect(interp.windSpeed).toBeNull();
    expect(interp.visibility).toBeNull();
  });

  it('missing fields give no false fog or ice warning and lists missing fields', () => {
    const bike = DEFAULT_PROFILES.bicycle;
    const samplePoints = [
      { id: 'p1', lat: 28.6, lon: 77.2, distanceKm: 0, heading: 90, elevation: 100 },
      { id: 'p2', lat: 28.7, lon: 77.3, distanceKm: 15, heading: 90, elevation: 100 }
    ];
    const weatherDataMap = new Map();
    // Incomplete weather: visibility is null, temperature is null
    weatherDataMap.set('p1', {
      forecast: {
        time: [1700000000, 1700003600],
        temperature_2m: [null, null],
        visibility: [null, null]
      }
    });
    weatherDataMap.set('p2', {
      forecast: {
        time: [1700000000, 1700003600],
        temperature_2m: [null, null],
        visibility: [null, null]
      }
    });

    const route = { durationMinutes: 60, distanceKm: 15, speedBasis: 'profile' };
    const scoreResult = scoreTripRoute(samplePoints, weatherDataMap, bike, new Date(1700000500 * 1000), route);

    const warnings = scoreResult.warnings;
    expect(warnings.some(w => w.type === 'fog')).toBe(false);
    expect(warnings.some(w => w.type === 'ice')).toBe(false);

    const scoredP1 = scoreResult.scoredPoints[0];
    expect(scoredP1.missingFields).toBeDefined();
    expect(scoredP1.missingFields).toContain('temperature');
    expect(scoredP1.missingFields).toContain('visibility');
  });

  it('out-of-range ETA returns {outOfRange: true} and gives a warning without reusing the last hour', () => {
    const hourlyData = {
      time: [1700000000, 1700003600], // 1 hour range
      temperature_2m: [25, 26]
    };
    // Target 5 hours after range
    const target = new Date(1700020000 * 1000);
    const interp = interpolateHourlyForecast(hourlyData, target);

    expect(interp).toEqual({ outOfRange: true });

    // In scoringEngine:
    const bike = DEFAULT_PROFILES.bicycle;
    const samplePoints = [
      { id: 'p1', lat: 28.6, lon: 77.2, distanceKm: 0, heading: 90, elevation: 100 }
    ];
    const weatherDataMap = new Map();
    weatherDataMap.set('p1', { forecast: hourlyData });

    const route = { durationMinutes: 60, distanceKm: 15, speedBasis: 'profile' };
    const scoreResult = scoreTripRoute(samplePoints, weatherDataMap, bike, target, route);

    expect(scoreResult.warnings.some(w => w.title.includes('Out of Range') || w.type === 'outOfRange')).toBe(true);
  });

  it('changing the departure causes zero extra network calls and hits increment per request', async () => {
    const mockHourly = {
      time: Array.from({ length: 72 }, (_, i) => 1700000000 + i * 3600),
      temperature_2m: Array(72).fill(25),
      precipitation: Array(72).fill(0),
      weather_code: Array(72).fill(1),
      wind_speed_10m: Array(72).fill(10),
      wind_direction_10m: Array(72).fill(180)
    };

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [{ hourly: mockHourly }]
    });
    vi.stubGlobal('fetch', fetchMock);

    const points = [{ id: 'p1', lat: 28.61, lon: 77.23, distanceKm: 0 }];
    const dep1 = new Date(1700000000 * 1000);
    const dep2 = new Date(1700010000 * 1000); // 2.7 hours later, same fetch hour

    await fetchRouteWeather(points, dep1, 120);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const stats1 = getCacheStats();
    expect(stats1.misses).toBe(1); // 1 request miss
    expect(stats1.hits).toBe(0);

    // Second call with different departure time
    await fetchRouteWeather(points, dep2, 120);
    expect(fetchMock).toHaveBeenCalledTimes(1); // Zero extra network calls!

    const stats2 = getCacheStats();
    expect(stats2.hits).toBe(1); // 1 request hit
  });

  it('Pass-2 loop does not crash when weather is null', () => {
    const bike = DEFAULT_PROFILES.bicycle;
    const samplePoints = [
      { id: 'p1', lat: 28.6, lon: 77.2, distanceKm: 0, heading: 90, elevation: 100 },
      { id: 'p2', lat: 28.7, lon: 77.3, distanceKm: 15, heading: 90, elevation: 100 }
    ];
    const route = { durationMinutes: 60, distanceKm: 15, speedBasis: 'profile' };

    // Pass null weather map
    expect(() => {
      scoreTripRoute(samplePoints, null, bike, new Date(), route);
    }).not.toThrow();

    // Pass empty weather map
    expect(() => {
      scoreTripRoute(samplePoints, new Map(), bike, new Date(), route);
    }).not.toThrow();
  });
});
