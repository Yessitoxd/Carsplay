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

// Lightweight ping endpoint for keep-alive / health checks
app.get('/api/ping', (req, res) => {
  try {
    return res.json({ ok: true, time: new Date().toISOString() });
  } catch (e) {
    return res.status(500).json({ ok: false });
  }
});

// Health endpoint for uptime monitors (UptimeRobot, etc.)
// Returns simple JSON and HTTP 200 when service is up. Includes DB connection state.
app.get('/health', (req, res) => {
  try {
    const dbState = (mongoose && mongoose.connection) ? mongoose.connection.readyState : 0;
    // mongoose readyState: 0 = disconnected, 1 = connected, 2 = connecting, 3 = disconnecting
    const dbConnected = dbState === 1;
    // Log health checks (timestamp, client IP, ua, dbState)
    try {
      const ip = req.headers['x-forwarded-for'] || req.socket && req.socket.remoteAddress || req.ip || 'unknown';
      const ua = req.headers['user-agent'] || 'unknown';
      console.log(`[health] ${new Date().toISOString()} ip=${ip} dbState=${dbState} ua="${String(ua).replace(/\"/g,'') }"`);
    } catch (e) { /* ignore logging errors */ }
    if (!dbConnected) {
      // Return 503 to indicate degraded state (DB required)
      return res.status(503).json({ ok: false, time: new Date().toISOString(), dbConnected, dbState, error: 'db_not_connected' });
    }
    return res.status(200).json({ ok: true, time: new Date().toISOString(), dbConnected, dbState });
  } catch (e) {
    console.error('health check failed', e && e.stack || e);
    return res.status(500).json({ ok: false, error: 'health_check_failed' });
  }
});

