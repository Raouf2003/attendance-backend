const cron = require('node-cron');
const Attendance = require('../models/Attendance');
const Employee = require('../models/Employee');
const { getSettings, localTimeToUtcCronTimes } = require('../services/settingsService');
const { emitToUser, emitToAll } = require('../services/socketService');

const scheduledTasks = [];

async function autoCheckoutPeriod(period, label) {
  try {
    const dateKey = new Date().toISOString().split('T')[0];

    const records = await Attendance.find({
      date: dateKey,
      period: period,
      checkOutTime: null,
    }).populate('employeeId', 'fullName employeeNumber');

    if (records.length === 0) return;

    const now = new Date();
    const bulkOps = records.map(r => ({
      updateOne: {
        filter: { _id: r._id },
        update: {
          $set: {
            checkOutTime: now,
            totalMinutes: Math.round((now - r.checkInTime) / 60000),
            normalHours: Math.round((now - r.checkInTime) / 60000) / 60,
            autoCheckout: true,
            checkoutType: 'auto',
          },
        },
      },
    }));

    await Attendance.bulkWrite(bulkOps);

    for (const record of records) {
      emitToUser(record.employeeId, 'attendance_updated', {
        type: 'checkout',
        period: record.period,
        attendanceId: record._id,
        autoCheckout: true,
      });
      const emp = record.employeeId;
      emitToAll('attendance_updated', {
        type: 'checkout',
        employeeId: emp._id.toString(),
        employeeName: emp.fullName || 'Unknown',
        employeeNumber: emp.employeeNumber || '',
        period: record.period,
      });
    }

    console.log(`[AutoCheckout] Checked out ${records.length} employees (${label})`);
  } catch (error) {
    console.error(`[AutoCheckout] Error (${label}):`, error);
  }
}

function clearAllTasks() {
  while (scheduledTasks.length > 0) {
    const task = scheduledTasks.pop();
    task.stop();
  }
}

function scheduleAutoCheckoutJob(period, cronExpr, label) {
  const task = cron.schedule(cronExpr, () => {
    autoCheckoutPeriod(period, label);
  });
  scheduledTasks.push(task);
}

async function rescheduleAutoCheckout() {
  clearAllTasks();

  const shifts = await getSettings();

  const morningCrons = localTimeToUtcCronTimes(shifts.morningEnd);
  for (const { hour, minute } of morningCrons) {
    const wdExpr = `${minute} ${hour} * * 1-5`;
    const weExpr = `${minute} ${hour} * * 0,6`;
    scheduleAutoCheckoutJob('morning', wdExpr, `weekday ${hour}:${minute} morning`);
    const weMinute = (minute + 30) % 60;
    const weHour = minute + 30 >= 60 ? (hour + 1) % 24 : hour;
    scheduleAutoCheckoutJob('morning', `${weMinute} ${weHour} * * 0,6`, `weekend ${weHour}:${weMinute} morning`);
  }

  const eveningCrons = localTimeToUtcCronTimes(shifts.eveningEnd);
  for (const { hour, minute } of eveningCrons) {
    const wdExpr = `${minute} ${hour} * * 1-5`;
    const weExpr = `${minute} ${hour} * * 0,6`;
    scheduleAutoCheckoutJob('evening', wdExpr, `weekday ${hour}:${minute} evening`);
    scheduleAutoCheckoutJob('evening', weExpr, `weekend ${hour}:${minute} evening`);
  }

  console.log(`[AutoCheckout] Scheduler set — morning end ${shifts.morningEnd}, evening end ${shifts.eveningEnd}`);
}

async function startAutoCheckoutScheduler() {
  await rescheduleAutoCheckout();
}

module.exports = { startAutoCheckoutScheduler, rescheduleAutoCheckout };
