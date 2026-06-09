const Attendance = require('../models/Attendance');

function getDateKey(date = new Date()) {
  return date.toISOString().split('T')[0];
}

/**
 * Performs a check-in for a given employee and period.
 * Returns { success: true, attendance } or { success: false, status, message }.
 */
async function performCheckIn(employeeId, period) {
  if (!period || !['morning', 'evening'].includes(period)) {
    return { success: false, status: 400, message: 'Period must be morning or evening' };
  }

  const now = new Date();
  const hour = now.getHours();

  if (period === 'morning' && (hour < 7 || hour >= 12)) {
    return { success: false, status: 400, message: 'Morning check-in allowed between 07:00 and 12:00' };
  }
  if (period === 'evening' && (hour < 12 || hour >= 23)) {
    return { success: false, status: 400, message: 'Evening check-in allowed between 12:00 and 22:59' };
  }

  const dateKey = getDateKey(now);

  const existing = await Attendance.findOne({ employeeId, date: dateKey, period });
  if (existing) {
    return { success: false, status: 400, message: `Already checked in for ${period} period` };
  }

  const attendance = new Attendance({
    employeeId,
    date: dateKey,
    period,
    checkInTime: now,
  });

  await attendance.save();

  return {
    success: true,
    attendance: {
      id: attendance._id,
      period: attendance.period,
      checkInTime: attendance.checkInTime,
      date: attendance.date,
    },
  };
}

module.exports = { performCheckIn };
