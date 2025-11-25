const express = require('express');
const cors = require('cors');
const path = require('path');
const bcrypt = require('bcryptjs');

const { connect } = require('./db');
const User = require('./models/user');

const app = express();
app.use(cors());
app.use(express.json());

// Respond to favicon requests with no content to avoid 404 errors in the browser console
app.get('/favicon.ico', (req, res) => res.status(204).end());

// Serve employee panel explicitly in case static hosting misses the file
app.get('/employee.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'employee.html'));
});

// Serve frontend static files from repository root (index.html, styles.css, login.js, dashboard.html)
app.use(express.static(path.join(__dirname)));

// Connect to MongoDB (if MONGODB_URI provided)
connect();

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ ok: false, error: 'missing_username_or_password' });

  try {
    const user = await User.findOne({ username }).exec();
    if (!user) return res.status(401).json({ ok: false, error: 'invalid_credentials' });

    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(401).json({ ok: false, error: 'invalid_credentials' });

    return res.json({ ok: true, username: user.username, role: user.role || 'employee' });
  } catch (err) {
    console.error('Login error', err);
    return res.status(500).json({ ok: false, error: 'server_error' });
  }
});

app.get('/', (req, res) => res.json({ ok: true, message: 'CarsPlay Auth Service' }));

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Server listening on port ${port}`));
