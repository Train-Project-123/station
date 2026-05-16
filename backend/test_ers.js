const https = require('https');
require('dotenv').config();

const apiKey = process.env.TRAIN_API;
const stationCode = 'ERS';
const url = `https://api.railradar.org/api/v1/stations/${stationCode}/live?hours=8&apiKey=${apiKey}`;

https.get(url, (res) => {
  let data = '';
  res.on('data', (chunk) => { data += chunk; });
  res.on('end', () => {
    try {
      const json = JSON.parse(data);
      const trains = json.data?.trains || json.data || json;
      console.log(`Total trains: ${trains.length}`);
      trains.slice(0, 10).forEach(t => {
        const num = t.train?.number || t.trainNumber || t.number;
        const status = t.status || {};
        console.log(`Train ${num}: hasArrived=${status.hasArrived}, hasDeparted=${status.hasDeparted}`);
      });
    } catch (e) {
      console.log('Error parsing:', e.message);
    }
  });
});
