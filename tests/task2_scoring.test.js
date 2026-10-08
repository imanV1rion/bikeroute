import { describe, it, expect } from 'vitest';
import { DEFAULT_PROFILES } from '../src/models/vehicleProfiles.js';
import { scoreTripRoute } from '../src/services/scoringEngine.js';
import { buildAdvice } from '../src/services/adviceBuilder.js';

describe('TASK 2: Vehicle-Profile-Driven Warnings & Scoring', () => {
  it('car, 34 C feels-like, calm: no heat warning', () => {
    const carProfile = JSON.parse(JSON.stringify(DEFAULT_PROFILES.car));
    const samplePoints = [
      {
        id: 'pt_0',
        index: 0,
        name: 'Start',
        distanceKm: 0,
        heading: 90,
        initialEtaMinutes: 0,
        weather: {
          temperature: 34,
          apparentTemperature: 34,
          precipitation: 0,
          precipitationProbability: 0,
          weatherCode: 0,
          windSpeed: 5,
          windDirection: 90,
          windGusts: 5,
          visibility: 10000,
          snowfall: 0,
          soilTemperature: 30,
          is_day: 1
        }
      }
    ];

    const result = scoreTripRoute(samplePoints, null, carProfile, new Date('2026-10-05T10:00:00Z'));
    const heatWarnings = result.warnings.filter(w => w.type === 'heat');
    expect(heatWarnings.length).toBe(0);
  });

  it('pedestrian, 34 C: heat warning', () => {
    const pedProfile = JSON.parse(JSON.stringify(DEFAULT_PROFILES.pedestrian));
    const samplePoints = [
      {
        id: 'pt_0',
        index: 0,
        name: 'Start',
        distanceKm: 0,
        heading: 90,
        initialEtaMinutes: 0,
        weather: {
          temperature: 34,
          apparentTemperature: 34,
          precipitation: 0,
          precipitationProbability: 0,
          weatherCode: 0,
          windSpeed: 5,
          windDirection: 90,
          windGusts: 5,
          visibility: 10000,
          snowfall: 0,
          soilTemperature: 30,
          is_day: 1
        }
      }
    ];

    const result = scoreTripRoute(samplePoints, null, pedProfile, new Date('2026-10-05T10:00:00Z'));
    const heatWarnings = result.warnings.filter(w => w.type === 'heat');
    expect(heatWarnings.length).toBeGreaterThan(0);
  });

  it('car with rain thresholds tuned to 20-60 mm/h and 6 mm/h rain: no "Torrential Rain"', () => {
    const carProfile = JSON.parse(JSON.stringify(DEFAULT_PROFILES.car));
    carProfile.hazards.rain.minThreshold = 20;
    carProfile.hazards.rain.maxThreshold = 60;

    const samplePoints = [
      {
        id: 'pt_0',
        index: 0,
        name: 'Start',
        distanceKm: 0,
        heading: 90,
        initialEtaMinutes: 0,
        weather: {
          temperature: 25,
          apparentTemperature: 25,
          precipitation: 6.0,
          precipitationProbability: 80,
          weatherCode: 61,
          windSpeed: 5,
          windDirection: 90,
          windGusts: 10,
          visibility: 5000,
          snowfall: 0,
          soilTemperature: 20,
          is_day: 1
        }
      }
    ];

    const result = scoreTripRoute(samplePoints, null, carProfile, new Date('2026-10-05T10:00:00Z'));
    const torrential = result.warnings.filter(w => w.title.toLowerCase().includes('torrential'));
    expect(torrential.length).toBe(0);
  });

  it('feels-like 33, 34, 35, 36 C for a motorcycle: scores strictly decrease, not all equal', () => {
    const motoProfile = JSON.parse(JSON.stringify(DEFAULT_PROFILES.motorcycle));
    const temps = [33, 34, 35, 36];
    const scores = temps.map(t => {
      const pt = {
        id: `pt_${t}`,
        index: 0,
        name: 'Check',
        distanceKm: 0,
        heading: 90,
        initialEtaMinutes: 0,
        weather: {
          temperature: t,
          apparentTemperature: t,
          precipitation: 0,
          precipitationProbability: 0,
          weatherCode: 0,
          windSpeed: 5,
          windDirection: 90,
          windGusts: 5,
          visibility: 10000,
          snowfall: 0,
          soilTemperature: 25,
          is_day: 1
        }
      };
      const res = scoreTripRoute([pt], null, motoProfile, new Date('2026-10-05T10:00:00Z'));
      return res.tripScore;
    });

    // Check strictly decreasing: scores[0] > scores[1] > scores[2] > scores[3]
    for (let i = 0; i < scores.length - 1; i++) {
      expect(scores[i]).toBeGreaterThan(scores[i + 1]);
    }
  });

  it('three trips with different high-hazard values give three different trip scores (not all 52)', () => {
    const motoProfile = JSON.parse(JSON.stringify(DEFAULT_PROFILES.motorcycle));
    // High hazard is triggered when norm >= 0.8
    // In motorcycle crosswind (min 20, max 55), crosswinds 49, 52, 55 give norms >= 0.8 but different
    const windSpeeds = [49, 52, 55];
    const tripScores = windSpeeds.map(ws => {
      const pt = {
        id: `pt_w_${ws}`,
        index: 0,
        name: 'Check',
        distanceKm: 10,
        heading: 0, // heading North
        initialEtaMinutes: 10,
        weather: {
          temperature: 25,
          apparentTemperature: 25,
          precipitation: 0,
          precipitationProbability: 0,
          weatherCode: 0,
          windSpeed: ws,
          windDirection: 90, // direct crosswind from East
          windGusts: ws,
          visibility: 10000,
          snowfall: 0,
          soilTemperature: 25,
          is_day: 1
        }
      };
      const res = scoreTripRoute([pt], null, motoProfile, new Date('2026-10-05T10:00:00Z'));
      return res.tripScore;
    });

    // None should be flat 52
    expect(tripScores[0]).not.toBe(tripScores[1]);
    expect(tripScores[1]).not.toBe(tripScores[2]);
    expect(new Set(tripScores).size).toBe(3);
  });

  it('thunderstorm code 95 triggers critical for motorcycle and high for car', () => {
    const motoProfile = JSON.parse(JSON.stringify(DEFAULT_PROFILES.motorcycle));
    const carProfile = JSON.parse(JSON.stringify(DEFAULT_PROFILES.car));
    const pt = {
      id: 'pt_ts',
      index: 0,
      name: 'TS Point',
      distanceKm: 10,
      heading: 0,
      initialEtaMinutes: 10,
      weather: {
        temperature: 20,
        apparentTemperature: 20,
        precipitation: 1.0,
        precipitationProbability: 90,
        weatherCode: 95,
        windSpeed: 10,
        windDirection: 0,
        windGusts: 15,
        visibility: 5000,
        snowfall: 0,
        soilTemperature: 20,
        is_day: 1
      }
    };

    const resMoto = scoreTripRoute([pt], null, motoProfile, new Date('2026-10-05T10:00:00Z'));
    const resCar = scoreTripRoute([pt], null, carProfile, new Date('2026-10-05T10:00:00Z'));

    expect(resMoto.hasCriticalWarning).toBe(true);
    expect(resCar.hasHighWarning).toBe(true);
  });

  it('night arrival is labeled Night riding in warnings', () => {
    const motoProfile = JSON.parse(JSON.stringify(DEFAULT_PROFILES.motorcycle));
    const pt = {
      id: 'pt_night',
      index: 0,
      name: 'Night Point',
      distanceKm: 10,
      heading: 0,
      initialEtaMinutes: 10,
      weather: {
        temperature: 20,
        apparentTemperature: 20,
        precipitation: 0,
        precipitationProbability: 0,
        weatherCode: 0,
        windSpeed: 5,
        windDirection: 0,
        windGusts: 5,
        visibility: 10000,
        snowfall: 0,
        soilTemperature: 20,
        is_day: 0
      }
    };

    const res = scoreTripRoute([pt], null, motoProfile, new Date('2026-10-05T22:00:00Z'));
    const nightWarn = res.warnings.find(w => w.title === 'Night riding');
    expect(nightWarn).toBeDefined();
  });
});
