// scripts/create_indexes.js
// Run this script once after deploying to create/sync DB indexes for models.

const { connect } = require('../db');
const mongoose = require('mongoose');

async function run() {
  await connect();
  // require models to register indexes
  const Station = require('../models/station');
  const TimeRate = require('../models/timeRate');

  try {
    console.log('Syncing Station indexes...');
    await Station.syncIndexes();
    console.log('Station indexes synced');

    console.log('Syncing TimeRate indexes...');
    await TimeRate.syncIndexes();
    console.log('TimeRate indexes synced');

    console.log('All indexes created/verified.');
  } catch (err) {
    console.error('Index sync error:', err);
  } finally {
    mongoose.connection && mongoose.connection.close();
  }
}

run();
