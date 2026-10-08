/**
 * Trip Weather System - Scoring Engine
 * Robust meteorological evaluation:
 * - Accurate UNIX time interpolation (zero timezone bugs)
 * - Safe missing value fallbacks
 * - Circular angular interpolation for wind direction
 * - Strict score capping whenever high or critical hazard warnings exist
 * - Two-pass speed & ETA adjustments
 */

/**
 * Interpolates hourly forecast at a target Date/Time.
 * Supports both UNIX epoch timestamps and ISO strings with zero timezone mismatch.
 */
export function interpolateHourlyForecast(hourlyData, targetTime) {
  if (!hourlyData || !hourlyData.time || hourlyData.time.length === 0) {
    return null;
  }

  const targetMs = targetTime instanceof Date ? targetTime.getTime() : new Date(targetTime).getTime();
  if (isNaN(targetMs)) {
    return null;
  }

  // Convert timestamps to absolute epoch milliseconds
  const timesMs = hourlyData.time.map(t => {
    if (typeof t === 'number') {
      return t < 1e11 ? t * 1000 : t; // handle seconds vs ms
    }
    return new Date(t).getTime();
  });

  const minTime = timesMs[0];
  const maxTime = timesMs[timesMs.length - 1];

  // Task 5c: If ETA is outside forecast range, return { outOfRange: true } (never reuse last hour)
  if (targetMs < minTime || targetMs > maxTime) {
    return { outOfRange: true };
  }

  // Find surrounding interval indices
  let idx0 = 0;
  for (let i = 0; i < timesMs.length - 1; i++) {
    if (timesMs[i] <= targetMs && timesMs[i + 1] >= targetMs) {
      idx0 = i;
      break;
    }
    if (timesMs[i] > targetMs) {
      idx0 = 0;
      break;
    }
    idx0 = timesMs.length - 2;
  }

  const idx1 = Math.min(idx0 + 1, timesMs.length - 1);
  const t0 = timesMs[idx0];
  const t1 = timesMs[idx1];
  const fraction = t1 === t0 ? 0 : Math.max(0, Math.min(1, (targetMs - t0) / (t1 - t0)));

  // Task 5b: Return null for missing fields, not 20 C / 10 km/h / 0 mm / 10 km
  const interpNumber = (arr) => {
    if (!arr || arr.length === 0) return null;
    const v0 = arr[idx0];
    const v1 = arr[idx1];
    if (v0 === null || v0 === undefined || isNaN(v0)) return null;
    if (v1 === null || v1 === undefined || isNaN(v1)) return null;
    return v0 + (v1 - v0) * fraction;
  };

  // Angular circular interpolation for wind direction (0-360)
  const interpAngle = (arr) => {
    if (!arr || arr.length === 0) return null;
    const a0 = arr[idx0];
    const a1 = arr[idx1];
    if (a0 === null || a0 === undefined || isNaN(a0)) return null;
    if (a1 === null || a1 === undefined || isNaN(a1)) return null;
    const diff = ((a1 - a0 + 540) % 360) - 180;
    return (a0 + diff * fraction + 360) % 360;
  };

  // Weather code and daylight take nearest hour
  const codeIdx = fraction < 0.5 ? idx0 : idx1;
  const weatherCode = (hourlyData.weather_code && hourlyData.weather_code[codeIdx] !== undefined && hourlyData.weather_code[codeIdx] !== null)
    ? hourlyData.weather_code[codeIdx]
    : null;
  const isDay = (hourlyData.is_day && hourlyData.is_day[codeIdx] !== undefined && hourlyData.is_day[codeIdx] !== null)
    ? hourlyData.is_day[codeIdx]
    : null;

  const temp = interpNumber(hourlyData.temperature_2m);
  const appTemp = interpNumber(hourlyData.apparent_temperature);
  const precip = interpNumber(hourlyData.precipitation);
  const precipProb = interpNumber(hourlyData.precipitation_probability);
  const windSpd = interpNumber(hourlyData.wind_speed_10m);
  const windDir = interpAngle(hourlyData.wind_direction_10m);
  const gusts = interpNumber(hourlyData.wind_gusts_10m);
  const vis = interpNumber(hourlyData.visibility);
  const snow = interpNumber(hourlyData.snowfall);
  const soilTemp = interpNumber(hourlyData.soil_temperature_0cm);

  return {
    time: new Date(targetMs).toISOString(),
    temperature: temp,
    apparentTemperature: appTemp,
    precipitation: precip !== null ? Math.max(0, precip) : null,
    precipitationProbability: precipProb !== null ? Math.max(0, Math.min(100, precipProb)) : null,
    weatherCode,
    windSpeed: windSpd !== null ? Math.max(0, windSpd) : null,
    windDirection: windDir,
    windGusts: gusts !== null ? Math.max(0, gusts) : null,
    visibility: vis !== null ? Math.max(0, vis) : null,
    snowfall: snow !== null ? Math.max(0, snow) : null,
    soilTemperature: soilTemp,
    is_day: isDay
  };
}

