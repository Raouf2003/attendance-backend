const cron = require('node-cron');
const { processStaleHeartbeats, processGeofenceViolations, batchEndShift } = require('../services/presenceEngine');
const { getSettings, localTimeToUtcCronTimes } = require('../services/settingsService');

let scheduledTasks = [];
let isRunning = false;

async function sweepStale() {
  if (isRunning) return;
  isRunning = true;
  try {
    const count = await processStaleHeartbeats();
    if (count > 0) {
      console.log(`[ServerSweep] Stale heartbeat sweep: ${count} auto-checked-out`);
    }
  } catch (err) {
    console.error('[ServerSweep] Stale sweep error:', err.message);
  } finally {
    isRunning = false;
  }
}

async function sweepGeofence() {
  try {
    const count = await processGeofenceViolations();
    if (count > 0) {
      console.log(`[ServerSweep] Geofence sweep: ${count} auto-checked-out`);
    }
  } catch (err) {
    console.error('[ServerSweep] Geofence sweep error:', err.message);
  }
}

async function sweepShiftEnd() {
  try {
    const now = new Date();
    const utcMin = now.getUTCHours() * 60 + now.getUTCMinutes();
    const settings = await getSettings();

    const morningEndUtc = localTimeToUtcCronTimes(settings.morningEnd);
    for (const { hour, minute } of morningEndUtc) {
      const endMin = hour * 60 + minute;
      if (Math.abs(utcMin - endMin) <= 2) {
        await batchEndShift('morning');
        break;
      }
    }

    const eveningEndUtc = localTimeToUtcCronTimes(settings.eveningEnd);
    for (const { hour, minute } of eveningEndUtc) {
      const endMin = hour * 60 + minute;
      if (Math.abs(utcMin - endMin) <= 2) {
        await batchEndShift('evening');
        break;
      }
    }
  } catch (err) {
    console.error('[ServerSweep] Shift end sweep error:', err.message);
  }
}

function clearAllTasks() {
  for (const task of scheduledTasks) {
    task.stop();
  }
  scheduledTasks = [];
}

function startServerSweep() {
  clearAllTasks();

  const staleTask = cron.schedule('*/1 * * * *', () => {
    sweepStale();
  });
  scheduledTasks.push(staleTask);

  const geoTask = cron.schedule('*/2 * * * *', () => {
    sweepGeofence();
  });
  scheduledTasks.push(geoTask);

  const shiftTask = cron.schedule('* * * * *', () => {
    sweepShiftEnd();
  });
  scheduledTasks.push(shiftTask);

  console.log('[ServerSweep] Scheduler started: stale(1m), geofence(2m), shift-end(1m)');
  console.log('[ServerSweep] Old schedulers (shiftEnd.js, autoCheckout.js) should be disabled');
}

module.exports = { startServerSweep, clearAllTasks };
