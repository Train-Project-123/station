const mongoose = require('mongoose');

const TripSchema = new mongoose.Schema({
  trainName: {
    type: String,
    required: true
  },
  trainNumber: {
    type: String,
    required: true
  },
  route: {
    type: String,
    required: true
  },
  date: {
    type: String,
    required: true
  },
  time: {
    type: String,
    required: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('Trip', TripSchema);
