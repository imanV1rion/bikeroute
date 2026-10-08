/**
 * Trip Weather System - Alert Worker & Trip Storage
 * Manages saved trips, runs real re-checks for weather updates,
 * and triggers condition-change alerts.
 */

import { fetchRouteWeather } from './weatherService.js';
import { scoreTripRoute } from './scoringEngine.js';

const SAVED_TRIPS_KEY = 'trip_weather_saved_trips';
const SUBSCRIBED_ALERTS_KEY = 'trip_weather_alerts_log';

export function getSavedTrips() {
  try {
    const raw = localStorage.getItem(SAVED_TRIPS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveTrip(trip) {
  const trips = getSavedTrips();
  const existingIdx = trips.findIndex(t => t.id === trip.id);
  const record = {
    ...trip,
    savedAt: new Date().toISOString(),
    monitored: true
  };

  if (existingIdx >= 0) {
    trips[existingIdx] = record;
  } else {
    trips.unshift(record);
  }

  localStorage.setItem(SAVED_TRIPS_KEY, JSON.stringify(trips.slice(0, 15)));
  return trips;
}

export function deleteTrip(tripId) {
  const trips = getSavedTrips().filter(t => t.id !== tripId);
  localStorage.setItem(SAVED_TRIPS_KEY, JSON.stringify(trips));
  return trips;
}

export function clearTripHistory() {
  localStorage.removeItem(SAVED_TRIPS_KEY);
  localStorage.removeItem(SUBSCRIBED_ALERTS_KEY);
  return [];
}

/**
 * Task 7b: Real "Re-check now" for saved trips:
 * fetches fresh forecast for saved sample points, re-scores,
 * and alerts if score dropped by >= 15 pts or a new critical warning appeared.
 * Checks run only while this tab is open.
 */
export async function recheckSavedTrips(trips = null, fetchWeather = null, scoreRoute = null) {
  const tripList = trips || getSavedTrips();
  const alerts = [];

  for (const trip of tripList) {
    const points = trip.samplePoints || trip.scoredPoints;
    if (!points || points.length === 0) continue;

    try {
      const departureDate = trip.departureTime ? new Date(trip.departureTime) : new Date();
      const durationMin = trip.route?.durationMinutes || 0;

      const weatherMap = fetchWeather
        ? await fetchWeather(points, departureDate, durationMin)
        : await fetchRouteWeather(points, departureDate, durationMin);

      const newScoreResult = scoreRoute
        ? scoreRoute(points, weatherMap, trip.vehicleProfile, departureDate, trip.route)
        : scoreTripRoute(points, weatherMap, trip.vehicleProfile, departureDate, trip.route);

      const oldScore = trip.scoreResult?.tripScore ?? 100;
      const newScore = newScoreResult.tripScore;
      const scoreDrop = oldScore - newScore;

      const prevHadCritical = Boolean(trip.scoreResult?.hasCriticalWarning || (trip.scoreResult?.warnings || []).some(w => w.severity === 'critical'));
      const nowHasCritical = Boolean(newScoreResult.hasCriticalWarning || (newScoreResult.warnings || []).some(w => w.severity === 'critical'));
      const newCritical = !prevHadCritical && nowHasCritical;

      if (scoreDrop >= 15 || newCritical) {
        const reason = [];
        if (scoreDrop >= 15) reason.push('score_drop');
        if (newCritical) reason.push('critical_warning');

        alerts.push({
          tripId: trip.id,
          tripTitle: trip.name || `${trip.startName} → ${trip.endName}`,
          reason: reason.join(','),
          scoreDrop,
          oldScore,
          newScore,
          newCritical,
          time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          message: newCritical
            ? `Critical weather hazard appeared on "${trip.name || 'saved trip'}"! Comfort score: ${newScore}/100.`
            : `Conditions worsened on "${trip.name || 'saved trip'}": score dropped by ${scoreDrop} pts (from ${oldScore} to ${newScore}).`
        });
      }

      // Update trip in list
      trip.scoreResult = newScoreResult;
      trip.scoredPoints = newScoreResult.scoredPoints;
      trip.lastCheckedAt = new Date().toISOString();
    } catch (e) {
      console.error('Failed to recheck saved trip:', trip.id, e);
    }
  }

  if (!trips) {
    try {
      localStorage.setItem(SAVED_TRIPS_KEY, JSON.stringify(tripList));
    } catch (e) {
      console.error('Failed to persist rechecked trips:', e);
    }
  }

  return alerts;
}

export function checkMonitoredTrips() {
  return [];
}