/**
 * Calculates headwind and crosswind components relative to travel heading.
 * Heading: travel direction (0-360°)
 * Wind Direction: meteorological direction the wind is blowing FROM (0-360°)
 */
export function calculateWindComponents(windSpeedKmH, windDirectionDeg, headingDeg) {
  const speed = Math.max(0, windSpeedKmH || 0);
  const windDir = ((windDirectionDeg || 0) + 360) % 360;
  const heading = ((headingDeg || 0) + 360) % 360;

  // Angle between the direction the wind is blowing from and the travel heading
  const deltaDeg = (windDir - heading + 360) % 360;
  const angleRad = (deltaDeg * Math.PI) / 180;

  // Headwind = wind speed × cos(wind direction − heading)
  // Positive = direct opposing headwind, Negative = aiding tailwind
  const headwind = speed * Math.cos(angleRad);

  // Crosswind = wind speed × sin(wind direction − heading)
  // Positive = lateral force from the traveler's right
  // Negative = lateral force from the traveler's left
  const crosswindSigned = speed * Math.sin(angleRad);
  const crosswind = Math.abs(crosswindSigned);

  return {
    headwind: Math.round(headwind * 10) / 10,
    crosswind: Math.round(crosswind * 10) / 10,
    crosswindSigned: Math.round(crosswindSigned * 10) / 10,
    windDirection: Math.round(windDir),
    heading: Math.round(heading),
    isTailwind: headwind < -5,
    isHeadwind: headwind > 12,
    isCrosswindHigh: crosswind > 20
  };
}

/**
 * Road ice proxy evaluation:
 * Surface or air temperature near 0°C to 2°C with precipitation or frozen ground.
 */
export function evaluateIceProxy(temp, precip, soilTemp, snowfall) {
  let isIceRisk = false;
  let iceProbability = 0;

  if (snowfall > 0.1) {
    isIceRisk = true;
    iceProbability = Math.min(1.0, 0.6 + snowfall * 0.2);
  } else if ((temp >= -1.5 && temp <= 2.5) && precip > 0.1) {
    isIceRisk = true;
    iceProbability = 0.85;
  } else if (soilTemp !== undefined && soilTemp <= 0.5 && precip > 0.05) {
    isIceRisk = true;
    iceProbability = 0.80;
  }

  return {
    isIceRisk,
    iceProbability,
    label: isIceRisk ? 'Possible road ice proxy' : 'Road surface dry/ice-free'
  };
}

/**
 * Calculates checkpoint ETAs with dynamic second-pass wind speed adjustments.
 */
export function calculatePointEtas(samplePoints, vehicleProfile, tripStartTime = new Date(), route = null) {
  const startTime = tripStartTime instanceof Date ? tripStartTime : new Date(tripStartTime);
  const startMs = startTime.getTime();
  const speed = route?.customSpeedKmH ||
    (route?.speedBasis === 'route-engine' && route?.impliedSpeedKmH ? route.impliedSpeedKmH : null) ||
    vehicleProfile?.defaultSpeedKmH || 50;

  return samplePoints.map((pt) => {
    let elapsedMinutes = pt.initialEtaMinutes;
    if (elapsedMinutes === undefined || isNaN(elapsedMinutes)) {
      if (pt.elapsedMinutes !== undefined && !isNaN(pt.elapsedMinutes)) {
        elapsedMinutes = pt.elapsedMinutes;
      } else {
        elapsedMinutes = speed > 0 ? (pt.distanceKm / speed) * 60 : 0;
      }
    }
    const etaDate = new Date(startMs + elapsedMinutes * 60 * 1000);
    return {
      ...pt,
      etaDate,
      etaString: etaDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      elapsedMinutes
    };
  });
}

