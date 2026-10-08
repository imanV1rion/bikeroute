import { describe, it, expect, vi, afterEach } from 'vitest';
import { calculateRoute } from '../src/services/routingService.js';

describe('TASK 4: Routing Fallbacks & Server Switching', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const start = { lat: 22.57, lon: 88.36, name: 'Kolkata' };
  const end = { lat: 26.72, lon: 88.39, name: 'Siliguri' };

  it('bicycle must call the bike server on fallback', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockImplementation(async (url) => {
      if (typeof url === 'string' && url.includes('valhalla')) {
        return {
          ok: false,
          status: 400,
          statusText: 'Bad Request',
          text: async () => '{"error_code":154,"error":"Path distance exceeds the max distance limit: 150000 meters"}'
        };
      }
      if (typeof url === 'string' && url.includes('routing.openstreetmap.de/routed-bike')) {
        return {
          ok: true,
          json: async () => ({
            routes: [
              {
                distance: 577000,
                duration: 90000,
                geometry: { coordinates: [[88.36, 22.57], [88.39, 26.72]] }
              }
            ]
          })
        };
      }
      throw new Error(`Unexpected url: ${url}`);
    });

    const routes = await calculateRoute(start, end, 'bicycle', false);
    expect(routes.length).toBeGreaterThan(0);
    const r = routes[0];
    expect(r.routeSource).toBe('osm-bike');
    expect(r.speedBasis).toBe('profile');

    // Verify bike fallback server was called
    const bikeCall = fetchSpy.mock.calls.find(call => typeof call[0] === 'string' && call[0].includes('routed-bike'));
    expect(bikeCall).toBeDefined();
    // Verify steps=true is removed
    expect(bikeCall[0]).not.toContain('steps=true');
  });

  it('motorcycle must show the "approximate" flag on fallback', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(async (url) => {
      if (typeof url === 'string' && url.includes('valhalla')) {
        return {
          ok: false,
          status: 500,
          statusText: 'Internal Server Error',
          text: async () => 'Server error'
        };
      }
      if (typeof url === 'string' && url.includes('routing.openstreetmap.de/routed-car')) {
        return {
          ok: true,
          json: async () => ({
            routes: [
              {
                distance: 120000,
                duration: 7200,
                geometry: { coordinates: [[88.36, 22.57], [88.39, 26.72]] }
              }
            ]
          })
        };
      }
      throw new Error(`Unexpected url: ${url}`);
    });

    const routes = await calculateRoute(start, end, 'motorcycle', false);
    expect(routes.length).toBeGreaterThan(0);
    const r = routes[0];
    expect(r.routeSource).toBe('osm-car-approx');
    expect(r.isApproximate).toBe(true);
  });

  it('failure of all servers must throw a clear error', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(async () => {
      return {
        ok: false,
        status: 503,
        statusText: 'Service Unavailable',
        text: async () => 'All servers down'
      };
    });

    await expect(calculateRoute(start, end, 'bicycle', false)).rejects.toThrowError(
      /routing/i
    );
  });
});
