const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const Employee = require('../models/Employee');

const router = express.Router();

router.post('/login', async (req, res) => {
  try {
    const { employeeNumber, password } = req.body;

    if (!employeeNumber || !password) {
      return res.status(400).json({ message: 'Employee number and password required' });
    }

    const employee = await Employee.findOne({ employeeNumber });
    if (!employee) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    if (!employee.isActive) {
      return res.status(401).json({ message: 'Account is deactivated' });
    }

    const isMatch = await bcrypt.compare(password, employee.password);
    if (!isMatch) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    const token = jwt.sign(
      { id: employee._id, role: employee.role },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.json({
      token,
      employee: {
        id: employee._id,
        employeeNumber: employee.employeeNumber,
        fullName: employee.fullName,
        role: employee.role,
      },
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
