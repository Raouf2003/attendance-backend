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
  lastHeartbeatAt: { type: Date, default: null },
  heartbeatCount: { type: Number, default: 0 },
  mockDetected: { type: Boolean, default: false },
  mockCount: { type: Number, default: 0 },
  velocityAnomalies: { type: Number, default: 0 },
  locationLost: { type: Boolean, default: false },
  locationLostSince: { type: Date, default: null },
  consecutiveOutsideCount: { type: Number, default: 0 },
  clientCheckInTime: { type: Date, default: null },
  clientCheckOutTime: { type: Date, default: null },
  deviceInactiveTimeout: { type: Boolean, default: false },
  checkOutReason: {
    type: String,
    enum: [
      'manual',
      'geofence_violation',
      'geofence_violation_server',
      'heartbeat_timeout',
      'device_inactive_timeout',
      'location_lost',
      'location_lost_timeout',
      'shift_end',
      'gps_lost_timeout',
      'admin_force',
    ],
    default: 'manual',
  },
  deviceId: { type: String },
  lastKnownIp: { type: String },
}, { timestamps: true });

attendanceSchema.index({ employeeId: 1, date: 1, period: 1 }, { unique: true });
attendanceSchema.index({ date: 1 });
attendanceSchema.index({ checkOutTime: 1 });
attendanceSchema.index({ checkOutTime: 1, lastHeartbeatAt: 1 });
attendanceSchema.index({ employeeId: 1, checkOutTime: 1 });

module.exports = mongoose.model('Attendance', attendanceSchema);