// Generate XLSX report using template 'Reporte Plantilla.xlsx'
app.get('/api/time/report.xlsx', async (req, res) => {
  try {
    let ExcelJS = null;
    try {
      ExcelJS = require('exceljs');
    } catch (e) {
      console.error('exceljs module not available:', e && e.message);
      return res.status(500).json({ ok: false, error: 'exceljs_missing', message: 'La dependencia exceljs no está instalada en el servidor. Por favor redeploy con package.json actualizado.' });
    }
    const q = req.query || {};
    // parse start/end as in logs endpoint
    let startDate = q.start ? new Date(q.start) : null;
    let endDate = q.end ? new Date(q.end) : null;
    if (!startDate) {
      const now = new Date(); startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0,0,0,0);
    }
    if (!endDate) {
      const now = new Date(); endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23,59,59,999);
    }
    // build filter
    const filter = { start: { $gte: startDate, $lte: endDate } };
    if (q.stationId) filter.stationId = q.stationId;
    if (q.stationNumber) filter.stationNumber = Number(q.stationNumber);

    // fetch logs sorted by start (order of use)
    const logs = (mongoose.connection && mongoose.connection.readyState === 1)
      ? await TimeLog.find(filter).sort({ start: 1 }).exec()
      : (IN_MEMORY_LOGS || []).filter(l => {
        const t = new Date(l.start).getTime();
        if (t < startDate.getTime() || t > endDate.getTime()) return false;
        if (q.stationId && String(l.stationId) !== String(q.stationId)) return false;
        if (q.stationNumber && Number(l.stationNumber) !== Number(q.stationNumber)) return false;
        return true;
      }).sort((a,b)=>new Date(a.start)-new Date(b.start));

    // load template
    const tplPath = path.join(__dirname, 'Reporte Plantilla.xlsx');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(tplPath);
    const ws = wb.worksheets[0];

    // expose Content-Disposition header for CORS so frontends can read filename
    try { res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition'); } catch(e){}

    // timezone offset (minutes) sent by client; used to format dates/times in user's local zone
    const tzOffset = q.tzOffset ? Number(q.tzOffset) : null;

    // Build report title in H4: single date or range
    const fmtDate = (d) => {
      const dd = String(d.getDate()).padStart(2,'0');
      const mm = String(d.getMonth()+1).padStart(2,'0');
      const yyyy = d.getFullYear();
      return `${dd}-${mm}-${yyyy}`;
    };
    // Prefer explicit human-friendly labels sent by the client (to avoid UTC shifts)
    const labelStart = q.labelStart ? String(q.labelStart) : null;
    const labelEnd = q.labelEnd ? String(q.labelEnd) : null;
    const sLocal = new Date(startDate);
    const eLocal = new Date(endDate);
    const computedStart = fmtDate(sLocal);
    const computedEnd = fmtDate(eLocal);
    const title = (labelStart && labelEnd)
      ? (labelStart === labelEnd ? labelStart : `${labelStart} al ${labelEnd}`)
      : (computedStart === computedEnd ? computedStart : `${computedStart} al ${computedEnd}`);
    // write title to H4 (column 8 row 4)
    ws.getCell('H4').value = title;
    try { ws.getCell('H4').font = { bold: true }; } catch(e){}

    // compute totals
    let totalAmount = 0; let totalSeconds = 0; let totalsCount = 0; let rowIdx = 13; // headers are at row 12
    for (const r of logs){
      const start = new Date(r.start);
      const end = new Date(r.end);
      const duration = r.duration !== undefined ? Number(r.duration) : Math.max(0, Math.floor((end.getTime()-start.getTime())/1000));
      totalAmount += Number(r.amount) || 0;
      totalSeconds += duration;
      totalsCount += 1;
      // columns B..I => B date, C empleado, D estación, E dinero, F tiempo, G inicio, H fin, I comentario
      // adjust to client's local time if tzOffset provided
      let adjStart = start;
      let adjEnd = end;
      if (typeof tzOffset === 'number') {
        try { adjStart = new Date(start.getTime() - (tzOffset * 60000)); } catch(e){}
        try { adjEnd = new Date(end.getTime() - (tzOffset * 60000)); } catch(e){}
      }
      const dateStr = adjStart ? `${String(adjStart.getDate()).padStart(2,'0')}-${String(adjStart.getMonth()+1).padStart(2,'0')}-${adjStart.getFullYear()}` : '';
      const emp = r.username || '';
      const est = r.stationName ? (r.stationName + (r.stationNumber ? ' #' + r.stationNumber : '')) : (r.stationNumber ? ('#'+r.stationNumber) : '');
      const money = Number(r.amount) || 0;
      // format time per rule: if <60 minutes show minutes, else H h M m
      const mins = Math.floor(duration/60);
      let timeLabel = '';
      if (mins < 60) timeLabel = `${mins} m`; else { const h = Math.floor(mins/60); const m = mins%60; timeLabel = `${h} h` + (m ? ` ${m} m` : ''); }
      const startTime = adjStart.toTimeString ? adjStart.toTimeString().split(' ')[0] : (adjStart.toLocaleTimeString ? adjStart.toLocaleTimeString('en-GB') : '');
      const endTime = adjEnd.toTimeString ? adjEnd.toTimeString().split(' ')[0] : (adjEnd.toLocaleTimeString ? adjEnd.toLocaleTimeString('en-GB') : '');
      const comment = r.comment || '';

      ws.getCell('B' + rowIdx).value = dateStr;
      ws.getCell('C' + rowIdx).value = emp;
      ws.getCell('D' + rowIdx).value = est;
      ws.getCell('E' + rowIdx).value = money;
      try { ws.getCell('E' + rowIdx).numFmt = '#,##0.00'; } catch(e){}
      ws.getCell('F' + rowIdx).value = timeLabel;
      ws.getCell('G' + rowIdx).value = startTime;
      ws.getCell('H' + rowIdx).value = endTime;
      ws.getCell('I' + rowIdx).value = comment;
      rowIdx++;
    }

    // After the detailed rows, add a horizontal summary row under the same columns
    // (Estación -> D, Dinero -> E, Tiempo -> F)
    try {
      const summaryRow = rowIdx + 1; // leave one empty row after data for visual separation
      // D -> total uses (e.g. "12 vueltas")
      ws.getCell('D' + summaryRow).value = `${totalsCount} vueltas`;
      // E -> total amount (numeric)
      ws.getCell('E' + summaryRow).value = totalAmount;
      try { ws.getCell('E' + summaryRow).numFmt = '#,##0.00'; } catch(e){}
      // F -> total time formatted (text)
      const totalMins2 = Math.floor(totalSeconds/60);
      let totTimeLabel2 = '';
      if (totalMins2 < 60) totTimeLabel2 = `${totalMins2} m`; else { const h2 = Math.floor(totalMins2/60); const m2 = totalMins2%60; totTimeLabel2 = `${h2} h` + (m2 ? ` ${m2} m` : ''); }
      ws.getCell('F' + summaryRow).value = totTimeLabel2;
      // style summary row cells as bold for visibility
      try {
        ws.getCell('D' + summaryRow).font = { bold: true };
        ws.getCell('E' + summaryRow).font = { bold: true };
        ws.getCell('F' + summaryRow).font = { bold: true };
      } catch(e){}
    } catch (e) {
      console.warn('Could not write summary row to XLSX', e && e.message);
    }

    // write totals: put label in F7 and numeric amount in G7 (as template expects)
    try { ws.getCell('F7').value = 'Ganancias'; ws.getCell('F7').font = { bold: true }; } catch(e){}
    ws.getCell('G7').value = totalAmount;
    try { ws.getCell('G7').numFmt = '#,##0.00'; ws.getCell('G7').font = { bold: true }; } catch(e){}

    // write totals time into H7 (so it isn't overwriting the F7 label); keep it human-readable
    const totalMins = Math.floor(totalSeconds/60);
    let totTimeLabel = '';
    if (totalMins < 60) totTimeLabel = `${totalMins} m`; else { const h = Math.floor(totalMins/60); const m = totalMins%60; totTimeLabel = `${h} h` + (m ? ` ${m} m` : ''); }
    try { ws.getCell('H7').value = totTimeLabel; ws.getCell('H7').font = { bold: true }; } catch(e){}

    // Also write the report title into F4 and H4 to be robust if template uses either cell
    try { ws.getCell('F4').value = title; ws.getCell('F4').font = { bold: true }; } catch(e){}
    try { ws.getCell('H4').value = title; ws.getCell('H4').font = { bold: true }; } catch(e){}

    // send workbook as attachment
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    // Build filename using labels if provided to match user's local selection
    const fname = (labelStart && labelEnd)
      ? (labelStart === labelEnd ? `Reporte del ${labelStart}.xlsx` : `Reportes del ${labelStart} al ${labelEnd}.xlsx`)
      : (computedStart === computedEnd ? `Reporte del ${computedStart}.xlsx` : `Reportes del ${computedStart} al ${computedEnd}.xlsx`);
    // Set Content-Disposition with UTF-8 filename* plus fallback filename
    try {
      res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(fname)}; filename="${fname.replace(/"/g,'') }"`);
    } catch (e) {
      res.setHeader('Content-Disposition', `attachment; filename="${fname.replace(/\s+/g,'_')}"`);
    }
    await wb.xlsx.write(res);
    res.end();
  } catch (e) {
    console.error('Generate XLSX error', e);
    return res.status(500).json({ ok: false, error: 'report_generation_failed' });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Server listening on port ${port}`));
