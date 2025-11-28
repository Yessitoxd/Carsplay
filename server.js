const express = require('express');
const cors = require('cors');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const { connect } = require('./db');
const User = require('./models/user');
const Station = require('./models/station');
const TimeRate = require('./models/timeRate');
const TimeLog = require('./models/timeLog');

const app = express();
const fs = require('fs');
const multer = require('multer');
const mongoose = require('mongoose');
app.use(cors());
app.use(express.json());

// In-memory fallback storage for TimeLogs when MongoDB is not available (development only)
const IN_MEMORY_LOGS = [];

// configure multer to use memory storage — we'll push files into GridFS
const upload = multer({ storage: multer.memoryStorage() });

// JWT secret for signing tokens (set via env in production)
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';

// Middleware: verify incoming Bearer token and attach payload to req.user
function verifyToken(req, res, next) {
  const auth = req.headers['authorization'] || req.headers['Authorization'];
  if (!auth) return res.status(401).json({ ok: false, error: 'missing_token' });
  const parts = String(auth).split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') return res.status(401).json({ ok: false, error: 'invalid_token' });
  const token = parts[1];
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload;
    return next();
  } catch (e) {
    return res.status(401).json({ ok: false, error: 'invalid_token' });
  }
}

function requireAdmin(req, res, next) {
  if (!req.user || (req.user.role || '').toLowerCase() !== 'admin') return res.status(403).json({ ok: false, error: 'forbidden' });
  return next();
}

// note: we previously served /uploads from disk; switching to GridFS will serve via `/api/uploads/:id`

// Respond to favicon requests with no content to avoid 404 errors in the browser console
app.get('/favicon.ico', (req, res) => res.status(204).end());

// Serve employee panel explicitly in case static hosting misses the file
app.get('/employee.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'employee.html'));
});

// Serve Alarm.wav explicitly from repo root (improves reliability on some hosts)
const ALARM_FILE = path.join(__dirname, 'Alarm.wav');
app.get('/Alarm.wav', (req, res) => {
  try {
    if (fs.existsSync(ALARM_FILE)) return res.sendFile(ALARM_FILE);
    return res.status(404).end();
  } catch (e) {
    console.error('Alarm serve error', e);
    return res.status(500).end();
  }
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

      // create JWT token
      const token = jwt.sign({ userId: user._id, username: user.username, role: user.role || 'employee' }, JWT_SECRET, { expiresIn: '6h' });
      return res.json({ ok: true, username: user.username, role: user.role || 'employee', token });
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

// Time rate endpoints
// Public GET allows employee UI to fetch available time tiers
app.get('/api/time/rates', async (req, res) => {
  try {
    const rates = await TimeRate.find({}).sort({ minutes: 1 }).exec();
    return res.json(rates);
  } catch (err) {
    console.error('Time rates fetch error', err);
    return res.status(500).json({ ok: false, error: 'server_error' });
  }
});

// Create a new time->amount rate (admin only)
app.post('/api/time/rates', verifyToken, requireAdmin, async (req, res) => {
  try {
    const minutes = Number(req.body.minutes);
    const amount = Number(req.body.amount);
    if (!minutes || minutes <= 0) return res.status(400).json({ ok: false, error: 'invalid_minutes' });
    if (isNaN(amount) || amount < 0) return res.status(400).json({ ok: false, error: 'invalid_amount' });
    // ensure minutes uniqueness
    const exists = await TimeRate.findOne({ minutes }).exec();
    if (exists) return res.status(409).json({ ok: false, error: 'minutes_taken', message: `Ya existe una tarifa para ${minutes} minutos` });
    const r = new TimeRate({ minutes, amount });
    await r.save();
    return res.status(201).json(r);
  } catch (err) {
    console.error('Create time rate error', err);
    return res.status(500).json({ ok: false, error: 'server_error' });
  }
});

// Persist a time session (log). Public POST so employees can send session records.
app.post('/api/time/logs', async (req, res) => {
  try {
    const body = req.body || {};
    const start = body.start ? new Date(body.start) : null;
    const end = body.end ? new Date(body.end) : null;
    if (!start || !end) return res.status(400).json({ ok: false, error: 'missing_start_or_end' });
    const duration = body.duration !== undefined ? Number(body.duration) : Math.max(0, Math.floor((end.getTime() - start.getTime())/1000));
    const amount = body.amount !== undefined ? Number(body.amount) : 0;

    // If MongoDB is not connected, persist logs in-memory for immediate local testing
    const isDbConnected = mongoose && mongoose.connection && mongoose.connection.readyState === 1;
    const clientId = body.clientId ? String(body.clientId) : null;
    if (!isDbConnected) {
      // check idempotency in memory
      if (clientId) {
        const ex = IN_MEMORY_LOGS.find(x => x.clientId === clientId);
        if (ex) return res.json({ ok: true, id: ex.id, existing: true });
      }
      const rec = {
        id: 'mem-' + Date.now() + '-' + Math.floor(Math.random()*1000000),
        clientId: clientId || undefined,
        stationId: body.stationId || null,
        stationNumber: body.stationNumber !== undefined ? Number(body.stationNumber) : undefined,
        stationName: body.stationName || null,
        username: body.username || null,
        start, end, duration, amount, comment: body.comment || null,
        createdAt: new Date()
      };
      IN_MEMORY_LOGS.push(rec);
      return res.status(201).json({ ok: true, id: rec.id, inMemory: true });
    }

    // DB connected: use mongoose model with idempotency
    if (clientId) {
      try {
        const existing = await TimeLog.findOne({ clientId }).exec();
        if (existing) return res.json({ ok: true, id: existing._id, existing: true });
      } catch (e) {
        // proceed to attempt insert below
      }
    }

    const log = new TimeLog({
      clientId: clientId || undefined,
      stationId: body.stationId || null,
      stationNumber: body.stationNumber !== undefined ? Number(body.stationNumber) : undefined,
      stationName: body.stationName || null,
      username: body.username || null,
      start, end, duration, amount, comment: body.comment || null
    });
    try {
      await log.save();
      return res.status(201).json({ ok: true, id: log._id });
    } catch (saveErr) {
      // handle duplicate key error (race where another request inserted same clientId)
      if (saveErr && saveErr.code === 11000 && clientId) {
        try {
          const existing = await TimeLog.findOne({ clientId }).exec();
          if (existing) return res.json({ ok: true, id: existing._id, existing: true });
        } catch (e) { /* fall through */ }
      }
      console.error('Create time log save error', saveErr);
      return res.status(500).json({ ok: false, error: 'server_error' });
    }
  } catch (err) {
    console.error('Create time log error', err);
    return res.status(500).json({ ok: false, error: 'server_error' });
  }
});

// Get time logs in a date range. Query params: start=YYYY-MM-DD, end=YYYY-MM-DD (inclusive)
app.get('/api/time/logs', async (req, res) => {
  try {
    const q = req.query || {};
    let startDate = q.start ? new Date(q.start) : null;
    let endDate = q.end ? new Date(q.end) : null;
    if (!startDate) {
      // default to today
      const now = new Date();
      startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0,0,0,0);
    } else {
      startDate = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate(), 0,0,0,0);
    }
    if (!endDate) {
      const now = new Date();
      endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23,59,59,999);
    } else {
      endDate = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate(), 23,59,59,999);
    }
    const isDbConnected = mongoose && mongoose.connection && mongoose.connection.readyState === 1;
    if (!isDbConnected){
      // return in-memory logs filtered by date range
      const out = IN_MEMORY_LOGS.filter(l => {
        const t = new Date(l.start).getTime();
        return t >= startDate.getTime() && t <= endDate.getTime();
      }).sort((a,b)=> new Date(a.start) - new Date(b.start));
      return res.json(out);
    }
    const logs = await TimeLog.find({ start: { $gte: startDate, $lte: endDate } }).sort({ start: 1 }).exec();
    return res.json(logs);
  } catch (err) {
    console.error('Fetch time logs error', err);
    return res.status(500).json({ ok: false, error: 'server_error' });
  }
});

