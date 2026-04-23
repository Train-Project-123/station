/**
 * API client for Railway Station Finder backend
 * Live backend hosted on Render
 */

const API_BASE_URL = 'https://station-wzhe.onrender.com';

/**
 * Fetch nearby stations from the backend
 * @param {number} lat
 * @param {number} lng
 * @param {number} radius - in meters (default 5000 = 5km)
 * @returns {Promise<{stations: Array, userLocation: Object, count: number}>}
 */
export async function fetchNearbyStations(lat, lng, radius = 5000) {
  const url = `${API_BASE_URL}/api/stations/nearby?lat=${lat}&lng=${lng}&radius=${radius}`;

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();

  if (!data.success) {
    throw new Error(data.message || 'Unknown API error');
  }

  return data;
}

/**
 * Health check
 */
export async function healthCheck() {
  const response = await fetch(`${API_BASE_URL}/health`);
  return response.json();
}
