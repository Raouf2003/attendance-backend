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

router.post('/employees', authenticate, adminOnly, async (req, res) => {
  try {
    const { employeeNumber, fullName, password, role } = req.body;

    if (!employeeNumber || !fullName || !password) {
      return res.status(400).json({ message: 'All fields are required' });
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
        fingerprintRegistered: false,
      },
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
      Employee.find({}, { password: 0 }).sort({ createdAt: -1 }),
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

    let csv = 'Employee Name,Employee Number,Period,Check In,Check Out,Total Minutes,Auto Checkout\n';

    for (const r of records) {
      if (!r.employeeId) continue;
      const checkIn = r.checkInTime ? new Date(r.checkInTime).toLocaleTimeString('en-GB', { hour12: false }) : '-';
      const checkOut = r.checkOutTime ? new Date(r.checkOutTime).toLocaleTimeString('en-GB', { hour12: false }) : '-';
      csv += `${r.employeeId.fullName},${r.employeeId.employeeNumber},${r.period},${checkIn},${checkOut},${r.totalMinutes || 0},${r.autoCheckout || false}\n`;
    }

    res.setHeader('Content-Type', 'text/csv');
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

    const records = await Attendance.find({
      date: {
        $gte: `${targetYear}-${monthStr}-01`,
        $lte: `${targetYear}-${monthStr}-31`,
      },
    }).populate('employeeId', 'fullName employeeNumber').sort({ date: 1 });

    let csv = 'Employee Name,Employee Number,Date,Period,Check In,Check Out,Total Minutes,Auto Checkout\n';

    for (const r of records) {
      if (!r.employeeId) continue;
      const checkIn = r.checkInTime ? new Date(r.checkInTime).toLocaleTimeString('en-GB', { hour12: false }) : '-';
      const checkOut = r.checkOutTime ? new Date(r.checkOutTime).toLocaleTimeString('en-GB', { hour12: false }) : '-';
      csv += `${r.employeeId.fullName},${r.employeeId.employeeNumber},${r.date},${r.period},${checkIn},${checkOut},${r.totalMinutes || 0},${r.autoCheckout || false}\n`;
    }

    res.setHeader('Content-Type', 'text/csv');
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

    let csv = 'Date,Period,Check In,Check Out,Total Minutes,Auto Checkout\n';

    for (const r of records) {
      const checkIn = r.checkInTime ? new Date(r.checkInTime).toLocaleTimeString('en-GB', { hour12: false }) : '-';
      const checkOut = r.checkOutTime ? new Date(r.checkOutTime).toLocaleTimeString('en-GB', { hour12: false }) : '-';
      csv += `${r.date},${r.period},${checkIn},${checkOut},${r.totalMinutes || 0},${r.autoCheckout || false}\n`;
    }

    res.setHeader('Content-Type', 'text/csv');
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

    const dateFilter = {
      $gte: `${targetYear}-${monthStr}-01`,
      $lte: `${targetYear}-${monthStr}-31`,
    };

    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 20));

    const distinctEmps = await Attendance.distinct('employeeId', { date: dateFilter });
    const total = distinctEmps.length;

    const aggregation = [
      { $match: { date: dateFilter } },
      { $lookup: { from: 'employees', localField: 'employeeId', foreignField: '_id', as: 'employee' } },
      { $unwind: { path: '$employee', preserveNullAndEmptyArrays: false } },
      {
        $group: {
          _id: '$employeeId',
          employeeName: { $first: '$employee.fullName' },
          employeeNumber: { $first: '$employee.employeeNumber' },
          totalMinutes: { $sum: { $ifNull: ['$totalMinutes', 0] } },
          daysPresent: { $sum: 1 },
          days: {
            $push: {
              date: '$date',
              period: '$period',
              checkInTime: '$checkInTime',
              checkOutTime: '$checkOutTime',
              totalMinutes: '$totalMinutes',
              autoCheckout: '$autoCheckout',
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
      totalMinutes: r.totalMinutes,
      daysPresent: r.daysPresent,
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

module.exports = router;
