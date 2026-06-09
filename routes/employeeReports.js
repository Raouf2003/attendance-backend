const express = require('express');
const Attendance = require('../models/Attendance');
const Report = require('../models/Report');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

router.get('/attendance-history', authenticate, async (req, res) => {
  try {
    const { month, year } = req.query;
    const now = new Date();
    const targetMonth = parseInt(month) || (now.getMonth() + 1);
    const targetYear = parseInt(year) || now.getFullYear();
    const monthStr = String(targetMonth).padStart(2, '0');
    const lastDay = String(new Date(targetYear, targetMonth, 0).getDate()).padStart(2, '0');

    const records = await Attendance.find({
      employeeId: req.employee._id,
      date: {
        $gte: `${targetYear}-${monthStr}-01`,
        $lte: `${targetYear}-${monthStr}-${lastDay}`,
      },
    }).sort({ date: -1, period: 1 });

    const totalMinutes = records.reduce((sum, r) => sum + (r.totalMinutes || 0), 0);
    const daysPresent = new Set(records.map(r => r.date)).size;

    res.json({
      year: targetYear,
      month: targetMonth,
      records,
      summary: {
        totalDays: daysPresent,
        totalMinutes,
        totalHours: `${Math.floor(totalMinutes / 60)}h ${totalMinutes % 60}m`,
      },
    });
  } catch (error) {
    console.error('Attendance history error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

router.get('/my-reports', authenticate, async (req, res) => {
  try {
    const reports = await Report.find({ employeeId: req.employee._id })
      .sort({ createdAt: -1 });
    res.json({ reports });
  } catch (error) {
    console.error('My reports error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

router.post('/reports', authenticate, async (req, res) => {
  try {
    const { type, description, photo } = req.body;

    if (!type || !['issue', 'inventory', 'feedback'].includes(type)) {
      return res.status(400).json({ message: 'Type must be issue, inventory, or feedback' });
    }

    if (!description || description.trim().length === 0) {
      return res.status(400).json({ message: 'Description is required' });
    }

    if (photo && typeof photo === 'string' && photo.length > 5000000) {
      return res.status(400).json({ message: 'Photo data too large (max 5MB)' });
    }

    const report = new Report({
      employeeId: req.employee._id,
      type,
      description,
      photo: (photo && typeof photo === 'string' && photo.startsWith('data:image')) ? photo : null,
    });

    await report.save();

    res.status(201).json({
      message: 'Report created',
      report: {
        id: report._id,
        type: report.type,
        description: report.description,
        photo: report.photo,
        createdAt: report.createdAt,
      },
    });
  } catch (error) {
    console.error('Create report error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
