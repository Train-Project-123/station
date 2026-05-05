const express = require('express');
const router = express.Router();
const Station = require('../models/Station');
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

// ─── CONFIG & CACHE ──────────────────────────────────────────────────────────
const STATION_CACHE_MAX_AGE = 12 * 60 * 60 * 1000; // 12 hours
const TRAIN_DETAIL_TTL = 120000; // 2 minutes
const API_TIMEOUT_MS = 8000; // 8 seconds

// stationCode -> { numbers: Set, lastUpdated: timestamp }
const stationTrainCache = new Map(); 
const trainNameCache = new Map();    
const trainDetailCache = new Map(); // trainNumber -> { data, timestamp }

// Periodic Cache Cleanup
setInterval(() => {
  const now = Date.now();
  for (const [code, entry] of stationTrainCache.entries()) {
    if (now - entry.lastUpdated > STATION_CACHE_MAX_AGE) {
      stationTrainCache.delete(code);
      console.log(`[CACHE] Cleared stale station cache for ${code}`);
    }
  }
  for (const [num, entry] of trainDetailCache.entries()) {
    if (now - entry.timestamp > TRAIN_DETAIL_TTL * 5) {
      trainDetailCache.delete(num);
    }
  }
}, 60 * 60 * 1000); // Hourly cleanup

// ─── HELPERS ─────────────────────────────────────────────────────────────────

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

function mergeTrainNumbers(stationCode, liveNumbers) {
  if (!stationTrainCache.has(stationCode)) {
    stationTrainCache.set(stationCode, { numbers: new Set(), lastUpdated: Date.now() });
  }
  const entry = stationTrainCache.get(stationCode);
  entry.lastUpdated = Date.now();
  liveNumbers.forEach(num => entry.numbers.add(num));
  
  const arr = Array.from(entry.numbers);
  if (arr.length > 50) {
    const fresh = new Set(arr.slice(-50));
    stationTrainCache.set(stationCode, { numbers: fresh, lastUpdated: Date.now() });
    return arr.slice(-50);
  }
  return arr;
}

async function fetchTrainLiveDetails(trainNumber, apiKey) {
  const now = new Date();
  const datesToTry = [
    now.toISOString().split('T')[0], // Today
    new Date(now.getTime() - 86400000).toISOString().split('T')[0] // Yesterday
  ];

  for (const date of datesToTry) {
    try {
      const url = `https://api.railradar.org/api/v1/trains/${encodeURIComponent(trainNumber)}?apiKey=${apiKey}&dataType=live&journeyDate=${date}`;
      const res = await fetchWithTimeout(url, {
        headers: { 'X-API-Key': apiKey, 'Accept': 'application/json', 'User-Agent': 'RailRadar-Mobile' }
      });
      if (!res.ok) continue;
      const json = await res.json();
      const data = json.data || json;
      
      // If we have live data with a current location, this is the correct date
      if (data?.liveData?.currentLocation || data?.route?.some(s => s.actualArrival || s.actualDeparture)) {
        return data;
      }
    } catch (e) {
      console.warn(`[TRAIN API] Date ${date} failed for ${trainNumber}: ${e.message}`);
    }
  }
  return null;
}

