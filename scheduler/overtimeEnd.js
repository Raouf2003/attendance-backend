const cron = require('node-cron');
const Attendance = require('../models/Attendance');
const { emitToUser, emitToAll } = require('../services/socketService');

async function processOvertimeEnd() {
  try {
    const now = new Date();

    const records = await Attendance.find({
      overtimeScheduledEnd: { $ne: null, $lte: now },
      checkOutTime: null,
    });

    if (records.length === 0) return;

    for (const record of records) {
      const checkIn = record.checkInTime;
      const totalMinutes = Math.round((now - checkIn) / 60000);
      const duration = record.overtimeDurationSelected || 0;

      record.checkOutTime = now;
      record.totalMinutes = totalMinutes;
      record.normalHours = totalMinutes;
      record.overtimeHours = duration;
      record.autoCheckout = true;
      record.checkoutType = 'auto';
      await record.save();

      emitToUser(record.employeeId, 'overtime_updated', {
        type: 'overtime_ended',
        attendanceId: record._id,
        period: record.period,
        overtimeDurationSelected: duration,
      });
      emitToAll('overtime_ended', {
        employeeId: record.employeeId.toString(),
        attendanceId: record._id.toString(),
        period: record.period,
        overtimeDurationSelected: duration,
      });

      console.log(`[OvertimeEnd] Auto-checkout employee ${record.employeeId}: ${duration}h overtime, ${totalMinutes}min total`);
    }

    console.log(`[OvertimeEnd] Processed ${records.length} overtime completions`);
  } catch (err) {
    console.error('[OvertimeEnd] Error:', err.message);
  }
}

function startOvertimeEndScheduler() {
  cron.schedule('* * * * *', () => {
    processOvertimeEnd();
  });

  console.log('[OvertimeEnd] Scheduler started (every minute)');
}

module.exports = { startOvertimeEndScheduler, processOvertimeEnd };