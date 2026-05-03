const express = require('express');
const router = express.Router();
const Station = require('../models/Station');
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

// Dynamic coordinate lookup enabled (no more hardcoded metadata)

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
  try {
    const INFO_URL = `${RAIL_RADAR_API}/api/v1/stations/${stationCode}/info`;
    const LIVE_URL = `${RAIL_RADAR_API}/api/v1/stations/${stationCode}/live?hours=2`;
    
    console.log(`[STATION FETCH] 🛰️ Fetching official info for ${stationCode}`);

    // Step 1: Fetch official station info (Coordinates, Zone, etc.)
    const infoResponse = await fetch(`${INFO_URL}?apiKey=${apiKey}`, {
      headers: {
        'X-API-Key': apiKey,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
    });

    let stationInfo = {};
    if (infoResponse.ok) {
      const infoJson = await infoResponse.json();
      stationInfo = infoJson.data || {};
      console.log(`[STATION FETCH] ✅ Official Info Found for ${stationCode}`);
    }

    // Step 2: Fetch live board for trains (Maintain existing functionality)
    const liveResponse = await fetch(LIVE_URL, {
      headers: {
        'X-API-Key': apiKey,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
    });

    if (!liveResponse.ok && !infoResponse.ok) {
      return res.status(404).json({
        success: false,
        message: `Station ${stationCode} not found.`,
      });
    }

    const liveJson = await liveResponse.json();
    const board = liveJson.data ?? liveJson;
    
    // Extract state from address (e.g. "Kerala" from "Tel: 0484- 2376131, Kerala")
    const address = stationInfo.address || "";
    const state = stationInfo.state || (address.includes(',') ? address.split(',').pop().trim() : null);

    return res.json({
      success: true,
      data: {
        station: {
          code: stationCode,
          name: stationInfo.name || board.station?.name || "",
          zone: stationInfo.zone || board.station?.zone || null,
          division: stationInfo.division || board.station?.division || null,
          state: state || board.station?.state || null,
          coordinates: stationInfo.lat ? {
            lat: parseFloat(stationInfo.lat),
            lng: parseFloat(stationInfo.lng)
          } : null
        },
        queryingForNextHours: board.queryingForNextHours || 2,
        totalTrains: (board.trains || []).length,
        trains: (board.trains || []).map((entry) => ({
          trainNumber: entry.train?.number || null,
          trainName: entry.train?.name || null,
          trainType: entry.train?.type || null,
          fromCode: entry.train?.sourceStationCode || entry.train?.source?.code || null,
          toCode: entry.train?.destinationStationCode || entry.train?.destination?.code || null,
          platform: entry.platform || null,
          scheduled: {
            arrival: entry.schedule?.arrival || null,
            departure: entry.schedule?.departure || null,
          },
          expected: {
            arrival: entry.live?.expectedArrival || entry.live?.arrivalDelayDisplay || null,
            departure: entry.live?.expectedDeparture || entry.live?.departureDelayDisplay || null,
          },
          delay: {
            arrival: entry.live?.arrivalDelayDisplay || '0 min',
            departure: entry.live?.departureDelayDisplay || '0 min',
          },
          status: {
            isCancelled: entry.status?.isCancelled || false,
            isDiverted: entry.status?.isDiverted || false,
            isArrivalCancelled: entry.status?.isArrivalCancelled || false,
            isDepartureCancelled: entry.status?.isDepartureCancelled || false,
            hasArrived: entry.status?.hasArrived || false,
            hasDeparted: entry.status?.hasDeparted || false,
          }
        })),
      },
      meta: {
        timestamp: new Date().toISOString(),
        service: 'TrainAPI_V1',
        method: 'getLiveStationBoard',
        _source: 'official_railradar_api'
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
