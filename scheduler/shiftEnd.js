const cron = require('node-cron');
const Attendance = require('../models/Attendance');
const Employee = require('../models/Employee');
const { sendMulticastPushNotification, isFcmEnabled } = require('../services/firebase');

async function notifyShiftEnd(period, label) {
  try {
    if (!isFcmEnabled()) {
      console.log(`[ShiftEnd] FCM not configured — skipping ${label}`);
      return;
    }

    const dateKey = new Date().toISOString().split('T')[0];

    const activeRecords = await Attendance.find({
      date: dateKey,
      period,
      checkInTime: { $ne: null },
      checkOutTime: null,
      overtimeRequested: { $ne: true },
    });

    if (activeRecords.length === 0) {
      console.log(`[ShiftEnd] No active employees for ${label}`);
      return;
    }

    for (const record of activeRecords) {
      const employee = await Employee.findById(record.employeeId);
      if (!employee || !employee.fcmTokens || employee.fcmTokens.length === 0) continue;

      const result = await sendMulticastPushNotification(
        employee.fcmTokens,
        'Shift Ended',
        'Do you want to add overtime?',
        {
          type: 'overtime_request',
          attendanceId: record._id.toString(),
          period,
          date: dateKey,
        },
      );

      record.overtimeRequested = true;
      await record.save();

      console.log(`[ShiftEnd] Notified ${employee.employeeNumber} (${label}): ${result.success} sent, ${result.failure} failed`);
    }

    console.log(`[ShiftEnd] ${label} — notified ${activeRecords.length} employees`);
  } catch (err) {
    console.error(`[ShiftEnd] Error (${label}):`, err.message);
  }
}

function startShiftEndScheduler() {
  cron.schedule('0 12 * * *', () => {
    notifyShiftEnd('morning', '12:00 morning shift end');
  });

  cron.schedule('0 16 * * *', () => {
    notifyShiftEnd('evening', '16:00 evening shift end');
  });

  console.log('[ShiftEnd] Scheduler started (12:00 morning, 16:00 evening)');
}

module.exports = { startShiftEndScheduler };
