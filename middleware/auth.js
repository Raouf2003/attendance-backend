const jwt = require('jsonwebtoken');
const Employee = require('../models/Employee');

async function authenticate(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ message: 'No token provided' });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const employee = await Employee.findById(decoded.id);
    if (!employee || !employee.isActive) {
      return res.status(401).json({ message: 'Invalid or inactive employee' });
    }

    req.employee = employee;
    next();
  } catch (error) {
    return res.status(401).json({ message: 'Invalid token' });
  }
}

async function adminOnly(req, res, next) {
  if (req.employee.role !== 'admin') {
    return res.status(403).json({ message: 'Admin access required' });
  }
  next();
}

module.exports = { authenticate, adminOnly };
