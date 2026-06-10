const cron = require('node-cron');
const Attendance = require('../models/Attendance');
const { getSettings, localTimeToUtcCronTimes } = require('../services/settingsService');

const scheduledTasks = [];

async function autoCheckoutPeriod(period, label) {
  try {
    const dateKey = new Date().toISOString().split('T')[0];

    const result = await Attendance.updateMany(
      {
        date: dateKey,
        period: period,
        checkOutTime: null,
      },
      [
        {
          $set: {
            checkOutTime: new Date(),
            totalMinutes: {
              $round: [
                {
                  $divide: [
                    { $subtract: [new Date(), '$checkInTime'] },
                    60000,
                  ],
                },
                0,
              ],
            },
            autoCheckout: true,
          },
        },
      ]
    );

    if (result.modifiedCount > 0) {
      console.log(`Auto checked out ${result.modifiedCount} employees (${label})`);
    }
  } catch (error) {
    console.error(`Auto checkout error (${label}):`, error);
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
    const weExpr = `${minute} ${hour + 1 > 23 ? (hour + 1) % 24 : minute} ${hour} * * 0,6`;
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
