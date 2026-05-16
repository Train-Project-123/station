const https = require('https');
require('dotenv').config();

const apiKey = process.env.TRAIN_API;
const trainNumber = '22653';
const date = new Date().toISOString().split('T')[0];
const url = `https://api.railradar.org/api/v1/trains/${encodeURIComponent(trainNumber)}?apiKey=${apiKey}&dataType=live&journeyDate=${date}`;

console.log(`Testing Train Details for ${trainNumber} on ${date}...`);
https.get(url, (res) => {
  let data = '';
  res.on('data', (chunk) => { data += chunk; });
  res.on('end', () => {
    console.log(`Status: ${res.statusCode}`);
    console.log('Response:', data.substring(0, 500));
  });
}).on('error', (err) => {
  console.error('Error:', err.message);
});