export function calculateCheckpointEtas(samplePoints, tripStartTime, vehicleProfile, route = null) {
  let points = calculatePointEtas(samplePoints, vehicleProfile, tripStartTime);
  let evaluatedPoints = points.map(pt => {
    const wind = pt.weather
      ? calculateWindComponents(pt.weather.windSpeed, pt.weather.windDirection, pt.heading)
      : (pt.wind || { headwind: 0, crosswind: 0, crosswindSigned: 0, isTailwind: false, windDirection: 0, heading: pt.heading });
    return {
      ...pt,
      wind
    };
  });

  if (vehicleProfile.secondPassWindEffect) {
    let runningAdjustedMinutes = 0;
    const baseSpeed = route?.customSpeedKmH ||
      (route?.speedBasis === 'route-engine' && route?.impliedSpeedKmH ? route.impliedSpeedKmH : null) ||
      samplePoints[0]?.effectiveSpeed ||
      samplePoints[0]?.impliedSpeedKmH ||
      vehicleProfile.defaultSpeedKmH;

    for (let i = 0; i < evaluatedPoints.length; i++) {
      if (i === 0) {
        evaluatedPoints[0].elapsedMinutes = 0;
        evaluatedPoints[0].etaDate = new Date(tripStartTime);
        continue;
      }

      const prev = evaluatedPoints[i - 1];
      const curr = evaluatedPoints[i];
      const legDist = Math.max(0.5, curr.distanceKm - prev.distanceKm);

      let effectiveSpeed = baseSpeed;
      const headwind = curr.wind ? curr.wind.headwind : 0;

      if (vehicleProfile.id === 'bicycle') {
        if (headwind > 0) {
          const slowFactor = Math.min(0.45, (headwind / 40) * 0.4);
          effectiveSpeed = baseSpeed * (1 - slowFactor);
        } else {
          const boostFactor = Math.min(0.20, (Math.abs(headwind) / 35) * 0.2);
          effectiveSpeed = baseSpeed * (1 + boostFactor);
        }
      } else if (vehicleProfile.id === 'ev') {
        if (headwind > 20) {
          effectiveSpeed = baseSpeed * 0.94;
        }
      }

      effectiveSpeed = Math.max(8.0, effectiveSpeed);
      const legMinutes = (legDist / effectiveSpeed) * 60;
      runningAdjustedMinutes += legMinutes;

      const revisedEta = new Date(tripStartTime.getTime() + runningAdjustedMinutes * 60 * 1000);
      curr.elapsedMinutes = Math.round(runningAdjustedMinutes);
      curr.etaDate = revisedEta;
      curr.etaString = revisedEta.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      curr.effectiveSpeed = Math.round(effectiveSpeed * 10) / 10;
    }
  }
  return evaluatedPoints;
}

/**
 * Executes full scoring on the sampled route with live weather data.
 * Applies strict safety caps whenever high or critical warnings exist.
 */
