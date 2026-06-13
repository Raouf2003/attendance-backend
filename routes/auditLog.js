const express = require('express');
const AuditLog = require('../models/AuditLog');
const { authenticate, adminOnly } = require('../middleware/auth');

const router = express.Router();

router.get('/audit-logs', authenticate, adminOnly, async (req, res) => {
  try {
    const { employeeId, action, startDate, endDate, page = 1, limit = 50 } = req.query;

    const filter = {};
    if (employeeId) filter.employeeId = employeeId;
    if (action) filter.action = action;
    if (startDate || endDate) {
      filter.timestamp = {};
      if (startDate) filter.timestamp.$gte = new Date(startDate);
      if (endDate) filter.timestamp.$lte = new Date(endDate);
    }

    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(200, Math.max(1, parseInt(limit)));
    const skip = (pageNum - 1) * limitNum;

    const [logs, total] = await Promise.all([
      AuditLog.find(filter)
        .populate('employeeId', 'fullName employeeNumber')
        .sort({ timestamp: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      AuditLog.countDocuments(filter),
    ]);

    res.json({
      logs,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum),
      },
    });
  } catch (error) {
    console.error('Audit log fetch error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
