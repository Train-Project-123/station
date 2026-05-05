const express = require('express');
const router = express.Router();
const Station = require('../models/Station');
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

// ─── Per-Station Train Number Cache ──────────────────────────────────────────
const stationTrainCache = new Map(); // stationCode → Set<trainNumber>
const trainNameCache = new Map();    // trainNumber → trainName

function mergeTrainNumbers(stationCode, newNumbers = []) {
  if (!stationTrainCache.has(stationCode)) {
    stationTrainCache.set(stationCode, new Set());
  }
  const cache = stationTrainCache.get(stationCode);
  newNumbers.forEach(n => cache.add(n));
  return Array.from(cache);
}

// ─── Helper: Unix timestamp → "HH:MM" IST string ─────────────────────────────
// Train API returns scheduledArrival / actualArrival as Unix epoch seconds (IST)
function tsToHHMM(unixSec) {
  if (!unixSec) return null;
  try {
    const d = new Date(unixSec * 1000);
    return d.toLocaleTimeString('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: 'Asia/Kolkata'
    });
  } catch (e) {
    return null;
  }
}

// ─── Helper: Parse Station API delay display → minutes number ─────────────────
// Station API live.arrivalDelayDisplay = "On Time" | "02:49" | "0 min"
function parseDelayDisplay(delayDisplay) {
  if (!delayDisplay || delayDisplay === 'On Time' || delayDisplay === '0 min') return 0;
  if (delayDisplay.includes(':')) {
    const [h, m] = delayDisplay.split(':').map(Number);
    return h * 60 + m;
  }
  return parseInt(delayDisplay) || 0;
}