export function scoreTripRoute(samplePoints, weatherDataMap, vehicleProfile, tripStartTime, route = null) {
  // Pass 1: compute initial ETAs
  let points = calculatePointEtas(samplePoints, vehicleProfile, tripStartTime, route);

  // Evaluate initial weather at Pass 1 ETAs
  let evaluatedPoints = points.map(pt => {
    const weatherResult = weatherDataMap ? weatherDataMap.get(pt.id) : null;
    const hourlyData = weatherResult ? weatherResult.forecast : null;
    const weather = hourlyData ? interpolateHourlyForecast(hourlyData, pt.etaDate) : (pt.weather || null);
    const wind = (weather && !weather.outOfRange && weather.windSpeed !== null && weather.windDirection !== null)
      ? calculateWindComponents(weather.windSpeed, weather.windDirection, pt.heading)
      : (pt.wind || { headwind: 0, crosswind: 0, crosswindSigned: 0, isTailwind: false, windDirection: 0, heading: pt.heading });

    return {
      ...pt,
      weather,
      wind,
      isCached: weatherResult?.cached ?? false
    };
  });

  // Pass 2: Wind and terrain adjustment on speed for Bicycle and EV
  if (vehicleProfile.secondPassWindEffect) {
    let runningAdjustedMinutes = 0;
    const baseSpeed = route?.customSpeedKmH ||
      (route?.speedBasis === 'route-engine' && route?.impliedSpeedKmH ? route.impliedSpeedKmH : null) ||
      samplePoints[0]?.effectiveSpeed ||
      samplePoints[0]?.impliedSpeedKmH ||
      vehicleProfile.defaultSpeedKmH;

    for (let i = 0; i < evaluatedPoints.length; i++) {
      if (i === 0) {
        evaluatedPoints[0].elapsedMinutes = 0;
        evaluatedPoints[0].etaDate = new Date(tripStartTime);
        continue;
      }

      const prev = evaluatedPoints[i - 1];
      const curr = evaluatedPoints[i];
      const legDist = Math.max(0.5, curr.distanceKm - prev.distanceKm);

      let effectiveSpeed = baseSpeed;
      const headwind = (curr.wind && curr.wind.headwind !== null) ? curr.wind.headwind : 0;

      if (vehicleProfile.id === 'bicycle') {
        if (headwind > 0) {
          const slowFactor = Math.min(0.45, (headwind / 40) * 0.4);
          effectiveSpeed = baseSpeed * (1 - slowFactor);
        } else {
          const boostFactor = Math.min(0.20, (Math.abs(headwind) / 35) * 0.2);
          effectiveSpeed = baseSpeed * (1 + boostFactor);
        }
      } else if (vehicleProfile.id === 'ev') {
        if (headwind > 20) {
          effectiveSpeed = baseSpeed * 0.94;
        }
      }

      effectiveSpeed = Math.max(8.0, effectiveSpeed);
      const legMinutes = (legDist / effectiveSpeed) * 60;
      runningAdjustedMinutes += legMinutes;

      const revisedEta = new Date(tripStartTime.getTime() + runningAdjustedMinutes * 60 * 1000);
      curr.elapsedMinutes = Math.round(runningAdjustedMinutes);
      curr.etaDate = revisedEta;
      curr.etaString = revisedEta.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      curr.effectiveSpeed = Math.round(effectiveSpeed * 10) / 10;

      // Re-interpolate forecast at revised ETA (Task 5e: do not crash if weather is null)
      const weatherResult = weatherDataMap ? weatherDataMap.get(curr.id) : null;
      if (weatherResult && weatherResult.forecast) {
        curr.weather = interpolateHourlyForecast(weatherResult.forecast, revisedEta);
        if (curr.weather && !curr.weather.outOfRange && curr.weather.windSpeed !== null && curr.weather.windDirection !== null) {
          curr.wind = calculateWindComponents(curr.weather.windSpeed, curr.weather.windDirection, curr.heading);
        } else {
          curr.wind = { headwind: 0, crosswind: 0, crosswindSigned: 0, isTailwind: false, windDirection: 0, heading: curr.heading };
        }
      }
    }
  }

  // Calculate scores and hazards for each point
  let worstPoint = null;
  const allWarnings = [];

  let hasTripCriticalWarning = false;
  let hasTripHighWarning = false;

  const nowMs = Date.now();

  const scoredPoints = evaluatedPoints.map(pt => {
    const { pointScore, hazards, pointWarnings, iceProxy, hasCritical, hasHigh, missingFields, isMissing, isOutOfRange } = computePointScore(pt, vehicleProfile);

    if (hasCritical) hasTripCriticalWarning = true;
    if (hasHigh) hasTripHighWarning = true;

    // Task 5d: Label any ETA beyond day 7 "low confidence"
    if (pt.etaDate && (pt.etaDate.getTime() - nowMs) > 7 * 24 * 3600 * 1000) {
      pointWarnings.push({
        type: 'lowConfidence',
        severity: 'low',
        title: 'Low confidence forecast',
        detail: 'Arrival time is beyond 7 days from now'
      });
    }

    if (pointWarnings.length > 0) {
      allWarnings.push(...pointWarnings.map(w => ({
        ...w,
        samplePointId: pt.id,
        pointName: pt.name,
        distanceKm: pt.distanceKm,
        etaString: pt.etaString,
        lat: pt.lat,
        lon: pt.lon
      })));
    }

    return {
      ...pt,
      pointScore,
      hazards,
      iceProxy,
      pointWarnings,
      missingFields: missingFields || [],
      isMissing: Boolean(isMissing),
      isOutOfRange: Boolean(isOutOfRange)
    };
  });

  // Task 5a: Exclude missing forecast and out-of-range points from average
  const validScoredPoints = scoredPoints.filter(p => !p.isMissing && !p.isOutOfRange && p.weather && !p.weather.outOfRange);
  const totalValidPoints = validScoredPoints.length;
  const totalPointsCount = scoredPoints.length;

  let totalScoreSum = 0;
  let minPointScore = 100;

  for (const pt of validScoredPoints) {
    totalScoreSum += pt.pointScore;
    if (pt.pointScore < minPointScore) {
      minPointScore = pt.pointScore;
      worstPoint = pt;
    }
  }

  if (validScoredPoints.length === 0 && scoredPoints.length > 0) {
    minPointScore = Math.min(...scoredPoints.map(p => p.pointScore));
    worstPoint = scoredPoints[0];
  }

  const avgScore = totalValidPoints > 0 ? (totalScoreSum / totalValidPoints) : 100;
  
  // Trip score formula: 60% average score + 40% lowest score, with NO flat cap (Task 2e)
  let tripScore = Math.round((0.6 * avgScore) + (0.4 * minPointScore));

  let evStats = null;
  if (vehicleProfile.id === 'ev') {
    evStats = computeEvEfficiencyImpact(scoredPoints);
  }

  return {
    tripScore: Math.max(0, Math.min(100, tripScore)),
    avgScore: Math.round(avgScore * 10) / 10,
    minScore: Math.round(minPointScore * 10) / 10,
    worstPoint,
    scoredPoints,
    warnings: allWarnings,
    hasCriticalWarning: hasTripCriticalWarning,
    hasHighWarning: hasTripHighWarning,
    forecastCoverage: {
      validPoints: totalValidPoints,
      totalPoints: totalPointsCount,
      text: `Forecast coverage: ${totalValidPoints} of ${totalPointsCount} points`
    },
    evStats,
    vehicleProfile
  };
}

