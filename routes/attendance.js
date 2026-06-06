const express = require('express');
const Attendance = require('../models/Attendance');
const { authenticate } = require('../middleware/auth');
const { haversineDistance } = require('../utils/haversine');

const router = express.Router();

function getDateKey(date = new Date()) {
  return date.toISOString().split('T')[0];
}

function getCurrentPeriod() {
  const hour = new Date().getHours();
  if (hour < 12) return 'morning';
  if (hour < 13) return 'break';
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
    const { lat, lng, period } = req.body;

    if (!lat || !lng) {
      return res.status(400).json({ message: 'Location is required' });
    }

    if (!period || !['morning', 'evening'].includes(period)) {
      return res.status(400).json({ message: 'Period must be morning or evening' });
    }

    const now = new Date();
    const hour = now.getHours();

    if (period === 'morning' && (hour < 8 || hour >= 12)) {
      return res.status(400).json({ message: 'Morning check-in allowed between 08:00 and 12:00' });
    }

    if (period === 'evening' && (hour < 13 || hour >= 16)) {
      return res.status(400).json({ message: 'Evening check-in allowed between 13:00 and 16:00' });
    }

    const companyLat = parseFloat(process.env.COMPANY_LAT);
    const companyLng = parseFloat(process.env.COMPANY_LNG);
    const maxRadius = parseFloat(process.env.MAX_RADIUS_METERS);

    const distance = haversineDistance(lat, lng, companyLat, companyLng);
    if (distance > maxRadius) {
      return res.status(400).json({
        message: `You are outside the allowed area. Distance: ${Math.round(distance)}m, Max: ${maxRadius}m`,
      });
    }

    const dateKey = getDateKey(now);

    const existing = await Attendance.findOne({
      employeeId: req.employee._id,
      date: dateKey,
      period: period,
    });

    if (existing) {
      return res.status(400).json({ message: `Already checked in for ${period} period` });
    }

    const attendance = new Attendance({
      employeeId: req.employee._id,
      date: dateKey,
      period: period,
      checkInTime: now,
      location: { lat, lng },
    });

    await attendance.save();

    res.json({
      message: 'Check-in successful',
      attendance: {
        id: attendance._id,
        period: attendance.period,
        checkInTime: attendance.checkInTime,
        date: attendance.date,
      },
    });
  } catch (error) {
    console.error('Check-in error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

router.post('/checkout', authenticate, async (req, res) => {
  try {
    const { period } = req.body;

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

    attendance.checkOutTime = now;
    const diffMs = now - attendance.checkInTime;
    attendance.totalMinutes = Math.round(diffMs / 60000);
    await attendance.save();

    res.json({
      message: 'Check-out successful',
      attendance: {
        id: attendance._id,
        period: attendance.period,
        checkInTime: attendance.checkInTime,
        checkOutTime: attendance.checkOutTime,
        totalMinutes: attendance.totalMinutes,
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
      morning: {
        status: getPeriodStatus(morning),
        attendance: morning,
      },
      evening: {
        status: getPeriodStatus(evening),
        attendance: evening,
      },
      employee: {
        id: req.employee._id,
        fullName: req.employee.fullName,
        employeeNumber: req.employee.employeeNumber,
        fingerprintRegistered: req.employee.fingerprintRegistered || false,
      },
    });
  } catch (error) {
    console.error('Status error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
