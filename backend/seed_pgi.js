/**
 * Seed Script — Adds Parappanangadi (PGI) station to MongoDB
 * Safe to run on production: does NOT delete existing stations.
 * Uses upsert on stationCode to avoid duplicates on re-runs.
 *
 * Run: node seed_pgi.js
 */

require('dotenv').config();
const mongoose = require('mongoose');
const Station = require('./models/Station');

const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/railway_station_finder';

const pgiStation = {
  stationName: 'Parappanangadi',
  stationCode: 'PGI',
  zone: 'Southern Railway',
  division: 'Shoranur',
  state: 'Kerala',
  location: {
    type: 'Point',
    coordinates: [75.86042, 11.04693], // [longitude, latitude] — GeoJSON
  },
};

async function seed() {
  try {
    await mongoose.connect(MONGO_URI);
    console.log('[SEED] ✅ Connected to MongoDB');

    // Upsert — inserts if not present, updates if already there (safe for re-runs)
    const result = await Station.findOneAndUpdate(
      { stationCode: pgiStation.stationCode },
      pgiStation,
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    console.log(`[SEED] 🌱 Upserted: ${result.stationName} (${result.stationCode}) @ [${result.location.coordinates}]`);

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
