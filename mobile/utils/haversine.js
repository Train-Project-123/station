/**
 * Haversine formula — returns distance in METERS between two lat/lng points.
 * Works in both browser and React Native environments.
 */

const R = 6371000; // Earth radius in meters

function toRad(deg) {
  return deg * (Math.PI / 180);
}

/**
 * @param {number} lat1 - User latitude
 * @param {number} lng1 - User longitude
 * @param {number} lat2 - Station latitude
 * @param {number} lng2 - Station longitude
 * @returns {number} Distance in meters
 */
export function haversineDistance(lat1, lng1, lat2, lng2) {
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c; // meters
}

/**
 * Format distance for display
 * @param {number} meters
 * @returns {string}
 */
export function formatDistance(meters) {
  if (meters < 1000) {
    return `${Math.round(meters)} m`;
  }
  return `${(meters / 1000).toFixed(2)} km`;
}

/**
 * Check if user is within threshold distance of a station
 * @param {number} distanceMeters
 * @param {number} thresholdMeters - default 500
 * @returns {boolean}
 */
export function isWithinBoundary(distanceMeters, thresholdMeters = 500) {
  return distanceMeters <= thresholdMeters;
}
