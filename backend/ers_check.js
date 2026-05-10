const https = require('https');
const fs = require('fs');
require('dotenv').config();

const apiKey = process.env.TRAIN_API;
const url = `https://api.railradar.org/api/v1/stations/ERS/live?hours=4&apiKey=${apiKey}`;

https.get(url, (res) => {
  let data = '';
  res.on('data', (chunk) => { data += chunk; });
  res.on('end', () => {
    try {
      console.log('Raw:', data.substring(0, 500));
      const json = JSON.parse(data);
      const trains = json.data?.trains || json.trains || [];
      let out = `Total: ${trains.length}\n`;
      trains.forEach(t => {
        const num = t.train?.number || t.trainNumber;
        const status = t.live?.hasArrived ? 'ARRIVED' : 'UPCOMING';
        out += `${num}: ${status} -> ${t.train?.destinationStationCode || t.toCode}\n`;
      });
      fs.writeFileSync('ers_check.txt', out);
      console.log('Done');
    } catch (e) { console.log(e.message); }
  });
});
