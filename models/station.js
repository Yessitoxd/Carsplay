const mongoose = require('mongoose');

const StationSchema = new mongoose.Schema({
  name: { type: String, required: true },
  number: { type: Number },
  image: { type: String },
  price: { type: Number, default: 0 },
  active: { type: Boolean, default: true }
}, { timestamps: true });

module.exports = mongoose.model('Station', StationSchema);
