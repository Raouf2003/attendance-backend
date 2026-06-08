const express = require('express');
const crypto = require('crypto');
const Employee = require('../models/Employee');
const { authenticate } = require('../middleware/auth');

const router = express.Router();
const SECRET = process.env.JWT_SECRET || 'fallback_secret';

function generateQrToken() {
  const timeSlot = Math.floor(Date.now() / 30000);
  const hmac = crypto.createHmac('sha256', SECRET).update(String(timeSlot)).digest('hex');
  return `${timeSlot}.${hmac}`;
}

function verifyQrToken(token) {
  try {
    const parts = token.split('.');
    if (parts.length !== 2) return false;
    const [timeSlot, hmac] = parts;
    const currentSlot = Math.floor(Date.now() / 30000);
    for (const slot of [currentSlot, currentSlot - 1]) {
      const expectedHmac = crypto.createHmac('sha256', SECRET).update(String(slot)).digest('hex');
      if (hmac === expectedHmac && timeSlot === String(slot)) return true;
    }
    return false;
  } catch (e) {
    return false;
  }
}

function cosineSimilarity(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0, normA = 0, normB = 0, validDims = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] === -1 || b[i] === -1) continue;
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
    validDims++;
  }
  if (validDims < 10 || normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
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

router.post('/verify-face', authenticate, async (req, res) => {
  try {
    const { descriptor } = req.body;
    if (!descriptor || !Array.isArray(descriptor)) {
      return res.status(400).json({ message: 'Face descriptor is required' });
    }

    const employee = await Employee.findById(req.employee._id);
    if (!employee || !employee.faceDescriptor) {
      return res.status(400).json({ message: 'No face registered. Contact admin.' });
    }

    const similarity = cosineSimilarity(employee.faceDescriptor, descriptor);
    const threshold = 0.90;

    if (similarity >= threshold) {
      return res.json({ verified: true, similarity });
    }

    res.status(400).json({
      verified: false,
      message: 'Face does not match. Try again.',
      similarity,
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
});

router.put('/employees/:id/face', authenticate, async (req, res) => {
  try {
    if (req.employee.role !== 'admin') {
      return res.status(403).json({ message: 'Admin access required' });
    }
    const { facePhoto, faceDescriptor } = req.body;
    if (!faceDescriptor || !Array.isArray(faceDescriptor)) {
      return res.status(400).json({ message: 'Face descriptor is required' });
    }

    const employee = await Employee.findByIdAndUpdate(
      req.params.id,
      { facePhoto: facePhoto || null, faceDescriptor },
      { new: true }
    );

    if (!employee) {
      return res.status(404).json({ message: 'Employee not found' });
    }

    res.json({ message: 'Face registered successfully', faceRegistered: true });
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
