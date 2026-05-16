const https = require('https');
require('dotenv').config();

const apiKey = process.env.TRAIN_API;
const trainNumber = '16605';
const date = new Date().toISOString().split('T')[0];
const url = `https://api.railradar.org/api/v1/trains/${encodeURIComponent(trainNumber)}?apiKey=${apiKey}&dataType=live&journeyDate=${date}`;

https.get(url, (res) => {
  let data = '';
  res.on('data', (chunk) => { data += chunk; });
  res.on('end', () => {
    try {
      const json = JSON.parse(data);
      console.log(JSON.stringify(json.data || json, null, 2));
    } catch (e) { console.log('Error'); }
  });
});
