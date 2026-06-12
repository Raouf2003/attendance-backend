const Attendance = require('../models/Attendance');
const Heartbeat = require('../models/Heartbeat');
const { getSettings } = require('./settingsService');
const { validateGeofence } = require('../utils/haversine');
const { emitToUser, emitToAll } = require('./socketService');

async function processHeartbeat(employeeId, attendanceId, { lat, lng, accuracy, isMock, battery, networkType, deviceId, ip }) {
  const attendance = await Attendance.findOne({
    _id: attendanceId,
    employeeId,
    checkOutTime: null,
  });
  if (!attendance) return { action: 'no_active_attendance' };

  const now = new Date();
  attendance.lastHeartbeatAt = now;
  attendance.heartbeatCount = (attendance.heartbeatCount || 0) + 1;

  if (lat != null && lng != null) {
    attendance.location = { lat, lng };
  }

  if (isMock === true || isMock === 'true') {
    attendance.mockDetected = true;
    attendance.mockCount = (attendance.mockCount || 0) + 1;
  }

  if (lat == null || lng == null || (accuracy != null && accuracy > 100)) {
    if (!attendance.locationLost) {
      attendance.locationLost = true;
      attendance.locationLostSince = now;
    }
  } else {
    attendance.locationLost = false;
    attendance.locationLostSince = null;
  }

  if (deviceId) attendance.deviceId = deviceId;
  if (ip) attendance.lastKnownIp = ip;

  let geoViolation = false;
  let checkedOut = false;

  if (lat != null && lng != null && !isMock) {
    const settings = await getSettings();
    const geoCheck = validateGeofence(
      lat, lng,
      settings.companyLocation.lat,
      settings.companyLocation.lng,
      settings.allowedRadius
    );

    if (!geoCheck.valid) {
      attendance.consecutiveOutsideCount = (attendance.consecutiveOutsideCount || 0) + 1;
      if (attendance.consecutiveOutsideCount >= 3) {
        await performAutoCheckout(attendance, 'geofence_violation', { lat, lng });
        checkedOut = true;
      }
      geoViolation = true;
    } else {
      attendance.consecutiveOutsideCount = 0;
    }
  }

  if (!checkedOut && attendance.locationLost && attendance.locationLostSince) {
    const lostMinutes = (now - attendance.locationLostSince) / 60000;
    if (lostMinutes >= 5) {
      await performAutoCheckout(attendance, 'location_lost_timeout');
      checkedOut = true;
    }
  }

  if (!checkedOut) {
    await attendance.save();
  }

  await Heartbeat.create({
    employeeId,
    attendanceId,
    lat, lng, accuracy,
    isMock: isMock === true || isMock === 'true',
    battery, networkType,
    timestamp: now,
  });

  if (checkedOut) {
    return { action: 'checked_out', reason: attendance.checkOutReason };
  }

  return {
    action: 'ok',
    insideGeofence: !geoViolation,
    consecutiveOutside: attendance.consecutiveOutsideCount || 0,
    serverTime: now.toISOString(),
    locationLost: attendance.locationLost,
  };
}

async function performAutoCheckout(attendance, reason, { lat, lng } = {}) {
  const now = new Date();
  attendance.checkOutTime = now;
  attendance.totalMinutes = Math.round((now - attendance.checkInTime) / 60000);
  attendance.normalHours = attendance.totalMinutes / 60;
  attendance.autoCheckout = true;
  attendance.checkoutType = 'auto';
  attendance.checkOutReason = reason;
  attendance.lastHeartbeatAt = now;
  if (lat != null && lng != null) {
    attendance.location = { lat, lng };
  }
  await attendance.save();

  emitToUser(attendance.employeeId, 'attendance_updated', {
    type: 'checkout',
    period: attendance.period,
    attendanceId: attendance._id,
    autoCheckout: true,
    reason,
  });
  emitToAll('attendance_updated', {
    type: 'checkout',
    employeeId: attendance.employeeId.toString(),
    period: attendance.period,
  });
}

async function processStaleHeartbeats() {
  const staleDeadline = new Date(Date.now() - 2 * 60 * 1000);
  const staleRecords = await Attendance.find({
    checkOutTime: null,
    lastHeartbeatAt: { $lt: staleDeadline },
  }).limit(100);

  for (const record of staleRecords) {
    await performAutoCheckout(record, 'heartbeat_timeout');
    console.log(`[Presence] Auto-checkout ${record._id}: heartbeat timeout`);
  }

  return staleRecords.length;
}

async function processGeofenceViolations() {
  const outsideRecords = await Attendance.find({
    checkOutTime: null,
    consecutiveOutsideCount: { $gte: 3 },
  }).limit(100);

  for (const record of outsideRecords) {
    await performAutoCheckout(record, 'geofence_violation_server');
    console.log(`[Presence] Auto-checkout ${record._id}: server geofence sweep`);
  }

  return outsideRecords.length;
}

async function batchEndShift(period) {
  const dateKey = new Date().toISOString().split('T')[0];
  const records = await Attendance.find({
    date: dateKey,
    period,
    checkOutTime: null,
  }).populate('employeeId', 'fullName employeeNumber');

  if (records.length === 0) return 0;

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
          checkOutReason: 'shift_end',
        },
      },
    },
  }));

  await Attendance.bulkWrite(bulkOps);

  for (const r of records) {
    emitToUser(r.employeeId, 'attendance_updated', {
      type: 'checkout', period, autoCheckout: true, reason: 'shift_end',
    });
  }

  console.log(`[Presence] Shift end ${period}: checked out ${records.length} employees`);
  return records.length;
}

module.exports = {
  processHeartbeat,
  performAutoCheckout,
  processStaleHeartbeats,
  processGeofenceViolations,
  batchEndShift,
};
