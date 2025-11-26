const mongoose = require('mongoose');

const StationSchema = new mongoose.Schema({
  name: { type: String, required: true },
  number: { type: Number },
  image: { type: String },
  price: { type: Number, default: 0 },
  active: { type: Boolean, default: true }
}, { timestamps: true });

// unique index on number to enforce DB-level uniqueness
// use sparse:true so documents without `number` don't conflict
StationSchema.index({ number: 1 }, { unique: true, sparse: true });

module.exports = mongoose.model('Station', StationSchema);
