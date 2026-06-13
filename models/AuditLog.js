const mongoose = require('mongoose');

const auditLogSchema = new mongoose.Schema({
  employeeId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Employee',
    required: true,
  },
  action: {
    type: String,
    enum: ['checkin', 'checkout', 'auto_checkout', 'admin_force_checkout', 'manual_checkout', 'face_verification_skipped'],
    required: true,
  },
  ip: { type: String, default: null },
  deviceId: { type: String, default: null },
  userAgent: { type: String, default: null },
  metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  timestamp: { type: Date, default: Date.now },
}, { timestamps: false });

auditLogSchema.index({ employeeId: 1, timestamp: -1 });
auditLogSchema.index({ action: 1, timestamp: -1 });
auditLogSchema.index({ timestamp: -1 });

module.exports = mongoose.model('AuditLog', auditLogSchema);
