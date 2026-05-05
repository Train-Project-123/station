const https = require('https');
require('dotenv').config();

const apiKey = process.env.TRAIN_API;
const stationCode = 'ERS';
const url = `https://api.railradar.org/api/v1/stations/${stationCode}/live?hours=4&apiKey=${apiKey}`;

function test() {
  console.log(`Verifying ERS Live Board...`);
  https.get(url, (res) => {
    let data = '';
    res.on('data', (chunk) => { data += chunk; });
    res.on('end', () => {
      console.log(`Status: ${res.statusCode}`);
      try {
        const json = JSON.parse(data);
        const trains = json.data || json;
        console.log(`Total trains found: ${trains.length}`);
        
        const summary = trains.map(t => {
          const num = t.train?.number || t.trainNumber || t.number;
          const status = t.live?.hasArrived ? 'AT STATION' : (t.live?.hasDeparted ? 'GONE' : 'UPCOMING');
          return `${num}: ${status}`;
        });
        
        console.log('--- SUMMARY ---');
        console.log(summary.join('\n'));
        console.log('---------------');
      } catch (e) {
        console.log('Raw Data:', data);
      }
    });
  }).on('error', (err) => {
    console.error('Error:', err.message);
  });
}

test();