/**
 * Computes individual point risk and comfort score with continuous bands.
 */
function computePointScore(point, vehicleProfile) {
  const w = point.weather;
  const missingFields = [];

  if (!w) {
    return {
      pointScore: 80,
      hazards: {},
      pointWarnings: [{
        type: 'missing',
        severity: 'medium',
        title: `No forecast at km ${Math.round(point.distanceKm || 0)}`,
        detail: 'Forecast data missing for this location'
      }],
      iceProxy: { isIceRisk: false },
      hasCritical: false,
      hasHigh: false,
      missingFields: ['forecast'],
      isMissing: true
    };
  }

  if (w.outOfRange) {
    return {
      pointScore: 50,
      hazards: {},
      pointWarnings: [{
        type: 'outOfRange',
        severity: 'high',
        title: 'Forecast Out of Range',
        detail: 'Arrival time is beyond available forecast horizon'
      }],
      iceProxy: { isIceRisk: false },
      hasCritical: false,
      hasHigh: true,
      missingFields: ['outOfRange'],
      isOutOfRange: true
    };
  }

  const wind = point.wind || { headwind: 0, crosswind: 0, crosswindSigned: 0 };
  const iceProxy = evaluateIceProxy(w.temperature, w.precipitation, w.soilTemperature, w.snowfall);
  const cfg = vehicleProfile.hazards || {};

  const hazards = {};
  const pointWarnings = [];
  let weightedRiskSum = 0;
  let totalWeights = 0;

  let worstCriticalNorm = 0;
  let worstHighNorm = 0;
  let worstMediumNorm = 0;

  let hasCritical = false;
  let hasHigh = false;
  let hasMedium = false;

  const registerWarning = (type, severity, title, detail, norm) => {
    if (severity === 'critical') {
      hasCritical = true;
      worstCriticalNorm = Math.max(worstCriticalNorm, norm);
    } else if (severity === 'high') {
      hasHigh = true;
      worstHighNorm = Math.max(worstHighNorm, norm);
    } else if (severity === 'medium') {
      hasMedium = true;
      worstMediumNorm = Math.max(worstMediumNorm, norm);
    }
    pointWarnings.push({ type, severity, title, detail });
  };

  // 1. Rain Hazard
  if (cfg.rain) {
    if (w.precipitation === null || w.precipitation === undefined) {
      missingFields.push('precipitation');
    } else {
      const rainVal = w.precipitation;
      const norm = normalizeHazard(rainVal, cfg.rain.minThreshold, cfg.rain.maxThreshold);
      hazards.rain = { value: rainVal, norm, label: `${rainVal.toFixed(1)} mm/h` };
      weightedRiskSum += norm * cfg.rain.weight;
      totalWeights += cfg.rain.weight;

      if (norm >= 0.8) {
        registerWarning('rain', 'high', 'Heavy Rain', `Heavy precipitation rate of ${rainVal.toFixed(1)} mm/h`, norm);
      } else if (norm >= 0.4) {
        registerWarning('rain', 'medium', 'Moderate Rain', `Precipitation of ${rainVal.toFixed(1)} mm/h`, norm);
      } else if (w.precipitationProbability !== null && w.precipitationProbability !== undefined && w.precipitationProbability >= 60 && rainVal < cfg.rain.minThreshold) {
        const probNorm = Math.min(0.6, 0.4 + ((w.precipitationProbability - 60) / 100) * 0.2);
        registerWarning('rain', 'medium', `Rain likely (${Math.round(w.precipitationProbability)}%)`, `Precipitation probability is ${Math.round(w.precipitationProbability)}%`, probNorm);
        weightedRiskSum += probNorm * (cfg.rain.weight * 0.5);
        totalWeights += (cfg.rain.weight * 0.5);
      }
    }
  }

  // 2. Headwind Hazard
  if (cfg.headwind) {
    if (w.windSpeed === null || w.windDirection === null || wind.headwind === null || wind.headwind === undefined) {
      missingFields.push('wind');
    } else {
      const headwindVal = Math.max(0, wind.headwind);
      const norm = normalizeHazard(headwindVal, cfg.headwind.minThreshold, cfg.headwind.maxThreshold);
      hazards.headwind = { value: headwindVal, norm, label: `${headwindVal.toFixed(0)} km/h` };
      weightedRiskSum += norm * cfg.headwind.weight;
      totalWeights += cfg.headwind.weight;

      if (norm >= 0.8) {
        registerWarning('headwind', 'high', 'Severe Headwind Drag', `Direct headwind of ${headwindVal.toFixed(0)} km/h opposing motion`, norm);
      } else if (norm >= 0.4) {
        registerWarning('headwind', 'medium', 'Moderate Headwind', `Opposing wind of ${headwindVal.toFixed(0)} km/h`, norm);
      }
    }
  }

  // 3. Crosswind Hazard
  if (cfg.crosswind) {
    if (w.windSpeed === null || w.windDirection === null || wind.crosswind === null || wind.crosswind === undefined) {
      missingFields.push('wind');
    } else {
      const crossVal = wind.crosswind;
      const norm = normalizeHazard(crossVal, cfg.crosswind.minThreshold, cfg.crosswind.maxThreshold);
      hazards.crosswind = { value: crossVal, norm, label: `${crossVal.toFixed(0)} km/h` };
      weightedRiskSum += norm * cfg.crosswind.weight;
      totalWeights += cfg.crosswind.weight;

      if (norm >= 0.8) {
        registerWarning('crosswind', 'high', 'Dangerous Lateral Crosswind', `High crosswind of ${crossVal.toFixed(0)} km/h threatening vehicle stability`, norm);
      } else if (norm >= 0.4) {
        registerWarning('crosswind', 'medium', 'Noticeable Crosswind', `Side wind of ${crossVal.toFixed(0)} km/h`, norm);
      }
    }
  }

  // 4. Gusts
  if (cfg.gusts) {
    if (w.windGusts === null || w.windGusts === undefined) {
      missingFields.push('wind_gusts');
    } else {
      const gustVal = w.windGusts;
      const norm = normalizeHazard(gustVal, cfg.gusts.minThreshold, cfg.gusts.maxThreshold);
      hazards.gusts = { value: gustVal, norm, label: `${gustVal.toFixed(0)} km/h` };
      weightedRiskSum += norm * cfg.gusts.weight;
      totalWeights += cfg.gusts.weight;

      if (norm >= 0.8) {
        registerWarning('gusts', 'high', 'Violent Gale Gusts', `Sudden wind gusts reaching ${gustVal.toFixed(0)} km/h`, norm);
      } else if (norm >= 0.4) {
        registerWarning('gusts', 'medium', 'Strong Gusts', `Gusts up to ${gustVal.toFixed(0)} km/h`, norm);
      }
    }
  }

  // 5. Heat Index
  if (cfg.heat) {
    const heatVal = (w.apparentTemperature !== null && w.apparentTemperature !== undefined)
      ? w.apparentTemperature
      : w.temperature;
    if (heatVal === null || heatVal === undefined) {
      missingFields.push('temperature');
    } else {
      const norm = normalizeHazard(heatVal, cfg.heat.minThreshold, cfg.heat.maxThreshold);
      hazards.heat = { value: heatVal, norm, label: `${heatVal.toFixed(1)} °C` };
      weightedRiskSum += norm * cfg.heat.weight;
      totalWeights += cfg.heat.weight;

      if (norm >= 0.8) {
        registerWarning('heat', 'high', 'Extreme Heat Danger', `Feels-like temperature of ${heatVal.toFixed(1)} °C`, norm);
      } else if (norm >= 0.4) {
        registerWarning('heat', 'medium', 'Elevated Heat Strain', `Feels-like temperature of ${heatVal.toFixed(1)} °C`, norm);
      }
    }
  }

  // 6. Cold / Chill
  if (cfg.cold) {
    const coldVal = (w.apparentTemperature !== null && w.apparentTemperature !== undefined)
      ? w.apparentTemperature
      : w.temperature;
    if (coldVal === null || coldVal === undefined) {
      missingFields.push('temperature');
    } else {
      const norm = normalizeInvertedHazard(coldVal, cfg.cold.minThreshold, cfg.cold.maxThreshold);
      hazards.cold = { value: coldVal, norm, label: `${coldVal.toFixed(1)} °C` };
      weightedRiskSum += norm * cfg.cold.weight;
      totalWeights += cfg.cold.weight;

      if (norm >= 0.8) {
        registerWarning('cold', 'high', 'Severe Freezing Cold', `Apparent temperature dropping to ${coldVal.toFixed(1)} °C`, norm);
      } else if (norm >= 0.4) {
        registerWarning('cold', 'medium', 'Cold Wind Chill', `Apparent temperature of ${coldVal.toFixed(1)} °C`, norm);
      }
    }
  }

  // 7. Road Ice Proxy (stays critical per 2a)
  if (cfg.ice) {
    if (w.temperature === null || w.temperature === undefined || w.precipitation === null || w.precipitation === undefined) {
      if (w.temperature === null || w.temperature === undefined) missingFields.push('temperature');
      if (w.precipitation === null || w.precipitation === undefined) missingFields.push('precipitation');
    } else if (iceProxy.isIceRisk) {
      hazards.ice = { value: iceProxy.iceProbability, norm: 1.0, label: 'Possible Ice' };
      weightedRiskSum += 1.0 * cfg.ice.weight;
      totalWeights += cfg.ice.weight;
      registerWarning('ice', 'critical', '⚠️ Possible Road Ice Proxy', `Freezing proxy detected: ${(w.temperature).toFixed(1)} °C with active precipitation`, 1.0);
    }
  }

  // 8. Visibility / Fog
  if (cfg.fog) {
    if (w.visibility === null || w.visibility === undefined) {
      missingFields.push('visibility');
    } else {
      const visVal = w.visibility;
      const norm = normalizeInvertedHazard(visVal, cfg.fog.minThreshold, cfg.fog.maxThreshold);
      hazards.fog = { value: visVal, norm, label: `${Math.round(visVal)} m` };
      weightedRiskSum += norm * cfg.fog.weight;
      totalWeights += cfg.fog.weight;

      if (norm >= 0.8) {
        registerWarning('fog', 'high', 'Dense Fog / Impaired Visibility', `Visibility restricted to ${Math.round(visVal)} meters`, norm);
      } else if (norm >= 0.4) {
        registerWarning('fog', 'medium', 'Mist / Low Visibility', `Visibility reduced to ${Math.round(visVal)} meters`, norm);
      }
    }
  }

  // 9. Snow (snow >= 2 cm/h stays critical per 2a)
  if (cfg.snow) {
    if (w.snowfall === null || w.snowfall === undefined) {
      missingFields.push('snowfall');
    } else if (w.snowfall > 0) {
      const snowVal = w.snowfall;
      const norm = normalizeHazard(snowVal, cfg.snow.minThreshold, cfg.snow.maxThreshold);
      hazards.snow = { value: snowVal, norm, label: `${snowVal.toFixed(1)} cm/h` };
      weightedRiskSum += norm * cfg.snow.weight;
      totalWeights += cfg.snow.weight;

      if (snowVal >= 2.0) {
        registerWarning('snow', 'critical', 'Heavy Snowstorm / Accumulation', `Snowfall rate of ${snowVal.toFixed(1)} cm/h`, Math.max(1.0, norm));
      } else if (norm >= 0.8) {
        registerWarning('snow', 'high', 'Active Snowfall', `Snowfall rate of ${snowVal.toFixed(1)} cm/h`, norm);
      } else if (norm >= 0.4) {
        registerWarning('snow', 'medium', 'Light Snowfall', `Snowfall rate of ${snowVal.toFixed(1)} cm/h`, norm);
      }
    }
  }

  // 10. Thunderstorm Hazard (Codes 95, 96, 99 per 2b)
  if (w.weatherCode === null || w.weatherCode === undefined) {
    missingFields.push('weather_code');
  } else if ([95, 96, 99].includes(w.weatherCode)) {
    const isVulnerable = ['bicycle', 'motorcycle', 'pedestrian'].includes(vehicleProfile.id);
    const tsWeight = cfg.thunderstorm?.weight ?? 2.0;
    weightedRiskSum += 1.0 * tsWeight;
    totalWeights += tsWeight;
    hazards.thunderstorm = { value: w.weatherCode, norm: 1.0, label: 'Thunderstorm' };

    if (isVulnerable) {
      registerWarning('thunderstorm', 'critical', 'Severe Thunderstorm Danger', `Severe lightning and squall hazard (weather code ${w.weatherCode})`, 1.0);
    } else {
      registerWarning('thunderstorm', 'high', 'Active Thunderstorm Alert', `Thunderstorm conditions along path (weather code ${w.weatherCode})`, 1.0);
    }
  }

  // 11. Daylight Hazard (is_day === 0 per 2f)
  if (w.is_day === 0) {
    const nightWeight = vehicleProfile.nightPenalty ?? 1.0;
    const nightNorm = 0.5;
    weightedRiskSum += nightNorm * nightWeight;
    totalWeights += nightWeight;
    hazards.daylight = { value: 0, norm: nightNorm, label: 'Night' };
    registerWarning('daylight', 'medium', 'Night riding', 'Nighttime conditions / reduced road illumination', nightNorm);
  }

  // Continuous Score Bands per Task 2d:
  // medium: 79 down to 60, high: 59 down to 40, critical: 39 down to 15, scaled by the worst hazard norm in that band.
  // Scores must vary inside a band.
  const totalNorm = Object.values(hazards).reduce((acc, h) => acc + (h.norm || 0), 0);
  const riskRatio = totalWeights > 0 ? (weightedRiskSum / totalWeights) : 0;
  const rawPenalty = Math.round(riskRatio * 50 + totalNorm * 15);
  const rawScore = Math.max(0, Math.min(100, 100 - rawPenalty));

  let pointScore = rawScore;

  if (hasCritical) {
    const t = Math.max(0, Math.min(1, (worstCriticalNorm - 0.8) / 0.2));
    const bandScore = 39 - Math.round(24 * t);
    pointScore = Math.min(pointScore, bandScore);
  } else if (hasHigh) {
    const t = Math.max(0, Math.min(1, (worstHighNorm - 0.8) / 0.2));
    const bandScore = 59 - Math.round(19 * t);
    pointScore = Math.min(pointScore, bandScore);
  } else if (hasMedium) {
    const t = Math.max(0, Math.min(1, (worstMediumNorm - 0.4) / 0.4));
    const bandScore = 79 - Math.round(19 * t);
    pointScore = Math.min(pointScore, bandScore);
  }

  return {
    pointScore,
    hazards,
    pointWarnings,
    iceProxy,
    hasCritical,
    hasHigh,
    missingFields: Array.from(new Set(missingFields))
  };
}

