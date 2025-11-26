const express = require('express');
const cors = require('cors');
const path = require('path');
const bcrypt = require('bcryptjs');

const { connect } = require('./db');
const User = require('./models/user');
const Station = require('./models/station');

const app = express();
const fs = require('fs');
const multer = require('multer');
app.use(cors());
app.use(express.json());

// ensure uploads directory exists
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

// configure multer
const storage = multer.diskStorage({
  destination: function (req, file, cb) { cb(null, uploadsDir); },
  filename: function (req, file, cb) {
    const ext = path.extname(file.originalname) || '.jpg';
    cb(null, `${Date.now()}-${Math.round(Math.random()*1e6)}${ext}`);
  }
});
const upload = multer({ storage });

// serve uploads statically
app.use('/uploads', express.static(uploadsDir));

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

// Stations endpoints (admin can create, employees fetch)
app.get('/api/stations', async (req, res) => {
  try {
    const stations = await Station.find({}).sort({ number: 1 }).exec();
    return res.json(stations);
  } catch (err) {
    console.error('Stations fetch error', err);
    return res.status(500).json({ ok: false, error: 'server_error' });
  }
});

// Create station with optional image upload (multipart/form-data)
app.post('/api/stations', upload.single('image'), async (req, res) => {
  // NOTE: no auth yet — restrict in future
  try {
    const name = req.body.name || 'Carrito';
    const number = req.body.number ? Number(req.body.number) : undefined;
    if (!number && number !== 0) return res.status(400).json({ ok: false, error: 'missing_number' });
    let imagePath = undefined;
    if (req.file && req.file.filename) {
      imagePath = '/uploads/' + req.file.filename;
    }
    const station = new Station({ name, number, image: imagePath });
    await station.save();
    return res.status(201).json(station);
  } catch (err) {
    console.error('Stations create error', err);
    return res.status(500).json({ ok: false, error: 'server_error' });
  }
});

app.get('/', (req, res) => res.json({ ok: true, message: 'CarsPlay Auth Service' }));

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Server listening on port ${port}`));
