const mongoose = require('mongoose');

const StationSchema = new mongoose.Schema(
  {
    stationName: {
      type: String,
      required: true,
      trim: true,
    },
    stationCode: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
      trim: true,
    },
    zone: {
      type: String,
      required: true,
    },
    division: {
      type: String,
      required: true,
    },
    state: {
      type: String,
      required: true,
    },
    location: {
      type: {
        type: String,
        enum: ['Point'],
        required: true,
        default: 'Point',
      },
      coordinates: {
        // [longitude, latitude] — GeoJSON standard
        type: [Number],
        required: true,
      },
    },
  },
  { timestamps: true }
);

// 2dsphere index for geospatial queries
StationSchema.index({ location: '2dsphere' });

module.exports = mongoose.model('Station', StationSchema);
