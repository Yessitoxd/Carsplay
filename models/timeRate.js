const mongoose = require('mongoose');

const TimeRateSchema = new mongoose.Schema({
  minutes: { type: Number, required: true },
  amount: { type: Number, required: true, default: 0 }
}, { timestamps: true });

module.exports = mongoose.model('TimeRate', TimeRateSchema);
