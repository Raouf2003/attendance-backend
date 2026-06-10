function toRadians(degrees) {
  return degrees * (Math.PI / 180);
}

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

function validateGeofence(lat, lng, companyLat, companyLng, radiusMeters) {
  if (lat == null || lng == null) {
    return { valid: false, message: 'Location data is required' };
  }

  const latNum = parseFloat(lat);
  const lngNum = parseFloat(lng);

  if (isNaN(latNum) || isNaN(lngNum)) {
    return { valid: false, message: 'Invalid location coordinates' };
  }

  const distance = haversineDistance(latNum, lngNum, companyLat, companyLng);

  if (distance > radiusMeters) {
    return {
      valid: false,
      message: `You are outside the allowed area (${Math.round(distance)}m from company, max ${radiusMeters}m)`,
    };
  }

  return { valid: true };
}

module.exports = {
  haversineDistance,
  validateGeofence,
};
