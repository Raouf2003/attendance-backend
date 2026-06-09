const express = require('express');
const crypto = require('crypto');
const multer = require('multer');
const Employee = require('../models/Employee');
const Attendance = require('../models/Attendance');
const { authenticate } = require('../middleware/auth');
const { extractDescriptor, compareDescriptors } = require('../utils/faceUtils');

const router = express.Router();
const SECRET = process.env.JWT_SECRET || 'fallback_secret';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'));
    }
  },
});

const usedTokens = new Set();

function generateQrToken() {
  const nonce = crypto.randomBytes(16).toString('hex');
  const timeSlot = Math.floor(Date.now() / 30000);
  const hmac = crypto.createHmac('sha256', SECRET).update(`${timeSlot}.${nonce}`).digest('hex');
  return `${timeSlot}.${nonce}.${hmac}`;
}

function verifyQrToken(token) {
  try {
    if (usedTokens.has(token)) return false;
    const parts = token.split('.');
    if (parts.length !== 3) return false;
    const [timeSlot, nonce, hmac] = parts;
    const expectedHmac = crypto.createHmac('sha256', SECRET).update(`${timeSlot}.${nonce}`).digest('hex');
    if (!crypto.timingSafeEqual(Buffer.from(hmac), Buffer.from(expectedHmac))) return false;
    const currentSlot = Math.floor(Date.now() / 30000);
    if (timeSlot !== String(currentSlot) && timeSlot !== String(currentSlot - 1)) return false;
    usedTokens.add(token);
    if (usedTokens.size > 10000) {
      const toDelete = [...usedTokens].slice(0, 1000);
      for (const t of toDelete) usedTokens.delete(t);
    }
    return true;
  } catch (e) {
    return false;
  }
}

function isWithinTimeWindow(period) {
  const now = new Date();
  const hour = now.getHours();
  if (period === 'morning') return hour >= 7 && hour < 12;
  if (period === 'evening') return hour >= 12 && hour < 17;
  return false;
}

router.get('/qr-token', authenticate, async (req, res) => {
  try {
    if (req.employee.role !== 'admin') {
      return res.status(403).json({ message: 'Admin access required' });
    }
    const token = generateQrToken();
    res.json({ token, expiresIn: 30 });
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
});

router.post('/verify-qr', authenticate, async (req, res) => {
  try {
    const { token } = req.body;
    if (!token) {
      return res.status(400).json({ message: 'QR token is required' });
    }
    const isValid = verifyQrToken(token);
    if (!isValid) {
      return res.status(400).json({ message: 'Invalid or expired QR code' });
    }
    res.json({ verified: true, message: 'QR code verified' });
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
});

router.post('/verify-face', authenticate, upload.single('image'), async (req, res) => {
  try {
    const { period, qrToken } = req.body;

    if (!qrToken || !verifyQrToken(qrToken)) {
      return res.status(400).json({ message: 'Invalid or expired QR code' });
    }

    if (!period || !['morning', 'evening'].includes(period)) {
      return res.status(400).json({ message: 'Period must be morning or evening' });
    }

    if (!isWithinTimeWindow(period)) {
      return res.status(400).json({
        message: period === 'morning'
          ? 'Morning check-in allowed between 07:00 and 12:00'
          : 'Evening check-in allowed between 12:00 and 17:00',
      });
    }

    if (!req.file) {
      return res.status(400).json({ message: 'Image file is required' });
    }

    const employee = await Employee.findById(req.employee._id).select('+faceDescriptor');
    if (!employee) {
      return res.status(404).json({ message: 'Employee not found' });
    }

    if (!employee.faceDescriptor || employee.faceDescriptor.length !== 128) {
      return res.status(400).json({ faceNotRegistered: true, message: 'No face registered. Contact admin.' });
    }

    const liveDescriptor = await extractDescriptor(req.file.buffer);
    if (!liveDescriptor) {
      return res.status(400).json({ noFaceDetected: true, message: 'No face detected in image' });
    }

    const { match, distance } = compareDescriptors(employee.faceDescriptor, liveDescriptor, 0.5);
    if (!match) {
      return res.status(400).json({ verified: false, distance, message: 'Face does not match' });
    }

    const now = new Date();
    const dateKey = now.toISOString().split('T')[0];
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
      verified: true,
      distance,
      attendance: {
        id: attendance._id,
        period: attendance.period,
        checkInTime: attendance.checkInTime,
        date: attendance.date,
      },
    });
  } catch (error) {
    console.error('Verify face error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

router.put('/employees/:id/face', authenticate, upload.single('image'), async (req, res) => {
  try {
    if (req.employee.role !== 'admin') {
      return res.status(403).json({ message: 'Admin access required' });
    }

    if (!req.file) {
      return res.status(400).json({ message: 'Image file is required' });
    }

    const descriptor = await extractDescriptor(req.file.buffer);
    if (!descriptor) {
      return res.status(400).json({ noFaceDetected: true, message: 'No face detected in image' });
    }

    const employee = await Employee.findByIdAndUpdate(
      req.params.id,
      { faceDescriptor: descriptor, faceRegistered: true },
      { new: true }
    );

    if (!employee) {
      return res.status(404).json({ message: 'Employee not found' });
    }

    res.json({ faceRegistered: true, descriptorSize: descriptor.length });
  } catch (error) {
    console.error('Register face error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;