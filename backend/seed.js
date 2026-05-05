/**
 * Seed Script — Inserts Kakkanchery station into MongoDB
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
    location: {
      type: 'Point',
      coordinates: [75.893304, 11.152122], // [longitude, latitude] — GeoJSON
    },
  },
];

async function seed() {
  try {
    await mongoose.connect(MONGO_URI);
    console.log('[SEED] ✅ Connected to MongoDB');

    console.log('[SEED] ✅ Connected to MongoDB');

    // Safe Seed: Use upsert instead of deleteMany to preserve user data
    for (const s of stations) {
      await Station.findOneAndUpdate(
        { stationCode: s.stationCode },
        s,
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
    }
    console.log(`[SEED] 🌱 Upserted ${stations.length} station(s)`);
    console.log(`[SEED] 🌱 Upserted ${stations.length} station(s) successfully.`);

    // Verify 2dsphere index
    const indexes = await Station.collection.indexes();
    const geoIndex = indexes.find((i) => i.key && i.key.location === '2dsphere');
    if (geoIndex) {
      console.log('[SEED] 📍 2dsphere index confirmed:', geoIndex.name);
    } else {
      console.warn('[SEED] ⚠️  2dsphere index NOT found — ensure model is initialized first');
    }

    console.log('[SEED] ✅ Seeding complete!');
  } catch (err) {
    console.error('[SEED] ❌ Error:', err.message);
  } finally {
    await mongoose.connection.close();
    process.exit(0);
  }
}

seed();