const tsToHHMM = (ts) => {
  if (!ts) return null;
  const d = new Date(ts * 1000);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

const addMinutesToTime = (timeStr, delayMinutes) => {
  if (!timeStr || !timeStr.includes(':')) return timeStr;
  const [h, m] = timeStr.split(':').map(Number);
  const total = h * 60 + m + delayMinutes;
  return `${String(Math.floor(total / 60) % 24).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
};

const parseDelayDisplay = (display) => {
  if (!display) return 0;
  const match = display.match(/(\d+)/);
  return match ? parseInt(match[1]) : 0;
};

// ─── ROUTES (Ordered correctly) ──────────────────────────────────────────────

/**
 * GET /api/stations (Alias for /all)
 */
router.get('/', async (req, res) => {
  try {
    const stations = await Station.find().sort({ stationName: 1 });
    const formatted = stations.map(s => ({
      ...s._doc,
      coordinates: {
        lat: s.location.coordinates[1],
        lng: s.location.coordinates[0]
      }
    }));
    res.json(formatted);
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

/**
 * GET /api/stations/all
 */
router.get('/all', async (req, res) => {
  try {
    const stations = await Station.find().sort({ stationName: 1 });
    console.log(`[DB] Found ${stations.length} total stations`);
    
    // Map to consistent format for frontend
    const formatted = stations.map(s => ({
      ...s._doc,
      coordinates: {
        lat: s.location.coordinates[1],
        lng: s.location.coordinates[0]
      }
    }));
    
    res.json(formatted);
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

/**
 * GET /api/stations/nearby
 */
router.get('/nearby', async (req, res) => {
  const { lat, lng, radius = 5000 } = req.query;
  if (!lat || !lng) return res.status(400).json({ success: false, message: 'Missing coords' });
  try {
    const stations = await Station.find({
      location: {
        $near: {
          $geometry: { type: 'Point', coordinates: [parseFloat(lng), parseFloat(lat)] },
          $maxDistance: parseInt(radius)
        }
      }
    });
    console.log(`[DB] Found ${stations.length} nearby stations for [${lng}, ${lat}]`);
    res.json({
      success: true,
      stations: stations.map(s => ({
        _id: s._id,
        stationName: s.stationName,
        stationCode: s.stationCode,
        zone: s.zone,
        coordinates: { lat: s.location.coordinates[1], lng: s.location.coordinates[0] }
      })),
      userLocation: { lat: parseFloat(lat), lng: parseFloat(lng) }
    });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

/**
 * DEBUG: Test RailRadar API directly
 */
router.get('/debug/railradar', async (req, res) => {
  const { code, num } = req.query;
  const apiKey = process.env.TRAIN_API;
  const results = {};
  try {
    if (code) {
      const sUrl = `https://api.railradar.org/api/v1/stations/${code.toUpperCase()}/live?hours=4&apiKey=${apiKey}`;
      const sRes = await fetchWithTimeout(sUrl, { headers: { 'X-API-Key': apiKey } });
      results.stationAPI = { url: sUrl, status: sRes.status, data: await sRes.json() };
    }
    if (num) {
      const data = await fetchTrainLiveDetails(num, apiKey);
      results.trainAPI = { data };
    }
    res.json({ success: true, results });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

/**
 * GET /api/stations/:code/live
 */
router.get('/:code/live', async (req, res) => {
  const stationCode = req.params.code.toUpperCase();
  const RAIL_RADAR_API = 'https://api.railradar.org';
  const apiKey = process.env.TRAIN_API;
  const hours = Math.min(parseInt(req.query.hours) || 4, 8);

  try {
    let stationTrainsRaw = [];
    try {
      const liveRes = await fetchWithTimeout(
        `${RAIL_RADAR_API}/api/v1/stations/${stationCode}/live?hours=${hours}&apiKey=${apiKey}`,
        { headers: { 'X-API-Key': apiKey, Accept: 'application/json' } }
      );
      if (liveRes.ok) {
        const liveJson = await liveRes.json();
        const root = liveJson.data || liveJson;
        stationTrainsRaw = Array.isArray(root) ? root : (root.trains || []);
        stationTrainsRaw.forEach(e => {
          const num = e.train?.number || e.trainNumber || e.number;
          const name = e.train?.name || e.trainName || e.name;
          if (num && name) trainNameCache.set(num, name);
        });
      }
    } catch (e) { console.warn(`[LIVE BOARD] Station API failure: ${e.message}`); }

    const rawNumbers = stationTrainsRaw.map(e => e.train?.number || e.trainNumber || e.number).filter(Boolean);
    const allNumbers = mergeTrainNumbers(stationCode, rawNumbers);

    // ── STEP 3: Enrich with Train API (Batch processing) ─────────────────────
    const BATCH_SIZE = 5;
    const finalTrains = [];
    
    for (let i = 0; i < allNumbers.length; i += BATCH_SIZE) {
      const batch = allNumbers.slice(i, i + BATCH_SIZE);
      const batchResults = await Promise.all(batch.map(async (num) => {
        const stationMatch = stationTrainsRaw.find(t => (t.train?.number || t.trainNumber || t.number) === num);
        try {
          const cached = trainDetailCache.get(num);
          let data = (cached && Date.now() - cached.timestamp < TRAIN_DETAIL_TTL) ? cached.data : null;
          
          if (!data) {
            data = await fetchTrainLiveDetails(num, apiKey);
            if (data) trainDetailCache.set(num, { data, timestamp: Date.now() });
          }
          if (!data) throw new Error("No data");

          const liveData = data.liveData || data;
          const route = liveData?.route || [];
          const stopIndex = route.findIndex(s => s.stationCode?.toUpperCase().trim() === stationCode.trim());
          if (stopIndex === -1) return null;

          const stop = route[stopIndex];
          const currentGPS = liveData?.currentLocation?.stationCode?.toUpperCase();
          const stopsBefore = route.slice(Math.max(0, stopIndex - 3), stopIndex).map(s => s.stationCode?.toUpperCase());
          const isApproaching = currentGPS && stopsBefore.includes(currentGPS);

          const schedArr = tsToHHMM(stop.scheduledArrival);
          const delay = stop.delayArrivalMinutes || 0;

          return {
            trainNumber: num,
            trainName: trainNameCache.get(num) || data.train?.name || 'Express',
            toCode: data.train?.destinationStationCode || route[route.length-1]?.stationCode,
            fromCode: data.train?.sourceStationCode || route[0]?.stationCode,
            platform: stop.platform || stationMatch?.platform || null,
            expectedArrival: addMinutesToTime(schedArr, delay) || schedArr,
            delayMinutes: delay,
            isApproaching,
            status: { hasArrived: !!stop.actualArrival, hasDeparted: !!stop.actualDeparture },
            _category: stop.actualDeparture ? 'GONE' : (stop.actualArrival ? 'AT_STATION' : (isApproaching ? 'APPROACHING' : 'UPCOMING'))
          };
        } catch (e) {
          if (!stationMatch) return null;
          const delay = parseDelayDisplay(stationMatch.live?.arrivalDelayDisplay);
          return {
            trainNumber: num,
            trainName: trainNameCache.get(num) || stationMatch.train?.name || 'Express',
            toCode: stationMatch.toCode || stationMatch.train?.destinationStationCode,
            platform: stationMatch.platform,
            expectedArrival: stationMatch.expectedArrival || stationMatch.scheduledArrival,
            delayMinutes: delay,
            isApproaching: false,
            status: { hasArrived: !!stationMatch.live?.hasArrived, hasDeparted: !!stationMatch.live?.hasDeparted },
            _category: stationMatch.live?.hasDeparted ? 'GONE' : (stationMatch.live?.hasArrived ? 'AT_STATION' : 'UPCOMING'),
            _isStale: true
          };
        }
      }));
      finalTrains.push(...batchResults);
      if (i + BATCH_SIZE < allNumbers.length) await new Promise(r => setTimeout(r, 300));
    }

    const filtered = finalTrains.filter(Boolean);
    res.json({
      success: true,
      data: {
        station: { code: stationCode },
        atStation: filtered.filter(t => t._category === 'AT_STATION'),
        approaching: filtered.filter(t => t._category === 'APPROACHING'),
        upcoming: filtered.filter(t => t._category === 'UPCOMING'),
        gone: filtered.filter(t => t._category === 'GONE'),
        trains: filtered 
      }
    });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// Admin CRUD
router.post('/', async (req, res) => {
  try {
    const station = new Station({ ...req.body, location: { type: 'Point', coordinates: [req.body.longitude, req.body.latitude] } });
    await station.save();
    res.status(201).json({ success: true, station });
  } catch (e) { res.status(400).json({ success: false, error: e.message }); }
});

router.put('/:id', async (req, res) => {
  try {
    const station = await Station.findByIdAndUpdate(req.params.id, { ...req.body, location: { type: 'Point', coordinates: [req.body.longitude, req.body.latitude] } }, { new: true });
    res.json({ success: true, station });
  } catch (e) { res.status(400).json({ success: false, error: e.message }); }
});

router.delete('/:id', async (req, res) => {
  try {
    await Station.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: 'Deleted' });
  } catch (e) { res.status(400).json({ success: false, error: e.message }); }
});

router.post(['/verify-admin', '/verify-pass'], async (req, res) => {
  const { passcode } = req.body;
  const expected = (process.env.ADMIN_PASS || '3210').trim();
  const received = String(passcode || '').trim();
  
  console.log(`[AUTH] Comparing: "${received}" vs "${expected}"`);
  
  if (received === expected) {
    res.json({ success: true });
  } else {
    res.status(401).json({ 
      success: false, 
      message: 'Invalid passcode',
      debug: { received, expectedLen: expected.length } // Help see if expected is empty
    });
  }
});

module.exports = router;
