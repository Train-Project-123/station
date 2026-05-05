/**
 * API client for Thirakkundo backend
 * Live backend hosted on Render
 */

export const API_BASE_URL = 'http://10.10.11.102:5000'; 
// const API_BASE_URL = 'https://station-wzhe.onrender.com';

const API_TIMEOUT = 8000; // 8 seconds

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), API_TIMEOUT);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    return response;
  } finally {
    clearTimeout(id);
  }
}

/**
 * Fetch nearby stations from the backend
 */
export async function fetchNearbyStations(lat, lng, radius = 5000) {
  const url = `${API_BASE_URL}/api/stations/nearby?lat=${lat}&lng=${lng}&radius=${radius}`;
  const response = await fetchWithTimeout(url);
  return response.json();
}

/**
 * Fetch station live board (trains currently at or approaching)
 */
export async function fetchStationLiveBoard(stationCode) {
  const url = `${API_BASE_URL}/api/stations/${stationCode}/live`;
  const response = await fetchWithTimeout(url);
  if (!response.ok) {
    throw new Error(`Live board error: ${response.status}`);
  }
  return response.json();
}

/**
 * Fetch all stations in directory
 */
export async function fetchAllStations() {
  try {
    const url = `${API_BASE_URL}/api/stations/all`;
    const response = await fetchWithTimeout(url);
    if (!response.ok) {
      const text = await response.text();
      console.error(`[API] fetchAllStations failed (${response.status}):`, text);
      throw new Error(`Server error ${response.status}`);
    }
    return response.json();
  } catch (err) {
    console.error('[API] Network error in fetchAllStations:', err.message);
    throw err;
  }
}

/**
 * Match train based on user locations
 */
export async function matchTrain(locations, stationCode) {
  const url = `${API_BASE_URL}/api/trains/match`;
  const response = await fetchWithTimeout(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ locations, stationCode }),
  });
  return response.json();
}

/**
 * Verify admin passcode
 */
export async function verifyAdminPasscode(passcode) {
  const url = `${API_BASE_URL}/api/stations/verify-admin`;
  const response = await fetchWithTimeout(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ passcode }),
  });
  return response.json();
}

/**
 * Add a new station
 */
export async function addStation(stationData) {
  const url = `${API_BASE_URL}/api/stations`;
  const response = await fetchWithTimeout(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(stationData),
  });
  return response.json();
}

/**
 * Update a station
 */
export async function updateStation(id, stationData) {
  const url = `${API_BASE_URL}/api/stations/${id}`;
  const response = await fetchWithTimeout(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(stationData),
  });
  return response.json();
}

/**
 * Delete a station
 */
export async function deleteStation(id) {
  const url = `${API_BASE_URL}/api/stations/${id}`;
  const response = await fetchWithTimeout(url, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
  });
  return response.json();
}

/**
 * Fetch full train details
 */
export async function fetchTrainDetails(trainNumber) {
  const apiKey = 'rr_as97u1l1wby7ueobdx3uc5cieea9b3sp';
  const today = new Date().toISOString().split('T')[0];
  const url = `https://api.railradar.org/api/v1/trains/${encodeURIComponent(trainNumber)}?apiKey=${apiKey}&dataType=live&journeyDate=${today}`;
  const response = await fetch(url); // External API, keep standard fetch
  if (!response.ok) {
    throw new Error(`Train details error: ${response.status}`);
  }
  return response.json();
}

/**
 * Fetch station metadata from RailRadar (via backend)
 */
export async function fetchStationInfo(code) {
  const url = `${API_BASE_URL}/api/stations/info/${code}`;
  const response = await fetchWithTimeout(url);
  if (!response.ok) {
    throw new Error(`Fetch info failed: ${response.status}`);
  }
  return response.json();
}

/**
 * Health check
 */
export async function healthCheck() {
  const response = await fetchWithTimeout(`${API_BASE_URL}/health`);
  return response.json();
}
