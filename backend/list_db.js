/**
 * List Script — Directly lists all stations in MongoDB
 * Run: node list_db.js
 */

require('dotenv').config();
const mongoose = require('mongoose');
const Station = require('./models/Station');

const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/railway_station_finder';

async function list() {
  try {
    await mongoose.connect(MONGO_URI);
    console.log('[DB] ✅ Connected');

    const stations = await Station.find().sort({ stationName: 1 });
    console.log(`[DB] Current Station Count: ${stations.length}`);
    
    stations.forEach((s, idx) => {
      console.log(`${idx + 1}. ${s.stationName} (${s.stationCode}) - ${s.state}`);
    });

  } catch (err) {
    console.error('[DB] ❌ Error:', err.message);
  } finally {
    await mongoose.connection.close();
    process.exit(0);
  }
}

list();
