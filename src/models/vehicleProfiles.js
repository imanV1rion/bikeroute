/**
 * Trip Weather System - Vehicle Profiles
 * Dynamic profile definitions with hazard weights, threshold limits, speeds, and routing profiles.
 */

export const DEFAULT_PROFILES = {
  bicycle: {
    id: 'bicycle',
    name: 'Bicycle',
    icon: '🚲',
    routingType: 'bicycle',
    defaultSpeedKmH: 22, // average cycling speed km/h
    secondPassWindEffect: true, // Wind recalculates speed & ETA
    nightPenalty: 1.8,
    description: 'Highly sensitive to headwind, rain, heavy gusts, extreme cold & heat.',
    hazards: {
      rain: { weight: 1.8, minThreshold: 0.2, maxThreshold: 5.0, unit: 'mm/h', label: 'Rain' },
      headwind: { weight: 2.2, minThreshold: 12, maxThreshold: 45, unit: 'km/h', label: 'Headwind' },
      crosswind: { weight: 0.9, minThreshold: 15, maxThreshold: 50, unit: 'km/h', label: 'Crosswind' },
      gusts: { weight: 1.6, minThreshold: 25, maxThreshold: 60, unit: 'km/h', label: 'Wind Gusts' },
      heat: { weight: 1.4, minThreshold: 28, maxThreshold: 38, unit: '°C', label: 'Extreme Heat' },
      cold: { weight: 1.5, minThreshold: 8, maxThreshold: -2, unit: '°C', label: 'Severe Cold' },
      ice: { weight: 2.5, minThreshold: 0.1, maxThreshold: 1.0, unit: 'prob', label: 'Possible Road Ice' },
      fog: { weight: 0.8, minThreshold: 1500, maxThreshold: 300, unit: 'm', label: 'Low Visibility' },
      snow: { weight: 2.2, minThreshold: 0.2, maxThreshold: 3.0, unit: 'cm/h', label: 'Snowfall' },
      thunderstorm: { weight: 2.5, minThreshold: 0, maxThreshold: 1, unit: 'code', label: 'Thunderstorm' }
    }
  },

  motorcycle: {
    id: 'motorcycle',
    name: 'Motorcycle',
    icon: '🏍️',
    routingType: 'motorcycle',
    defaultSpeedKmH: 75,
    secondPassWindEffect: false,
    nightPenalty: 1.8,
    description: 'Sensitive to crosswinds, wet asphalt, ice proxy, fog, and chilling cold.',
    hazards: {
      rain: { weight: 1.9, minThreshold: 0.5, maxThreshold: 7.0, unit: 'mm/h', label: 'Rain & Wet Road' },
      headwind: { weight: 0.8, minThreshold: 25, maxThreshold: 70, unit: 'km/h', label: 'Headwind' },
      crosswind: { weight: 2.2, minThreshold: 20, maxThreshold: 55, unit: 'km/h', label: 'Crosswind Stability' },
      gusts: { weight: 2.0, minThreshold: 30, maxThreshold: 65, unit: 'km/h', label: 'Wind Gusts' },
      heat: { weight: 1.0, minThreshold: 32, maxThreshold: 42, unit: '°C', label: 'Excessive Heat' },
      cold: { weight: 1.7, minThreshold: 6, maxThreshold: -4, unit: '°C', label: 'Wind Chill' },
      ice: { weight: 2.8, minThreshold: 0.1, maxThreshold: 1.0, unit: 'prob', label: 'Possible Road Ice' },
      fog: { weight: 1.9, minThreshold: 1000, maxThreshold: 200, unit: 'm', label: 'Dense Fog' },
      snow: { weight: 2.9, minThreshold: 0.1, maxThreshold: 2.0, unit: 'cm/h', label: 'Snow' },
      thunderstorm: { weight: 2.5, minThreshold: 0, maxThreshold: 1, unit: 'code', label: 'Thunderstorm' }
    }
  },

  car: {
    id: 'car',
    name: 'Car',
    icon: '🚗',
    routingType: 'auto',
    defaultSpeedKmH: 85,
    secondPassWindEffect: false,
    nightPenalty: 0.3,
    description: 'Enclosed cabin protection; threatened primarily by heavy rain, aquaplaning, dense fog, snow, ice & hail.',
    hazards: {
      rain: { weight: 1.5, minThreshold: 2.0, maxThreshold: 12.0, unit: 'mm/h', label: 'Heavy Rain / Hydroplaning' },
      headwind: { weight: 0.3, minThreshold: 40, maxThreshold: 90, unit: 'km/h', label: 'Headwind' },
      crosswind: { weight: 0.7, minThreshold: 35, maxThreshold: 75, unit: 'km/h', label: 'Crosswind' },
      gusts: { weight: 0.9, minThreshold: 45, maxThreshold: 85, unit: 'km/h', label: 'Strong Gusts' },
      heat: { weight: 0.4, minThreshold: 35, maxThreshold: 45, unit: '°C', label: 'Cabin Heat Strain' },
      cold: { weight: 0.5, minThreshold: -5, maxThreshold: -15, unit: '°C', label: 'Freezing Conditions' },
      ice: { weight: 2.5, minThreshold: 0.1, maxThreshold: 1.0, unit: 'prob', label: 'Black Ice Risk' },
      fog: { weight: 2.0, minThreshold: 800, maxThreshold: 150, unit: 'm', label: 'Dense Fog' },
      snow: { weight: 2.4, minThreshold: 0.5, maxThreshold: 5.0, unit: 'cm/h', label: 'Snow Accumulation' },
      thunderstorm: { weight: 1.8, minThreshold: 0, maxThreshold: 1, unit: 'code', label: 'Thunderstorm' }
    }
  },

  truck: {
    id: 'truck',
    name: 'Truck / Van / Bus',
    icon: '🚛',
    routingType: 'truck',
    defaultSpeedKmH: 70,
    secondPassWindEffect: false,
    nightPenalty: 0.4,
    description: 'High side profile makes it vulnerable to severe crosswinds, bridge gusts, heavy snow, and ice.',
    hazards: {
      rain: { weight: 1.2, minThreshold: 2.5, maxThreshold: 15.0, unit: 'mm/h', label: 'Heavy Rain' },
      headwind: { weight: 0.5, minThreshold: 35, maxThreshold: 80, unit: 'km/h', label: 'Headwind Drag' },
      crosswind: { weight: 2.6, minThreshold: 25, maxThreshold: 60, unit: 'km/h', label: 'High Crosswind Rollover' },
      gusts: { weight: 2.4, minThreshold: 35, maxThreshold: 70, unit: 'km/h', label: 'Bridge / Gap Gusts' },
      heat: { weight: 0.5, minThreshold: 35, maxThreshold: 45, unit: '°C', label: 'Tire / Engine Heat' },
      cold: { weight: 0.8, minThreshold: -5, maxThreshold: -18, unit: '°C', label: 'Extreme Cold / Diesel Waxing' },
      ice: { weight: 2.7, minThreshold: 0.1, maxThreshold: 1.0, unit: 'prob', label: 'Jackknife / Road Ice' },
      fog: { weight: 1.8, minThreshold: 700, maxThreshold: 150, unit: 'm', label: 'Low Visibility' },
      snow: { weight: 2.5, minThreshold: 0.5, maxThreshold: 4.0, unit: 'cm/h', label: 'Snow & Slush' },
      thunderstorm: { weight: 2.0, minThreshold: 0, maxThreshold: 1, unit: 'code', label: 'Thunderstorm' }
    }
  },

  ev: {
    id: 'ev',
    name: 'Electric Vehicle (EV)',
    icon: '⚡',
    routingType: 'auto',
    defaultSpeedKmH: 80,
    secondPassWindEffect: true, // Recalculates range & speed penalty
    nightPenalty: 0.3,
    description: 'Cabin heating/cooling and aerodynamic headwind drastically alter battery range and efficiency.',
    hazards: {
      rain: { weight: 1.2, minThreshold: 2.0, maxThreshold: 12.0, unit: 'mm/h', label: 'Rain (Rolling Resistance)' },
      headwind: { weight: 2.3, minThreshold: 18, maxThreshold: 55, unit: 'km/h', label: 'Headwind Range Drain' },
      crosswind: { weight: 0.8, minThreshold: 35, maxThreshold: 75, unit: 'km/h', label: 'Crosswind' },
      gusts: { weight: 1.0, minThreshold: 40, maxThreshold: 80, unit: 'km/h', label: 'Gust Resistance' },
      heat: { weight: 1.8, minThreshold: 30, maxThreshold: 40, unit: '°C', label: 'A/C Battery Penalty' },
      cold: { weight: 2.4, minThreshold: 7, maxThreshold: -10, unit: '°C', label: 'Sub-Zero Battery Drop' },
      ice: { weight: 2.3, minThreshold: 0.1, maxThreshold: 1.0, unit: 'prob', label: 'Road Ice' },
      fog: { weight: 1.8, minThreshold: 800, maxThreshold: 150, unit: 'm', label: 'Fog' },
      snow: { weight: 2.3, minThreshold: 0.5, maxThreshold: 5.0, unit: 'cm/h', label: 'Snow Resistance' },
      thunderstorm: { weight: 1.8, minThreshold: 0, maxThreshold: 1, unit: 'code', label: 'Thunderstorm' }
    }
  },

  pedestrian: {
    id: 'pedestrian',
    name: 'Pedestrian',
    icon: '🚶',
    routingType: 'pedestrian',
    defaultSpeedKmH: 4.8,
    secondPassWindEffect: false,
    nightPenalty: 2.0,
    description: 'Direct human exposure; highly sensitive to heat stress, heavy downpours, severe cold, and high UV.',
    hazards: {
      rain: { weight: 2.3, minThreshold: 0.3, maxThreshold: 4.0, unit: 'mm/h', label: 'Rain & Wet Clothing' },
      headwind: { weight: 1.4, minThreshold: 20, maxThreshold: 50, unit: 'km/h', label: 'Opposing Wind' },
      crosswind: { weight: 0.9, minThreshold: 25, maxThreshold: 55, unit: 'km/h', label: 'Crosswind' },
      gusts: { weight: 1.7, minThreshold: 30, maxThreshold: 60, unit: 'km/h', label: 'Gale Gusts' },
      heat: { weight: 2.4, minThreshold: 27, maxThreshold: 37, unit: '°C', label: 'Heat Exhaustion' },
      cold: { weight: 2.1, minThreshold: 5, maxThreshold: -8, unit: '°C', label: 'Hypothermia Risk' },
      ice: { weight: 2.5, minThreshold: 0.1, maxThreshold: 1.0, unit: 'prob', label: 'Slippery Sidewalk Ice' },
      fog: { weight: 0.6, minThreshold: 500, maxThreshold: 100, unit: 'm', label: 'Reduced Sight' },
      snow: { weight: 2.2, minThreshold: 0.2, maxThreshold: 3.0, unit: 'cm/h', label: 'Snow & Sleet' },
      thunderstorm: { weight: 2.5, minThreshold: 0, maxThreshold: 1, unit: 'code', label: 'Thunderstorm' }
    }
  }
};

const STORAGE_KEY = 'trip_weather_custom_profiles';

export function getVehicleProfiles() {
  try {
    const custom = localStorage.getItem(STORAGE_KEY);
    if (custom) {
      const parsed = JSON.parse(custom);
      return { ...DEFAULT_PROFILES, ...parsed };
    }
  } catch (e) {
    console.warn('Could not read custom profiles from localStorage:', e);
  }
  return { ...DEFAULT_PROFILES };
}

export function saveVehicleProfile(profile) {
  const allProfiles = getVehicleProfiles();
  allProfiles[profile.id] = profile;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(allProfiles));
  } catch (e) {
    console.error('Failed to save profile:', e);
  }
  return allProfiles;
}

export function resetVehicleProfiles() {
  localStorage.removeItem(STORAGE_KEY);
  return { ...DEFAULT_PROFILES };
}
