/**
 * Trip Weather System - Sampler
 * Selects sample points every 20-30 minutes of travel time along the real road route.
 * Zero hardcoded heuristics or fake coordinates.
 */

import { computeHaversine, calculateHeading } from './routingService.js';

export function sampleRoute(route, vehicleProfile, customSpeedKmH = null) {
  const coordinates = route.coordinates;
  if (!coordinates || coordinates.length === 0) return [];

  // Determine effective speed and speed basis
  let speed;
  let activeSpeedBasis;

  const validCustomSpeed = (customSpeedKmH !== null && customSpeedKmH !== undefined && !isNaN(customSpeedKmH) && Number(customSpeedKmH) > 0)
    ? Number(customSpeedKmH)
    : null;

  if (validCustomSpeed !== null) {
    speed = validCustomSpeed;
    activeSpeedBasis = 'your-speed';
  } else if (
    route.routeSource === 'valhalla' &&
    route.speedBasis === 'route-engine' &&
    route.durationMinutes > 0 &&
    route.distanceKm > 0
  ) {
    const impliedSpeed = route.distanceKm / (route.durationMinutes / 60);
    speed = impliedSpeed;
    activeSpeedBasis = 'route-engine';
  } else {
    speed = vehicleProfile.defaultSpeedKmH || 25;
    activeSpeedBasis = 'profile';
  }

  // 1. Build cumulative distances along route polyline
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
  const totalKm = cumulativeKm[cumulativeKm.length - 1];

  // Total travel minutes calculation
  const totalDurationMinutes = activeSpeedBasis === 'route-engine'
    ? route.durationMinutes
    : (totalKm / speed) * 60;

  // Spacing: Aim for every 25 minutes of travel time, at most 40 points and at least 2
  // Max checkpoints is 38 (start + 38 checkpoints + destination = 40 points)
  let targetIntervalMinutes = 25;
  if (totalDurationMinutes / 25 > 38) {
    targetIntervalMinutes = totalDurationMinutes / 38;
  }
  const targetStepKm = speed * (targetIntervalMinutes / 60);

  // Helper to compute initial ETA in minutes
  const calcEtaMin = (cumKm) => {
    if (activeSpeedBasis === 'route-engine') {
      return totalKm > 0 ? (cumKm / totalKm) * route.durationMinutes : 0;
    }
    return (cumKm / speed) * 60;
  };

  const samplePoints = [];
  let lastSampledKm = 0;

  // Always add start point
  const startHeading = coordinates.length > 1
    ? calculateHeading(coordinates[0][0], coordinates[0][1], coordinates[1][0], coordinates[1][1])
    : 0;

  samplePoints.push({
    id: `sample_0`,
    index: 0,
    name: 'Departure Point',
    lat: coordinates[0][0],
    lon: coordinates[0][1],
    distanceKm: 0,
    elevationM: null,
    heading: Math.round(startHeading),
    initialEtaMinutes: 0,
    speedBasis: activeSpeedBasis,
    effectiveSpeed: speed,
    impliedSpeedKmH: Math.round((route.distanceKm / (route.durationMinutes / 60)) * 10) / 10,
    type: 'start'
  });

  // Iterate along polyline
  for (let i = 1; i < coordinates.length - 1; i++) {
    const distFromLast = cumulativeKm[i] - lastSampledKm;
    const distToDest = totalKm - cumulativeKm[i];

    // Check if step reached AND not within 2.5 km of destination
    if (distFromLast >= targetStepKm) {
      if (distToDest < 2.5) {
        // Skip regular point within 2.5 km of destination
        continue;
      }

      const nextCoord = coordinates[Math.min(i + 1, coordinates.length - 1)];
      const prevCoord = coordinates[Math.max(0, i - 1)];
      const heading = calculateHeading(prevCoord[0], prevCoord[1], nextCoord[0], nextCoord[1]);
      const etaMin = calcEtaMin(cumulativeKm[i]);

      samplePoints.push({
        id: `sample_${samplePoints.length}`,
        index: i,
        name: `Checkpoint ${samplePoints.length} (${Math.round(cumulativeKm[i])} km)`,
        lat: coordinates[i][0],
        lon: coordinates[i][1],
        distanceKm: Math.round(cumulativeKm[i] * 10) / 10,
        elevationM: null,
        heading: Math.round(heading),
        initialEtaMinutes: Math.round(etaMin),
        speedBasis: activeSpeedBasis,
        effectiveSpeed: speed,
        impliedSpeedKmH: Math.round((route.distanceKm / (route.durationMinutes / 60)) * 10) / 10,
        type: 'regular'
      });

      lastSampledKm = cumulativeKm[i];
    }
  }

  // Always add destination point (at least 2 points)
  const lastIdx = coordinates.length - 1;
  const prevLast = coordinates[Math.max(0, lastIdx - 1)];
  const endHeading = calculateHeading(prevLast[0], prevLast[1], coordinates[lastIdx][0], coordinates[lastIdx][1]);
  const finalDist = totalKm;
  const finalEtaMin = calcEtaMin(finalDist);

  samplePoints.push({
    id: `sample_${samplePoints.length}`,
    index: lastIdx,
    name: 'Destination Arrival',
    lat: coordinates[lastIdx][0],
    lon: coordinates[lastIdx][1],
    distanceKm: Math.round(finalDist * 10) / 10,
    elevationM: null,
    heading: Math.round(endHeading),
    initialEtaMinutes: Math.round(finalEtaMin),
    speedBasis: activeSpeedBasis,
    effectiveSpeed: speed,
    impliedSpeedKmH: Math.round((route.distanceKm / (route.durationMinutes / 60)) * 10) / 10,
    type: 'end'
  });

  // Attach metadata to route object
  route.activeSpeedBasis = activeSpeedBasis;
  if (route.durationMinutes > 0) {
    route.impliedSpeedKmH = Math.round((route.distanceKm / (route.durationMinutes / 60)) * 10) / 10;
  }
  if (validCustomSpeed !== null) {
    route.customSpeedKmH = validCustomSpeed;
  }

  return samplePoints;
}

