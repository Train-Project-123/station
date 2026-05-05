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

// ─── Helper: Fetch a single train's live details from RailRadar ───────────────
// Train API response shape (data field):
//   trainNumber, route: [{ stationCode, scheduledArrival (unix), scheduledDeparture (unix),
//     actualArrival (unix|null), actualDeparture (unix|null), delayArrivalMinutes, platform }]
async function fetchTrainLiveDetails(trainNumber, apiKey) {
  const today = new Date().toISOString().split('T')[0];
  const url = `https://api.railradar.org/api/v1/trains/${encodeURIComponent(trainNumber)}?apiKey=${apiKey}&dataType=live&journeyDate=${today}`;
  const res = await fetch(url, {
    headers: { 'X-API-Key': apiKey, Accept: 'application/json' },
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
router.get('/:code/live', async (req, res) => {
  const stationCode = req.params.code.toUpperCase();
  const RAIL_RADAR_API = 'https://api.railradar.org';
  const apiKey = process.env.TRAIN_API;
  const hours = Math.min(parseInt(req.query.hours) || 4, 8); // Expanded window to 8 hours for better upcoming visibility

  try {
    // ── STEP 1: Station Info (metadata only, not for train classification) ────
    let stationInfo = {};
    try {
      const infoRes = await fetch(
        `${RAIL_RADAR_API}/api/v1/stations/${stationCode}/info?apiKey=${apiKey}`,
        { headers: { 'X-API-Key': apiKey, Accept: 'application/json' } }
      );
      if (infoRes.ok) {
        const infoJson = await infoRes.json();
        stationInfo = infoJson.data || {};
        console.log(`[LIVE BOARD] ✅ Station info fetched for ${stationCode}`);
      }
    } catch (e) {
      console.warn(`[LIVE BOARD] ⚠️ Station info fetch failed: ${e.message}`);
    }

    // ── STEP 2: Station API — wide window (hours=6) to get train numbers ─────
    let stationApiTrainNumbers = [];
    try {
      const liveRes = await fetch(
        `${RAIL_RADAR_API}/api/v1/stations/${stationCode}/live?hours=${hours}`,
        { headers: { 'X-API-Key': apiKey, Accept: 'application/json' } }
      );
      if (liveRes.ok) {
        const liveJson = await liveRes.json();
        const board = liveJson.data ?? liveJson;
        const stationTrains = board.trains || [];
        stationApiTrainNumbers = stationTrains.map(e => e.train?.number).filter(Boolean);
        
        // Carry over names from station board
        stationTrains.forEach(e => {
          if (e.train?.number && e.train?.name) {
            trainNameCache.set(e.train.number, e.train.name);
          }
        });

        console.log(`[LIVE BOARD] 🚉 Station API returned ${stationApiTrainNumbers.length} trains for ${stationCode}`);
      }
    } catch (e) {
      console.warn(`[LIVE BOARD] ⚠️ Station API fetch failed: ${e.message}`);
    }

    // ── STEP 3: Merge with cache so already-seen trains aren't lost ───────────
    const allTrainNumbers = mergeTrainNumbers(stationCode, stationApiTrainNumbers);
    console.log(`[LIVE BOARD] 🔀 Merged train set: ${allTrainNumbers.length} trains (cache + fresh)`);

    if (allTrainNumbers.length === 0) {
      return res.json({
        success: true,
        data: {
          station: { code: stationCode, name: stationInfo.name || '' },
          summary: { atStation: 0, approaching: 0, upcoming: 0, gone: 0, totalResolved: 0 },
          atStation: [],
          approaching: [],
          upcoming: [],
          gone: [],
          trains: []
        }
      });
    }

    // ── STEP 4: Train API — SOURCE OF TRUTH for each train ───────────────────
    // Cap parallel requests to avoid rate limiting (max 20 concurrent)
    const CAP = 20;
    const capped = allTrainNumbers.slice(0, CAP);

    const trainResults = await Promise.allSettled(
      capped.map(num => fetchTrainLiveDetails(num, apiKey))
    );

    // ── STEP 5: Extract this station's stop from each train's route ───────────
    const atStation   = [];
    const upcoming    = [];
    const approaching = [];
    const gone        = [];

    trainResults.forEach((result, i) => {
      const trainNum = capped[i];

      if (result.status === 'rejected') {
        console.warn(`[LIVE BOARD] ⚠️ Train API failed for ${trainNum}: ${result.reason?.message}`);
        return;
      }

      const data = result.value;
      const liveData = data.liveData || data;
      const route = liveData?.route || [];
      const trainMeta = data.train || liveData?.train || data || {};
      
      // Smart Metadata: If API doesn't provide source/destination, get them from route
      const sourceCode = trainMeta.sourceStationCode || trainMeta.source?.code || route[0]?.stationCode || null;
      const destCode = trainMeta.destinationStationCode || trainMeta.destination?.code || route[route.length - 1]?.stationCode || null;

      // Find the stop for our station in this train's route
      const stopIndex = route.findIndex(
        s => s.stationCode?.toUpperCase().trim() === stationCode
      );

      if (stopIndex === -1) {
        // Train route doesn't pass through this station — evict from cache
        stationTrainCache.get(stationCode)?.delete(trainNum);
        return;
      }

      const stop = route[stopIndex];

      // Current train GPS location = the last stop that has an actual departure
      const currentStop = [...route]
        .reverse()
        .find(s => s.actualDeparture && s.stationCode?.toUpperCase() !== stationCode);

      const currentLocationCode = currentStop?.stationCode || null;

      // Prior stop (the stop just before our station in the route)
      const priorStop = stopIndex > 0 ? route[stopIndex - 1] : null;
      const isApproaching = (
        priorStop &&
        currentLocationCode &&
        priorStop.stationCode?.toUpperCase() === currentLocationCode.toUpperCase()
      );

      const schedArrHHMM = tsToHHMM(stop.scheduledArrival);
      const schedDepHHMM = tsToHHMM(stop.scheduledDeparture);
      const delayMinutes = stop.delayArrivalMinutes || 0;
      const expectedArrival = addMinutesToTime(schedArrHHMM, delayMinutes);

      // Best accurate name detection (Prefer name from station board, then API info, then data fields)
      const boardName = trainNameCache.get(trainNum);
      const bestName = boardName || trainMeta.name || trainMeta.trainName || trainMeta.longName || data.trainName || data.name || 'Express';
      
      const trainEntry = {
        trainNumber:     trainNum,
        trainName:       bestName,
        trainType:       trainMeta.type || trainMeta.trainType || null,
        fromCode:        sourceCode,
        toCode:          destCode,
        platform:        stop.platform || null,
        scheduledArrival:   schedArrHHMM,
        scheduledDeparture: schedDepHHMM,
        expectedArrival:    expectedArrival || schedArrHHMM,
        actualArrival:      tsToHHMM(stop.actualArrival),
        actualDeparture:    tsToHHMM(stop.actualDeparture),
        // Nested objects for TrackingScreen.js getTrainState()
        scheduled: {
          arrival: schedArrHHMM,
          departure: schedDepHHMM
        },
        expected: {
          arrival: expectedArrival || schedArrHHMM,
          departure: addMinutesToTime(schedDepHHMM, delayMinutes) || schedDepHHMM
        },
        delay: {
          arrival: delayMinutes > 0 ? `${delayMinutes} min` : 'On Time',
          departure: delayMinutes > 0 ? `${delayMinutes} min` : 'On Time'
        },
        // Status flags for getTrainState()
        status: {
          hasArrived: !!stop.actualArrival,
          hasDeparted: !!stop.actualDeparture
        },
        detailedStatus: {
          hasArrived: !!stop.actualArrival,
          hasDeparted: !!stop.actualDeparture
        },
        // Raw timestamps for sorting
        rawActualArrival:   stop.actualArrival,
        rawActualDeparture: stop.actualDeparture,
        delayMinutes:       delayMinutes,
        currentLocation:    currentLocationCode,
        isApproaching:      isApproaching,
        isCancelled:        stop.isCancelled || false,
        isDiverted:         stop.isDiverted || false,
      };

      // ── Classification using ACTUAL timestamps (never status flags) ─────────
      if (stop.actualArrival && !stop.actualDeparture) {
        atStation.push(trainEntry);
      } else if (stop.actualDeparture) {
        gone.push(trainEntry);
      } else {
        if (isApproaching) {
          approaching.push(trainEntry);
        } else {
          upcoming.push(trainEntry);
        }
      }
      
      // DEBUG: Log categorization result
      console.log(`[DEBUG CAT] Train ${trainNum}: ARR=${!!stop.actualArrival} DEP=${!!stop.actualDeparture} -> ${stop.actualArrival && !stop.actualDeparture ? 'AT' : stop.actualDeparture ? 'GONE' : 'UPCOMING'}`);
    });

    // Sort UPCOMING by expected arrival time (earliest first)
    upcoming.sort((a, b) => (a.expectedArrival || '99:99').localeCompare(b.expectedArrival || '99:99'));
    approaching.sort((a, b) => (a.expectedArrival || '99:99').localeCompare(b.expectedArrival || '99:99'));
    // Sort GONE by actual departure time (most recent first) using raw timestamps
    gone.sort((a, b) => (b.rawActualDeparture || 0) - (a.rawActualDeparture || 0));

    const address = stationInfo.address || '';
    const state = stationInfo.state || (address.includes(',') ? address.split(',').pop().trim() : null);

    console.log(`[LIVE BOARD] ✅ ${stationCode}: AT=${atStation.length} APPROACHING=${approaching.length} UPCOMING=${upcoming.length} GONE=${gone.length}`);

    return res.json({
      success: true,
      data: {
        station: {
          code:        stationCode,
          name:        stationInfo.name || '',
          zone:        stationInfo.zone || null,
          division:    stationInfo.division || null,
          state:       state || null,
          coordinates: stationInfo.lat
            ? { lat: parseFloat(stationInfo.lat), lng: parseFloat(stationInfo.lng) }
            : null,
        },
        summary: {
          atStation:    atStation.length,
          approaching:  approaching.length,
          upcoming:     upcoming.length,
          gone:         gone.length,
          totalResolved: atStation.length + approaching.length + upcoming.length + gone.length,
        },
        atStation,
        approaching,
        upcoming,
        gone,
        // Legacy flat `trains` array for backwards compatibility with older mobile clients
        trains: [...atStation, ...approaching, ...upcoming, ...gone],
      },
      meta: {
        timestamp:        new Date().toISOString(),
        service:          'TrainAPI_V2_Aggregator',
        method:           'getLiveStationBoard',
        stationApiCount:  stationApiTrainNumbers.length,
        cachedCount:      allTrainNumbers.length - stationApiTrainNumbers.length,
        resolvedCount:    atStation.length + approaching.length + upcoming.length + gone.length,
        hoursWindow:      hours,
        _strategy:        'train_api_source_of_truth',
      },
    });

  } catch (err) {
    console.error('[LIVE BOARD] ❌ Aggregator error:', err.message);
    return res.status(500).json({
      success: false,
      error: {
        code:      'SERVER_ERROR',
        message:   'Failed to aggregate live board data.',
        statusCode: 500,
        retryable: true,
      },
      meta: {
        timestamp: new Date().toISOString(),
        service:   'TrainAPI_V2_Aggregator',
      },
    });
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
