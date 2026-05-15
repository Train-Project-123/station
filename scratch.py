import re

with open('backend/routes/stations.js', 'r') as f:
    content = f.read()

# 1. Add StationBoard require
content = content.replace("const Station = require('../models/Station');", "const Station = require('../models/Station');\nconst StationBoard = require('../models/StationBoard');")

# 2. Modify router.get('/:code/live'
new_route_start = """router.get('/:code/live', async (req, res) => {
  const stationCode = req.params.code.toUpperCase();
  
  try {
    const stationDoc = await Station.findOne({ stationCode });
    if (stationDoc) {
      const board = await StationBoard.findOne({ station_id: stationDoc._id });
      if (board && (Date.now() - board.last_updated_at.getTime() < 5 * 60 * 1000)) {
        const filtered = board.upcoming_trains.map(t => ({
          trainNumber: t.train_code,
          trainName: t.train_name,
          toCode: t.to_code,
          toName: t.to_name,
          fromCode: t.from_code,
          fromName: t.from_name,
          platform: t.platform,
          expectedArrival: t.expected_arrival_time ? tsToHHMM(t.expected_arrival_time.getTime() / 1000) : null,
          delayMinutes: t.delay_minutes,
          isApproaching: t.is_approaching,
          status: { hasArrived: t.arrived_time != null, hasDeparted: t.is_departed },
          _category: t.category
        }));
        return res.json({
          success: true,
          data: {
            station: { code: stationCode },
            atStation: filtered.filter(t => t._category === 'AT_STATION'),
            approaching: filtered.filter(t => t._category === 'APPROACHING'),
            upcoming: filtered.filter(t => t._category === 'UPCOMING'),
            gone: filtered.filter(t => t._category === 'GONE'),
            trains: filtered 
          }
        });
      }
    }
"""

content = content.replace("router.get('/:code/live', async (req, res) => {\n  const stationCode = req.params.code.toUpperCase();", new_route_start)

# 3. Add mapping fields in finalTrains creation for success case
success_replacement = """            _category: category,
            _scheduledDepartureTime: stop.scheduledDeparture ? new Date(stop.scheduledDeparture * 1000) : null,
            _expectedArrivalTime: (stop.actualArrival || stop.expectedArrival || stop.scheduledArrival) ? new Date((stop.actualArrival || stop.expectedArrival || stop.scheduledArrival) * 1000) : null,
            _arrivedTime: stop.actualArrival ? new Date(stop.actualArrival * 1000) : null,
            _departedAt: stop.actualDeparture ? new Date(stop.actualDeparture * 1000) : null
          };"""
content = content.replace("            _category: category\n          };", success_replacement)

# 4. Add mapping fields in finalTrains creation for fallback catch case
fallback_replacement = """            _category: category,
            _isStale: true,
            _scheduledDepartureTime: null,
            _expectedArrivalTime: null,
            _arrivedTime: stationMatch.live?.hasArrived ? new Date() : null,
            _departedAt: stationMatch.live?.hasDeparted ? new Date() : null
          };"""
content = content.replace("            _category: category,\n            _isStale: true\n          };", fallback_replacement)


# 5. Add DB update logic at the end
end_replacement = """    const filtered = finalTrains.filter(Boolean);
    
    if (stationDoc) {
      const upcoming_trains = filtered.map(t => ({
        train_code: t.trainNumber,
        train_name: t.trainName,
        to_code: t.toCode,
        to_name: t.toName,
        from_code: t.fromCode,
        from_name: t.fromName,
        platform: t.platform,
        delay_minutes: t.delayMinutes,
        is_approaching: t.isApproaching,
        category: t._category,
        scheduled_departure_time: t._scheduledDepartureTime,
        expected_arrival_time: t._expectedArrivalTime,
        arrived_time: t._arrivedTime,
        is_departed: !!t.status?.hasDeparted,
        departed_at: t._departedAt
      }));
      await StationBoard.findOneAndUpdate(
        { station_id: stationDoc._id },
        { upcoming_trains, last_updated_at: new Date() },
        { upsert: true, new: true }
      );
    }

    res.json({"""
content = content.replace("    const filtered = finalTrains.filter(Boolean);\n    res.json({", end_replacement)

with open('backend/routes/stations.js', 'w') as f:
    f.write(content)

print("Patched stations.js")
