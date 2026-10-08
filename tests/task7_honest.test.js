import { describe, it, expect, vi } from 'vitest';
import * as alertWorker from '../src/services/alertWorker.js';
import { computeEvEfficiencyImpact } from '../src/services/scoringEngine.js';

describe('TASK 7: Fake Features and Honest Names', () => {
  it('a) getOfficialWeatherBulletins is deleted', () => {
    expect(alertWorker.getOfficialWeatherBulletins).toBeUndefined();
  });

  it('b) recheckSavedTrips alerts if score drops >= 15 pts or new critical warning appears', async () => {
    expect(typeof alertWorker.recheckSavedTrips).toBe('function');

    const sampleTrip = {
      id: 'trip-1',
      name: 'Delhi to Agra',
      departureTime: new Date().toISOString(),
      vehicleProfile: { id: 'car', name: 'Car', hazards: {} },
      samplePoints: [{ id: 'p1', lat: 28.6, lon: 77.2, distanceKm: 0 }],
      scoreResult: {
        tripScore: 85,
        hasCriticalWarning: false,
        warnings: []
      }
    };

    // Case 1: Score drops by 20 points (85 -> 65)
    const mockWeatherFetch = vi.fn().mockResolvedValue(new Map());
    const mockScoreFn1 = vi.fn().mockReturnValue({
      tripScore: 65,
      hasCriticalWarning: false,
      warnings: []
    });

    const alerts1 = await alertWorker.recheckSavedTrips([sampleTrip], mockWeatherFetch, mockScoreFn1);
    expect(alerts1.length).toBe(1);
    expect(alerts1[0].reason).toContain('score_drop');

    // Case 2: Score drops only by 5 points, but new critical warning appears
    const mockScoreFn2 = vi.fn().mockReturnValue({
      tripScore: 80,
      hasCriticalWarning: true,
      warnings: [{ severity: 'critical', title: 'Severe Thunderstorm Danger' }]
    });

    const alerts2 = await alertWorker.recheckSavedTrips([sampleTrip], mockWeatherFetch, mockScoreFn2);
    expect(alerts2.length).toBe(1);
    expect(alerts2[0].reason).toContain('critical_warning');

    // Case 3: Score drops by only 5 points and no critical warning
    const mockScoreFn3 = vi.fn().mockReturnValue({
      tripScore: 80,
      hasCriticalWarning: false,
      warnings: []
    });

    const alerts3 = await alertWorker.recheckSavedTrips([sampleTrip], mockWeatherFetch, mockScoreFn3);
    expect(alerts3.length).toBe(0);
  });

  it('c) computeEvEfficiencyImpact weights by leg distance, not per sample point', () => {
    // 2 segments:
    // Pt 0 at km 0
    // Pt 1 at km 10 (short leg: 10 km) - mild temp 20C (factor 1.0) -> 175 Wh/km
    // Pt 2 at km 100 (long leg: 90 km) - freezing temp -5C (factor 1.35) -> 175 * 1.35 = 236 Wh/km
    const scoredPoints = [
      { distanceKm: 0, weather: { temperature: 20 }, wind: { headwind: 0 } },
      { distanceKm: 10, weather: { temperature: 20 }, wind: { headwind: 0 } },
      { distanceKm: 100, weather: { temperature: -5 }, wind: { headwind: 0 } }
    ];

    const result = computeEvEfficiencyImpact(scoredPoints);
    // Unweighted average would be (175 + 175 + 236) / 3 = 195 Wh/km
    // Weighted average: (10 * 175 + 90 * 236.25) / 100 = 230 Wh/km
    expect(result.estimatedWhPerKm).toBeGreaterThan(215);
  });
});
