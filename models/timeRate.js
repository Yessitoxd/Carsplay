const mongoose = require('mongoose');

const TimeRateSchema = new mongoose.Schema({
  minutes: { type: Number, required: true },
  amount: { type: Number, required: true, default: 0 }
}, { timestamps: true });

// unique index on minutes to enforce DB-level uniqueness
TimeRateSchema.index({ minutes: 1 }, { unique: true });

module.exports = mongoose.model('TimeRate', TimeRateSchema);
