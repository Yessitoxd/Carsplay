// seed-if-needed.js
// Run create_users.js only when SKIP_SEED is not set to 'true'.
// This allows controlling seeding from the environment (e.g. Render).

const skip = String(process.env.SKIP_SEED || '').toLowerCase();
if (skip === 'true' || skip === '1' || skip === 'yes') {
  console.log('SKIP_SEED is set — skipping user seeding.');
  process.exit(0);
}

// Require and call run exported from create_users.js
const creator = require('./create_users');
if (creator && typeof creator.run === 'function') {
  creator.run();
} else {
  console.error('create_users.run not available');
  process.exit(1);
}
