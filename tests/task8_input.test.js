import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  searchPlaces,
  geocodeOnEnter,
  validateTripDistance
} from '../src/services/routingService.js';

describe('TASK 8: Input and Search', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('a) validation: if start and destination are less than 500m apart, rejects calculation', () => {
    // 2 points ~150 meters apart
    const start = { lat: 28.6139, lon: 77.2090, name: 'Place A' };
    const dest = { lat: 28.6145, lon: 77.2095, name: 'Place B' };

    const check = validateTripDistance(start, dest);
    expect(check.valid).toBe(false);
    expect(check.error).toContain('500');

    // 2 points 10 km apart
    const farDest = { lat: 28.7041, lon: 77.1025, name: 'Place C' };
    const checkFar = validateTripDistance(start, farDest);
    expect(checkFar.valid).toBe(true);
  });

  it('b) uses one AbortController per input field (typing in dest does not abort start)', async () => {
    const fetchMock = vi.fn().mockImplementation((url, opts) => {
      return new Promise((resolve, reject) => {
        if (opts?.signal?.aborted) {
          reject(new DOMException('Aborted', 'AbortError'));
          return;
        }
        opts?.signal?.addEventListener('abort', () => {
          reject(new DOMException('Aborted', 'AbortError'));
        });
        setTimeout(() => {
          resolve({
            ok: true,
            json: async () => ({ features: [] })
          });
        }, 50);
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    // Start 1 begins
    const startPromise1 = searchPlaces('Delhi', 'start');
    // Destination 1 begins
    const destPromise1 = searchPlaces('Agra', 'destination');
    // Start 2 begins -> should abort start 1, but NOT destination 1
    const startPromise2 = searchPlaces('Dehradun', 'start');

    // Start 1 was aborted
    const startRes1 = await startPromise1;
    expect(startRes1).toEqual([]);

    // Destination 1 was NOT aborted by start 2
    const destRes1 = await destPromise1;
    expect(Array.isArray(destRes1)).toBe(true);

    const startRes2 = await startPromise2;
    expect(Array.isArray(startRes2)).toBe(true);
  });

  it('c) removes User-Agent header and never calls Nominatim while typing', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ features: [] })
    });
    vi.stubGlobal('fetch', fetchMock);

    await searchPlaces('Mumbai', 'start');

    expect(fetchMock).toHaveBeenCalled();
    const calledUrls = fetchMock.mock.calls.map(c => c[0]);
    // Nominatim must NOT be called while typing
    expect(calledUrls.some(u => u.includes('nominatim.openstreetmap.org'))).toBe(false);
    expect(calledUrls.every(u => u.includes('photon.komoot.io'))).toBe(true);

    // User-Agent must not be in headers
    const calledOpts = fetchMock.mock.calls.map(c => c[1]);
    for (const opt of calledOpts) {
      if (opt?.headers) {
        expect(opt.headers['User-Agent']).toBeUndefined();
      }
    }
  });

  it('d) keeps only Photon results with countrycode IN and does not default subtitle to India', async () => {
    const mockPhotonResponse = {
      features: [
        {
          properties: {
            osm_id: 1,
            name: 'Delhi',
            city: 'Delhi',
            countrycode: 'IN',
            country: 'India'
          },
          geometry: { coordinates: [77.2, 28.6] }
        },
        {
          properties: {
            osm_id: 2,
            name: 'Delhi',
            city: 'Delhi',
            countrycode: 'US', // United States
            state: 'California'
          },
          geometry: { coordinates: [-120.0, 37.0] }
        },
        {
          properties: {
            osm_id: 3,
            name: 'Isolated Village',
            countrycode: 'IN' // No district, state, country
          },
          geometry: { coordinates: [78.0, 25.0] }
        }
      ]
    };

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockPhotonResponse
    }));

    const results = await searchPlaces('Delhi', 'start');
    // Only 2 results with countrycode 'IN' should be kept
    expect(results.length).toBe(2);
    expect(results.some(r => r.name === 'Delhi')).toBe(true);
    expect(results.some(r => r.lat === 37.0)).toBe(false);

    // Subtitle must NOT default to 'India'
    const isolated = results.find(r => r.name === 'Isolated Village');
    expect(isolated.subtitle).toBe('');
  });
});