function normalizeHazard(value, minThresh, maxThresh) {
  if (value <= minThresh) return 0;
  if (value >= maxThresh) return 1.0;
  return (value - minThresh) / (maxThresh - minThresh);
}

function normalizeInvertedHazard(value, minThresh, maxThresh) {
  if (value >= minThresh) return 0;
  if (value <= maxThresh) return 1.0;
  return (minThresh - value) / (minThresh - maxThresh);
}

export function computeEvEfficiencyImpact(scoredPoints) {
  const baseConsumptionWhPerKm = 175;
  if (!scoredPoints || scoredPoints.length === 0) {
    return {
      baseWhPerKm: baseConsumptionWhPerKm,
      estimatedWhPerKm: baseConsumptionWhPerKm,
      rangePenaltyPercent: 0,
      headline: 'Optimal EV range conditions'
    };
  }

  let totalWh = 0;
  let totalKm = 0;

  for (let i = 0; i < scoredPoints.length; i++) {
    const pt = scoredPoints[i];
    const prev = i > 0 ? scoredPoints[i - 1] : null;
    const legDist = prev ? Math.max(0.1, pt.distanceKm - prev.distanceKm) : (scoredPoints.length > 1 ? Math.max(0.1, scoredPoints[1].distanceKm / 2) : 1);

    const temp = (pt.weather && pt.weather.temperature !== null) ? pt.weather.temperature : 20;
    const headwind = (pt.wind && pt.wind.headwind !== null) ? pt.wind.headwind : 0;

    let tempFactor = 1.0;
    if (temp < 0) {
      tempFactor = 1.35;
    } else if (temp < 10) {
      tempFactor = 1.18;
    } else if (temp > 32) {
      tempFactor = 1.12;
    }

    let windFactor = 1.0;
    if (headwind > 15) {
      windFactor = 1.0 + (headwind / 120);
    }

    const consumptionPerKm = baseConsumptionWhPerKm * tempFactor * windFactor;
    totalWh += consumptionPerKm * legDist;
    totalKm += legDist;
  }

  const avgConsumption = totalKm > 0 ? Math.round(totalWh / totalKm) : baseConsumptionWhPerKm;
  const rangePenaltyPercent = Math.round(((avgConsumption - baseConsumptionWhPerKm) / baseConsumptionWhPerKm) * 100);

  return {
    baseWhPerKm: baseConsumptionWhPerKm,
    estimatedWhPerKm: avgConsumption,
    rangePenaltyPercent: Math.max(0, rangePenaltyPercent),
    headline: rangePenaltyPercent > 10 
      ? `-${rangePenaltyPercent}% Range Reduction due to ambient temperature & headwind drag` 
      : 'Optimal EV range conditions'
  };
}
