const SystemSettings = require('../models/SystemSettings');
const { validateGeofence: haversineValidate } = require('../utils/haversine');

const DEFAULTS = {
  morningStart: '08:00',
  morningEnd: '12:00',
  eveningStart: '13:00',
  eveningEnd: '16:00',
  companyLocation: { lat: 35.219445, lng: 4.204832 },
  allowedRadius: 50,
};

const TIMEZONE_OFFSETS = [1]; // Algeria (CET, UTC+1, no DST)

let cachedSettings = null;

function parseHHmm(str) {
  if (!str || typeof str !== 'string') return null;
  const parts = str.split(':');
  if (parts.length !== 2) return null;
  const h = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10);
  if (isNaN(h) || isNaN(m) || h < 0 || h > 23 || m < 0 || m > 59) return null;
  return h * 60 + m;
}

function localToUtcMinutes(localHHmm) {
  const localMin = parseHHmm(localHHmm);
  if (localMin === null) return [];
  const results = [];
  for (const offset of TIMEZONE_OFFSETS) {
    results.push((localMin - offset * 60 + 1440) % 1440);
  }
  return results;
}

function utcMinInRange(utcMin, localStart, localEnd) {
  const utcStarts = localToUtcMinutes(localStart);
  const utcEnds = localToUtcMinutes(localEnd);
  for (let i = 0; i < utcStarts.length; i++) {
    const start = utcStarts[i];
    let end = utcEnds[i];
    if (start <= end) {
      if (utcMin >= start && utcMin < end) return true;
    } else {
      if (utcMin >= start || utcMin < end) return true;
    }
  }
  return false;
}

function localTimeToUtcCronTimes(localHHmm) {
  const utcMinutes = localToUtcMinutes(localHHmm);
  return utcMinutes.map(utcMin => ({
    hour: Math.floor(utcMin / 60) % 24,
    minute: utcMin % 60,
  }));
}

async function getSettings() {
  if (cachedSettings) return cachedSettings;
  const doc = await SystemSettings.findOne().sort({ _id: 1 }).limit(1);
  if (!doc) {
    cachedSettings = { ...DEFAULTS, companyLocation: { ...DEFAULTS.companyLocation } };
    return cachedSettings;
  }
  cachedSettings = {
    morningStart: doc.morningStart || DEFAULTS.morningStart,
    morningEnd: doc.morningEnd || DEFAULTS.morningEnd,
    eveningStart: doc.eveningStart || DEFAULTS.eveningStart,
    eveningEnd: doc.eveningEnd || DEFAULTS.eveningEnd,
    companyLocation: {
      lat: doc.companyLocation?.lat ?? DEFAULTS.companyLocation.lat,
      lng: doc.companyLocation?.lng ?? DEFAULTS.companyLocation.lng,
    },
    allowedRadius: doc.allowedRadius ?? DEFAULTS.allowedRadius,
  };
  return cachedSettings;
}

function invalidateCache() {
  cachedSettings = null;
}

async function getCurrentPeriod() {
  const now = new Date();
  const utcMin = now.getUTCHours() * 60 + now.getUTCMinutes();
  const settings = await getSettings();
  if (utcMinInRange(utcMin, settings.morningStart, settings.morningEnd)) return 'morning';
  if (utcMinInRange(utcMin, settings.eveningStart, settings.eveningEnd)) return 'evening';
  const morningEndUtc = Math.max(...localToUtcMinutes(settings.morningEnd));
  const eveningStartUtc = Math.min(...localToUtcMinutes(settings.eveningStart));
  if (morningEndUtc <= eveningStartUtc) {
    return utcMin < (morningEndUtc + eveningStartUtc) / 2 ? 'morning' : 'evening';
  }
  return 'evening';
}

async function validateCheckInPeriod(period, utcMin) {
  const settings = await getSettings();
  if (period === 'morning') {
    if (!utcMinInRange(utcMin, settings.morningStart, settings.morningEnd)) {
      return `Morning check-in allowed between ${settings.morningStart} and ${settings.morningEnd}`;
    }
  } else if (period === 'evening') {
    if (!utcMinInRange(utcMin, settings.eveningStart, settings.eveningEnd)) {
      return `Evening check-in allowed between ${settings.eveningStart} and ${settings.eveningEnd}`;
    }
  }
  return null;
}

async function validateGeofence(lat, lng) {
  const settings = await getSettings();
  return haversineValidate(lat, lng, settings.companyLocation.lat, settings.companyLocation.lng, settings.allowedRadius);
}

function formatUtcDateLocal(date, offsetHours) {
  if (!date) return '-';
  const d = new Date(date);
  const local = new Date(d.getTime() + (offsetHours || TIMEZONE_OFFSETS[0]) * 3600000);
  const h = String(local.getUTCHours()).padStart(2, '0');
  const m = String(local.getUTCMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

module.exports = {
  getSettings,
  invalidateCache,
  getCurrentPeriod,
  validateCheckInPeriod,
  validateGeofence,
  localTimeToUtcCronTimes,
  localToUtcMinutes,
  utcMinInRange,
  parseHHmm,
  formatUtcDateLocal,
  DEFAULTS,
};
