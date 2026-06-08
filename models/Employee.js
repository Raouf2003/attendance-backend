const mongoose = require('mongoose');

const employeeSchema = new mongoose.Schema({
  employeeNumber: {
    type: String,
    required: true,
    unique: true,
  },
  fullName: {
    type: String,
    required: true,
  },
  password: {
    type: String,
    required: true,
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
  facePhoto: {
    type: String,
    default: null,
  },
  faceDescriptor: {
    type: [Number],
    default: null,
  },
}, { timestamps: true });

employeeSchema.index({ role: 1 });

module.exports = mongoose.model('Employee', employeeSchema);
