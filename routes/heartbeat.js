const express = require('express');
const { authenticate } = require('../middleware/auth');
const { processHeartbeat } = require('../services/presenceEngine');

const router = express.Router();

const heartbeatLimiter = {};

function getHeartbeatLimiter(employeeId) {
  const now = Date.now();
  const key = employeeId.toString();
  const entry = heartbeatLimiter[key];
  if (!entry || now - entry.resetAt > 15000) {
    heartbeatLimiter[key] = { count: 0, resetAt: now + 15000 };
    return { limited: false };
  }
  entry.count++;
  if (entry.count > 3) {
    return { limited: true, retryAfter: entry.resetAt - now };
  }
  return { limited: false };
}

setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of Object.entries(heartbeatLimiter)) {
    if (now > entry.resetAt) delete heartbeatLimiter[key];
  }
}, 30000);

router.post('/heartbeat', authenticate, async (req, res) => {
  try {
    const limiter = getHeartbeatLimiter(req.employee._id);
    if (limiter.limited) {
      return res.status(429).json({
        message: 'Too many heartbeats',
        retryAfter: Math.ceil(limiter.retryAfter / 1000),
      });
    }

    const { attendanceId, lat, lng, accuracy, isMock, battery, networkType } = req.body;

    if (!attendanceId) {
      return res.status(400).json({ message: 'attendanceId is required' });
    }

    const clientIp = req.headers['x-forwarded-for'] || req.connection.remoteAddress;

    const result = await processHeartbeat(
      req.employee._id,
      attendanceId,
      {
        lat, lng, accuracy,
        isMock: isMock === true || isMock === 'true',
        battery, networkType,
        deviceId: req.headers['x-device-id'],
        ip: clientIp,
      }
    );

    if (result.action === 'checked_out') {
      return res.json(result);
    }

    if (result.action === 'no_active_attendance') {
      return res.json(result);
    }

    res.json(result);
  } catch (error) {
    console.error('Heartbeat error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
