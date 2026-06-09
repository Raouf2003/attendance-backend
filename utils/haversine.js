const COMPANY_LAT = 35.219445;
const COMPANY_LNG = 4.204832;
const GEOFENCE_RADIUS_METERS = 50;

function toRadians(degrees) {
  return degrees * (Math.PI / 180);
}

/**
 * Calculate haversine distance between two GPS coordinates in meters.
 */
function haversineDistance(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const dLat = toRadians(lat2 - lat1);
  const dLng = toRadians(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Validate if given coordinates are inside the company geofence.
 * Returns { valid: true } or { valid: false, message: string }.
 */
function validateGeofence(lat, lng) {
  if (lat == null || lng == null) {
    return { valid: false, message: 'Location data is required for check-in' };
  }

  const latNum = parseFloat(lat);
  const lngNum = parseFloat(lng);

  if (isNaN(latNum) || isNaN(lngNum)) {
    return { valid: false, message: 'Invalid location coordinates' };
  }

  const distance = haversineDistance(latNum, lngNum, COMPANY_LAT, COMPANY_LNG);

  if (distance > GEOFENCE_RADIUS_METERS) {
    return {
      valid: false,
      message: `You are outside the allowed area (${Math.round(distance)}m from company, max ${GEOFENCE_RADIUS_METERS}m)`,
    };
  }

  return { valid: true };
}

module.exports = {
  COMPANY_LAT,
  COMPANY_LNG,
  GEOFENCE_RADIUS_METERS,
  haversineDistance,
  validateGeofence,
};
