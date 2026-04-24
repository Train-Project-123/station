/**
 * OpenRouteService API Integration
 * Retrieves actual road distance and duration.
 */

// TODO: Replace with your actual OpenRouteService API Key
// You can get a free key at: https://openrouteservice.org/
const ORS_API_KEY ='eyJvcmciOiI1YjNjZTM1OTc4NTExMTAwMDFjZjYyNDgiLCJpZCI6IjY5OTNkZjcxNGU3YTRmNDhiMWY0MGEzNGI0MGQxZTJmIiwiaCI6Im11cm11cjY0In0=';

/**
 * Get driving distance and duration between two coordinates
 * @param {number} startLat 
 * @param {number} startLng 
 * @param {number} endLat 
 * @param {number} endLng 
 * @param {string} profile - 'driving-car', 'foot-walking', 'cycling-regular'
 * @returns {Promise<{distanceMeters: number, durationSeconds: number}>}
 */
export async function getRoadDistance(startLat, startLng, endLat, endLng, profile = 'driving-car') {
  if (ORS_API_KEY === 'YOUR_OPENROUTESERVICE_API_KEY') {
    console.warn('OpenRouteService API key is missing. Using Haversine fallback.');
    return null;
  }

  try {
    // Note: OpenRouteService takes coordinates as [longitude, latitude]
    const url = `https://api.openrouteservice.org/v2/directions/${profile}?api_key=${ORS_API_KEY}&start=${startLng},${startLat}&end=${endLng},${endLat}`;
    
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`ORS API Error: ${response.status}`);
    }

    const data = await response.json();
    
    if (data.features && data.features.length > 0) {
      const summary = data.features[0].properties.summary;
      return {
        distanceMeters: summary.distance, // distance in meters
        durationSeconds: summary.duration // duration in seconds
      };
    }
    return null;
  } catch (error) {
    console.error('Failed to fetch from OpenRouteService:', error);
    return null;
  }
}
