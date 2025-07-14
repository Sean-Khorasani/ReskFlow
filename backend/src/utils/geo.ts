/**
 * Geographic Utility Functions
 * Handles distance calculations, ETA estimations, and geofencing
 */

interface Location {
  latitude: number;
  longitude: number;
}

/**
 * Calculate distance between two coordinates using Haversine formula
 * @returns Distance in meters
 */
export function calculateDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371e3; // Earth's radius in meters
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}

/**
 * Calculate estimated time of arrival based on distance
 * @param distance Distance in meters
 * @param mode Transportation mode
 * @returns ETA in seconds
 */
export function calculateETA(
  distance: number,
  mode: 'car' | 'motorcycle' | 'bicycle' = 'motorcycle'
): number {
  // Average speeds in km/h for different modes
  const speeds = {
    car: 40,        // City driving
    motorcycle: 35, // City riding
    bicycle: 15     // Cycling
  };

  const speedKmh = speeds[mode];
  const distanceKm = distance / 1000;
  const timeHours = distanceKm / speedKmh;
  
  // Add buffer time for traffic and stops
  const bufferMultiplier = 1.2;
  
  return Math.round(timeHours * 3600 * bufferMultiplier);
}

/**
 * Check if a point is within a geofence
 */
export function isWithinGeofence(
  point: Location,
  center: Location,
  radius: number
): boolean {
  const distance = calculateDistance(
    point.latitude,
    point.longitude,
    center.latitude,
    center.longitude
  );
  
  return distance <= radius;
}

/**
 * Calculate bearing between two points
 * @returns Bearing in degrees (0-360)
 */
export function calculateBearing(
  start: Location,
  end: Location
): number {
  const startLat = (start.latitude * Math.PI) / 180;
  const startLng = (start.longitude * Math.PI) / 180;
  const endLat = (end.latitude * Math.PI) / 180;
  const endLng = (end.longitude * Math.PI) / 180;

  const dLng = endLng - startLng;

  const x = Math.sin(dLng) * Math.cos(endLat);
  const y = Math.cos(startLat) * Math.sin(endLat) -
    Math.sin(startLat) * Math.cos(endLat) * Math.cos(dLng);

  const bearing = Math.atan2(x, y);
  
  return ((bearing * 180) / Math.PI + 360) % 360;
}

/**
 * Get compass direction from bearing
 */
export function getCompassDirection(bearing: number): string {
  const directions = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  const index = Math.round(bearing / 45) % 8;
  return directions[index];
}

/**
 * Calculate bounds for a given center and radius
 */
export function calculateBounds(
  center: Location,
  radius: number
): {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
} {
  const earthRadius = 6371000; // meters
  const lat = center.latitude;
  const lng = center.longitude;

  // Calculate lat/lng deltas
  const latDelta = (radius / earthRadius) * (180 / Math.PI);
  const lngDelta = (radius / earthRadius) * (180 / Math.PI) / Math.cos((lat * Math.PI) / 180);

  return {
    minLat: lat - latDelta,
    maxLat: lat + latDelta,
    minLng: lng - lngDelta,
    maxLng: lng + lngDelta
  };
}

/**
 * Cluster nearby locations
 */
export function clusterLocations(
  locations: Location[],
  clusterRadius: number
): Array<{
  center: Location;
  locations: Location[];
}> {
  const clusters: Array<{
    center: Location;
    locations: Location[];
  }> = [];

  const unprocessed = [...locations];

  while (unprocessed.length > 0) {
    const current = unprocessed.shift()!;
    const cluster = {
      center: current,
      locations: [current]
    };

    // Find all locations within cluster radius
    for (let i = unprocessed.length - 1; i >= 0; i--) {
      const distance = calculateDistance(
        current.latitude,
        current.longitude,
        unprocessed[i].latitude,
        unprocessed[i].longitude
      );

      if (distance <= clusterRadius) {
        cluster.locations.push(unprocessed[i]);
        unprocessed.splice(i, 1);
      }
    }

    // Calculate cluster center
    const avgLat = cluster.locations.reduce((sum, loc) => sum + loc.latitude, 0) / cluster.locations.length;
    const avgLng = cluster.locations.reduce((sum, loc) => sum + loc.longitude, 0) / cluster.locations.length;
    cluster.center = { latitude: avgLat, longitude: avgLng };

    clusters.push(cluster);
  }

  return clusters;
}

/**
 * Simplify a route by removing redundant points
 * Uses Douglas-Peucker algorithm
 */
export function simplifyRoute(
  points: Location[],
  tolerance: number = 10
): Location[] {
  if (points.length <= 2) return points;

  // Find point with maximum distance from line
  let maxDistance = 0;
  let maxIndex = 0;

  for (let i = 1; i < points.length - 1; i++) {
    const distance = perpendicularDistance(
      points[i],
      points[0],
      points[points.length - 1]
    );

    if (distance > maxDistance) {
      maxDistance = distance;
      maxIndex = i;
    }
  }

  // If max distance is greater than tolerance, recursively simplify
  if (maxDistance > tolerance) {
    const left = simplifyRoute(points.slice(0, maxIndex + 1), tolerance);
    const right = simplifyRoute(points.slice(maxIndex), tolerance);
    return [...left.slice(0, -1), ...right];
  } else {
    return [points[0], points[points.length - 1]];
  }
}

/**
 * Calculate perpendicular distance from point to line
 */
function perpendicularDistance(
  point: Location,
  lineStart: Location,
  lineEnd: Location
): number {
  const x0 = point.longitude;
  const y0 = point.latitude;
  const x1 = lineStart.longitude;
  const y1 = lineStart.latitude;
  const x2 = lineEnd.longitude;
  const y2 = lineEnd.latitude;

  const numerator = Math.abs((y2 - y1) * x0 - (x2 - x1) * y0 + x2 * y1 - y2 * x1);
  const denominator = Math.sqrt(Math.pow(y2 - y1, 2) + Math.pow(x2 - x1, 2));

  return numerator / denominator * 111320; // Convert to meters (approximate)
}

/**
 * Validate coordinates
 */
export function isValidCoordinate(lat: number, lng: number): boolean {
  return (
    typeof lat === 'number' &&
    typeof lng === 'number' &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  );
}

/**
 * Format distance for display
 */
export function formatDistance(meters: number): string {
  if (meters < 1000) {
    return `${Math.round(meters)}m`;
  } else {
    return `${(meters / 1000).toFixed(1)}km`;
  }
}

/**
 * Format duration for display
 */
export function formatDuration(seconds: number): string {
  if (seconds < 60) {
    return `${Math.round(seconds)}s`;
  } else if (seconds < 3600) {
    return `${Math.round(seconds / 60)}min`;
  } else {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.round((seconds % 3600) / 60);
    return `${hours}h ${minutes}min`;
  }
}