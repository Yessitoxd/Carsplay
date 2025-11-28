const mongoose = require('mongoose');

const TimeLogSchema = new mongoose.Schema({
  clientId: { type: String }, // optional client-generated id for idempotency
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
TimeLogSchema.index({ clientId: 1 }, { unique: true, sparse: true });

module.exports = mongoose.model('TimeLog', TimeLogSchema);
