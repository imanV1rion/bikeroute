import { describe, it, expect, vi } from 'vitest';
import { detectMountainPasses, enrichWithRealTopography } from '../src/services/sampler.js';
import { fetchRealElevations } from '../src/services/elevationService.js';

describe('TASK 3: Real Terrain, No Fake Tags', () => {
  it('steady climb 500-1200 m gives zero passes', () => {
    // Generate dense profile every 2.5 km from 0 to 70 km, climbing 500m to 1200m steadily
    const denseProfile = [];
    const count = 30;
    for (let i = 0; i < count; i++) {
      denseProfile.push({
        distanceKm: i * 2.5,
        lat: 25.0 + i * 0.02,
        lon: 80.0 + i * 0.02,
        elevationM: 500 + (700 / (count - 1)) * i // 500 to 1200 m
      });
    }

    const passes = detectMountainPasses(denseProfile);
    expect(passes.length).toBe(0);
  });

  it('a profile with a 600 m rise and a 600 m drop gives one pass', () => {
    const denseProfile = [];
    // Rise 0 to 600m over 15 points, then drop 600m to 0m over 15 points
    for (let i = 0; i <= 15; i++) {
      denseProfile.push({
        distanceKm: i * 2,
        lat: 25.0 + i * 0.01,
        lon: 80.0,
        elevationM: (600 / 15) * i
      });
    }
    for (let i = 1; i <= 15; i++) {
      denseProfile.push({
        distanceKm: 30 + i * 2,
        lat: 25.15 + i * 0.01,
        lon: 80.0,
        elevationM: 600 - (600 / 15) * i
      });
    }

    const passes = detectMountainPasses(denseProfile);
    expect(passes.length).toBe(1);
    expect(passes[0].elevationM).toBe(600);
    expect(passes[0].distanceKm).toBe(30);
  });

  it('flat delta data gives no terrain tags', () => {
    const denseProfile = [];
    for (let i = 0; i < 20; i++) {
      denseProfile.push({
        distanceKm: i * 2.5,
        lat: 22.0 + i * 0.02,
        lon: 88.0,
        elevationM: 10 + (i % 3) * 2 // 10m to 14m delta
      });
    }

    const passes = detectMountainPasses(denseProfile);
    expect(passes.length).toBe(0);

    const samplePoints = [
      { id: 's0', distanceKm: 0, lat: 22.0, lon: 88.0, elevationM: 10, type: 'start' },
      { id: 's1', distanceKm: 25, lat: 22.2, lon: 88.0, elevationM: 12, type: 'regular' },
      { id: 's2', distanceKm: 50, lat: 22.4, lon: 88.0, elevationM: 10, type: 'end' }
    ];

    enrichWithRealTopography(samplePoints, denseProfile);
    // No points should be tagged as coastal or mountain_pass
    samplePoints.forEach(pt => {
      expect(pt.type).not.toBe('coastal');
      expect(pt.type).not.toBe('mountain_pass');
    });
  });

  it('fetchRealElevations chunks requests to at most 100 coordinates and returns null on failure (never 50)', async () => {
    // Generate 150 coordinates
    const testPoints = [];
    for (let i = 0; i < 150; i++) {
      testPoints.push({ lat: 20 + i * 0.01, lon: 80 + i * 0.01 });
    }

    // Mock global fetch to verify chunk size
    const fetchSpy = vi.spyOn(global, 'fetch').mockImplementation(async (url) => {
      const urlObj = new URL(url);
      const lats = urlObj.searchParams.get('latitude').split(',');
      expect(lats.length).toBeLessThanOrEqual(100);
      return {
        ok: true,
        json: async () => ({ elevation: lats.map(() => 123) })
      };
    });

    const result = await fetchRealElevations(testPoints);
    expect(result.length).toBe(150);
    expect(fetchSpy).toHaveBeenCalledTimes(2); // 100 + 50
    fetchSpy.mockRestore();

    // Now test failure returns null, never 50
    const failSpy = vi.spyOn(global, 'fetch').mockRejectedValue(new Error('Network error'));
    const failResult = await fetchRealElevations(testPoints.slice(0, 5));
    expect(failResult).toEqual([null, null, null, null, null]);
    expect(failResult.includes(50)).toBe(false);
    failSpy.mockRestore();
  });
});
