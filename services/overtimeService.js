const Attendance = require('../models/Attendance');

const ALLOWED_MORNING = [0, 1];
const ALLOWED_EVENING = [0, 1, 2];

function validDurations(period) {
  return period === 'morning' ? ALLOWED_MORNING : ALLOWED_EVENING;
}

function isValidDuration(period, duration) {
  return validDurations(period).includes(duration);
}

async function acceptOvertime(attendanceId, employeeId, duration, period) {
  if (!isValidDuration(period, duration)) {
    return { success: false, status: 400, message: `Invalid duration for ${period} period` };
  }

  const attendance = await Attendance.findById(attendanceId);
  if (!attendance) {
    return { success: false, status: 404, message: 'Attendance record not found' };
  }

  if (attendance.employeeId.toString() !== employeeId.toString()) {
    return { success: false, status: 403, message: 'Not authorized' };
  }

  if (attendance.overtimeResponseAt) {
    return { success: false, status: 400, message: 'Overtime response already recorded' };
  }

  if (duration === 0) {
    attendance.overtimeDurationSelected = 0;
    attendance.overtimeResponseAt = new Date();
    await attendance.save();
    return { success: true, needsCheckout: true, attendance };
  }

  const now = new Date();
  attendance.overtimeDurationSelected = duration;
  attendance.overtimeResponseAt = now;
  attendance.overtimeScheduledEnd = new Date(now.getTime() + duration * 60 * 60 * 1000);
  await attendance.save();

  return {
    success: true,
    needsCheckout: false,
    overtimeEnd: attendance.overtimeScheduledEnd,
    attendance,
  };
}

async function cancelOvertime(attendanceId, employeeId) {
  const attendance = await Attendance.findById(attendanceId);
  if (!attendance) {
    return { success: false, status: 404, message: 'Attendance record not found' };
  }

  if (attendance.employeeId.toString() !== employeeId.toString()) {
    return { success: false, status: 403, message: 'Not authorized' };
  }

  if (attendance.checkOutTime) {
    return { success: false, status: 400, message: 'Already checked out' };
  }

  const now = new Date();
  const totalMinutes = Math.round((now - attendance.checkInTime) / 60000);

  attendance.checkOutTime = now;
  attendance.totalMinutes = totalMinutes;
  attendance.normalHours = totalMinutes;
  attendance.overtimeHours = 0;
  attendance.autoCheckout = true;
  attendance.checkoutType = 'auto';
  attendance.overtimeScheduledEnd = null;
  await attendance.save();

  return { success: true, attendance };
}

module.exports = { acceptOvertime, cancelOvertime, validDurations, isValidDuration };