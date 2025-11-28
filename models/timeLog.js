const mongoose = require('mongoose');

const TimeLogSchema = new mongoose.Schema({
  stationId: { type: String },
  stationNumber: { type: Number },
  stationName: { type: String },
  username: { type: String },
  start: { type: Date, required: true },
  end: { type: Date, required: true },
  duration: { type: Number }, // seconds
  amount: { type: Number, default: 0 },
  comment: { type: String },
  createdAt: { type: Date, default: Date.now }
});

TimeLogSchema.index({ start: 1 });

module.exports = mongoose.model('TimeLog', TimeLogSchema);
