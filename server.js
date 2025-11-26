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
const mongoose = require('mongoose');
app.use(cors());
app.use(express.json());

// configure multer to use memory storage — we'll push files into GridFS
const upload = multer({ storage: multer.memoryStorage() });

// note: we previously served /uploads from disk; switching to GridFS will serve via `/api/uploads/:id`

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
    if (existing) return res.status(409).json({ ok: false, error: 'number_taken' });

    const station = new Station({ name, number, image: imageUrl });
    await station.save();
    return res.status(201).json(station);
  } catch (err) {
    console.error('Stations create error', err);
    return res.status(500).json({ ok: false, error: 'server_error' });
  }
});

// Update station (number or replace image via multipart)
app.put('/api/stations/:id', upload.single('image'), async (req, res) => {
  try {
    const id = req.params.id;
    const number = req.body.number ? Number(req.body.number) : undefined;
    // if number provided, ensure uniqueness among others
    if (number !== undefined) {
      const clash = await Station.findOne({ number, _id: { $ne: id } }).exec();
      if (clash) return res.status(409).json({ ok: false, error: 'number_taken' });
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
app.delete('/api/stations/:id', async (req, res) => {
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
