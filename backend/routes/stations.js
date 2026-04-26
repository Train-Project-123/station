const express = require('express');
const router = express.Router();
const Station = require('../models/Station');

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

  if (!apiKey) {
    return res.status(500).json({
      success: false,
      message: 'TRAIN_API key is not configured on the server.',
    });
  }

  try {
    const url = `${RAIL_RADAR_API}/api/v1/stations/${stationCode}/live?hours=2`;

    console.log(`[LIVE BOARD] 🚉 Fetching live board for ${stationCode} → ${url}`);

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
    const board = json.data ?? json; // RailRadar wraps response in { success, data: {...} }

    // Map each train entry to a clean, mobile-friendly shape
    const trains = (board.trains || []).map((entry) => ({
      trainNumber: entry.train?.number ?? null,
      trainName: entry.train?.name ?? null,
      trainType: entry.train?.type ?? null,
      from: entry.train?.source?.name ?? null,
      fromCode: entry.train?.source?.code ?? null,
      to: entry.train?.destination?.name ?? null,
      toCode: entry.train?.destination?.code ?? null,
      platform: entry.platform ?? null,
      journeyDate: entry.journeyDate ?? null,
      scheduled: {
        arrival: entry.schedule?.arrival ?? null,
        departure: entry.schedule?.departure ?? null,
      },
      expected: {
        arrival: entry.live?.expectedArrival ?? null,
        departure: entry.live?.expectedDeparture ?? null,
      },
      delay: {
        arrival: entry.live?.arrivalDelayDisplay ?? null,
        departure: entry.live?.departureDelayDisplay ?? null,
      },
      status: {
        isCancelled: entry.status?.isCancelled ?? false,
        isDiverted: entry.status?.isDiverted ?? false,
        hasArrived: entry.status?.hasArrived ?? false,
        hasDeparted: entry.status?.hasDeparted ?? false,
        isArrivalCancelled: entry.status?.isArrivalCancelled ?? false,
        isDepartureCancelled: entry.status?.isDepartureCancelled ?? false,
      },
    }));

    console.log(`[LIVE BOARD] ✅ ${trains.length} train(s) found at ${stationCode} in next 2h`);

    return res.json({
      success: true,
      stationCode,
      queryingForNextHours: 2,
      totalTrains: trains.length,
      trains,
    });
  } catch (err) {
    console.error('[LIVE BOARD] ❌ Error fetching live board:', err.message);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch live board from RailRadar.',
      error: err.message,
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

module.exports = router;
