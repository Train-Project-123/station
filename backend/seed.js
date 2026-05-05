/**
 * Seed Script — Restores common Kerala stations
 * Run: node seed.js
 */

require('dotenv').config();
const mongoose = require('mongoose');
const Station = require('./models/Station');

const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/railway_station_finder';

const stations = [
  {
    stationName: 'Kakkanchery',
    stationCode: 'KAKJ',
    zone: 'Southern Railway',
    division: 'Palakkad',
    state: 'Kerala',
    location: { type: 'Point', coordinates: [75.893304, 11.152122] },
  },
  {
    stationName: 'Ernakulam Junction',
    stationCode: 'ERS',
    zone: 'Southern Railway',
    division: 'Thiruvananthapuram',
    state: 'Kerala',
    location: { type: 'Point', coordinates: [76.2882, 9.9658] },
  },
  {
    stationName: 'Ernakulam Town',
    stationCode: 'ERN',
    zone: 'Southern Railway',
    division: 'Thiruvananthapuram',
    state: 'Kerala',
    location: { type: 'Point', coordinates: [76.2894, 9.9917] },
  },
  {
    stationName: 'Shoranur Junction',
    stationCode: 'SRR',
    zone: 'Southern Railway',
    division: 'Palakkad',
    state: 'Kerala',
    location: { type: 'Point', coordinates: [76.2711, 10.7621] },
  },
  {
    stationName: 'Pattambi',
    stationCode: 'PTB',
    zone: 'Southern Railway',
    division: 'Palakkad',
    state: 'Kerala',
    location: { type: 'Point', coordinates: [76.1953, 10.8122] },
  },
  {
    stationName: 'Trivandrum Central',
    stationCode: 'TVC',
    zone: 'Southern Railway',
    division: 'Thiruvananthapuram',
    state: 'Kerala',
    location: { type: 'Point', coordinates: [76.9500, 8.4875] },
  },
  {
    stationName: 'Thrissur',
    stationCode: 'TCR',
    zone: 'Southern Railway',
    division: 'Thiruvananthapuram',
    state: 'Kerala',
    location: { type: 'Point', coordinates: [76.2084, 10.5190] },
  },
  {
    stationName: 'Kozhikode',
    stationCode: 'CLT',
    zone: 'Southern Railway',
    division: 'Palakkad',
    state: 'Kerala',
    location: { type: 'Point', coordinates: [75.7891, 11.2485] },
  }
];

async function seed() {
  try {
    await mongoose.connect(MONGO_URI);
    console.log('[SEED] ✅ Connected to MongoDB');

    for (const s of stations) {
      await Station.findOneAndUpdate(
        { stationCode: s.stationCode },
        s,
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
    }
    
    console.log(`[SEED] 🌱 Successfully upserted ${stations.length} stations.`);
  } catch (err) {
    console.error('[SEED] ❌ Error:', err.message);
  } finally {
    await mongoose.connection.close();
    process.exit(0);
  }
}

seed();