/**
 * Detects mountain passes or summits in a dense elevation profile with prominence:
 * a rise of at least 150m before AND a drop of at least 150m after.
 */
export function detectMountainPasses(denseProfile) {
  if (!denseProfile || denseProfile.length < 3) return [];
  const valid = denseProfile.filter(p => p && p.elevationM !== null && p.elevationM !== undefined && !isNaN(p.elevationM));
  if (valid.length < 3) return [];

  const passes = [];

  for (let i = 1; i < valid.length - 1; i++) {
    const curElev = valid[i].elevationM;
    const prevElev = valid[i - 1].elevationM;
    const nextElev = valid[i + 1].elevationM;

    // Peak candidate
    if (curElev >= prevElev && curElev >= nextElev && (curElev > prevElev || curElev > nextElev)) {
      // Find minimum elevation before i until reaching a point higher than curElev
      let minBefore = curElev;
      for (let j = i - 1; j >= 0; j--) {
        if (valid[j].elevationM > curElev) break;
        if (valid[j].elevationM < minBefore) {
          minBefore = valid[j].elevationM;
        }
      }

      // Find minimum elevation after i until reaching a point higher than curElev
      let minAfter = curElev;
      for (let k = i + 1; k < valid.length; k++) {
        if (valid[k].elevationM > curElev) break;
        if (valid[k].elevationM < minAfter) {
          minAfter = valid[k].elevationM;
        }
      }

      const rise = curElev - minBefore;
      const drop = curElev - minAfter;

      if (rise >= 150 && drop >= 150) {
        if (passes.length === 0 || Math.abs(valid[i].distanceKm - passes[passes.length - 1].distanceKm) > 5) {
          passes.push({
            ...valid[i],
            rise,
            drop,
            prominence: Math.min(rise, drop)
          });
        }
      }
    }
  }

  return passes;
}

/**
 * Labels checkpoints based on real topography and prominence.
 * If elevation cannot be fetched, sets elevation to null.
 */
export function enrichWithRealTopography(samplePoints, elevationData) {
  if (!samplePoints || samplePoints.length === 0) return;

  const isDenseArray = Array.isArray(elevationData) && elevationData.length > 0 && typeof elevationData[0] === 'object';

  if (isDenseArray) {
    const denseProfile = elevationData;
    const passes = detectMountainPasses(denseProfile);

    samplePoints.forEach(pt => {
      let closest = null;
      let minDiff = Infinity;
      denseProfile.forEach(dp => {
        const diff = Math.abs(dp.distanceKm - pt.distanceKm);
        if (diff < minDiff) {
          minDiff = diff;
          closest = dp;
        }
      });
      pt.elevationM = closest ? (closest.elevationM ?? null) : null;
    });

    // Tag or insert sample points for passes
    passes.forEach(pass => {
      let existing = samplePoints.find(pt => Math.abs(pt.distanceKm - pass.distanceKm) <= 2.5);
      if (existing && existing.type !== 'start' && existing.type !== 'end') {
        existing.type = 'mountain_pass';
        existing.elevationM = pass.elevationM;
        existing.name = `Mountain Pass / Summit (${Math.round(pass.elevationM)}m)`;
      } else if (!existing) {
        samplePoints.push({
          id: `sample_pass_${Math.round(pass.distanceKm)}`,
          name: `Mountain Pass / Summit (${Math.round(pass.elevationM)}m)`,
          lat: pass.lat,
          lon: pass.lon,
          distanceKm: Math.round(pass.distanceKm * 10) / 10,
          elevationM: pass.elevationM,
          heading: pass.heading || 0,
          initialEtaMinutes: samplePoints[0]?.speedBasis === 'route-engine' && samplePoints[samplePoints.length - 1]?.distanceKm > 0
            ? Math.round((pass.distanceKm / samplePoints[samplePoints.length - 1].distanceKm) * (samplePoints[samplePoints.length - 1].initialEtaMinutes || 0))
            : Math.round((pass.distanceKm / (samplePoints[0]?.effectiveSpeed || 25)) * 60),
          speedBasis: samplePoints[0]?.speedBasis,
          effectiveSpeed: samplePoints[0]?.effectiveSpeed,
          type: 'mountain_pass'
        });
        samplePoints.sort((a, b) => a.distanceKm - b.distanceKm);
      }
    });
  } else if (Array.isArray(elevationData)) {
    samplePoints.forEach((pt, i) => {
      pt.elevationM = (elevationData[i] !== undefined && elevationData[i] !== null && !isNaN(elevationData[i]))
        ? elevationData[i]
        : null;
    });
  } else {
    samplePoints.forEach(pt => {
      pt.elevationM = null;
    });
  }
}
