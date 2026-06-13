const express = require('express');
const Attendance = require('../models/Attendance');
const AuditLog = require('../models/AuditLog');
const { authenticate } = require('../middleware/auth');
const { performCheckIn } = require('../utils/attendanceHelper');
const { validateGeofence } = require('../services/settingsService');
const { getCurrentPeriod, getSettings } = require('../services/settingsService');
const { emitToUser, emitToAll } = require('../services/socketService');

const router = express.Router();

function getDateKey(date = new Date()) {
  return date.toISOString().split('T')[0];
}

function getPeriodStatus(record) {
  if (!record) return 'not_started';
  if (record.checkInTime && !record.checkOutTime) return 'working';
  if (record.checkInTime && record.checkOutTime) return 'finished';
  return 'not_started';
}

router.post('/checkin', authenticate, async (req, res) => {
  try {
    const { period, lat, lng, clientEventTime } = req.body;

    const geoCheck = await validateGeofence(lat, lng);
    if (!geoCheck.valid) {
      return res.status(403).json({ message: geoCheck.message, error: 'geofence_blocked' });
    }

    const result = await performCheckIn(req.employee._id, period, { lat, lng, clientEventTime });
    if (!result.success) {
      return res.status(result.status).json({ message: result.message });
    }
    emitToUser(req.employee._id, 'attendance_updated', {
      type: 'checkin',
      period,
      attendanceId: result.attendance.id,
    });
    emitToAll('attendance_updated', {
      type: 'checkin',
      employeeId: req.employee._id.toString(),
      employeeName: req.employee.fullName,
      employeeNumber: req.employee.employeeNumber,
      period,
    });

    await AuditLog.create({
      employeeId: req.employee._id,
      action: 'checkin',
      ip: req.ip,
      userAgent: req.headers['user-agent'] || null,
      metadata: { period, attendanceId: result.attendance.id, lat, lng },
    });

    res.json({ message: 'Check-in successful', attendance: result.attendance });
  } catch (error) {
    console.error('Check-in error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

router.post('/checkout', authenticate, async (req, res) => {
  try {
    const { period, autoCheckout, lat, lng, clientEventTime, reason } = req.body;

    if (!period || !['morning', 'evening'].includes(period)) {
      return res.status(400).json({ message: 'Period must be morning or evening' });
    }

    const now = new Date();
    const dateKey = getDateKey(now);

    const attendance = await Attendance.findOne({
      employeeId: req.employee._id,
      date: dateKey,
      period: period,
    });

    if (!attendance) {
      return res.status(400).json({ message: `No check-in found for ${period} period` });
    }

    if (attendance.checkOutTime) {
      return res.status(400).json({ message: `Already checked out for ${period} period` });
    }

    if (!autoCheckout) {
      const minDuration = 1;
      const diffMs = now - attendance.checkInTime;
      const totalMinutes = Math.round(diffMs / 60000);
      if (totalMinutes < minDuration) {
        return res.status(400).json({
          message: `Check-out too early. Minimum duration is ${minDuration} minute(s).`,
        });
      }
    }

    attendance.checkOutTime = now;
    if (clientEventTime) {
      attendance.clientCheckOutTime = new Date(clientEventTime);
    }
    attendance.totalMinutes = Math.round((now - attendance.checkInTime) / 60000);
    attendance.normalHours = attendance.totalMinutes / 60;
    if (autoCheckout) {
      attendance.autoCheckout = true;
      attendance.checkoutType = 'auto';
      if (reason) {
        attendance.checkOutReason = reason;
      }
      if (lat != null && lng != null) {
        attendance.location = { lat, lng };
      }
    }
    await attendance.save();

    emitToUser(req.employee._id, 'attendance_updated', {
      type: 'checkout',
      period,
      attendanceId: attendance._id,
      autoCheckout: attendance.autoCheckout,
    });
    emitToAll('attendance_updated', {
      type: 'checkout',
      employeeId: req.employee._id.toString(),
      employeeName: req.employee.fullName,
      employeeNumber: req.employee.employeeNumber,
      period,
    });

    await AuditLog.create({
      employeeId: req.employee._id,
      action: autoCheckout ? 'auto_checkout' : 'checkout',
      ip: req.ip,
      userAgent: req.headers['user-agent'] || null,
      deviceId: attendance.deviceId || null,
      metadata: {
        period,
        attendanceId: attendance._id,
        checkOutReason: attendance.checkOutReason,
        autoCheckout: !!autoCheckout,
        lat,
        lng,
      },
    });

    res.json({
      message: 'Check-out successful',
      attendance: {
        id: attendance._id,
        date: attendance.date,
        period: attendance.period,
        checkInTime: attendance.checkInTime,
        checkOutTime: attendance.checkOutTime,
        clientCheckInTime: attendance.clientCheckInTime,
        clientCheckOutTime: attendance.clientCheckOutTime,
        totalMinutes: attendance.totalMinutes,
        normalHours: attendance.normalHours,
        autoCheckout: attendance.autoCheckout,
        checkoutType: attendance.checkoutType,
        checkOutReason: attendance.checkOutReason,
        location: attendance.location,
      },
    });
  } catch (error) {
    console.error('Check-out error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

router.get('/status', authenticate, async (req, res) => {
  try {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    const now = new Date();
    const dateKey = getDateKey(now);
    const currentPeriod = await getCurrentPeriod();
    const settings = await getSettings();

    const records = await Attendance.find({
      employeeId: req.employee._id,
      date: dateKey,
    });

    const morning = records.find(r => r.period === 'morning') || null;
    const evening = records.find(r => r.period === 'evening') || null;

    res.json({
      currentPeriod,
      morning: { status: getPeriodStatus(morning), attendance: morning },
      evening: { status: getPeriodStatus(evening), attendance: evening },
      shifts: {
        morningStart: settings.morningStart,
        morningEnd: settings.morningEnd,
        eveningStart: settings.eveningStart,
        eveningEnd: settings.eveningEnd,
      },
      geofence: {
        companyLocation: settings.companyLocation,
        allowedRadius: settings.allowedRadius,
      },
      employee: {
        id: req.employee._id,
        fullName: req.employee.fullName,
        employeeNumber: req.employee.employeeNumber,
        role: req.employee.role,
        isActive: req.employee.isActive,
        fingerprintRegistered: req.employee.fingerprintRegistered || false,
        faceEnrolled: req.employee.faceEnrolled || false,
      },
    });
  } catch (error) {
    console.error('Status error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

router.get('/attendance/current-state', authenticate, async (req, res) => {
  try {
    const now = new Date();
    const dateKey = getDateKey(now);
    const currentPeriod = await getCurrentPeriod();
    const settings = await getSettings();

    const records = await Attendance.find({
      employeeId: req.employee._id,
      date: dateKey,
    });

    const morning = records.find(r => r.period === 'morning') || null;
    const evening = records.find(r => r.period === 'evening') || null;

    res.json({
      currentPeriod,
      morning: { status: getPeriodStatus(morning), attendance: morning },
      evening: { status: getPeriodStatus(evening), attendance: evening },
      shifts: {
        morningStart: settings.morningStart,
        morningEnd: settings.morningEnd,
        eveningStart: settings.eveningStart,
        eveningEnd: settings.eveningEnd,
      },
      geofence: {
        companyLocation: settings.companyLocation,
        allowedRadius: settings.allowedRadius,
      },
    });
  } catch (error) {
    console.error('Current state error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
