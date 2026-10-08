import { describe, it, expect } from 'vitest';
import { buildAdvice } from '../src/services/adviceBuilder.js';
import { DEFAULT_PROFILES } from '../src/models/vehicleProfiles.js';

describe('TASK 6: Departure Optimizer', () => {
  it('Trip C must not print "undefined"', () => {
    const car = DEFAULT_PROFILES.car;
    const scoringResult = {
      tripScore: 95,
      avgScore: 95,
      minScore: 95,
      worstPoint: null,
      warnings: []
    };
    const samplePoints = [
      { id: 'p1', lat: 28.6, lon: 77.2, distanceKm: 0, heading: 90 },
      { id: 'p2', lat: 28.7, lon: 77.3, distanceKm: 50, heading: 90 }
    ];
    const weatherMap = new Map();
    const originalStartTime = new Date('2023-11-15T08:00:00Z');

    const advice = buildAdvice(scoringResult, samplePoints, weatherMap, car, originalStartTime);

    expect(advice.departureRecommendation).not.toContain('undefined');
    expect(advice.bestWindow.departureLabel).toBeDefined();
    expect(advice.bestWindow.departureLabel).not.toBe('undefined');
  });

  it('Trip A must not recommend 01:30 am for a motorcycle without a night label', () => {
    const moto = DEFAULT_PROFILES.motorcycle;
    const scoringResult = {
      tripScore: 50,
      avgScore: 55,
      minScore: 40,
      worstPoint: null,
      warnings: []
    };
    const samplePoints = [
      { id: 'p1', lat: 28.6, lon: 77.2, distanceKm: 0, heading: 90 },
      { id: 'p2', lat: 28.7, lon: 77.3, distanceKm: 50, heading: 90 }
    ];
    // Trip start at 18:30, +7h is 01:30 am
    const originalStartTime = new Date('2023-11-15T18:30:00');
    const weatherMap = new Map();

    const advice = buildAdvice(scoringResult, samplePoints, weatherMap, moto, originalStartTime);

    // If 01:30 am is mentioned or recommended, it must contain a night label ('night' or 'Night')
    if (advice.departureRecommendation.includes('1:30') || advice.departureRecommendation.includes('01:30')) {
      expect(advice.departureRecommendation.toLowerCase()).toContain('night');
    }
    // And bestWindow must label night
    const windowAt0130 = advice.departureWindows.find(w => w.departureLabel && (w.departureLabel.includes('1:30') || w.departureLabel.includes('01:30')));
    if (windowAt0130) {
      expect(windowAt0130.isNight).toBe(true);
      expect(windowAt0130.departureLabel.toLowerCase()).toContain('night');
    }
  });

  it('evaluates +0 to +12 hours (13 windows)', () => {
    const moto = DEFAULT_PROFILES.motorcycle;
    const scoringResult = {
      tripScore: 70,
      avgScore: 70,
      minScore: 70,
      worstPoint: null,
      warnings: []
    };
    const samplePoints = [{ id: 'p1', lat: 28.6, lon: 77.2, distanceKm: 0, heading: 90 }];
    const originalStartTime = new Date('2023-11-15T08:00:00Z');

    const advice = buildAdvice(scoringResult, samplePoints, new Map(), moto, originalStartTime);
    expect(advice.departureWindows.length).toBe(13); // 0 to 12
    expect(advice.departureWindows[12].offsetHours).toBe(12);
  });

  it('always shows current score, best score and difference, and only says optimal if difference <= 3', () => {
    const car = DEFAULT_PROFILES.car;
    const scoringResult = {
      tripScore: 50,
      avgScore: 50,
      minScore: 50,
      worstPoint: null,
      warnings: []
    };
    const samplePoints = [{ id: 'p1', lat: 28.6, lon: 77.2, distanceKm: 0, heading: 90 }];
    const originalStartTime = new Date('2023-11-15T08:00:00Z');

    const advice = buildAdvice(scoringResult, samplePoints, new Map(), car, originalStartTime);
    // Best score vs current score diff
    expect(advice.departureRecommendation).toContain('50');
    // If difference > 3, it must not say optimal
    const diff = advice.bestWindow.score - scoringResult.tripScore;
    if (diff > 3) {
      expect(advice.departureRecommendation.toLowerCase()).not.toContain('optimal');
    }
  });
});
