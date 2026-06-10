const express = require('express');
const Attendance = require('../models/Attendance');
const Employee = require('../models/Employee');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

router.post('/fcm-token', authenticate, async (req, res) => {
  try {
    const { token } = req.body;
    if (!token || typeof token !== 'string') {
      return res.status(400).json({ message: 'FCM token is required' });
    }

    const employee = await Employee.findById(req.employee._id);
    if (!employee) {
      return res.status(404).json({ message: 'Employee not found' });
    }

    if (!employee.fcmTokens.includes(token)) {
      employee.fcmTokens.push(token);
      if (employee.fcmTokens.length > 10) {
        employee.fcmTokens = employee.fcmTokens.slice(-10);
      }
      await employee.save();
    }

    res.json({ message: 'FCM token registered' });
  } catch (err) {
    console.error('[FCM] Token registration error:', err.message);
    res.status(500).json({ message: 'Server error' });
  }
});

router.post('/overtime-response', authenticate, async (req, res) => {
  try {
    const { attendanceId, duration } = req.body;

    if (!attendanceId) {
      return res.status(400).json({ message: 'attendanceId is required' });
    }

    const validDurations = [0, 1, 2, 3];
    if (!validDurations.includes(duration)) {
      return res.status(400).json({ message: 'Duration must be 0, 1, 2, or 3' });
    }

    const attendance = await Attendance.findById(attendanceId);
    if (!attendance) {
      return res.status(404).json({ message: 'Attendance record not found' });
    }

    if (attendance.employeeId.toString() !== req.employee._id.toString()) {
      return res.status(403).json({ message: 'Not authorized' });
    }

    if (attendance.overtimeResponseAt) {
      return res.status(400).json({ message: 'Overtime response already recorded' });
    }

    attendance.overtimeDurationSelected = duration;
    attendance.overtimeResponseAt = new Date();

    if (duration > 0) {
      const now = new Date();
      attendance.overtimeScheduledEnd = new Date(now.getTime() + duration * 60 * 60 * 1000);
    }

    await attendance.save();

    res.json({
      message: duration > 0
        ? `Overtime of ${duration}h accepted`
        : 'Overtime declined',
      needsCheckout: duration === 0,
      overtimeEnd: duration > 0 ? attendance.overtimeScheduledEnd.toISOString() : null,
      attendance: {
        id: attendance._id,
        period: attendance.period,
        checkInTime: attendance.checkInTime,
        checkOutTime: attendance.checkOutTime,
        overtimeRequested: attendance.overtimeRequested,
        overtimeDurationSelected: attendance.overtimeDurationSelected,
        overtimeScheduledEnd: attendance.overtimeScheduledEnd,
      },
    });
  } catch (err) {
    console.error('[Overtime] Response error:', err.message);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
