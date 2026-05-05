const dotenvResult = require('dotenv').config();
if (dotenvResult.error) {
  console.error('[ENV] ❌ Failed to load .env file. Check if .env exists in backend root.');
} else {
  console.log('[ENV] ✅ .env file loaded successfully');
}
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');

const stationRoutes = require('./routes/stations');
const trainRoutes = require('./routes/trains');
const historyRoutes = require('./routes/history');

const app = express();
const PORT = process.env.PORT || 5000;
const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/railway_station_finder';

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());

// Request Logger
app.use((req, res, next) => {
  console.log(`[${new Date().toLocaleTimeString()}] ${req.method} ${req.url}`);
  next();
});

// ─── Health Check ─────────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
  });
});

// ─── Routes ───────────────────────────────────────────────────────────────────
app.use('/api/stations', stationRoutes);
app.use('/api/trains', trainRoutes);
app.use('/api/history', historyRoutes);

// ─── 404 Handler ──────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ success: false, message: `Route ${req.path} not found.` });
});

// ─── Error Handler ────────────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('[SERVER ERROR]', err.message);
  res.status(500).json({ success: false, message: 'Internal server error.' });
});

// ─── MongoDB Connection ───────────────────────────────────────────────────────
const connectDB = async () => {
  try {
    await mongoose.connect(MONGO_URI);
    console.log('[DB] ✅ MongoDB connected');
  } catch (err) {
    console.error('[DB] ❌ Connection failed:', err.message);
    setTimeout(connectDB, 5000); // Retry every 5s
  }
};

connectDB();

mongoose.connection.on('disconnected', () => {
  console.warn('[DB] ⚠️ Disconnected. Attempting reconnect...');
  connectDB();
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[SERVER] 🚀 Running on port ${PORT} (Network Accessible)`);
});

process.on('SIGINT', async () => {
  await mongoose.connection.close();
  console.log('[DB] Connection closed. Exiting...');
  process.exit(0);
});
