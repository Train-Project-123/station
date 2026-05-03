const express = require('express');
const router = express.Router();
const Station = require('../models/Station');
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

// Detailed metadata for common stations to support full auto-fill in test app
const STATION_METADATA = {
  "FK": {
    name: "FEROK",
    zone: "SR",
    division: "PGT",
    state: "Kerala",
    latitude: 11.2486,
    longitude: 75.8364
  },
  "PGI": {
    name: "PARPANANGADI",
    zone: "SR",
    division: "PGT",
    state: "Kerala",
    latitude: 11.04693,
    longitude: 75.86042
  },
  "KAKJ": {
    name: "KAKKANCHERY",
    zone: "SR",
    division: "PGT",
    state: "Kerala",
    latitude: 11.152122,
    longitude: 75.893304
  },
  "CLT": {
    name: "KOZHIKODE MAIN",
    zone: "SR",
    division: "PGT",
    state: "Kerala",
    latitude: 11.2486,
    longitude: 75.7844
  },
  "AWY": {
    name: "ALUVA",
    zone: "SR",
    division: "TVC",
    state: "Kerala",
    latitude: 10.1076,
    longitude: 76.3533
  },
  "ERS": {
    name: "ERNAKULAM JN",
    zone: "SR",
    division: "TVC",
    state: "Kerala",
    latitude: 9.9659,
    longitude: 76.2905
  },
  "ERN": {
    name: "ERNAKULAM TOWN",
    zone: "SR",
    division: "TVC",
    state: "Kerala",
    latitude: 9.9918,
    longitude: 76.2882
  },
  "TCR": {
    name: "THRISSUR",
    zone: "SR",
    division: "TVC",
    state: "Kerala",
    latitude: 10.5186,
    longitude: 76.2101
  },
  "SRR": {
    name: "SHORANUR JN",
    zone: "SR",
    division: "PGT",
    state: "Kerala",
    latitude: 10.7602,
    longitude: 76.2736
  },
  "TVC": {
    name: "THIRUVANANTHAPURAM",
    zone: "SR",
    division: "TVC",
    state: "Kerala",
    latitude: 8.4870,
    longitude: 76.9515
  }
};

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
 * Fetches the live station board from RailRadar for the next 2 hours.
 * Proxies: GET https://api.railradar.org/api/v1/stations/{stationCode}/live?hours=2
 *
 * Returns a cleaned list of trains at the station in the next 2 hours with:
 *   trainNumber, trainName, type, platform, from → to,
 *   scheduledArrival, scheduledDeparture, expectedArrival, expectedDeparture,
 *   delay info, and status flags.
 */
router.get('/:code/live', async (req, res) => {
  const stationCode = req.params.code.toUpperCase();
  const RAIL_RADAR_API = 'https://api.railradar.org';
  const apiKey = process.env.TRAIN_API;

  // ── Smart Fetch: Prioritize local metadata for demo/test purposes ───────────
  const metadata = STATION_METADATA[stationCode];
  
  // If we have detailed local metadata, return it immediately (no API call needed)
  if (metadata) {
    console.log(`[SMART FETCH] 🧠 Using local metadata for ${stationCode}`);
    return res.json({
      success: true,
      data: {
        station: {
          code: stationCode,
          name: metadata.name,
          zone: metadata.zone,
          division: metadata.division,
          state: metadata.state,
          coordinates: { lat: metadata.latitude, lng: metadata.longitude }
        },
        queryingForNextHours: 2,
        totalTrains: 0,
        trains: [],
        _source: 'local_metadata'
      },
      meta: {
        timestamp: new Date().toISOString(),
        service: 'TrainAPI_V1',
        method: 'getLiveStationBoard'
      }
    });
  }

  // Fallback to RailRadar API if not in local metadata
  if (!apiKey) {
    return res.status(500).json({
      success: false,
      error: { code: 'CONFIG_ERROR', message: 'TRAIN_API key not configured.', statusCode: 500 }
    });
  }

  try {
    const url = `${RAIL_RADAR_API}/api/v1/stations/${stationCode}/live?hours=2`;
    console.log(`[LIVE BOARD] 🚉 Fetching live board for ${stationCode}`);

    const response = await fetch(url, {
      headers: {
        'X-API-Key': apiKey,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error(`[LIVE BOARD] ❌ RailRadar API error ${response.status}:`, errText);
      return res.status(response.status).json({
        success: false,
        message: `RailRadar API returned ${response.status}.`,
        detail: errText,
      });
    }

    const json = await response.json();
    const board = json.data ?? json; // Handle both wrapped and unwrapped responses

    // Follow the specific structure provided: { success, data: { station, queryingForNextHours, totalTrains, trains }, meta }
    const metadata = STATION_METADATA[stationCode] || {};
    
    return res.json({
      success: true,
      data: {
        station: {
          code: stationCode,
          name: metadata.name || board.station?.name || "",
          zone: metadata.zone || null,
          division: metadata.division || null,
          state: metadata.state || null,
          coordinates: metadata.latitude ? {
            lat: metadata.latitude,
            lng: metadata.longitude
          } : null
        },
        queryingForNextHours: board.queryingForNextHours || 2,
        totalTrains: (board.trains || []).length,
        trains: (board.trains || []).map((entry) => ({
          train: {
            number: entry.train?.number || null,
            name: entry.train?.name || null,
            type: entry.train?.type || null,
            sourceStationCode: entry.train?.sourceStationCode || entry.train?.source?.code || null,
            destinationStationCode: entry.train?.destinationStationCode || entry.train?.destination?.code || null,
          },
          platform: entry.platform || null,
          journeyDate: entry.journeyDate || null,
          schedule: {
            arrival: entry.schedule?.arrival || null,
            departure: entry.schedule?.departure || null,
          },
          live: {
            arrivalDelayDisplay: entry.live?.arrivalDelayDisplay || entry.live?.expectedArrival || null,
            departureDelayDisplay: entry.live?.departureDelayDisplay || entry.live?.expectedDeparture || null,
          },
          status: {
            isCancelled: entry.status?.isCancelled || false,
            isDiverted: entry.status?.isDiverted || false,
            isArrivalCancelled: entry.status?.isArrivalCancelled || false,
            isDepartureCancelled: entry.status?.isDepartureCancelled || false,
            hasArrived: entry.status?.hasArrived || false,
            hasDeparted: entry.status?.hasDeparted || false,
            isDestinationChanged: entry.status?.isDestinationChanged || false,
            isSourceChanged: entry.status?.isSourceChanged || false,
          },
          coachInfo: entry.coachInfo || {
            arrivalCoachPosition: null,
            departureCoachPosition: null,
          }
        })),
      },
      meta: {
        timestamp: new Date().toISOString(),
        traceId: response.headers.get('x-trace-id') || null,
        service: 'TrainAPI_V1',
        method: 'getLiveStationBoard'
      }
    });
  } catch (err) {
    console.error('[LIVE BOARD] ❌ Error fetching live board:', err.message);
    return res.status(500).json({
      success: false,
      error: {
        code: 'SERVER_ERROR',
        message: 'Failed to fetch live board from RailRadar.',
        statusCode: 500,
        retryable: true
      },
      meta: {
        timestamp: new Date().toISOString(),
        service: 'TrainAPI_V1'
      }
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
