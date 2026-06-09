const express = require('express');
const Attendance = require('../models/Attendance');
const { authenticate } = require('../middleware/auth');
const { performCheckIn } = require('../utils/attendanceHelper');
const { validateGeofence } = require('../utils/haversine');

const router = express.Router();

function getDateKey(date = new Date()) {
  return date.toISOString().split('T')[0];
}

function getCurrentPeriod() {
  const hour = new Date().getHours();
  if (hour < 8) return 'morning';
  return 'evening';
}

function getPeriodStatus(record) {
  if (!record) return 'not_started';
  if (record.checkInTime && !record.checkOutTime) return 'working';
  if (record.checkInTime && record.checkOutTime) return 'finished';
  return 'not_started';
}

router.post('/checkin', authenticate, async (req, res) => {
  try {
    const { period, lat, lng } = req.body;

    const geoCheck = validateGeofence(lat, lng);
    if (!geoCheck.valid) {
      return res.status(403).json({ message: geoCheck.message, error: 'geofence_blocked' });
    }

    const result = await performCheckIn(req.employee._id, period, { lat, lng });
    if (!result.success) {
      return res.status(result.status).json({ message: result.message });
    }
    res.json({ message: 'Check-in successful', attendance: result.attendance });
  } catch (error) {
    console.error('Check-in error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

router.post('/checkout', authenticate, async (req, res) => {
  try {
    const { period, autoCheckout } = req.body;

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
    attendance.totalMinutes = Math.round((now - attendance.checkInTime) / 60000);
    if (autoCheckout) {
      attendance.autoCheckout = true;
    }
    await attendance.save();

    res.json({
      message: 'Check-out successful',
      attendance: {
        id: attendance._id,
        period: attendance.period,
        checkInTime: attendance.checkInTime,
        checkOutTime: attendance.checkOutTime,
        totalMinutes: attendance.totalMinutes,
        autoCheckout: attendance.autoCheckout,
      },
    });
  } catch (error) {
    console.error('Check-out error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

router.get('/status', authenticate, async (req, res) => {
  try {
    const now = new Date();
    const dateKey = getDateKey(now);
    const currentPeriod = getCurrentPeriod();

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

module.exports = router;
