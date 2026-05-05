const express = require('express');
const router = express.Router();
const Station = require('../models/Station');


const liveTrainCache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

async function getLiveBoardCached(stationCode) {
  const now = Date.now();
  if (liveTrainCache.has(stationCode)) {
    const cached = liveTrainCache.get(stationCode);
    if (now - cached.timestamp < CACHE_TTL_MS) {
      console.log(`[TRAIN MATCH] 🟢 Using cached live board for ${stationCode}`);
      return cached.data;
    }
  }

  const RAIL_RADAR_API = 'https://api.railradar.org';
  const apiKey = process.env.TRAIN_API;

  if (!apiKey) {
    throw new Error('TRAIN_API key is not configured');
  }

  const url = `${RAIL_RADAR_API}/api/v1/stations/${stationCode}/live?hours=4`;
  console.log(`[TRAIN MATCH] 🚉 Fetching live board for ${stationCode} → ${url}`);

  const response = await fetch(url, {
    headers: {
      'X-API-Key': apiKey,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`RailRadar API returned ${response.status}`);
  }

  const json = await response.json();
  const board = json.data ?? json;
  
  const trains = (board.trains || []).map((entry) => ({
    trainNumber: entry.train?.number,
    trainName: entry.train?.name,
    expectedDeparture: entry.live?.expectedDeparture || entry.schedule?.departure,
    status: entry.status || {},
  }));

  liveTrainCache.set(stationCode, { timestamp: now, data: trains });
  return trains;
}

/**
 * POST /api/trains/match
 * Body: { locations: [{ lat, lng, speed, heading, timestamp }] }
 */
router.post('/match', async (req, res) => {
  try {
    const { locations } = req.body;
    
    if (!locations || locations.length === 0) {
      return res.status(400).json({ success: false, message: 'No locations provided' });
    }

    // Sort locations by timestamp (earliest first)
    locations.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    
    const startPoint = locations[0];
    
    // Find nearest station to the starting point
    const stations = await Station.find({
      location: {
        $nearSphere: {
          $geometry: {
            type: 'Point',
            coordinates: [startPoint.lng, startPoint.lat],
          },
          $maxDistance: 5000,
        },
      },
    }).limit(1);

    if (stations.length === 0) {
      return res.json({ success: false, message: 'No nearby station found at origin.' });
    }

    const nearestStation = stations[0];
    let matchedTrain = null;
    let trains = [];
    
    try {
      trains = await getLiveBoardCached(nearestStation.stationCode);
      
      const startTime = new Date(startPoint.timestamp);
      
      // Basic matching algorithm: find train departing around start time
      // We look for trains that departed within +/- 30 minutes of our start point timestamp
      for (const train of trains) {
        if (train.expectedDeparture) {
          // Parse expectedDeparture (format usually "HH:MM")
          // This is a simplified parse, assuming today's date
          const [hours, minutes] = train.expectedDeparture.split(':').map(Number);
          const expectedTime = new Date(startTime);
          expectedTime.setHours(hours, minutes, 0, 0);
          
          const diffMinutes = Math.abs((startTime - expectedTime) / (1000 * 60));
          
          // Match if within 30 mins and not cancelled
          if (diffMinutes <= 30 && !train.status.isCancelled) {
            matchedTrain = train;
            break;
          }
        }
      }
    } catch (apiErr) {
      console.warn('[TRAIN MATCH] API Error:', apiErr.message);
    }

    return res.json({
      success: true,
      departureStation: nearestStation.stationName,
      matchedTrain: matchedTrain ? {
        trainNumber: matchedTrain.trainNumber,
        trainName: matchedTrain.trainName
      } : null,
    });
  } catch (error) {
    console.error('[TRAIN MATCH ERROR]', error.message);
    return res.status(500).json({ success: false, message: 'Server error matching train.' });
  }
});

module.exports = router;
