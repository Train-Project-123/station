const express = require('express');
const router = express.Router();
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

const RAIL_RADAR_API = 'https://api.railradar.org';
const MATCH_CACHE_TTL = 90 * 1000; // 90 seconds for high-precision matching
const API_TIMEOUT_MS = 8000;

// stationCode -> { data, timestamp }
const liveBoardCache = new Map();

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), API_TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    return res;
  } finally {
    clearTimeout(id);
  }
}

async function getLiveBoardCached(stationCode, apiKey) {
  const cached = liveBoardCache.get(stationCode);
  if (cached && (Date.now() - cached.timestamp < MATCH_CACHE_TTL)) {
    return cached.data;
  }

  try {
    // 🔴 FIX: Added missing apiKey to query param
    const url = `${RAIL_RADAR_API}/api/v1/stations/${stationCode}/live?hours=4&apiKey=${apiKey}`;
    const res = await fetchWithTimeout(url, {
      headers: { 'X-API-Key': apiKey, 'Accept': 'application/json' }
    });
    if (!res.ok) return null;
    
    const json = await res.json();
    const data = json.data || json;
    const trains = data.trains || (Array.isArray(data) ? data : []);
    
    // Normalize response for matching
    const normalized = trains.map(t => ({
      number: t.train?.number || t.trainNumber || t.number,
      name: t.train?.name || t.trainName || t.name,
      expectedDeparture: t.expectedDeparture || t.scheduledDeparture || t.live?.expectedDeparture,
      status: {
        hasArrived: !!(t.live?.hasArrived || t.actualArrival),
        hasDeparted: !!(t.live?.hasDeparted || t.actualDeparture),
        isCancelled: !!t.isCancelled
      }
    }));

    liveBoardCache.set(stationCode, { data: normalized, timestamp: Date.now() });
    return normalized;
  } catch (e) {
    console.error(`[MATCH] Live board fetch failed: ${e.message}`);
    return null;
  }
}

function matchTrainByScore(trains, startTime, userSpeed, heading) {
  const candidates = [];
  const startTs = new Date(startTime).getTime();

  for (const train of trains) {
    if (!train.expectedDeparture || train.status.isCancelled) continue;

    // Parse HH:MM
    const [h, m] = train.expectedDeparture.split(':').map(Number);
    const expectedDate = new Date(startTs);
    expectedDate.setHours(h, m, 0, 0);
    
    // Handle midnight wrap
    let diffMinutes = Math.abs((startTs - expectedDate.getTime()) / 60000);
    if (diffMinutes > 720) { // If > 12h diff, try adjusting day
       expectedDate.setDate(expectedDate.getDate() + (startTs > expectedDate.getTime() ? 1 : -1));
       diffMinutes = Math.abs((startTs - expectedDate.getTime()) / 60000);
    }

    // ── SCORING ALGORITHM ────────────────────────────────────────────────────
    let score = 0;
    
    // 1. Time Proximity (Max 50)
    if (diffMinutes <= 10) score += 50;
    else if (diffMinutes <= 20) score += 30;
    else if (diffMinutes <= 30) score += 10;
    else continue; // Too far from departure time

    // 2. Station Status (Max 30)
    // Most likely to board when train is AT station
    if (train.status.hasArrived && !train.status.hasDeparted) score += 30;
    // Also possible just after departure or just before arrival
    else if (!train.status.hasArrived) score += 10;

    // 3. Reliability (Max 10)
    if (!train.status.isCancelled) score += 10;

    // 4. Motion Hint (Future: heading/speed comparison could add +20)

    candidates.push({ train, score, diffMinutes });
  }

  candidates.sort((a, b) => b.score - a.score);
  
  if (candidates.length > 0 && candidates[0].score >= 40) {
    return candidates[0].train;
  }
  return null;
}

/**
 * POST /api/trains/match
 * Payload: { locations: [{lat, lng, speed, timestamp, heading}, ...], stationCode }
 */
router.post('/match', async (req, res) => {
  const { locations, stationCode } = req.body;
  const apiKey = process.env.TRAIN_API;

  if (!locations || !locations.length || !stationCode) {
    return res.status(400).json({ success: false, message: 'Missing tracking data or stationCode' });
  }

  try {
    const trains = await getLiveBoardCached(stationCode, apiKey);
    if (!trains || !trains.length) {
      return res.json({ success: false, message: 'No trains found at station' });
    }

    // Boarding usually starts at the first location where speed becomes significant
    const boardingEvent = locations.find(loc => loc.speed > 2); // > 7km/h
    const startTime = boardingEvent ? boardingEvent.timestamp : locations[0].timestamp;
    const avgSpeed = locations.reduce((sum, l) => sum + l.speed, 0) / locations.length;
    const lastHeading = locations[locations.length - 1].heading;

    const matched = matchTrainByScore(trains, startTime, avgSpeed, lastHeading);

    if (matched) {
      res.json({
        success: true,
        match: {
          trainNumber: matched.number,
          trainName: matched.name,
          confidence: 'high',
          detectedAt: new Date(startTime).toISOString()
        }
      });
    } else {
      res.json({ success: false, message: 'No confident match' });
    }
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

module.exports = router;