// Update rate (admin only)
app.put('/api/time/rates/:id', verifyToken, requireAdmin, async (req, res) => {
  try {
    const id = req.params.id;
    const minutes = req.body.minutes !== undefined ? Number(req.body.minutes) : undefined;
    const amount = req.body.amount !== undefined ? Number(req.body.amount) : undefined;
    const update = {};
    if (minutes !== undefined) update.minutes = minutes;
    if (amount !== undefined) update.amount = amount;
    // if minutes provided, ensure uniqueness among others
    if (minutes !== undefined) {
      const clash = await TimeRate.findOne({ minutes, _id: { $ne: id } }).exec();
      if (clash) return res.status(409).json({ ok: false, error: 'minutes_taken', message: `Ya existe una tarifa para ${minutes} minutos` });
    }
    const updated = await TimeRate.findByIdAndUpdate(id, update, { new: true }).exec();
    if (!updated) return res.status(404).json({ ok: false, error: 'not_found' });
    return res.json(updated);
  } catch (err) {
    console.error('Update time rate error', err);
    return res.status(500).json({ ok: false, error: 'server_error' });
  }
});

// Delete rate (admin only)
app.delete('/api/time/rates/:id', verifyToken, requireAdmin, async (req, res) => {
  try {
    const id = req.params.id;
    await TimeRate.deleteOne({ _id: id }).exec();
    return res.json({ ok: true });
  } catch (err) {
    console.error('Delete time rate error', err);
    return res.status(500).json({ ok: false, error: 'server_error' });
  }
});

