const SystemSettings = require('../models/SystemSettings');

const DEFAULT_SHIFTS = {
  morningStart: '08:00',
  morningEnd: '12:00',
  eveningStart: '13:00',
  eveningEnd: '16:00',
};

const TIMEZONE_OFFSETS = [1, 2];

let cachedShifts = null;

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

async function getShifts() {
  if (cachedShifts) return cachedShifts;
  const doc = await SystemSettings.findOne().sort({ _id: 1 }).limit(1);
  if (!doc) {
    cachedShifts = { ...DEFAULT_SHIFTS };
    return cachedShifts;
  }
  cachedShifts = {
    morningStart: doc.morningStart || DEFAULT_SHIFTS.morningStart,
    morningEnd: doc.morningEnd || DEFAULT_SHIFTS.morningEnd,
    eveningStart: doc.eveningStart || DEFAULT_SHIFTS.eveningStart,
    eveningEnd: doc.eveningEnd || DEFAULT_SHIFTS.eveningEnd,
  };
  return cachedShifts;
}

function invalidateCache() {
  cachedShifts = null;
}

async function getCurrentPeriod() {
  const now = new Date();
  const utcMin = now.getUTCHours() * 60 + now.getUTCMinutes();
  const shifts = await getShifts();
  if (utcMinInRange(utcMin, shifts.morningStart, shifts.morningEnd)) return 'morning';
  if (utcMinInRange(utcMin, shifts.eveningStart, shifts.eveningEnd)) return 'evening';
  const morningEndUtc = Math.max(...localToUtcMinutes(shifts.morningEnd));
  const eveningStartUtc = Math.min(...localToUtcMinutes(shifts.eveningStart));
  if (morningEndUtc <= eveningStartUtc) {
    return utcMin < (morningEndUtc + eveningStartUtc) / 2 ? 'morning' : 'evening';
  }
  return 'evening';
}

async function validateCheckInPeriod(period, utcMin) {
  const shifts = await getShifts();
  if (period === 'morning') {
    if (!utcMinInRange(utcMin, shifts.morningStart, shifts.morningEnd)) {
      return `Morning check-in allowed between ${shifts.morningStart} and ${shifts.morningEnd}`;
    }
  } else if (period === 'evening') {
    if (!utcMinInRange(utcMin, shifts.eveningStart, shifts.eveningEnd)) {
      return `Evening check-in allowed between ${shifts.eveningStart} and ${shifts.eveningEnd}`;
    }
  }
  return null;
}

function localTimeToUtcCronTimes(localHHmm) {
  const utcMinutes = localToUtcMinutes(localHHmm);
  return utcMinutes.map(utcMin => ({
    hour: Math.floor(utcMin / 60) % 24,
    minute: utcMin % 60,
  }));
}

module.exports = {
  getShifts,
  invalidateCache,
  getCurrentPeriod,
  validateCheckInPeriod,
  localTimeToUtcCronTimes,
  localToUtcMinutes,
  utcMinInRange,
  parseHHmm,
  DEFAULT_SHIFTS,
};
