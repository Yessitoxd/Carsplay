const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');

const EMPLOYEES_FILE = path.join(__dirname, 'employees.json');
const OUTPUT_FILE = path.join(__dirname, 'users.json');

function run() {
  if (!fs.existsSync(EMPLOYEES_FILE)) {
    console.error('employees.json not found. Create employees.json first.');
    process.exit(1);
  }

  const raw = fs.readFileSync(EMPLOYEES_FILE, 'utf8');
  const parsed = JSON.parse(raw);
  const employees = parsed.employees || [];

  const users = employees.map(e => {
    const hash = bcrypt.hashSync(String(e.password), 10);
    return {
      id: e.id,
      username: e.username,
      password: hash,
      role: e.role || 'employee',
      created_at: e.created_at || new Date().toISOString()
    };
  });

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(users, null, 2), 'utf8');
  console.log('Wrote', OUTPUT_FILE, 'with', users.length, 'user(s)');
}

run();
