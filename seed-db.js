// seed-db.js
// Simple script to seed the MongoDB database with initial users.
// Requires MONGODB_URI environment variable.

const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const User = require('./models/user');

async function run() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('MONGODB_URI not set. Aborting.');
    process.exit(1);
  }

  await mongoose.connect(uri, { useNewUrlParser: true, useUnifiedTopology: true });
  console.log('Connected to MongoDB for seeding');

  const toCreate = [
    { username: 'Carsplay', password: 'Carsplay-2026', role: 'employee' },
    { username: 'Larry', password: 'Lavn180524', role: 'admin' }
  ];

  for (const u of toCreate) {
    const existing = await User.findOne({ username: u.username }).exec();
    if (existing) {
      console.log('Skipping existing user', u.username);
      continue;
    }
    const hash = await bcrypt.hash(String(u.password), 10);
    const created = new User({ username: u.username, password: hash, role: u.role });
    await created.save();
    console.log('Created user', u.username);
  }

  await mongoose.disconnect();
  console.log('Seeding finished');
  process.exit(0);
}

run().catch(err => { console.error(err); process.exit(1); });
