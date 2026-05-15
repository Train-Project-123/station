import * as TaskManager from 'expo-task-manager';
import * as Location from 'expo-location';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { matchTrain } from './api';

export const BACKGROUND_LOCATION_TASK = 'BACKGROUND_LOCATION_TASK';

TaskManager.defineTask(BACKGROUND_LOCATION_TASK, async ({ data, error }) => {
  if (error) {
    console.error('[BACKGROUND TASK] Error:', error.message);
    return;
  }
  if (data) {
    const { locations } = data;
    const location = locations[0];

    if (location) {
      console.log('[BACKGROUND TASK] Got location, speed:', location.coords.speed);

      if (location.coords.speed > 8.3) {
        try {
          const storedLocationsStr = await AsyncStorage.getItem('train_movement_locations');
          const storedLocations = storedLocationsStr ? JSON.parse(storedLocationsStr) : [];

          storedLocations.push({
            lat: location.coords.latitude,
            lng: location.coords.longitude,
            speed: location.coords.speed,
            heading: location.coords.heading,
            timestamp: new Date(location.timestamp).toISOString(),
          });

          // Keep max 20 locations
          if (storedLocations.length > 20) {
            storedLocations.shift();
          }

          await AsyncStorage.setItem('train_movement_locations', JSON.stringify(storedLocations));

          // If we have at least 5 points, try to match the train
          if (storedLocations.length >= 5) {
            const lastMatchTime = await AsyncStorage.getItem('last_train_match_time');
            const now = Date.now();

            // Only try matching once every 5 minutes (300000 ms) to avoid spam
            if (!lastMatchTime || (now - parseInt(lastMatchTime)) > 300000) {
              // FIX: read stationCode that foreground stores when user enters boundary
              const stationCode = await AsyncStorage.getItem('active_station_code');
              if (!stationCode) {
                console.warn('[BACKGROUND TASK] No active_station_code in storage, skipping match.');
                return;
              }

              // FIX: pass stationCode — backend /api/trains/match requires it (missing caused 400)
              const matchResult = await matchTrain(storedLocations, stationCode);

              // FIX: backend returns { success, match: {...} }, NOT matchedTrain
              if (matchResult.success && matchResult.match) {
                console.log('[BACKGROUND TASK] 🚂 Matched Train:', matchResult.match.trainName);

                // Store result so foreground UI can show the confirmation modal
                await AsyncStorage.setItem('matched_train_result', JSON.stringify({
                  train: matchResult.match,
                  departureStation: stationCode,
                  timestamp: new Date().toISOString(),
                }));

                await AsyncStorage.setItem('last_train_match_time', now.toString());
              }
            }
          }
        } catch (err) {
          console.error('[BACKGROUND TASK] Logic error:', err);
        }
      }
    }
  }
});
