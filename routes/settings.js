const express = require('express');
const SystemSettings = require('../models/SystemSettings');
const { authenticate, adminOnly } = require('../middleware/auth');
const { getShifts, invalidateCache, parseHHmm, DEFAULT_SHIFTS } = require('../services/settingsService');
const { rescheduleShiftEnd } = require('../scheduler/shiftEnd');
const { rescheduleAutoCheckout } = require('../scheduler/autoCheckout');

const router = express.Router();

function isValidTime(str) {
  return parseHHmm(str) !== null;
}

router.get('/settings/shifts', authenticate, async (req, res) => {
  try {
    const shifts = await getShifts();
    res.json(shifts);
  } catch (err) {
    console.error('[Settings] GET error:', err.message);
    res.status(500).json({ message: 'Server error' });
  }
});

router.put('/settings/shifts', authenticate, adminOnly, async (req, res) => {
  try {
    const { morningStart, morningEnd, eveningStart, eveningEnd } = req.body;

    if (!morningStart || !morningEnd || !eveningStart || !eveningEnd) {
      return res.status(400).json({ message: 'All four shift times are required' });
    }

    if (!isValidTime(morningStart) || !isValidTime(morningEnd) || !isValidTime(eveningStart) || !isValidTime(eveningEnd)) {
      return res.status(400).json({ message: 'All times must be in HH:mm format (00:00–23:59)' });
    }

    const morningStartMin = parseHHmm(morningStart);
    const morningEndMin = parseHHmm(morningEnd);
    const eveningStartMin = parseHHmm(eveningStart);
    const eveningEndMin = parseHHmm(eveningEnd);

    if (morningStartMin >= morningEndMin) {
      return res.status(400).json({ message: 'Morning start must be before morning end' });
    }

    if (eveningStartMin >= eveningEndMin) {
      return res.status(400).json({ message: 'Evening start must be before evening end' });
    }

    if (morningEndMin > eveningStartMin) {
      return res.status(400).json({ message: 'Morning end must not overlap with evening start' });
    }

    let doc = await SystemSettings.findOne().sort({ _id: 1 }).limit(1);
    if (!doc) {
      doc = new SystemSettings();
    }
    doc.morningStart = morningStart;
    doc.morningEnd = morningEnd;
    doc.eveningStart = eveningStart;
    doc.eveningEnd = eveningEnd;
    doc.updatedBy = req.employee._id;
    await doc.save();

    invalidateCache();

    rescheduleShiftEnd();
    rescheduleAutoCheckout();

    res.json({
      message: 'Shift settings updated successfully',
      shifts: await getShifts(),
    });
  } catch (err) {
    console.error('[Settings] PUT error:', err.message);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
