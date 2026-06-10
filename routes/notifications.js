const express = require('express');
const Attendance = require('../models/Attendance');
const Employee = require('../models/Employee');
const { authenticate } = require('../middleware/auth');
const { acceptOvertime, cancelOvertime, validDurations } = require('../services/overtimeService');
const { emitToUser } = require('../services/socketService');

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
    const { attendanceId, duration, period } = req.body;

    if (!attendanceId) {
      return res.status(400).json({ message: 'attendanceId is required' });
    }

    const result = await acceptOvertime(attendanceId, req.employee._id, duration, period);
    if (!result.success) {
      return res.status(result.status).json({ message: result.message });
    }

    emitToUser(req.employee._id, 'overtime_updated', {
      type: 'overtime_response',
      attendanceId,
      duration,
      period,
      overtimeScheduledEnd: result.overtimeEnd ? result.overtimeEnd.toISOString() : null,
    });

    res.json({
      message: duration > 0
        ? `Overtime of ${duration}h accepted`
        : 'Overtime declined',
      needsCheckout: result.needsCheckout,
      overtimeEnd: result.overtimeEnd ? result.overtimeEnd.toISOString() : null,
      attendance: {
        id: result.attendance._id,
        period: result.attendance.period,
        checkInTime: result.attendance.checkInTime,
        checkOutTime: result.attendance.checkOutTime,
        overtimeRequested: result.attendance.overtimeRequested,
        overtimeDurationSelected: result.attendance.overtimeDurationSelected,
        overtimeScheduledEnd: result.attendance.overtimeScheduledEnd,
      },
    });
  } catch (err) {
    console.error('[Overtime] Response error:', err.message);
    res.status(500).json({ message: 'Server error' });
  }
});

router.post('/overtime-cancel', authenticate, async (req, res) => {
  try {
    const { attendanceId } = req.body;
    if (!attendanceId) {
      return res.status(400).json({ message: 'attendanceId is required' });
    }

    const result = await cancelOvertime(attendanceId, req.employee._id);
    if (!result.success) {
      return res.status(result.status).json({ message: result.message });
    }

    emitToUser(req.employee._id, 'overtime_updated', {
      type: 'overtime_cancelled',
      attendanceId,
    });

    res.json({
      message: 'Overtime cancelled, session closed',
      attendance: {
        id: result.attendance._id,
        checkOutTime: result.attendance.checkOutTime,
        totalMinutes: result.attendance.totalMinutes,
        normalHours: result.attendance.normalHours,
        overtimeHours: result.attendance.overtimeHours,
      },
    });
  } catch (err) {
    console.error('[Overtime] Cancel error:', err.message);
    res.status(500).json({ message: 'Server error' });
  }
});

router.get('/overtime-options', authenticate, async (req, res) => {
  try {
    const { period } = req.query;
    if (!period || !['morning', 'evening'].includes(period)) {
      return res.status(400).json({ message: 'Period must be morning or evening' });
    }
    res.json({ period, durations: validDurations(period) });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;