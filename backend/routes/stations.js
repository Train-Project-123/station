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
