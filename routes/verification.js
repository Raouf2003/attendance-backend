const express = require('express');
const crypto = require('crypto');
const Employee = require('../models/Employee');
const { authenticate } = require('../middleware/auth');
const { performCheckIn } = require('../utils/attendanceHelper');
const { validateGeofence } = require('../utils/haversine');

const router = express.Router();

// Generate a random per-process secret if none is configured
const _rawSecret = process.env.JWT_SECRET;
var SECRET;
if (_rawSecret && _rawSecret !== 'fallback_secret' && !_rawSecret.startsWith('attApp_')) {
  SECRET = _rawSecret;
} else {
  if (!_rawSecret) {
    console.warn('[verification] WARNING: JWT_SECRET not set. Generating ephemeral secret (all tokens invalidated on restart).');
  } else {
    console.warn('[verification] WARNING: JWT_SECRET appears to be a placeholder. Generating ephemeral secret.');
  }
  SECRET = crypto.randomBytes(32).toString('hex');
}

// Cosine similarity threshold (0.0–1.0). Higher = stricter match.
// Typical good range: 0.5–0.7. Default 0.55.
// For Euclidean distance (legacy), use FACE_THRESHOLD env var.
const COSINE_THRESHOLD = parseFloat(process.env.COSINE_THRESHOLD) || 0.55;
// Legacy Euclidean threshold — only used if COSINE_THRESHOLD is not set and FACE_THRESHOLD is set
const FACE_THRESHOLD = parseFloat(process.env.FACE_THRESHOLD) || 0.6;
// Whether to use cosine similarity (true) or Euclidean distance (false)
const USE_COSINE = process.env.USE_COSINE !== 'false';

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
    const parts = token.split('.');
    if (parts.length !== 3) return false;
    const [timeSlot, nonce, hmac] = parts;
    const expectedHmac = crypto
      .createHmac('sha256', SECRET)
      .update(`${timeSlot}.${nonce}`)
      .digest('hex');
    if (!crypto.timingSafeEqual(Buffer.from(hmac), Buffer.from(expectedHmac))) return false;
    const currentSlot = Math.floor(Date.now() / 30000);
    if (timeSlot !== String(currentSlot)) return false;
    return true;
  } catch {
    return false;
  }
}

/**
 * Cosine similarity between two L2-normalized vectors.
 * Returns 1.0 for identical, -1.0 for opposite.
 */
function cosineSimilarity(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return -1;
  let dot = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
  }
  return dot;
}

/**
 * Euclidean distance (legacy).
 */
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

console.log(`[verification] Matching: ${USE_COSINE ? 'cosine similarity' : 'Euclidean distance'}, ` +
  `threshold=${USE_COSINE ? COSINE_THRESHOLD : FACE_THRESHOLD}`);

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
 */
router.post('/verify-qr', authenticate, async (req, res) => {
  try {
    const { token, lat, lng } = req.body;
    if (!token) {
      return res.status(400).json({ message: 'QR token is required', error: 'invalid_qr' });
    }

    const geoCheck = validateGeofence(lat, lng);
    if (!geoCheck.valid) {
      return res.status(403).json({ message: geoCheck.message, error: 'geofence_blocked' });
    }

    const isValid = validateQrToken(token);
    if (!isValid) {
      return res.status(400).json({ message: 'Invalid or expired QR code', error: 'invalid_qr' });
    }

    const employeeIdStr = req.employee._id.toString();
    qrVerifiedSessions.set(employeeIdStr, Date.now() + 60_000);

    res.json({ verified: true, message: 'QR code verified. Please complete face verification.' });
  } catch {
    res.status(500).json({ message: 'Server error' });
  }
});

