const express = require('express');
const crypto = require('crypto');
const { authenticate } = require('../middleware/auth');

const router = express.Router();
const SECRET = process.env.JWT_SECRET || 'fallback_secret';

const usedTokens = new Set();

function generateQrToken() {
  const nonce = crypto.randomBytes(16).toString('hex');
  const timeSlot = Math.floor(Date.now() / 30000);
  const hmac = crypto.createHmac('sha256', SECRET).update(`${timeSlot}.${nonce}`).digest('hex');
  return `${timeSlot}.${nonce}.${hmac}`;
}

function validateQrToken(token) {
  try {
    if (usedTokens.has(token)) return false;
    const parts = token.split('.');
    if (parts.length !== 3) return false;
    const [timeSlot, nonce, hmac] = parts;
    const expectedHmac = crypto.createHmac('sha256', SECRET).update(`${timeSlot}.${nonce}`).digest('hex');
    if (!crypto.timingSafeEqual(Buffer.from(hmac), Buffer.from(expectedHmac))) return false;
    const currentSlot = Math.floor(Date.now() / 30000);
    if (timeSlot !== String(currentSlot) && timeSlot !== String(currentSlot - 1)) return false;
    return true;
  } catch (e) {
    return false;
  }
}

function consumeToken(token) {
  usedTokens.add(token);
  if (usedTokens.size > 10000) {
    const toDelete = [...usedTokens].slice(0, 1000);
    for (const t of toDelete) usedTokens.delete(t);
  }
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
    const isValid = validateQrToken(token);
    if (!isValid) {
      return res.status(400).json({ message: 'Invalid or expired QR code' });
    }
    consumeToken(token);
    res.json({ verified: true, message: 'QR code verified' });
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
