const mongoose = require('mongoose');

const systemSettingsSchema = new mongoose.Schema({
  morningStart: { type: String, required: true, default: '08:00' },
  morningEnd: { type: String, required: true, default: '12:00' },
  eveningStart: { type: String, required: true, default: '13:00' },
  eveningEnd: { type: String, required: true, default: '16:00' },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
}, { timestamps: true });

module.exports = mongoose.model('SystemSettings', systemSettingsSchema);
