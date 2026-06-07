const mongoose = require('mongoose');

const reportSchema = new mongoose.Schema({
  employeeId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Employee',
    required: true,
  },
  type: {
    type: String,
    enum: ['issue', 'inventory', 'feedback'],
    required: true,
  },
  description: {
    type: String,
    required: true,
  },
  photo: {
    type: String,
    default: null,
  },
}, { timestamps: true });

reportSchema.index({ employeeId: 1, createdAt: -1 });

module.exports = mongoose.model('Report', reportSchema);
