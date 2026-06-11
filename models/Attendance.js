const mongoose = require('mongoose');

const attendanceSchema = new mongoose.Schema({
  employeeId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Employee',
    required: true,
  },
  date: {
    type: String,
    required: true,
  },
  period: {
    type: String,
    enum: ['morning', 'evening'],
    required: true,
  },
  checkInTime: {
    type: Date,
    required: true,
  },
  checkOutTime: {
    type: Date,
    default: null,
  },
  totalMinutes: {
    type: Number,
    default: 0,
  },
  autoCheckout: {
    type: Boolean,
    default: false,
  },
  checkoutType: {
    type: String,
    enum: ['manual', 'auto'],
    default: 'manual',
  },
  location: {
    lat: { type: Number },
    lng: { type: Number },
  },
  normalHours: {
    type: Number,
    default: 0,
  },
}, { timestamps: true });

attendanceSchema.index({ employeeId: 1, date: 1, period: 1 }, { unique: true });
attendanceSchema.index({ date: 1 });
attendanceSchema.index({ checkOutTime: 1 });

module.exports = mongoose.model('Attendance', attendanceSchema);
