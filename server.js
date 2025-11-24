const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');

const app = express();
app.use(cors());
app.use(express.json());

const USERS_FILE = path.join(__dirname, 'users.json');

function loadUsers() {
  try {
    const raw = fs.readFileSync(USERS_FILE, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    return [];
  }
}

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ ok: false, error: 'missing_username_or_password' });

  const users = loadUsers();
  const user = users.find(u => u.username === username);
  if (!user) return res.status(401).json({ ok: false, error: 'invalid_credentials' });

  const match = await bcrypt.compare(password, user.password);
  if (!match) return res.status(401).json({ ok: false, error: 'invalid_credentials' });

  // For a real app you would create a session or JWT here.
  return res.json({ ok: true, username: user.username, role: user.role || 'employee' });
});

app.get('/', (req, res) => res.json({ ok: true, message: 'CarsPlay Auth Service' }));

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Server listening on port ${port}`));
