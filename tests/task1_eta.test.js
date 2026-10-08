import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { sampleRoute } from '../src/services/sampler.js';
import { DEFAULT_PROFILES } from '../src/models/vehicleProfiles.js';
import { calculateCheckpointEtas } from '../src/services/scoringEngine.js';

import { decodeValhallaShape } from '../src/services/routingService.js';

describe('TASK 1: ETA Model', () => {
  const tripARawPath = path.resolve(__dirname, '../audit_package/samples/raw_routing_trip_a_motorcycle.json');
  const tripARaw = JSON.parse(fs.readFileSync(tripARawPath, 'utf-8'));
  const leg = tripARaw.trip.legs[0];
  const distanceKm = Math.round(tripARaw.trip.summary.length * 10) / 10; // 116.5
  const durationMinutes = Math.round(tripARaw.trip.summary.time / 60); // 218
  const realCoords = decodeValhallaShape(leg.shape, 6);

  const motorcycleProfile = DEFAULT_PROFILES.motorcycle;

  it('Trip A motorcycle: last ETA must be within 2% of 218 min', () => {
    const route = {
      id: 'route_trip_a_moto',
      distanceKm,
      durationMinutes,
      coordinates: realCoords,
      routeSource: 'valhalla',
      speedBasis: 'route-engine',
      vehicleType: 'motorcycle'
    };

    const points = sampleRoute(route, motorcycleProfile);
    expect(points.length).toBeGreaterThanOrEqual(2);
    expect(points.length).toBeLessThanOrEqual(40);

    const lastPoint = points[points.length - 1];
    expect(lastPoint.type).toBe('end');

    const diffPercent = Math.abs(lastPoint.initialEtaMinutes - 218) / 218;
    expect(diffPercent).toBeLessThanOrEqual(0.02);
  });

  it('speedBasis case: route-engine uses implied speed and engine duration', () => {
    const route = {
      id: 'test_engine',
      distanceKm: 100,
      durationMinutes: 200, // 30 km/h implied speed
      coordinates: [
        [22.5, 88.3],
        [22.6, 88.4],
        [22.7, 88.5]
      ],
      routeSource: 'valhalla',
      speedBasis: 'route-engine',
      vehicleType: 'motorcycle'
    };

    const points = sampleRoute(route, motorcycleProfile);
    const lastPoint = points[points.length - 1];
    // With route-engine, total ETA should match route durationMinutes (200 min)
    expect(lastPoint.initialEtaMinutes).toBe(200);
  });

  it('speedBasis case: profile uses vehicleProfile.defaultSpeedKmH', () => {
    const route = {
      id: 'test_profile',
      distanceKm: 150,
      durationMinutes: 90, // engine duration which should be ignored for profile speedBasis
      coordinates: [
        [22.5, 88.3],
        [22.8, 88.6],
        [23.1, 88.9]
      ],
      routeSource: 'osm-car-approx',
      speedBasis: 'profile',
      vehicleType: 'bicycle'
    };

    const bicycleProfile = DEFAULT_PROFILES.bicycle; // defaultSpeedKmH: 22
    const points = sampleRoute(route, bicycleProfile);
    const lastPoint = points[points.length - 1];
    // Total ETA should be approx (distanceKm / 22) * 60 = (150 / 22) * 60 ~= 409 min
    const expectedMinutes = Math.round((points[points.length - 1].distanceKm / bicycleProfile.defaultSpeedKmH) * 60);
    expect(lastPoint.initialEtaMinutes).toBe(expectedMinutes);
  });

  it('custom average speed override takes precedence over everything', () => {
    const route = {
      id: 'test_override',
      distanceKm: 100,
      durationMinutes: 120,
      coordinates: [
        [22.5, 88.3],
        [22.6, 88.4],
        [22.7, 88.5]
      ],
      routeSource: 'valhalla',
      speedBasis: 'route-engine',
      vehicleType: 'motorcycle'
    };

    // Override with 50 km/h
    const customSpeedKmH = 50;
    const points = sampleRoute(route, motorcycleProfile, customSpeedKmH);
    const lastPoint = points[points.length - 1];
    // 100 km at 50 km/h = 120 min or based on actual polyline distance
    const expectedMinutes = Math.round((lastPoint.distanceKm / 50) * 60);
    expect(lastPoint.initialEtaMinutes).toBe(expectedMinutes);
  });

  it('skips regular sample point within 2.5 km of destination', () => {
    // Generate route coordinates where a sample point would fall 1.5 km before destination
    const coords = [];
    for (let i = 0; i <= 30; i++) {
      coords.push([22.0 + i * 0.01, 88.0]);
    }
    const route = {
      id: 'test_skip_near_dest',
      distanceKm: 33,
      durationMinutes: 60,
      coordinates: coords,
      routeSource: 'valhalla',
      speedBasis: 'route-engine',
      vehicleType: 'motorcycle'
    };

    const points = sampleRoute(route, motorcycleProfile);
    const totalDist = points[points.length - 1].distanceKm;
    for (let i = 0; i < points.length - 1; i++) {
      if (points[i].type === 'regular') {
        expect(totalDist - points[i].distanceKm).toBeGreaterThanOrEqual(2.5);
      }
    }
  });

  it('Bicycle and EV second pass starts from implied speed, not fixed profile speed', () => {
    const route = {
      id: 'test_pass2_implied',
      distanceKm: 50,
      durationMinutes: 150, // 20 km/h implied speed
      coordinates: realCoords,
      routeSource: 'valhalla',
      speedBasis: 'route-engine',
      vehicleType: 'bicycle',
      impliedSpeedKmH: 20
    };

    const bicycleProfile = DEFAULT_PROFILES.bicycle;
    const points = sampleRoute(route, bicycleProfile);
    // Attach dummy calm weather
    points.forEach(p => {
      p.weather = {
        temperature: 25,
        windSpeed: 0,
        windDirection: 0,
        precipitation: 0,
        weatherCode: 0
      };
    });

    const adjusted = calculateCheckpointEtas(points, new Date(), bicycleProfile, route);
    // With 0 wind, effectiveSpeed should start from implied speed (20 km/h), not defaultSpeedKmH (22 km/h)
    expect(adjusted[1].effectiveSpeed).toBeCloseTo(20, 0);
  });
});
