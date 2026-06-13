const express = require('express');
const bcrypt = require('bcryptjs');
const Employee = require('../models/Employee');
const Attendance = require('../models/Attendance');
const Report = require('../models/Report');
const AuditLog = require('../models/AuditLog');
const { authenticate, adminOnly } = require('../middleware/auth');
const { paginate, paginatedResponse } = require('../utils/pagination');
const { cacheMiddleware, clearCache } = require('../middleware/cache');
const { formatUtcDateLocal } = require('../services/settingsService');


const router = express.Router();

function formatMinutes(totalMinutes) {
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${h}h ${m}m`;
}

function sanitizeCsvField(value) {
  if (value == null) return '';
  const str = String(value);
  if (str.startsWith('=') || str.startsWith('+') || str.startsWith('-') || str.startsWith('@') || str.startsWith('\t') || str.startsWith('\r')) {
    return `'${str}`;
  }
  return str;
}

router.post('/employees', authenticate, adminOnly, async (req, res) => {
  try {
    const { employeeNumber, fullName, password, role, faceDescriptor, faceDescriptors } = req.body;

    // ── Debug logging ──────────────────────────────────────────────────────────
    console.log('[create] Received employee data keys:', Object.keys(req.body));
    console.log('[create] faceDescriptor type:', typeof faceDescriptor, 'value:', Array.isArray(faceDescriptor) ? `array[${faceDescriptor.length}]` : faceDescriptor);
    console.log('[create] faceDescriptors type:', typeof faceDescriptors, 'value:', Array.isArray(faceDescriptors) ? `array[${faceDescriptors.length}]` : faceDescriptors);
    if (Array.isArray(faceDescriptors) && faceDescriptors.length > 0) {
      console.log('[create] faceDescriptors[0] type:', typeof faceDescriptors[0], 'isArray:', Array.isArray(faceDescriptors[0]));
      if (Array.isArray(faceDescriptors[0])) {
        console.log('[create] faceDescriptors[0] length:', faceDescriptors[0].length);
        console.log('[create] faceDescriptors[0] first 3 values:', faceDescriptors[0].slice(0, 3));
      }
    }

    if (!employeeNumber || !fullName || !password) {
      return res.status(400).json({ message: 'All fields are required' });
    }

    // Face enrollment is mandatory for employees, but admins don't need a face
    const isAdminUser = role === 'admin';
    let descriptors = null;

    if (!isAdminUser) {
      // If faceDescriptors is already an array (new format), use it directly
      // or if it's a single flat array (legacy), wrap it
      if (Array.isArray(faceDescriptors)) {
        if (faceDescriptors.length > 0 && Array.isArray(faceDescriptors[0])) {
          descriptors = faceDescriptors;
        } else if (faceDescriptors.length > 0 && typeof faceDescriptors[0] === 'number') {
          descriptors = [faceDescriptors];
        }
      }

      // Fallback to singular faceDescriptor (legacy)
      if (!descriptors && Array.isArray(faceDescriptor)) {
        if (Array.isArray(faceDescriptor[0])) {
          descriptors = faceDescriptor;
        } else {
          descriptors = [faceDescriptor];
        }
      }
    }

    console.log('[create] resolved descriptors:',
      descriptors ? `array[${descriptors.length}] samples` : 'null');

    if (!descriptors && !isAdminUser) {
      return res.status(400).json({
        message: 'Face enrollment is required. Please capture the employee face before saving.',
        error: 'missing_face',
        debug: {
          hasFaceDescriptors: Array.isArray(faceDescriptors),
          faceDescriptorsLength: Array.isArray(faceDescriptors) ? faceDescriptors.length : typeof faceDescriptors,
          hasFaceDescriptor: Array.isArray(faceDescriptor),
          faceDescriptorLength: Array.isArray(faceDescriptor) ? faceDescriptor.length : typeof faceDescriptor,
        },
      });
    }

    const existing = await Employee.findOne({ employeeNumber });
    if (existing) {
      return res.status(400).json({ message: 'Employee number already exists' });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    const employee = new Employee({
      employeeNumber,
      fullName,
      password: hashedPassword,
      role: role || 'employee',
      isActive: true,
      fingerprintRegistered: false,
      faceDescriptors: descriptors || [],
      faceEnrolled: !isAdminUser && descriptors != null && descriptors.length > 0,
    });

    await employee.save();
    clearCache();

    res.status(201).json({
      message: 'Employee created',
      employee: {
        id: employee._id,
        employeeNumber: employee.employeeNumber,
        fullName: employee.fullName,
        role: employee.role,
        isActive: employee.isActive,
        faceEnrolled: employee.faceEnrolled,
      },
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
});

/**
 * POST /employees/enroll-face/:id
 * Re-enroll (or initially enroll) a face for an existing employee.
 * Admin only. Accepts a 128-float faceDescriptor array.
 */
router.post('/employees/enroll-face/:id', authenticate, adminOnly, async (req, res) => {
  try {
    const { faceDescriptor, faceDescriptors } = req.body;

    const descriptors = faceDescriptors && faceDescriptors.length > 0
      ? faceDescriptors
      : (faceDescriptor && Array.isArray(faceDescriptor) && faceDescriptor.length >= 2
          ? (Array.isArray(faceDescriptor[0]) ? faceDescriptor : [faceDescriptor])
          : null);
    if (!descriptors) {
      return res.status(400).json({
        message: 'A valid face descriptor is required',
        error: 'missing_face',
      });
    }

    const employee = await Employee.findByIdAndUpdate(
      req.params.id,
      { faceDescriptors: descriptors, faceEnrolled: true },
      { new: true }
    );

    if (!employee) {
      return res.status(404).json({ message: 'Employee not found' });
    }

    clearCache();

    res.json({
      message: 'Face enrolled successfully',
      faceEnrolled: true,
      employeeId: employee._id,
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
});

router.put('/employees/:id', authenticate, adminOnly, async (req, res) => {
  try {
    const { employeeNumber, fullName, password, isActive } = req.body;
    const updateData = {};

    if (isActive !== undefined && req.params.id === req.employee._id.toString()) {
      return res.status(400).json({ message: 'Cannot deactivate yourself' });
    }

    if (employeeNumber) {
      const existing = await Employee.findOne({ employeeNumber, _id: { $ne: req.params.id } });
      if (existing) {
        return res.status(400).json({ message: 'Employee number already exists' });
      }
      updateData.employeeNumber = employeeNumber;
    }

    if (fullName) updateData.fullName = fullName;
    if (isActive !== undefined) updateData.isActive = isActive;

    if (password) {
      const salt = await bcrypt.genSalt(10);
      updateData.password = await bcrypt.hash(password, salt);
    }

    const employee = await Employee.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true }
    );

    if (!employee) {
      return res.status(404).json({ message: 'Employee not found' });
    }

    clearCache();

    res.json({
      message: 'Employee updated',
      employee: {
        id: employee._id,
        employeeNumber: employee.employeeNumber,
        fullName: employee.fullName,
        role: employee.role,
        isActive: employee.isActive,
      },
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
});

router.delete('/employees/:id', authenticate, adminOnly, async (req, res) => {
  try {
    if (req.params.id === req.employee._id.toString()) {
      return res.status(400).json({ message: 'Cannot delete yourself' });
    }

    const employee = await Employee.findByIdAndDelete(req.params.id);
    if (!employee) {
      return res.status(404).json({ message: 'Employee not found' });
    }

    await Attendance.deleteMany({ employeeId: req.params.id });

    clearCache();

    res.json({ message: 'Employee deleted' });
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
});

router.get('/employees', authenticate, adminOnly, async (req, res) => {
  try {
    const { page, limit } = req.query;
    const total = await Employee.countDocuments({});
    const employees = await paginate(
      Employee.find({}).select('employeeNumber fullName role isActive fingerprintRegistered faceEnrolled createdAt').sort({ createdAt: -1 }),
      page,
      limit
    );

    if (page || limit) {
      return res.json(paginatedResponse(employees, total, page, limit));
    }

    res.json({ employees });
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
});

router.get('/employees/active', authenticate, adminOnly, async (req, res) => {
  try {
    const activeRecords = await Attendance.find({
      checkInTime: { $ne: null },
      checkOutTime: null,
    })
      .populate('employeeId', 'fullName employeeNumber')
      .sort({ checkInTime: -1 });

    const active = activeRecords
      .filter(r => r.employeeId)
      .map(r => ({
        employeeId: r.employeeId._id,
        fullName: r.employeeId.fullName,
        employeeNumber: r.employeeId.employeeNumber,
        period: r.period,
        checkInTime: r.checkInTime,
      }));

    res.json({ active, count: active.length });
  } catch (error) {
    console.error('Active employees error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

router.get('/admin/live-employees', authenticate, adminOnly, async (req, res) => {
  try {
    const now = new Date();
    const activeRecords = await Attendance.find({
      checkInTime: { $ne: null },
      checkOutTime: null,
    })
      .populate('employeeId', 'fullName employeeNumber')
      .sort({ checkInTime: -1 });

    const working = activeRecords
      .filter(r => r.employeeId)
      .map(r => ({
        employeeId: r.employeeId._id,
        fullName: r.employeeId.fullName,
        employeeNumber: r.employeeId.employeeNumber,
        period: r.period,
        checkInTime: r.checkInTime,
      }));

    res.json({ working });
  } catch (error) {
    console.error('Live employees error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

router.get('/reports/daily', authenticate, adminOnly, cacheMiddleware(), async (req, res) => {
  try {
    const { date, page, limit } = req.query;
    const targetDate = date || new Date().toISOString().split('T')[0];

    const filter = { date: targetDate };
    const total = await Attendance.countDocuments(filter);

    const records = await paginate(
      Attendance.find(filter).populate('employeeId', 'fullName employeeNumber').sort({ checkInTime: -1 }),
      page,
      limit
    );

    const report = records
      .filter(r => r.employeeId)
      .map(r => ({
        employeeName: r.employeeId.fullName,
        employeeNumber: r.employeeId.employeeNumber,
        period: r.period,
        checkInTime: r.checkInTime,
        checkOutTime: r.checkOutTime,
        normalMinutes: r.totalMinutes || 0,
        totalMinutes: r.totalMinutes,
        autoCheckout: r.autoCheckout,
      }));

    if (page || limit) {
      return res.json(paginatedResponse(report, total, page, limit));
    }

    res.json({ date: targetDate, report });
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
});

router.get('/reports/daily/export', authenticate, adminOnly, async (req, res) => {
  try {
    const { date } = req.query;
    const targetDate = date || new Date().toISOString().split('T')[0];

    const records = await Attendance.find({ date: targetDate })
      .populate('employeeId', 'fullName employeeNumber');

    let csv = 'Employee Name,Employee Number,Period,Check In,Check Out,Total Time (min)\n';

    for (const r of records) {
      if (!r.employeeId) continue;
      const checkIn = formatUtcDateLocal(r.checkInTime);
      const checkOut = formatUtcDateLocal(r.checkOutTime);
      csv += `${sanitizeCsvField(r.employeeId.fullName)},${sanitizeCsvField(r.employeeId.employeeNumber)},${sanitizeCsvField(r.period)},${sanitizeCsvField(checkIn)},${sanitizeCsvField(checkOut)},${r.totalMinutes || 0}\n`;
    }

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename=attendance_${targetDate}.csv`);
    res.send(csv);
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
});

router.get('/reports/monthly/export', authenticate, adminOnly, async (req, res) => {
  try {
    const { year, month } = req.query;
    const now = new Date();
    const targetYear = parseInt(year) || now.getFullYear();
    const targetMonth = parseInt(month) || (now.getMonth() + 1);

    const monthStr = String(targetMonth).padStart(2, '0');
    const lastDay = String(new Date(targetYear, targetMonth, 0).getDate()).padStart(2, '0');

    const dateFilter = {
      $gte: `${targetYear}-${monthStr}-01`,
      $lte: `${targetYear}-${monthStr}-${lastDay}`,
    };

    const aggregation = [
      { $match: { date: dateFilter } },
      { $lookup: { from: 'employees', localField: 'employeeId', foreignField: '_id', as: 'employee' } },
      { $unwind: { path: '$employee', preserveNullAndEmptyArrays: false } },
      {
        $group: {
          _id: { employeeId: '$employeeId', date: '$date' },
          employeeName: { $first: '$employee.fullName' },
          employeeNumber: { $first: '$employee.employeeNumber' },
          totalMinutes: { $sum: { $ifNull: ['$totalMinutes', 0] } },
        },
      },
      {
        $group: {
          _id: '$_id.employeeId',
          employeeName: { $first: '$employeeName' },
          employeeNumber: { $first: '$employeeNumber' },
          totalMinutes: { $sum: '$totalMinutes' },
          daysPresent: { $sum: 1 },
        },
      },
      { $sort: { employeeName: 1 } },
    ];

    const results = await Attendance.aggregate(aggregation);

    let csv = 'Employee Name,Employee Number,Days Present,Total Time (min)\n';

    for (const r of results) {
      csv += `${sanitizeCsvField(r.employeeName)},${sanitizeCsvField(r.employeeNumber)},${r.daysPresent},${r.totalMinutes || 0}\n`;
    }

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename=attendance_${targetYear}_${monthStr}.csv`);
    res.send(csv);
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
});

router.get('/reports/employee/:id/export', authenticate, adminOnly, async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const employee = await Employee.findById(req.params.id);
    if (!employee) return res.status(404).json({ message: 'Employee not found' });

    const filter = { employeeId: req.params.id };
    if (startDate && endDate) {
      filter.date = { $gte: startDate, $lte: endDate };
    }

    const records = await Attendance.find(filter).sort({ date: 1 });

    let csv = 'Date,Period,Check In,Check Out,Total Minutes\n';

    for (const r of records) {
      const checkIn = formatUtcDateLocal(r.checkInTime);
      const checkOut = formatUtcDateLocal(r.checkOutTime);
      csv += `${sanitizeCsvField(r.date)},${sanitizeCsvField(r.period)},${sanitizeCsvField(checkIn)},${sanitizeCsvField(checkOut)},${r.totalMinutes || 0}\n`;
    }

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename=${employee.employeeNumber}_attendance.csv`);
    res.send(csv);
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
});

router.post('/fingerprint/register', authenticate, adminOnly, async (req, res) => {
  try {
    const { employeeId } = req.body;
    if (!employeeId) {
      return res.status(400).json({ message: 'Employee ID is required' });
    }

    const employee = await Employee.findById(employeeId);
    if (!employee) {
      return res.status(404).json({ message: 'Employee not found' });
    }

    employee.fingerprintRegistered = true;
    await employee.save();

    res.json({ message: 'Fingerprint registered successfully', fingerprintRegistered: true });
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
});

router.get('/reports/monthly', authenticate, adminOnly, cacheMiddleware(), async (req, res) => {
  try {
    const { year, month, page, limit } = req.query;
    const now = new Date();
    const targetYear = parseInt(year) || now.getFullYear();
    const targetMonth = parseInt(month) || (now.getMonth() + 1);

    const monthStr = String(targetMonth).padStart(2, '0');
    const lastDay = String(new Date(targetYear, targetMonth, 0).getDate()).padStart(2, '0');

    const dateFilter = {
      $gte: `${targetYear}-${monthStr}-01`,
      $lte: `${targetYear}-${monthStr}-${lastDay}`,
    };

    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 20));

    const distinctEmps = await Attendance.distinct('employeeId', { date: dateFilter });
    const total = distinctEmps.length;

    const aggregation = [
      { $match: { date: dateFilter } },
      { $lookup: { from: 'employees', localField: 'employeeId', foreignField: '_id', as: 'employee' } },
      { $unwind: { path: '$employee', preserveNullAndEmptyArrays: false } },
      // First group: per (employee, date) — so each date counts as 1 day present
      {
        $group: {
          _id: { employeeId: '$employeeId', date: '$date' },
          employeeName: { $first: '$employee.fullName' },
          employeeNumber: { $first: '$employee.employeeNumber' },
          totalMinutes: { $sum: { $ifNull: ['$totalMinutes', 0] } },
          records: {
            $push: {
              period: '$period',
              checkInTime: '$checkInTime',
              checkOutTime: '$checkOutTime',
              totalMinutes: '$totalMinutes',
              autoCheckout: '$autoCheckout',
            },
          },
        },
      },
      // Second group: per employee — sum across dates, unique date count
      {
        $group: {
          _id: '$_id.employeeId',
          employeeName: { $first: '$employeeName' },
          employeeNumber: { $first: '$employeeNumber' },
          totalMinutes: { $sum: '$totalMinutes' },
          daysPresent: { $sum: 1 },
          days: {
            $push: {
              date: '$_id.date',
              records: '$records',
            },
          },
        },
      },
      { $sort: { employeeName: 1 } },
    ];

    if (page || limit) {
      aggregation.push({ $skip: (pageNum - 1) * limitNum });
      aggregation.push({ $limit: limitNum });
    }

    const results = await Attendance.aggregate(aggregation);

    const report = results.map(r => ({
      employeeName: r.employeeName,
      employeeNumber: r.employeeNumber,
      daysPresent: r.daysPresent,
      totalMinutes: r.totalMinutes,
      days: r.days,
    }));

    if (page || limit) {
      return res.json(paginatedResponse(report, total, page, limit));
    }

    res.json({
      year: targetYear,
      month: targetMonth,
      report,
    });
  } catch (error) {
    console.error('Monthly report error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

router.get('/employee-reports', authenticate, adminOnly, async (req, res) => {
  try {
    const reports = await Report.find({})
      .populate('employeeId', 'fullName employeeNumber')
      .sort({ createdAt: -1 });
    res.json({ reports });
  } catch (error) {
    console.error('Employee reports error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

router.delete('/employee-reports/:id', authenticate, adminOnly, async (req, res) => {
  try {
    const report = await Report.findByIdAndDelete(req.params.id);
    if (!report) {
      return res.status(404).json({ message: 'Report not found' });
    }
    res.json({ message: 'Report deleted' });
  } catch (error) {
    console.error('Delete report error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

router.post('/admin/attendance', authenticate, adminOnly, async (req, res) => {
  try {
    const { employeeId, date, period, checkInTime, checkOutTime, reason } = req.body;

    if (!employeeId || !date || !period || !checkInTime) {
      return res.status(400).json({ message: 'employeeId, date, period, and checkInTime are required' });
    }
    if (!['morning', 'evening'].includes(period)) {
      return res.status(400).json({ message: 'Period must be morning or evening' });
    }

    const employee = await Employee.findById(employeeId);
    if (!employee) {
      return res.status(404).json({ message: 'Employee not found' });
    }

    const existing = await Attendance.findOne({ employeeId, date, period });
    if (existing) {
      return res.status(409).json({ message: `Attendance already exists for ${period} on ${date}` });
    }

    const checkIn = new Date(checkInTime);
    const totalMinutes = checkOutTime
      ? Math.round((new Date(checkOutTime) - checkIn) / 60000)
      : 0;

    const attendance = await Attendance.create({
      employeeId,
      date,
      period,
      checkInTime: checkIn,
      checkOutTime: checkOutTime ? new Date(checkOutTime) : null,
      totalMinutes,
      normalHours: totalMinutes / 60,
      checkoutType: checkOutTime ? 'manual' : undefined,
      checkOutReason: checkOutTime ? 'manual' : undefined,
      autoCheckout: false,
    });

    await AuditLog.create({
      employeeId,
      action: checkOutTime ? 'manual_checkout' : 'checkin',
      ip: req.headers['x-forwarded-for'] || req.connection.remoteAddress,
      deviceId: req.headers['x-device-id'],
      userAgent: req.headers['user-agent'],
      metadata: { adminId: req.employee._id.toString(), reason, manual: true },
    });

    res.status(201).json({
      message: 'Attendance record created',
      attendance: {
        id: attendance._id,
        employeeId: attendance.employeeId,
        date: attendance.date,
        period: attendance.period,
        checkInTime: attendance.checkInTime,
        checkOutTime: attendance.checkOutTime,
        totalMinutes: attendance.totalMinutes,
      },
    });
  } catch (error) {
    console.error('Manual attendance error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
