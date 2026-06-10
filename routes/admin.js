const express = require('express');
const bcrypt = require('bcryptjs');
const Employee = require('../models/Employee');
const Attendance = require('../models/Attendance');
const Report = require('../models/Report');
const { authenticate, adminOnly } = require('../middleware/auth');
const { paginate, paginatedResponse } = require('../utils/pagination');
const { cacheMiddleware, clearCache } = require('../middleware/cache');


const router = express.Router();

function formatMinutes(totalMinutes) {
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${h}h ${m}m`;
}

function computeNormalMinutes(totalMinutes, overtimeHours) {
  const ot = overtimeHours || 0;
  return Math.max(0, (totalMinutes || 0) - ot * 60);
}

function computeOvertimeMinutes(overtimeHours) {
  return (overtimeHours || 0) * 60;
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

    const working = [];
    const overtime = [];

    for (const r of activeRecords) {
      if (!r.employeeId) continue;
      const hasActiveOvertime = r.overtimeScheduledEnd && r.overtimeScheduledEnd > now;
      const entry = {
        employeeId: r.employeeId._id,
        fullName: r.employeeId.fullName,
        employeeNumber: r.employeeId.employeeNumber,
        period: r.period,
        checkInTime: r.checkInTime,
      };
      if (hasActiveOvertime) {
        entry.overtimeScheduledEnd = r.overtimeScheduledEnd;
        overtime.push(entry);
      } else {
        working.push(entry);
      }
    }

    res.json({ working, overtime });
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
        normalMinutes: computeNormalMinutes(r.totalMinutes, r.overtimeHours),
        overtimeMinutes: computeOvertimeMinutes(r.overtimeHours),
        totalMinutes: r.totalMinutes,
        overtimeHours: r.overtimeHours || 0,
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

    let csv = 'Employee Name,Employee Number,Period,Check In,Check Out,Overtime Time (min),Total Time (min)\n';

    for (const r of records) {
      if (!r.employeeId) continue;
      const checkIn = r.checkInTime ? new Date(r.checkInTime).toLocaleTimeString('en-GB', { hour12: false }) : '-';
      const checkOut = r.checkOutTime ? new Date(r.checkOutTime).toLocaleTimeString('en-GB', { hour12: false }) : '-';
      const normalMin = computeNormalMinutes(r.totalMinutes, r.overtimeHours);
      const overtimeMin = computeOvertimeMinutes(r.overtimeHours);
      csv += `${sanitizeCsvField(r.employeeId.fullName)},${sanitizeCsvField(r.employeeId.employeeNumber)},${sanitizeCsvField(r.period)},${sanitizeCsvField(checkIn)},${sanitizeCsvField(checkOut)},${overtimeMin},${normalMin}\n`;
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
          overtimeHours: { $sum: { $ifNull: ['$overtimeHours', 0] } },
        },
      },
      {
        $group: {
          _id: '$_id.employeeId',
          employeeName: { $first: '$employeeName' },
          employeeNumber: { $first: '$employeeNumber' },
          totalMinutes: { $sum: '$totalMinutes' },
          totalOvertimeHours: { $sum: '$overtimeHours' },
          daysPresent: { $sum: 1 },
        },
      },
      { $sort: { employeeName: 1 } },
    ];

    const results = await Attendance.aggregate(aggregation);

    let csv = 'Employee Name,Employee Number,Days Present,Total Normal Hours (min),Total Overtime Hours (min)\n';

    for (const r of results) {
      const normalMin = computeNormalMinutes(r.totalMinutes, r.totalOvertimeHours);
      const overtimeMin = computeOvertimeMinutes(r.totalOvertimeHours);
      csv += `${sanitizeCsvField(r.employeeName)},${sanitizeCsvField(r.employeeNumber)},${r.daysPresent},${normalMin},${overtimeMin}\n`;
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

    let csv = 'Date,Period,Check In,Check Out,Normal Time (min),Overtime Time (min),Total Minutes\n';

    for (const r of records) {
      const checkIn = r.checkInTime ? new Date(r.checkInTime).toLocaleTimeString('en-GB', { hour12: false }) : '-';
      const checkOut = r.checkOutTime ? new Date(r.checkOutTime).toLocaleTimeString('en-GB', { hour12: false }) : '-';
      const normalMin = computeNormalMinutes(r.totalMinutes, r.overtimeHours);
      const overtimeMin = computeOvertimeMinutes(r.overtimeHours);
      csv += `${sanitizeCsvField(r.date)},${sanitizeCsvField(r.period)},${sanitizeCsvField(checkIn)},${sanitizeCsvField(checkOut)},${normalMin},${overtimeMin},${r.totalMinutes || 0}\n`;
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
          overtimeHours: { $sum: { $ifNull: ['$overtimeHours', 0] } },
          records: {
            $push: {
              period: '$period',
              checkInTime: '$checkInTime',
              checkOutTime: '$checkOutTime',
              totalMinutes: '$totalMinutes',
              overtimeHours: '$overtimeHours',
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
          totalOvertimeHours: { $sum: '$overtimeHours' },
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

    const report = results.map(r => {
      const normalMinutes = computeNormalMinutes(r.totalMinutes, r.totalOvertimeHours);
      const overtimeMinutes = computeOvertimeMinutes(r.totalOvertimeHours);
      return {
        employeeName: r.employeeName,
        employeeNumber: r.employeeNumber,
        daysPresent: r.daysPresent,
        totalNormalMinutes: normalMinutes,
        totalOvertimeMinutes: overtimeMinutes,
        totalMinutes: r.totalMinutes,
        days: r.days,
      };
    });

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

module.exports = router;
