const express = require('express');
const router = express.Router();
const Station = require('../models/Station');
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

// ─── DEBUG: Test RailRadar API directly ───────────────────────────────────────
router.get('/debug/railradar', async (req, res) => {
  const { code, num } = req.query;
  const apiKey = process.env.TRAIN_API;
  const results = {};

  try {
    if (code) {
      const sUrl = `https://api.railradar.org/api/v1/stations/${code.toUpperCase()}/live?hours=4&apiKey=${apiKey}`;
      const sRes = await fetch(sUrl, { headers: { 'X-API-Key': apiKey, 'Accept': 'application/json' } });
      results.stationAPI = { url: sUrl, status: sRes.status, data: await sRes.json() };
    }
    if (num) {
      const tUrl = `https://api.railradar.org/api/v1/trains/${num}?apiKey=${apiKey}&dataType=live&journeyDate=${new Date().toISOString().split('T')[0]}`;
      const tRes = await fetch(tUrl, { headers: { 'X-API-Key': apiKey, 'Accept': 'application/json' } });
      results.trainAPI = { url: tUrl, status: tRes.status, data: await tRes.json() };
    }
    res.json({ success: true, results });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ─── Per-Station Train Number Cache ──────────────────────────────────────────
const stationTrainCache = new Map(); // stationCode -> Set of trainNumbers
const trainNameCache = new Map();    // trainNumber -> trainName
const trainDetailCache = new Map(); // trainNumber -> { data, timestamp }
const CACHE_TTL = 120000; // 2 minutes

// ─── Helper: Merge live numbers into historical cache ───────────────────────
function mergeTrainNumbers(stationCode, liveNumbers) {
  if (!stationTrainCache.has(stationCode)) {
    stationTrainCache.set(stationCode, new Set());
  }
  const cache = stationTrainCache.get(stationCode);
  liveNumbers.forEach(num => cache.add(num));
  
  // Cleanup: keep only 50 most recent per station
  const arr = Array.from(cache);
  if (arr.length > 50) {
    const fresh = new Set(arr.slice(-50));
    stationTrainCache.set(stationCode, fresh);
    return arr.slice(-50);
  }
  return arr;
}

// ─── Helper: Cache management for train details ──────────────────────────────
function getCachedTrainDetails(trainNumber) {
  const cached = trainDetailCache.get(trainNumber);
  if (cached && (Date.now() - cached.timestamp < CACHE_TTL)) {
    return cached.data;
  }
  return null;
}

// ─── Helper: Fetch a single train's live details from RailRadar ───────────────
async function fetchTrainLiveDetails(trainNumber, apiKey) {
  const now = new Date();
  const today = now.toISOString().split('T')[0]; // YYYY-MM-DD
  
  const url = `https://api.railradar.org/api/v1/trains/${encodeURIComponent(trainNumber)}?apiKey=${apiKey}&dataType=live&journeyDate=${today}`;
  const res = await fetch(url, {
    headers: { 
      'X-API-Key': apiKey, 
      'Accept': 'application/json',
      'User-Agent': 'RailRadar-Mobile'
    },
  });
  if (!res.ok) throw new Error(`Train API ${res.status} for ${trainNumber}`);
  const json = await res.json();
  return json.data || json;
}

// ─── Utilities ───────────────────────────────────────────────────────────────
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
}

const parseDelayDisplay = (display) => {
  if (!display) return 0;
  const match = display.match(/(\d+)/);
  return match ? parseInt(match[1]) : 0;
};

// ─── ROUTES ──────────────────────────────────────────────────────────────────

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
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
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
    // ── STEP 1: Fetch Station API (Wide Window) ──────────────────────────────
    let stationTrainsRaw = [];
    try {
      const liveRes = await fetch(
        `${RAIL_RADAR_API}/api/v1/stations/${stationCode}/live?hours=${hours}&apiKey=${apiKey}`,
        { headers: { 'X-API-Key': apiKey, Accept: 'application/json' } }
      );
      if (liveRes.ok) {
        const liveJson = await liveRes.json();
        const root = liveJson.data || liveJson;
        stationTrainsRaw = Array.isArray(root) ? root : (root.trains || []);
        
        // Seed name cache
        stationTrainsRaw.forEach(e => {
          const num = e.train?.number || e.trainNumber || e.number;
          const name = e.train?.name || e.trainName || e.name;
          if (num && name) trainNameCache.set(num, name);
        });
      }
    } catch (e) {
      console.warn(`[LIVE BOARD] Station API failure: ${e.message}`);
    }

    // ── STEP 2: Merge with History Cache ─────────────────────────────────────
    const rawNumbers = stationTrainsRaw.map(e => e.train?.number || e.trainNumber || e.number).filter(Boolean);
    const allNumbers = mergeTrainNumbers(stationCode, rawNumbers);

    // ── STEP 3: Enrich with Train API (Source of Truth) ──────────────────────
    const finalTrains = await Promise.all(
      allNumbers.slice(0, 30).map(async (num) => {
        const stationMatch = stationTrainsRaw.find(t => (t.train?.number || t.trainNumber || t.number) === num);
        
        try {
          let data = getCachedTrainDetails(num);
          if (!data) {
            data = await fetchTrainLiveDetails(num, apiKey);
            trainDetailCache.set(num, { data, timestamp: Date.now() });
          }

          const liveData = data.liveData || data;
          const route = liveData?.route || [];
          const stopIndex = route.findIndex(s => 
            s.stationCode?.toUpperCase().trim() === stationCode.trim()
          );

          if (stopIndex === -1) {
            stationTrainCache.get(stationCode)?.delete(num);
            return null;
          }

          const stop = route[stopIndex];
          const priorStop = stopIndex > 0 ? route[stopIndex - 1] : null;
          const currentStop = [...route].reverse().find(s => s.actualDeparture && s.stationCode?.toUpperCase() !== stationCode);
          const isApproaching = priorStop && currentStop && priorStop.stationCode?.toUpperCase() === currentStop.stationCode?.toUpperCase();

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
            status: {
              hasArrived: !!stop.actualArrival,
              hasDeparted: !!stop.actualDeparture
            },
            _category: stop.actualDeparture ? 'GONE' : (stop.actualArrival ? 'AT_STATION' : (isApproaching ? 'APPROACHING' : 'UPCOMING'))
          };
        } catch (e) {
          if (!stationMatch) return null;
          const delay = parseDelayDisplay(stationMatch.live?.arrivalDelayDisplay);
          return {
            trainNumber: num,
            trainName: trainNameCache.get(num) || stationMatch.train?.name || 'Express',
            toCode: stationMatch.toCode,
            platform: stationMatch.platform,
            expectedArrival: stationMatch.expectedArrival || stationMatch.scheduledArrival,
            delayMinutes: delay,
            isApproaching: false,
            status: {
              hasArrived: !!stationMatch.live?.hasArrived,
              hasDeparted: !!stationMatch.live?.hasDeparted
            },
            _category: stationMatch.live?.hasDeparted ? 'GONE' : (stationMatch.live?.hasArrived ? 'AT_STATION' : 'UPCOMING'),
            _isStale: true
          };
        }
      })
    );

    const filtered = finalTrains.filter(Boolean);
    console.log(`[LIVE BOARD] Returning ${filtered.length} trains for station ${stationCode}`);

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
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * Admin: Basic Station CRUD
 */
router.post('/', async (req, res) => {
  try {
    const station = new Station({
      ...req.body,
      location: { type: 'Point', coordinates: [req.body.longitude, req.body.latitude] }
    });
    await station.save();
    res.status(201).json({ success: true, station });
  } catch (e) { res.status(400).json({ success: false, error: e.message }); }
});

router.put('/:id', async (req, res) => {
  try {
    const station = await Station.findByIdAndUpdate(req.params.id, {
      ...req.body,
      location: { type: 'Point', coordinates: [req.body.longitude, req.body.latitude] }
    }, { new: true });
    res.json({ success: true, station });
  } catch (e) { res.status(400).json({ success: false, error: e.message }); }
});

router.delete('/:id', async (req, res) => {
  try {
    await Station.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: 'Deleted' });
  } catch (e) { res.status(400).json({ success: false, error: e.message }); }
});

router.get('/all', async (req, res) => {
  try {
    const stations = await Station.find().sort({ stationName: 1 });
    res.json(stations);
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.post('/verify-pass', async (req, res) => {
  const { passcode } = req.body;
  if (passcode === process.env.ADMIN_PASS) {
    res.json({ success: true });
  } else {
    res.status(401).json({ success: false, message: 'Invalid passcode' });
  }
});

module.exports = router;
