const mongoose = require('mongoose');

const StationBoardSchema = new mongoose.Schema(
  {
    station_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Station',
      required: true,
      unique: true,
    },
    upcoming_trains: [
      {
        train_code: {
          type: String,
          required: true,
        },
        scheduled_departure_time: {
          type: Date,
        },
        expected_arrival_time: {
          type: Date,
        },
        arrived_time: {
          type: Date,
        },
        is_departed: {
          type: Boolean,
          default: false,
        },
        departed_at: {
          type: Date,
          default: null,
        },
        // Extra fields to ensure frontend doesn't break when using cached data
        train_name: String,
        to_code: String,
        to_name: String,
        from_code: String,
        from_name: String,
        platform: String,
        delay_minutes: Number,
        is_approaching: Boolean,
        category: String,
      },
    ],
    last_updated_at: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('StationBoard', StationBoardSchema);
