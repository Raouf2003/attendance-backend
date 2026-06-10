const Attendance = require('../models/Attendance');

function getDateKey(date = new Date()) {
  return date.toISOString().split('T')[0];
}

/**
 * Performs a check-in for a given employee and period.
 * Accepts optional location data (lat/lng) to store with the record.
 * Returns { success: true, attendance } or { success: false, status, message }.
 */
async function performCheckIn(employeeId, period, location) {
  if (!period || !['morning', 'evening'].includes(period)) {
    return { success: false, status: 400, message: 'Period must be morning or evening' };
  }

  const now = new Date();
  const hour = now.getHours();

  if (period === 'morning' && (hour < 6 || hour >= 11)) {
    return { success: false, status: 400, message: 'Morning check-in allowed between 08:00 and 12:00' };
  }
  if (period === 'evening') {
    const totalMin = hour * 60 + now.getMinutes();
    if (totalMin < 11 * 60 || totalMin >= 15 * 60) {
      return { success: false, status: 400, message: 'Evening check-in allowed between 13:00 and 16:00' };
    }
  }

  const dateKey = getDateKey(now);

  const existing = await Attendance.findOne({ employeeId, date: dateKey, period });
  if (existing) {
    return { success: false, status: 400, message: `Already checked in for ${period} period` };
  }

  const attendanceData = {
    employeeId,
    date: dateKey,
    period,
    checkInTime: now,
  };

  if (location && location.lat != null && location.lng != null) {
    attendanceData.location = {
      lat: parseFloat(location.lat),
      lng: parseFloat(location.lng),
    };
  }

  const attendance = new Attendance(attendanceData);
  await attendance.save();

  return {
    success: true,
    attendance: {
      id: attendance._id,
      period: attendance.period,
      checkInTime: attendance.checkInTime,
      date: attendance.date,
      location: attendance.location,
    },
  };
}

module.exports = { performCheckIn };
