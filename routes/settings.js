const express = require('express');
const SystemSettings = require('../models/SystemSettings');
const { authenticate, adminOnly } = require('../middleware/auth');
const { getSettings, invalidateCache, parseHHmm, DEFAULTS } = require('../services/settingsService');
const { rescheduleShiftEnd } = require('../scheduler/shiftEnd');
const { rescheduleAutoCheckout } = require('../scheduler/autoCheckout');

const router = express.Router();

function isValidTime(str) {
  return parseHHmm(str) !== null;
}

router.get('/settings/shifts', authenticate, async (req, res) => {
  try {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    const settings = await getSettings();
    res.json({
      morningStart: settings.morningStart,
      morningEnd: settings.morningEnd,
      eveningStart: settings.eveningStart,
      eveningEnd: settings.eveningEnd,
      companyLocation: settings.companyLocation,
      allowedRadius: settings.allowedRadius,
    });
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

    await rescheduleShiftEnd();
    await rescheduleAutoCheckout();

    const updated = await getSettings();
    res.json({
      message: 'Shift settings updated successfully',
      morningStart: updated.morningStart,
      morningEnd: updated.morningEnd,
      eveningStart: updated.eveningStart,
      eveningEnd: updated.eveningEnd,
    });
  } catch (err) {
    console.error('[Settings] PUT error:', err.message);
    res.status(500).json({ message: 'Server error' });
  }
});

router.get('/settings/geofence', authenticate, async (req, res) => {
  try {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    const settings = await getSettings();
    res.json({
      companyLocation: settings.companyLocation,
      allowedRadius: settings.allowedRadius,
    });
  } catch (err) {
    console.error('[Settings] GET geofence error:', err.message);
    res.status(500).json({ message: 'Server error' });
  }
});

router.put('/settings/geofence', authenticate, adminOnly, async (req, res) => {
  try {
    const { companyLocation, allowedRadius } = req.body;

    if (!companyLocation || allowedRadius == null) {
      return res.status(400).json({ message: 'companyLocation and allowedRadius are required' });
    }

    const lat = parseFloat(companyLocation.lat);
    const lng = parseFloat(companyLocation.lng);

    if (isNaN(lat) || isNaN(lng)) {
      return res.status(400).json({ message: 'Invalid companyLocation coordinates' });
    }

    if (lat < -90 || lat > 90) {
      return res.status(400).json({ message: 'Latitude must be between -90 and 90' });
    }

    if (lng < -180 || lng > 180) {
      return res.status(400).json({ message: 'Longitude must be between -180 and 180' });
    }

    const radius = parseFloat(allowedRadius);
    if (isNaN(radius) || radius < 10 || radius > 1000) {
      return res.status(400).json({ message: 'Allowed radius must be between 10 and 1000 meters' });
    }

    let doc = await SystemSettings.findOne().sort({ _id: 1 }).limit(1);
    if (!doc) {
      doc = new SystemSettings();
    }
    doc.companyLocation = { lat, lng };
    doc.allowedRadius = radius;
    doc.updatedBy = req.employee._id;
    await doc.save();

    invalidateCache();

    res.json({
      message: 'Geofence settings updated successfully',
      companyLocation: { lat, lng },
      allowedRadius: radius,
    });
  } catch (err) {
    console.error('[Settings] PUT geofence error:', err.message);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
