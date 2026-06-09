const mongoose = require('mongoose');

const employeeSchema = new mongoose.Schema({
  employeeNumber: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    minlength: 1,
    maxlength: 50,
  },
  fullName: {
    type: String,
    required: true,
    trim: true,
    minlength: 1,
    maxlength: 100,
  },
  password: {
    type: String,
    required: true,
    minlength: 4,
  },
  role: {
    type: String,
    enum: ['employee', 'admin'],
    default: 'employee',
  },
  isActive: {
    type: Boolean,
    default: true,
  },
  fingerprintRegistered: {
    type: Boolean,
    default: false,
  },
}, { timestamps: true });

employeeSchema.index({ role: 1 });

module.exports = mongoose.model('Employee', employeeSchema);
