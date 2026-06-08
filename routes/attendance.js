const express = require('express');
const Attendance = require('../models/Attendance');
const { authenticate } = require('../middleware/auth');

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

// TEST MODE: evening 01:00-12:00

function getPeriodStatus(record) {
  if (!record) return 'not_started';
  if (record.checkInTime && !record.checkOutTime) return 'working';
  if (record.checkInTime && record.checkOutTime) return 'finished';
  return 'not_started';
}

router.post('/checkin', authenticate, async (req, res) => {
  try {
    const { period } = req.body;

    if (!period || !['morning', 'evening'].includes(period)) {
      return res.status(400).json({ message: 'Period must be morning or evening' });
    }

    const now = new Date();
    const hour = now.getHours();

    if (period === 'morning' && (hour < 8 || hour >= 12)) {
      return res.status(400).json({ message: 'Morning check-in allowed between 08:00 and 12:00' });
    }

    if (period === 'evening' && (hour < 1 || hour >= 12)) {
      return res.status(400).json({ message: 'Evening check-in allowed between 01:00 and 12:00 (TEST MODE)' });
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