// Create station with optional image upload (multipart/form-data)
app.post('/api/stations', verifyToken, requireAdmin, upload.single('image'), async (req, res) => {
  // NOTE: no auth yet — restrict in future
  try {
    const name = req.body.name || 'Carrito';
    const number = req.body.number ? Number(req.body.number) : undefined;
    if (!number && number !== 0) return res.status(400).json({ ok: false, error: 'missing_number' });

    let imageUrl = undefined;
    // if file buffer present, stream to GridFS and build image URL
    if (req.file && req.file.buffer) {
      if (!mongoose.connection || !mongoose.connection.db) {
        console.error('MongoDB not connected yet');
        return res.status(500).json({ ok: false, error: 'db_not_ready' });
      }
      const bucket = new mongoose.mongo.GridFSBucket(mongoose.connection.db, { bucketName: 'uploads' });
      const filename = req.file.originalname || (`upload-${Date.now()}.jpg`);
      const uploadStream = bucket.openUploadStream(filename, { contentType: req.file.mimetype });
      // write buffer then wait finish
      await new Promise((resolve, reject) => {
        uploadStream.on('error', (err) => reject(err));
        uploadStream.on('finish', () => resolve());
        uploadStream.end(req.file.buffer);
      });
      const fileId = uploadStream.id;
      imageUrl = `/api/uploads/${fileId}`;
    }

    // ensure number uniqueness
    const existing = await Station.findOne({ number }).exec();
    if (existing) return res.status(409).json({ ok: false, error: 'number_taken', message: 'Ese número ya está ocupado' });

    const station = new Station({ name, number, image: imageUrl });
    await station.save();
    return res.status(201).json(station);
  } catch (err) {
    console.error('Stations create error', err);
    return res.status(500).json({ ok: false, error: 'server_error' });
  }
});

// Update station (number or replace image via multipart)
app.put('/api/stations/:id', verifyToken, requireAdmin, upload.single('image'), async (req, res) => {
  try {
    const id = req.params.id;
    const number = req.body.number ? Number(req.body.number) : undefined;
    // if number provided, ensure uniqueness among others
    if (number !== undefined) {
      const clash = await Station.findOne({ number, _id: { $ne: id } }).exec();
      if (clash) return res.status(409).json({ ok: false, error: 'number_taken', message: 'Ese número ya está ocupado' });
    }

    const update = {};
    if (number !== undefined) update.number = number;

    // handle image replacement: if file buffer present, store in GridFS and set image URL
    if (req.file && req.file.buffer) {
      if (!mongoose.connection || !mongoose.connection.db) return res.status(500).json({ ok: false, error: 'db_not_ready' });
      const bucket = new mongoose.mongo.GridFSBucket(mongoose.connection.db, { bucketName: 'uploads' });
      const filename = req.file.originalname || (`upload-${Date.now()}.jpg`);
      const uploadStream = bucket.openUploadStream(filename, { contentType: req.file.mimetype });
      await new Promise((resolve, reject) => {
        uploadStream.on('error', (err) => reject(err));
        uploadStream.on('finish', () => resolve());
        uploadStream.end(req.file.buffer);
      });
      const fileId = uploadStream.id;
      update.image = `/api/uploads/${fileId}`;
    }

    const updated = await Station.findByIdAndUpdate(id, update, { new: true }).exec();
    if (!updated) return res.status(404).json({ ok: false, error: 'not_found' });
    return res.json(updated);
  } catch (err) {
    console.error('Station update error', err);
    return res.status(500).json({ ok: false, error: 'server_error' });
  }
});

// Delete station and remove image from GridFS if present
app.delete('/api/stations/:id', verifyToken, requireAdmin, async (req, res) => {
  try {
    const id = req.params.id;
    const station = await Station.findById(id).exec();
    if (!station) return res.status(404).json({ ok: false, error: 'not_found' });
    // if image stored as /api/uploads/<fileId>, extract and delete from GridFS
    if (station.image && station.image.startsWith('/api/uploads/')) {
      const fileId = station.image.split('/').pop();
      try {
        if (mongoose.connection && mongoose.connection.db) {
          const bucket = new mongoose.mongo.GridFSBucket(mongoose.connection.db, { bucketName: 'uploads' });
          await bucket.delete(new mongoose.Types.ObjectId(fileId));
        }
      } catch (e) {
        console.error('GridFS delete warning', e.message || e);
      }
    }
    await Station.deleteOne({ _id: id }).exec();
    return res.json({ ok: true });
  } catch (err) {
    console.error('Station delete error', err);
    return res.status(500).json({ ok: false, error: 'server_error' });
  }
});

// Serve images stored in GridFS: /api/uploads/:id
app.get('/api/uploads/:id', async (req, res) => {
  try {
    const id = req.params.id;
    if (!id) return res.status(400).end();
    if (!mongoose.connection || !mongoose.connection.db) return res.status(500).end();
    const bucket = new mongoose.mongo.GridFSBucket(mongoose.connection.db, { bucketName: 'uploads' });
    const _id = new mongoose.Types.ObjectId(id);
    const download = bucket.openDownloadStream(_id);
    download.on('error', (err) => { res.status(404).end(); });
    download.pipe(res);
  } catch (err) {
    console.error('GridFS serve error', err);
    return res.status(500).end();
  }
});

app.get('/', (req, res) => res.json({ ok: true, message: 'CarsPlay Auth Service' }));

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Server listening on port ${port}`));
