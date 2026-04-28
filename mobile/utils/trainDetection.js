/**
 * Train Detection Utility
 * Implements the algorithm for auto-detecting which train the user has boarded.
 */

const RAIL_RADAR_API_KEY = process.env.EXPO_PUBLIC_TRAIN_API;
const RAIL_RADAR_BASE_URL = 'https://api.railradar.org/api/v1';

/**
 * Fetch detailed train route and find actual departure from a specific station
 * @param {string} trainNumber 
 * @param {string} stationCode 
 */
export async function getActualDeparture(trainNumber, stationCode) {
  const today = new Date().toISOString().split('T')[0];
  const url = `${RAIL_RADAR_BASE_URL}/trains/${trainNumber}?dataType=live&journeyDate=${today}`;

  try {
    const response = await fetch(url, {
      headers: {
        'X-API-Key': RAIL_RADAR_API_KEY,
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      console.error(`[DETECTION] API error for train ${trainNumber}: ${response.status}`);
      return null;
    }

    const json = await response.json();
    const data = json.data || json;
    const route = data.route || [];
    
    // Find the stop for our station
    const stop = route.find(s => 
      (s.stationCode && s.stationCode.toUpperCase() === stationCode.toUpperCase()) || 
      (s.code && s.code.toUpperCase() === stationCode.toUpperCase())
    );
    
    if (stop && stop.actualDeparture) {
      // Return actualDeparture (assuming it's a unix timestamp in seconds as per prompt)
      return stop.actualDeparture;
    }
    
    return null;
  } catch (err) {
    console.error(`[DETECTION] Fetch failed for ${trainNumber}:`, err.message);
    return null;
  }
}

/**
 * Core matching algorithm (Steps 2-5)
 * @param {number} T_trigger - Unix timestamp in seconds
 * @param {string} stationCode 
 * @param {Array} candidateTrains - From Live Board
 */
export async function performMatch(T_trigger, stationCode, candidateTrains) {
  const validCandidates = [];

  console.log(`[DETECTION] Starting match for ${candidateTrains.length} candidates at ${stationCode}. T_trigger: ${T_trigger}`);

  for (const train of candidateTrains) {
    const actualDeparture = await getActualDeparture(train.trainNumber, stationCode);
    
    if (actualDeparture === null) {
      console.log(`[DETECTION] Train ${train.trainNumber} has no actual departure yet.`);
      continue;
    }

    if (actualDeparture > T_trigger) {
      console.log(`[DETECTION] Train ${train.trainNumber} departed after trigger (${actualDeparture} > ${T_trigger}).`);
      continue;
    }

    const gap = T_trigger - actualDeparture;
    validCandidates.push({
      ...train,
      actualDeparture,
      gap
    });
  }

  // STEP 5: False Trigger Guard
  // "if no train departed within 600 seconds (10 min) before T_trigger, it's a false trigger."
  if (validCandidates.length === 0) {
    console.log('[DETECTION] No valid candidates found (all filtered).');
    return { status: 'NO_CANDIDATES' };
  }

  // STEP 3: Sort by gap ascending
  validCandidates.sort((a, b) => a.gap - b.gap);
  const bestMatch = validCandidates[0];

  // Check the 600s rule on the best match specifically
  if (bestMatch.gap > 600) {
    console.log(`[DETECTION] False trigger: best match gap is ${bestMatch.gap}s (> 600s).`);
    return { status: 'FALSE_TRIGGER' };
  }

  // STEP 4: Confidence Scoring
  let confidence = 'LOW';
  if (bestMatch.gap < 180) {
    confidence = 'HIGH';
  } else if (bestMatch.gap <= 360) {
    confidence = 'MEDIUM';
  }

  if (confidence === 'LOW') {
    console.log(`[DETECTION] Discarding match: ${bestMatch.trainNumber} has LOW confidence (gap: ${bestMatch.gap}s).`);
    return { status: 'LOW_CONFIDENCE' };
  }

  console.log(`[DETECTION] Best match: ${bestMatch.trainNumber} with ${confidence} confidence (gap: ${bestMatch.gap}s).`);

  return {
    status: 'SUCCESS',
    confidence,
    train: bestMatch
  };
}
