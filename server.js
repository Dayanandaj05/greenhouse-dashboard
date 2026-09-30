require('dotenv').config();
const express = require('express');
const mysql = require('mysql2/promise');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  timezone: 'Z',
  decimalNumbers: true,
});

const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);

// Optional shared passcode for write operations (set WRITE_KEY in .env to enable)
function requireKey(req, res, next) {
  const key = process.env.WRITE_KEY;
  if (!key || req.get('x-write-key') === key) return next();
  res.status(401).json({ error: 'Invalid or missing community passcode' });
}

function validate(b) {
  const errors = [];
  const bed_id = Number.parseInt(b.bed_id, 10);
  if (!Number.isInteger(bed_id)) errors.push('bed_id is required');
  const chk = (name, min, max) => {
    const v = b[name];
    const n = Number(v);
    if (v === undefined || v === null || v === '' || !Number.isFinite(n) || n < min || n > max) {
      errors.push(`${name} must be a number between ${min} and ${max}`);
      return null;
    }
    return n;
  };
  const soil_moisture = chk('soil_moisture', 0, 100);
  const temperature = chk('temperature', -10, 60);
  const humidity = chk('humidity', 0, 100);
  let recorded_at = null;
  if (b.recorded_at) {
    const d = new Date(b.recorded_at);
    if (isNaN(d)) errors.push('recorded_at is not a valid date'); else recorded_at = d;
  }
  const notes = b.notes ? String(b.notes).slice(0, 255) : null;
  const source = b.source === 'sensor' ? 'sensor' : 'manual';
  return { errors, data: { bed_id, soil_moisture, temperature, humidity, recorded_at, notes, source } };
}

// ---------- Health ----------
app.get('/api/health', wrap(async (req, res) => {
  await pool.query('SELECT 1');
  res.json({ status: 'ok', time: new Date().toISOString() });
}));

// ---------- Beds ----------
app.get('/api/beds', wrap(async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM beds ORDER BY id');
  res.json(rows);
}));

app.post('/api/beds', requireKey, wrap(async (req, res) => {
  const { name, location, crop } = req.body;
  if (!name || !location || !crop) return res.status(400).json({ error: 'name, location and crop are required' });
  const [r] = await pool.query('INSERT INTO beds (name, location, crop) VALUES (?,?,?)', [name, location, crop]);
  const [rows] = await pool.query('SELECT * FROM beds WHERE id=?', [r.insertId]);
  res.status(201).json(rows[0]);
}));

// ---------- Readings: READ ----------
app.get('/api/readings/latest', wrap(async (req, res) => {
  const [rows] = await pool.query(`
    SELECT b.id AS bed_id, b.name AS bed_name, b.location, b.crop,
           r.id, r.soil_moisture, r.temperature, r.humidity, r.source, r.recorded_at
    FROM beds b
    LEFT JOIN readings r ON r.id = (
      SELECT id FROM readings WHERE bed_id = b.id ORDER BY recorded_at DESC, id DESC LIMIT 1
    )
    ORDER BY b.id`);
  res.json(rows);
}));

app.get('/api/readings', wrap(async (req, res) => {
  const where = [], params = [];
  if (req.query.bed_id) { where.push('r.bed_id = ?'); params.push(Number(req.query.bed_id)); }
  if (['sensor', 'manual'].includes(req.query.source)) { where.push('r.source = ?'); params.push(req.query.source); }
  const limit = Math.min(parseInt(req.query.limit, 10) || 50, 500);
  const [rows] = await pool.query(
    `SELECT r.*, b.name AS bed_name FROM readings r JOIN beds b ON b.id = r.bed_id
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY r.recorded_at DESC, r.id DESC LIMIT ?`,
    [...params, limit]);
  res.json(rows);
}));

// ---------- Readings: CREATE ----------
app.post('/api/readings', requireKey, wrap(async (req, res) => {
  const { errors, data } = validate(req.body);
  if (errors.length) return res.status(400).json({ errors });
  const [r] = await pool.query(
    `INSERT INTO readings (bed_id, soil_moisture, temperature, humidity, source, notes, recorded_at)
     VALUES (?,?,?,?,?,?,?)`,
    [data.bed_id, data.soil_moisture, data.temperature, data.humidity, data.source, data.notes, data.recorded_at || new Date()]);
  const [rows] = await pool.query(
    'SELECT r.*, b.name AS bed_name FROM readings r JOIN beds b ON b.id=r.bed_id WHERE r.id=?', [r.insertId]);
  res.status(201).json(rows[0]);
}));

// ---------- Readings: UPDATE ----------
app.put('/api/readings/:id', requireKey, wrap(async (req, res) => {
  const { errors, data } = validate(req.body);
  if (errors.length) return res.status(400).json({ errors });
  const [r] = await pool.query(
    `UPDATE readings SET bed_id=?, soil_moisture=?, temperature=?, humidity=?, notes=?,
     recorded_at=COALESCE(?, recorded_at) WHERE id=?`,
    [data.bed_id, data.soil_moisture, data.temperature, data.humidity, data.notes, data.recorded_at, req.params.id]);
  if (!r.affectedRows) return res.status(404).json({ error: 'Reading not found' });
  const [rows] = await pool.query(
    'SELECT r.*, b.name AS bed_name FROM readings r JOIN beds b ON b.id=r.bed_id WHERE r.id=?', [req.params.id]);
  res.json(rows[0]);
}));

// ---------- Readings: DELETE ----------
app.delete('/api/readings/:id', requireKey, wrap(async (req, res) => {
  const [r] = await pool.query('DELETE FROM readings WHERE id=?', [req.params.id]);
  if (!r.affectedRows) return res.status(404).json({ error: 'Reading not found' });
  res.json({ deleted: Number(req.params.id) });
}));

// ---------- Errors ----------
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));
app.use((err, req, res, next) => {
  console.error(err);
  if (err.code === 'ER_NO_REFERENCED_ROW_2') return res.status(400).json({ error: 'Unknown bed_id' });
  res.status(500).json({ error: 'Internal server error' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Greenhouse dashboard running on port ${PORT}`));
