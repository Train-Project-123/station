require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');

const stationRoutes = require('./routes/stations');

const app = express();
const PORT = process.env.PORT || 5000;
const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/railway_station_finder';

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());

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
mongoose
  .connect(MONGO_URI)
  .then(() => {
    console.log('[DB] ✅ MongoDB connected:', MONGO_URI);
    app.listen(PORT, () => {
      console.log(`[SERVER] 🚀 Running on http://localhost:${PORT}`);
      console.log(`[API]    GET http://localhost:${PORT}/api/stations/nearby?lat=11.152122&lng=75.893304&radius=5000`);
    });
  })
  .catch((err) => {
    console.error('[DB] ❌ MongoDB connection failed:', err.message);
    process.exit(1);
  });

mongoose.connection.on('disconnected', () => {
  console.warn('[DB] ⚠️  MongoDB disconnected.');
});

process.on('SIGINT', async () => {
  await mongoose.connection.close();
  console.log('[DB] MongoDB connection closed. Exiting...');
  process.exit(0);
});
