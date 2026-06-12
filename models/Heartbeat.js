const mongoose = require('mongoose');

const heartbeatSchema = new mongoose.Schema({
  employeeId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Employee',
    required: true,
  },
  attendanceId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Attendance',
    required: true,
  },
  lat: { type: Number },
  lng: { type: Number },
  accuracy: { type: Number },
  isMock: { type: Boolean, default: false },
  battery: { type: Number },
  networkType: { type: String },
  timestamp: { type: Date, default: Date.now },
});

heartbeatSchema.index({ timestamp: 1 }, { expireAfterSeconds: 604800 });
heartbeatSchema.index({ attendanceId: 1, timestamp: -1 });
heartbeatSchema.index({ employeeId: 1, timestamp: -1 });

module.exports = mongoose.model('Heartbeat', heartbeatSchema);
