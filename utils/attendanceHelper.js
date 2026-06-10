const Attendance = require('../models/Attendance');
const { validateCheckInPeriod } = require('../services/settingsService');

function getDateKey(date = new Date()) {
  return date.toISOString().split('T')[0];
}

async function performCheckIn(employeeId, period, location) {
  if (!period || !['morning', 'evening'].includes(period)) {
    return { success: false, status: 400, message: 'Period must be morning or evening' };
  }

  const now = new Date();
  const utcMin = now.getUTCHours() * 60 + now.getUTCMinutes();

  const timeError = await validateCheckInPeriod(period, utcMin);
  if (timeError) {
    return { success: false, status: 400, message: timeError };
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
