const express = require('express');
const router = express.Router();
const Trip = require('../models/Trip');

// @route   POST /api/history
// @desc    Save a new train journey
router.post('/', async (req, res) => {
  try {
    const { trainName, trainNumber, route, date, time } = req.body;
    
    const newTrip = new Trip({
      trainName,
      trainNumber,
      route,
      date,
      time
    });

    const trip = await newTrip.save();
    res.json(trip);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server Error');
  }
});

// @route   GET /api/history
// @desc    Get all past journeys
router.get('/', async (req, res) => {
  try {
    const trips = await Trip.find().sort({ createdAt: -1 });
    res.json(trips);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server Error');
  }
});

module.exports = router;