// ─── Helper: Add minutes to an HH:MM time string ─────────────────────────────
function addMinutesToTime(timeStr, delayMinutes) {
  if (!timeStr || !timeStr.includes(':')) return timeStr;
  if (!delayMinutes || delayMinutes <= 0) return timeStr;
  const [h, m] = timeStr.split(':').map(Number);
  const total = h * 60 + m + delayMinutes;
  return `${String(Math.floor(total / 60) % 24).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}


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

/**
 * GET /api/stations
 * List all stations
 */
router.get('/', async (req, res) => {
  try {
    const stations = await Station.find({}).sort({ stationName: 1 });
    return res.json({
      success: true,
      count: stations.length,
      stations: stations.map(s => ({
        _id: s._id,
        stationName: s.stationName,
        stationCode: s.stationCode,
        zone: s.zone,
        division: s.division,
        state: s.state,
        coordinates: {
          lat: s.location.coordinates[1],
          lng: s.location.coordinates[0],
        }
      }))
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
});

/**
 * GET /api/stations/nearby
 * Query params: lat, lng, radius (in meters, default 5000m = 5km)
 *
 * Uses $nearSphere with GeoJSON format:
 *   coordinates: [longitude, latitude]
 */
router.get('/nearby', async (req, res) => {
  try {
    const lat = parseFloat(req.query.lat);
    const lng = parseFloat(req.query.lng);
    const radius = parseFloat(req.query.radius) || 5000; // default 5km

    if (isNaN(lat) || isNaN(lng)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or missing lat/lng query parameters.',
      });
    }

    // $nearSphere returns results sorted by distance (nearest first)
    const stations = await Station.find({
      location: {
        $nearSphere: {
          $geometry: {
            type: 'Point',
            coordinates: [lng, lat], // GeoJSON: [longitude, latitude]
          },
          $maxDistance: radius, // in meters
        },
      },
    });

    // Calculate distance for each station using Haversine
    const results = stations.map((station) => {
      const distance = haversineDistance(
        lat,
        lng,
        station.location.coordinates[1], // latitude
        station.location.coordinates[0]  // longitude
      );
      return {
        _id: station._id,
        stationName: station.stationName,
        stationCode: station.stationCode,
        zone: station.zone,
        division: station.division,
        state: station.state,
        coordinates: {
          lat: station.location.coordinates[1],
          lng: station.location.coordinates[0],
        },
        distanceMeters: Math.round(distance),
        isWithin500m: distance <= 500,
      };
    });

    return res.json({
      success: true,
      count: results.length,
      userLocation: { lat, lng },
      searchRadius: radius,
      stations: results,
    });
  } catch (error) {
    console.error('[NEARBY STATIONS ERROR]', error.message);
    return res.status(500).json({
      success: false,
      message: 'Server error while fetching nearby stations.',
      error: error.message,
    });
  }
});

/**
 * GET /api/stations/:code/live
 *
 * ── Aggregator Strategy ──────────────────────────────────────────────────────
 * 1. Call Station API (hours=6) for a wide list of train numbers.
 * 2. Merge with in-memory cache so trains never disappear prematurely.
 * 3. For each train number, call the Train API and find this station in
 *    liveData.route — this is the SOURCE OF TRUTH.
 * 4. Categorize using actual timestamps, never hasArrived/hasDeparted flags:
 *      AT_STATION  → actualArrival exists  AND  actualDeparture is null
 *      UPCOMING    → actualArrival is null (sorted by expected arrival time)
 *      APPROACHING → UPCOMING train whose currentLocation is the prior stop
 *      GONE        → actualDeparture exists
 * 5. Return structured { atStation, upcoming, approaching, gone } JSON.
 * ────────────────────────────────────────────────────────────────────────────
 */
// ─── Cache for Train API Results (2 min TTL) ──────────────────────────────────
const trainDetailCache = new Map(); // trainNumber → { data, timestamp }
const CACHE_TTL = 2 * 60 * 1000;

function getCachedTrainDetails(num) {
  const cached = trainDetailCache.get(num);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) return cached.data;
  return null;
}

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
        stationTrainsRaw = (liveJson.data ?? liveJson).trains || [];
        // Seed name cache
        stationTrainsRaw.forEach(e => {
          if (e.train?.number && e.train?.name) trainNameCache.set(e.train.number, e.train.name);
        });
      }
    } catch (e) {
      console.warn(`[LIVE BOARD] Station API failure: ${e.message}`);
    }

    // ── STEP 2: Merge with History Cache ─────────────────────────────────────
    const rawNumbers = stationTrainsRaw.map(e => e.train?.number).filter(Boolean);
    const allNumbers = mergeTrainNumbers(stationCode, rawNumbers);

    // ── STEP 3: Enrich with Train API (Source of Truth) ──────────────────────
    const finalTrains = await Promise.all(
      allNumbers.slice(0, 30).map(async (num) => {
        const stationMatch = stationTrainsRaw.find(t => t.train?.number === num);
        
        try {
          // Use cache or fetch
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
            console.log(`[LIVE BOARD] ⚠️ Train ${num} route does not include ${stationCode}. Route: ${route.map(s => s.stationCode).join(',')}`);
            stationTrainCache.get(stationCode)?.delete(num);
            return null;
          }

          const stop = route[stopIndex];
          const priorStop = stopIndex > 0 ? route[stopIndex - 1] : null;
          
          // GPS Location Resolution
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
            // Metadata for tiered polling
            _category: stop.actualDeparture ? 'GONE' : (stop.actualArrival ? 'AT_STATION' : (isApproaching ? 'APPROACHING' : 'UPCOMING'))
          };
        } catch (e) {
          // ── FALLBACK: Use Station API data if Train API fails ────────────────
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
    
    // ── STEP 4: Final Sorting ────────────────────────────────────────────────
    const response = {
      success: true,
      data: {
        station: { code: stationCode },
        atStation: filtered.filter(t => t._category === 'AT_STATION'),
        approaching: filtered.filter(t => t._category === 'APPROACHING'),
        upcoming: filtered.filter(t => t._category === 'UPCOMING'),
        gone: filtered.filter(t => t._category === 'GONE'),
        trains: filtered // flat for legacy
      }
    };

    return res.json(response);

  } catch (err) {
    return res.status(500).json({ success: false, message: 'Aggregator failure' });
  }
});

/**
 * GET /api/stations
 * Returns all stations in database
 */
router.get('/', async (req, res) => {
  try {
    const stations = await Station.find({});
    return res.json({
      success: true,
      count: stations.length,
      stations,
    });
  } catch (error) {
    console.error('[GET ALL STATIONS ERROR]', error.message);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
});

/**
 * GET /api/stations/:code
 * Get station by code
 */
router.get('/:code', async (req, res) => {
  try {
    const station = await Station.findOne({
      stationCode: req.params.code.toUpperCase(),
    });
    if (!station) {
      return res.status(404).json({ success: false, message: 'Station not found.' });
    }
    return res.json({ success: true, station });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
});

/**
 * POST /api/stations
 * Add a new station
 */
router.post('/', async (req, res) => {
  try {
    const { stationName, stationCode, zone, division, state, latitude, longitude } = req.body;

    if (!stationName || !stationCode || !zone || !division || !state || latitude === undefined || longitude === undefined) {
      return res.status(400).json({
        success: false,
        message: 'All fields are required: stationName, stationCode, zone, division, state, latitude, longitude.',
      });
    }

    const newStation = new Station({
      stationName,
      stationCode: stationCode.toUpperCase(),
      zone,
      division,
      state,
      location: {
        type: 'Point',
        coordinates: [parseFloat(longitude), parseFloat(latitude)], // GeoJSON: [longitude, latitude]
      },
    });

    await newStation.save();

    return res.status(201).json({
      success: true,
      message: 'Station added successfully.',
      station: newStation,
    });
  } catch (error) {
    console.error('[ADD STATION ERROR]', error.message);
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: 'Station code already exists.',
      });
    }
    return res.status(500).json({
      success: false,
      message: 'Server error while adding station.',
      error: error.message,
    });
  }
});

/**
 * Haversine formula — returns distance in METERS between two lat/lng points
 */
function haversineDistance(lat1, lng1, lat2, lng2) {
  const R = 6371000; // Earth radius in meters
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
    Math.cos(toRad(lat2)) *
    Math.sin(dLng / 2) *
    Math.sin(dLng / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function toRad(deg) {
  return deg * (Math.PI / 180);
}

/**
 * PUT /api/stations/:id
 * Update an existing station
 */
router.put('/:id', async (req, res) => {
  try {
    const { stationName, stationCode, zone, division, state, latitude, longitude } = req.body;

    const updateData = {
      stationName,
      stationCode: stationCode?.toUpperCase(),
      zone,
      division,
      state,
      location: {
        type: 'Point',
        coordinates: [parseFloat(longitude), parseFloat(latitude)]
      }
    };

    const station = await Station.findByIdAndUpdate(req.params.id, updateData, { new: true });

    if (!station) {
      return res.status(404).json({ success: false, message: 'Station not found' });
    }

    res.json({ success: true, message: 'Station updated successfully', station });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Error updating station', error: error.message });
  }
});

/**
 * DELETE /api/stations/:id
 * Delete a station
 */
router.delete('/:id', async (req, res) => {
  try {
    const station = await Station.findByIdAndDelete(req.params.id);
    if (!station) {
      return res.status(404).json({ success: false, message: 'Station not found' });
    }
    res.json({ success: true, message: 'Station deleted successfully' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Error deleting station', error: error.message });
  }
});

/**
 * POST /api/stations/verify-admin
 * Verify admin passcode
 */
router.post('/verify-admin', (req, res) => {
  const { passcode } = req.body;
  const adminPass = process.env.ADMIN_PASS || '1234';

  if (passcode === adminPass) {
    return res.json({ success: true, message: 'Authentication successful' });
  } else {
    return res.status(401).json({ success: false, message: 'Invalid passcode' });
  }
});

module.exports = router;
