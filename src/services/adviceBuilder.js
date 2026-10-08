/**
 * Trip Weather System - Advice Builder
 * Generates the trip verdict (Great, Rideable, Rough, Wait),
 * detailed hazard warning catalog with kilometer and time coordinates,
 * and departure time window optimizer using in-memory forecast matrices.
 */

import { scoreTripRoute } from './scoringEngine.js';

function isNightTime(date) {
  const hour = date.getHours();
  // Typically night is 19:00 (7 PM) to 06:00 (6 AM)
  return hour < 6 || hour >= 19;
}

function formatDepartureLabel(date) {
  const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const night = isNightTime(date);
  return `${timeStr}${night ? ' (Night)' : ''}`;
}

export function buildAdvice(scoringResult, samplePoints, weatherDataMap, vehicleProfile, originalStartTime) {
  const { tripScore, avgScore, minScore, worstPoint, warnings } = scoringResult;

  // 1. Verdict determination
  let verdict = 'Great';
  let verdictColor = '#10b981'; // emerald
  let verdictClass = 'verdict-great';
  let verdictSummary = '';

  if (tripScore >= 80) {
    verdict = 'Great';
    verdictColor = '#10b981';
    verdictClass = 'verdict-great';
    verdictSummary = `Ideal conditions for ${vehicleProfile.name.toLowerCase()} travel. Mild winds and clean pavement.`;
  } else if (tripScore >= 60) {
    verdict = 'Rideable';
    verdictColor = '#f59e0b'; // amber
    verdictClass = 'verdict-rideable';
    verdictSummary = `Manageable conditions. Suitable gear required; anticipate localized breezes and road dampness.`;
  } else if (tripScore >= 40) {
    verdict = 'Rough';
    verdictColor = '#f97316'; // orange
    verdictClass = 'verdict-rough';
    verdictSummary = `Challenging journey. High fatigue and physical resistance expected; proceed with heightened caution.`;
  } else {
    verdict = 'Wait';
    verdictColor = '#ef4444'; // crimson red
    verdictClass = 'verdict-wait';
    verdictSummary = `Hazardous weather alert. Dangerous gusts, freezing proxy, or torrential precipitation along the path.`;
  }

  // Verdict must not be better than the worst severity present (Task 2e: high means at most Rough, critical means Wait)
  const hasCritical = scoringResult.hasCriticalWarning || (warnings && warnings.some(w => w.severity === 'critical'));
  const hasHigh = scoringResult.hasHighWarning || (warnings && warnings.some(w => w.severity === 'high'));

  if (hasCritical) {
    verdict = 'Wait';
    verdictColor = '#ef4444';
    verdictClass = 'verdict-wait';
    verdictSummary = `Critical weather hazards active along route. Defer trip until conditions clear.`;
  } else if (hasHigh && (verdict === 'Great' || verdict === 'Rideable')) {
    verdict = 'Rough';
    verdictColor = '#f97316';
    verdictClass = 'verdict-rough';
    verdictSummary = `High weather warnings active along route. Proceed with caution.`;
  }

  // 2. Format localized warnings
  // Group duplicate consecutive warnings and sort by kilometer
  const structuredWarnings = (warnings || [])
    .slice()
    .sort((a, b) => a.distanceKm - b.distanceKm)
    .map(w => ({
      type: w.type,
      title: w.title,
      detail: w.detail,
      distanceKm: w.distanceKm,
      etaString: w.etaString,
      pointName: w.pointName,
      severity: w.severity,
      lat: w.lat,
      lon: w.lon
    }));

  // 3. Best Departure Time Optimizer (Task 6)
  // Evaluate +0 to +12 hours (Task 6c)
  const departureWindows = [];
  const isVulnerable = ['bicycle', 'motorcycle', 'pedestrian'].includes(vehicleProfile.id);

  for (let offset = 0; offset <= 12; offset++) {
    const candidateStartTime = new Date(originalStartTime.getTime() + offset * 3600000);
    const candidateScoreResult = scoreTripRoute(samplePoints, weatherDataMap, vehicleProfile, candidateStartTime);

    let candidateVerdict = 'Great';
    if (candidateScoreResult.tripScore < 40) candidateVerdict = 'Wait';
    else if (candidateScoreResult.tripScore < 60) candidateVerdict = 'Rough';
    else if (candidateScoreResult.tripScore < 80) candidateVerdict = 'Rideable';

    if (candidateScoreResult.hasCriticalWarning) candidateVerdict = 'Wait';
    else if (candidateScoreResult.hasHighWarning && (candidateVerdict === 'Great' || candidateVerdict === 'Rideable')) candidateVerdict = 'Rough';

    const candIsNight = isNightTime(candidateStartTime);
    const item = {
      offsetHours: offset,
      departureTime: candidateStartTime,
      departureLabel: formatDepartureLabel(candidateStartTime),
      score: candidateScoreResult.tripScore,
      minScore: candidateScoreResult.minScore,
      verdict: candidateVerdict,
      isNight: candIsNight,
      hasCritical: candidateScoreResult.hasCriticalWarning,
      hasHigh: candidateScoreResult.hasHighWarning
    };

    departureWindows.push(item);
  }

  // Task 6c: Do not recommend a night departure for bicycle, motorcycle or pedestrian unless it is the only non-hazardous window
  let eligibleWindows = departureWindows;
  if (isVulnerable) {
    const hasDaytimeNonHazardous = departureWindows.some(w => !w.isNight && w.score >= 60 && !w.hasCritical && !w.hasHigh);
    if (hasDaytimeNonHazardous) {
      eligibleWindows = departureWindows.filter(w => !w.isNight);
    } else {
      const hasNightNonHazardous = departureWindows.some(w => w.isNight && w.score >= 60 && !w.hasCritical && !w.hasHigh);
      if (!hasNightNonHazardous) {
        // Neither day nor night is non-hazardous: prefer day
        eligibleWindows = departureWindows.filter(w => !w.isNight);
        if (eligibleWindows.length === 0) eligibleWindows = departureWindows;
      }
    }
  }

  // Select best window (Task 6a: fallback must always include departureLabel)
  let bestWindow = eligibleWindows.reduce((best, w) => (w.score > best.score ? w : best), eligibleWindows[0] || departureWindows[0]);

  // Task 6b: Always show the current departure score and the best score with the difference.
  // Do not say "optimal" unless the difference is at most 3 points.
  const scoreDiff = bestWindow.score - tripScore;
  const diffSign = scoreDiff > 0 ? `+${scoreDiff}` : `${scoreDiff}`;

  let departureRecommendation = '';
  if (scoreDiff <= 3) {
    departureRecommendation = `Current departure score: ${tripScore}. Best window: ${bestWindow.departureLabel} (Score: ${bestWindow.score}, diff: ${diffSign} pts). Current departure provides optimal travel conditions within evaluated window.`;
  } else {
    departureRecommendation = `Current departure score: ${tripScore}. Best window: ${bestWindow.departureLabel} (Score: ${bestWindow.score}, diff: ${diffSign} pts). Recommended to adjust departure to ${bestWindow.departureLabel} (+${scoreDiff} pts higher comfort).`;
  }

  return {
    verdict,
    verdictColor,
    verdictClass,
    verdictSummary,
    tripScore,
    avgScore,
    minScore,
    worstPoint,
    warnings: structuredWarnings,
    departureRecommendation,
    bestWindow,
    departureWindows
  };
}
