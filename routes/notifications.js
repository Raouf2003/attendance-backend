const express = require('express');
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

module.exports = router;