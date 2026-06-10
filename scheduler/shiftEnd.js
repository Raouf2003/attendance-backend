const cron = require('node-cron');
const Attendance = require('../models/Attendance');
const Employee = require('../models/Employee');
const { sendMulticastPushNotification, isFcmEnabled } = require('../services/firebase');

async function processShiftEnd(period, label) {
  try {
    const today = new Date();
    const dateKey = today.toISOString().split('T')[0];
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayKey = yesterday.toISOString().split('T')[0];

    const activeRecords = await Attendance.find({
      date: { $in: [dateKey, yesterdayKey] },
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
      const now = new Date();
      const totalMinutes = Math.round((now - record.checkInTime) / 60000);

      record.checkOutTime = now;
      record.totalMinutes = totalMinutes;
      record.normalHours = totalMinutes;
      record.autoCheckout = true;
      record.checkoutType = 'auto';

      const employee = await Employee.findById(record.employeeId);
      if (employee && employee.fcmTokens && employee.fcmTokens.length > 0) {
        record.overtimeRequested = true;
        await record.save();

        const result = await sendMulticastPushNotification(
          employee.fcmTokens,
          'Shift Ended',
          'Your shift has ended. Tap to choose overtime.',
          {
            type: 'overtime_request',
            attendanceId: record._id.toString(),
            period,
            date: dateKey,
          },
        );

        console.log(`[ShiftEnd] Notified ${employee.employeeNumber} (${label}): ${result.success} sent, ${result.failure} failed`);
      } else {
        await record.save();
        console.log(`[ShiftEnd] Auto-checkout ${record.employeeId} (${label}): no FCM tokens`);
      }
    }

    console.log(`[ShiftEnd] ${label} — processed ${activeRecords.length} employees`);
  } catch (err) {
    console.error(`[ShiftEnd] Error (${label}):`, err.message);
  }
}

function startShiftEndScheduler() {
  // Morning ends at 12:00 local → 10:00 UTC (UTC+2) / 11:00 UTC (UTC+1)
  cron.schedule('0 10 * * *', () => {
    processShiftEnd('morning', '10:00 UTC morning');
  });

  cron.schedule('0 11 * * *', () => {
    processShiftEnd('morning', '11:00 UTC morning');
  });

  // Evening ends at 16:00 local → 14:00 UTC (UTC+2) / 15:00 UTC (UTC+1)
  cron.schedule('0 14 * * *', () => {
    processShiftEnd('evening', '14:00 UTC evening');
  });

  cron.schedule('0 15 * * *', () => {
    processShiftEnd('evening', '15:00 UTC evening');
  });

  console.log('[ShiftEnd] Scheduler started (10:00/11:00 UTC morning, 14:00/15:00 UTC evening)');
}

module.exports = { startShiftEndScheduler };