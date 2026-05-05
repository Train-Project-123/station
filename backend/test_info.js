const https = require('https');
require('dotenv').config();

const apiKey = process.env.TRAIN_API;
const code = 'ERS';
const url = `https://api.railradar.org/api/v1/stations/${code}/info?apiKey=${apiKey}`;

function test() {
  console.log(`Testing with new key: ${apiKey.substring(0, 8)}...`);
  console.log(`URL: ${url}`);
  https.get(url, (res) => {
    let data = '';
    res.on('data', (chunk) => { data += chunk; });
    res.on('end', () => {
      console.log(`Status: ${res.statusCode}`);
      try {
        const json = JSON.parse(data);
        console.log('Full JSON:', JSON.stringify(json, null, 2));
      } catch (e) {
        console.log('Raw Data:', data);
      }
    });
  }).on('error', (err) => {
    console.error('Error:', err.message);
  });
}

test();
