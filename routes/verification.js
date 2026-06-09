const express = require('express');
const crypto = require('crypto');
const Employee = require('../models/Employee');
const { authenticate } = require('../middleware/auth');
const { performCheckIn } = require('../utils/attendanceHelper');

const router = express.Router();

// Generate a random per-process secret if none is configured
const _secret = process.env.JWT_SECRET;
if (!_secret || _secret === 'fallback_secret' || _secret.startsWith('attApp_$(openssl')) {
  if (!_secret) {
    console.warn('[verification] WARNING: JWT_SECRET not set. Generating ephemeral secret (all tokens invalidated on restart).');
  } else {
    console.warn('[verification] WARNING: JWT_SECRET appears to be a placeholder. Generating ephemeral secret.');
  }
}
const SECRET = (_secret && _secret !== 'fallback_secret' && !_secret.startsWith('attApp_$(openssl'))
  ? _secret
  : crypto.randomBytes(32).toString('hex'));

const FACE_THRESHOLD = parseFloat(process.env.FACE_THRESHOLD) || 0.6;

// ─── One-time-use QR token store ──────────────────────────────────────────────
const usedTokens = new Set();

// ─── Short-lived QR session store (employeeId → expiry timestamp) ─────────────
// Set after a successful /verify-qr; consumed by /verify-checkin
const qrVerifiedSessions = new Map();

// ─── Helpers ──────────────────────────────────────────────────────────────────

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
    const expectedHmac = crypto
      .createHmac('sha256', SECRET)
      .update(`${timeSlot}.${nonce}`)
      .digest('hex');
    if (!crypto.timingSafeEqual(Buffer.from(hmac), Buffer.from(expectedHmac))) return false;
    const currentSlot = Math.floor(Date.now() / 30000);
    if (timeSlot !== String(currentSlot) && timeSlot !== String(currentSlot - 1)) return false;
    return true;
  } catch {
    return false;
  }
}

function consumeQrToken(token) {
  usedTokens.add(token);
  if (usedTokens.size > 10000) {
    const toDelete = [...usedTokens].slice(0, 1000);
    for (const t of toDelete) usedTokens.delete(t);
  }
}

function euclideanDistance(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return Infinity;
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    sum += (a[i] - b[i]) ** 2;
  }
  return Math.sqrt(sum);
}

// Periodically purge expired QR sessions (every 2 minutes)
setInterval(() => {
  const now = Date.now();
  for (const [empId, expiry] of qrVerifiedSessions.entries()) {
    if (now > expiry) qrVerifiedSessions.delete(empId);
  }
}, 2 * 60 * 1000);

// ─── Routes ───────────────────────────────────────────────────────────────────

/**
 * GET /qr-token
 * Admin generates a fresh QR token for the check-in station display.
 */
router.get('/qr-token', authenticate, async (req, res) => {
  try {
    if (req.employee.role !== 'admin') {
      return res.status(403).json({ message: 'Admin access required' });
    }
    const token = generateQrToken();
    res.json({ token, expiresIn: 30 });
  } catch {
    res.status(500).json({ message: 'Server error' });
  }
});

/**
 * POST /verify-qr
 * Step 1 of check-in. Employee (authenticated via JWT) submits the scanned QR token.
 * If valid: consumes the QR token and creates a 60-second QR-verified session
 * tied to this employee's ID. Returns verified: true so the client can proceed
 * to the face capture step.
 *
 * Security: the session is keyed by employeeId (from JWT), so no other employee
 * can "inherit" this QR verification.
 */
router.post('/verify-qr', authenticate, async (req, res) => {
  try {
    const { token } = req.body;
    if (!token) {
      return res.status(400).json({ message: 'QR token is required', error: 'invalid_qr' });
    }

    const isValid = validateQrToken(token);
    if (!isValid) {
      return res.status(400).json({ message: 'Invalid or expired QR code', error: 'invalid_qr' });
    }

    // Consume the QR token — it cannot be replayed
    consumeQrToken(token);

    // Record a 60-second window for this employee to complete face verification
    const employeeIdStr = req.employee._id.toString();
    qrVerifiedSessions.set(employeeIdStr, Date.now() + 60_000);

    res.json({ verified: true, message: 'QR code verified. Please complete face verification.' });
  } catch {
    res.status(500).json({ message: 'Server error' });
  }
});

/**
 * POST /verify-checkin
 * Step 2 of check-in. Employee submits a live face descriptor captured by the
 * front camera. The server:
 *  1. Confirms a valid QR session exists for this employee (from step 1).
 *  2. Loads ONLY that employee's stored faceDescriptor from the database.
 *  3. Computes Euclidean distance between submitted and stored descriptors.
 *  4. If distance < FACE_THRESHOLD → records the attendance check-in.
 *  5. If distance >= FACE_THRESHOLD → rejects with face_mismatch.
 *
 * Security guarantees:
 *  - QR step must precede this call (session check prevents bypass).
 *  - Face is compared ONLY against the JWT-identified employee — no cross-account match.
 *  - No gallery is trusted; face capture is enforced on the client side with no backend loophole.
 */
router.post('/verify-checkin', authenticate, async (req, res) => {
  try {
    const { faceDescriptor, period } = req.body;

    // ── 1. Validate face data is present ──────────────────────────────────────
    if (!faceDescriptor || !Array.isArray(faceDescriptor) || faceDescriptor.length === 0) {
      return res.status(400).json({
        message: 'Face data is required for check-in',
        error: 'missing_face',
      });
    }

    // ── 2. Confirm QR was verified for THIS employee in the last 60 seconds ───
    const employeeIdStr = req.employee._id.toString();
    const sessionExpiry = qrVerifiedSessions.get(employeeIdStr);
    if (!sessionExpiry || Date.now() > sessionExpiry) {
      qrVerifiedSessions.delete(employeeIdStr);
      return res.status(403).json({
        message: 'QR code not verified or session expired. Please scan the QR code again.',
        error: 'invalid_qr',
      });
    }
    // Consume the session — each QR scan allows exactly one check-in attempt
    qrVerifiedSessions.delete(employeeIdStr);

    // ── 3. Load stored face descriptor for this specific employee ──────────────
    const employee = await Employee.findById(req.employee._id);
    if (!employee) {
      return res.status(404).json({ message: 'Employee not found' });
    }

    if (!employee.faceEnrolled || !employee.faceDescriptor || employee.faceDescriptor.length < 2) {
      return res.status(403).json({
        message: 'Face not enrolled for this account. Please contact your administrator.',
        error: 'face_not_enrolled',
      });
    }

    // ── 4. Compare descriptors ─────────────────────────────────────────────────
    const distance = euclideanDistance(faceDescriptor, employee.faceDescriptor);
    if (distance > FACE_THRESHOLD) {
      return res.status(403).json({
        message: 'Face does not match this account',
        error: 'face_mismatch',
        // distance intentionally omitted in production to prevent oracle attacks
      });
    }

    // ── 5. Both factors verified — perform check-in ────────────────────────────
    const result = await performCheckIn(employee._id, period);
    if (!result.success) {
      return res.status(result.status).json({ message: result.message });
    }

    return res.json({
      message: 'Check-in successful',
      attendance: result.attendance,
      faceVerified: true,
    });
  } catch (error) {
    console.error('verify-checkin error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