/**
 * POST /verify-checkin
 * Step 2 of check-in. Compares face descriptor against all stored enrollment
 * samples using cosine similarity. Accepts if ANY sample passes the threshold.
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

    // ── 3. Validate geofence ──────────────────────────────────────────────────
    const { lat, lng } = req.body;
    const geoCheck = validateGeofence(lat, lng);
    if (!geoCheck.valid) {
      return res.status(403).json({
        message: geoCheck.message,
        error: 'geofence_blocked',
      });
    }

    // ── 4. Load stored face descriptors for this specific employee ────────────
    const employee = await Employee.findById(req.employee._id);
    if (!employee) {
      return res.status(404).json({ message: 'Employee not found' });
    }

    let storedDescriptors = [];
    if (employee.faceDescriptors && employee.faceDescriptors.length > 0) {
      storedDescriptors = employee.faceDescriptors;
    } else if (employee.faceDescriptor && Array.isArray(employee.faceDescriptor)) {
      storedDescriptors = Array.isArray(employee.faceDescriptor[0])
        ? employee.faceDescriptor
        : [employee.faceDescriptor];
    }

    if (!employee.faceEnrolled || storedDescriptors.length === 0) {
      return res.status(403).json({
        message: 'Face not enrolled for this account. Please contact your administrator.',
        error: 'face_not_enrolled',
      });
    }

    // ── 4. Compare against ALL stored descriptors — accept if ANY match ────────
    let bestScore = USE_COSINE ? -1 : Infinity;
    let bestIndex = -1;
    const scores = [];

    for (let i = 0; i < storedDescriptors.length; i++) {
      const score = USE_COSINE
        ? cosineSimilarity(faceDescriptor, storedDescriptors[i])
        : -euclideanDistance(faceDescriptor, storedDescriptors[i]); // negate so higher = better

      scores.push(score);

      if (USE_COSINE) {
        if (score > bestScore) {
          bestScore = score;
          bestIndex = i;
        }
      } else {
        if (score > bestScore) {
          bestScore = score;
          bestIndex = i;
        }
      }
    }

    const threshold = USE_COSINE ? COSINE_THRESHOLD : -FACE_THRESHOLD;

    console.log(`[verify] Employee ${employee.employeeNumber}: ${faceDescriptor.length}-d, ` +
      `${storedDescriptors.length} samples, method=${USE_COSINE ? 'cosine' : 'euclidean'}, ` +
      `best=${bestScore.toFixed(4)}, ` +
      `samples=[${scores.map(s => s.toFixed(4)).join(', ')}], ` +
      `threshold=${threshold.toFixed(4)}`);

    const accepted = USE_COSINE
      ? bestScore >= threshold
      : bestScore >= threshold;

    if (!accepted) {
      console.log(`[verify] REJECTED: best=${bestScore.toFixed(4)} < threshold=${threshold.toFixed(4)}`);
      return res.status(403).json({
        message: 'Face does not match this account',
        error: 'face_mismatch',
      });
    }

    console.log(`[verify] ACCEPTED: best=${bestScore.toFixed(4)} (sample #${bestIndex + 1}) ` +
      `passes threshold=${threshold.toFixed(4)}`);

    // ── 5. Both factors verified — perform check-in ────────────────────────────
    qrVerifiedSessions.delete(employeeIdStr);
    const result = await performCheckIn(employee._id, period, { lat, lng });
    if (!result.success) {
      return res.status(result.status).json({ message: result.message });
    }

    return res.json({
      message: 'Check-in successful',
      attendance: result.attendance,
      faceVerified: true,
      similarity: USE_COSINE
        ? parseFloat(bestScore.toFixed(4))
        : parseFloat((-bestScore).toFixed(4)),
      matchMethod: USE_COSINE ? 'cosine' : 'euclidean',
    });
  } catch (error) {
    console.error('verify-checkin error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

/**
 * POST /verify-face
 * Face-only identity verification (used for check-out, etc.).
 * No QR session or geofence check required.
 */
router.post('/verify-face', authenticate, async (req, res) => {
  try {
    const { faceDescriptor } = req.body;

    if (!faceDescriptor || !Array.isArray(faceDescriptor) || faceDescriptor.length === 0) {
      return res.status(400).json({
        message: 'Face data is required',
        error: 'missing_face',
      });
    }

    const employee = await Employee.findById(req.employee._id);
    if (!employee) {
      return res.status(404).json({ message: 'Employee not found' });
    }

    let storedDescriptors = [];
    if (employee.faceDescriptors && employee.faceDescriptors.length > 0) {
      storedDescriptors = employee.faceDescriptors;
    } else if (employee.faceDescriptor && Array.isArray(employee.faceDescriptor)) {
      storedDescriptors = Array.isArray(employee.faceDescriptor[0])
        ? employee.faceDescriptor
        : [employee.faceDescriptor];
    }

    if (!employee.faceEnrolled || storedDescriptors.length === 0) {
      return res.status(403).json({
        message: 'Face not enrolled for this account. Please contact your administrator.',
        error: 'face_not_enrolled',
      });
    }

    let bestScore = USE_COSINE ? -1 : Infinity;
    let bestIndex = -1;
    const scores = [];

    for (let i = 0; i < storedDescriptors.length; i++) {
      const score = USE_COSINE
        ? cosineSimilarity(faceDescriptor, storedDescriptors[i])
        : -euclideanDistance(faceDescriptor, storedDescriptors[i]);

      scores.push(score);

      if (score > bestScore) {
        bestScore = score;
        bestIndex = i;
      }
    }

    const threshold = USE_COSINE ? COSINE_THRESHOLD : -FACE_THRESHOLD;
    const accepted = bestScore >= threshold;

    if (!accepted) {
      console.log(`[verify-face] REJECTED: employee=${employee.employeeNumber}, best=${bestScore.toFixed(4)} < threshold=${threshold.toFixed(4)}`);
      return res.status(403).json({
        message: 'Face does not match this account',
        error: 'face_mismatch',
      });
    }

    console.log(`[verify-face] ACCEPTED: employee=${employee.employeeNumber}, best=${bestScore.toFixed(4)} (sample #${bestIndex + 1})`);

    return res.json({
      faceVerified: true,
      similarity: USE_COSINE
        ? parseFloat(bestScore.toFixed(4))
        : parseFloat((-bestScore).toFixed(4)),
      matchMethod: USE_COSINE ? 'cosine' : 'euclidean',
    });
  } catch (error) {
    console.error('verify-face error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
