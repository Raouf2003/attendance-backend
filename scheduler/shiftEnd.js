const cron = require('node-cron');
const Attendance = require('../models/Attendance');
const { getSettings, localTimeToUtcCronTimes } = require('../services/settingsService');

const scheduledTasks = [];

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
      record.normalHours = totalMinutes / 60;
      record.autoCheckout = true;
      record.checkoutType = 'auto';
      await record.save();
      console.log(`[ShiftEnd] Auto-checkout ${record.employeeId} (${label})`);
    }

    console.log(`[ShiftEnd] ${label} — processed ${activeRecords.length} employees`);
  } catch (err) {
    console.error(`[ShiftEnd] Error (${label}):`, err.message);
  }
}

function clearAllTasks() {
  while (scheduledTasks.length > 0) {
    const task = scheduledTasks.pop();
    task.stop();
  }
}

function scheduleShiftEndJob(period, cronExpr, label) {
  const task = cron.schedule(cronExpr, () => {
    processShiftEnd(period, label);
  });
  scheduledTasks.push(task);
}

async function rescheduleShiftEnd() {
  clearAllTasks();

  const shifts = await getSettings();

  const morningCrons = localTimeToUtcCronTimes(shifts.morningEnd);
  for (const { hour, minute } of morningCrons) {
    const expr = `${minute} ${hour} * * *`;
    scheduleShiftEndJob('morning', expr, `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')} UTC morning`);
    console.log(`[ShiftEnd] Scheduled morning at ${expr} (${shifts.morningEnd} local)`);
  }

  const eveningCrons = localTimeToUtcCronTimes(shifts.eveningEnd);
  for (const { hour, minute } of eveningCrons) {
    const expr = `${minute} ${hour} * * *`;
    scheduleShiftEndJob('evening', expr, `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')} UTC evening`);
    console.log(`[ShiftEnd] Scheduled evening at ${expr} (${shifts.eveningEnd} local)`);
  }

  console.log(`[ShiftEnd] Scheduler set — morning end ${shifts.morningEnd}, evening end ${shifts.eveningEnd}`);
}

async function startShiftEndScheduler() {
  await rescheduleShiftEnd();
}

module.exports = { startShiftEndScheduler, rescheduleShiftEnd };
