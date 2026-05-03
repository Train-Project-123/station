/**
 * API client for Thirakkundo backend
 * Live backend hosted on Render
 */

// const API_BASE_URL = 'https://station-wzhe.onrender.com';
const API_BASE_URL = 'http://192.168.1.4:5000';

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
 * Fetch live station board — trains arriving/departing in the next 2 hours.
 * Calls: GET /api/stations/:code/live
 *
 * @param {string} stationCode - e.g. "KAKJ", "PGI"
 * @returns {Promise<{stationCode, totalTrains, trains: Array}>}
 */
export async function fetchStationLiveBoard(stationCode) {
  const url = `${API_BASE_URL}/api/stations/${encodeURIComponent(stationCode)}/live`;

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`Live board API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();

  if (!data.success) {
    throw new Error(data.message || 'Live board fetch failed');
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

/**
 * Match train based on user locations
 * @param {Array<{lat, lng, speed, timestamp}>} locations 
 */
export async function matchTrain(locations) {

  const url = `${API_BASE_URL}/api/trains/match`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ locations }),
  });

  if (!response.ok) {
    throw new Error(`Match API error: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

/**
 * Save a journey to the cloud history
 */
export async function syncTripWithCloud(trip) {
  const url = `${API_BASE_URL}/api/history`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(trip),
  });

  if (!response.ok) {
    throw new Error('Cloud sync failed');
  }

  return response.json();
}

/**
 * Fetch all journeys from cloud history
 */
export async function fetchCloudHistory() {
  const url = `${API_BASE_URL}/api/history`;

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error('Failed to fetch cloud history');
  }

  return response.json();
}

/**
 * Add a new station manually (Admin)
 */
export async function addStation(stationData) {
  const url = `${API_BASE_URL}/api/stations`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(stationData),
  });

  return response.json();
}
/**
 * Fetch all stations from the database
 */
export async function fetchAllStations() {
  const url = `${API_BASE_URL}/api/stations`;

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error('Failed to fetch stations');
  }

  const data = await response.json();
  return data.stations || [];
}

/**
 * Update an existing station
 */
export async function updateStation(id, stationData) {
  const url = `${API_BASE_URL}/api/stations/${id}`;

  const response = await fetch(url, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(stationData),
  });

  return response.json();
}

/**
 * Delete a station
 */
export async function deleteStation(id) {
  const url = `${API_BASE_URL}/api/stations/${id}`;

  const response = await fetch(url, {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json',
    },
  });

  return response.json();
}

/**
 * Verify admin passcode with the backend
 */
export async function verifyAdminPasscode(passcode) {
  const url = `${API_BASE_URL}/api/stations/verify-admin`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ passcode }),
  });

  return response.json();
}
