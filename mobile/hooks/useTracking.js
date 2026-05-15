import { useState, useRef, useCallback, useEffect } from 'react';
import * as Location from 'expo-location';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { BACKGROUND_LOCATION_TASK } from '../utils/backgroundTask';

export const TRACKING_STATUS = {
  IDLE: 'idle',
  LOADING: 'loading',
  INSIDE: 'inside',
  OUTSIDE: 'outside',
  ERROR: 'error',
};

export const useTracking = () => {
  const [isTracking, setIsTracking] = useState(false);
  const [trackingStatus, setTrackingStatus] = useState(TRACKING_STATUS.IDLE);
  const [distanceMeters, setDistanceMeters] = useState(null);
  const [location, setLocation] = useState(null);
  const [speed, setSpeed] = useState(0);
  const [heading, setHeading] = useState(0);
  const locationSubscription = useRef(null);

  const stopTracking = useCallback(async () => {
    if (locationSubscription.current) {
      locationSubscription.current.remove();
      locationSubscription.current = null;
    }

    // Stop background updates if running
    try {
      const isRegistered = await Location.hasStartedLocationUpdatesAsync(BACKGROUND_LOCATION_TASK).catch(() => false);
      if (isRegistered) {
        await Location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
        console.log('[TRACKING] Background location updates stopped.');
      }
    } catch (e) {
      console.warn('[TRACKING] Could not stop background updates:', e.message);
    }

    // Clear station state from storage
    await AsyncStorage.multiRemove([
      'active_station_code',
      'train_movement_locations',
    ]).catch(() => {});

    setIsTracking(false);
    setTrackingStatus(TRACKING_STATUS.IDLE);
    setDistanceMeters(null);
    setLocation(null);
    setSpeed(0);
  }, []);

  const startTracking = useCallback(async () => {
    // 1. Foreground permission (required for watchPositionAsync)
    const { status: fgStatus } = await Location.requestForegroundPermissionsAsync();
    if (fgStatus !== 'granted') {
      setTrackingStatus(TRACKING_STATUS.ERROR);
      return false;
    }

    setIsTracking(true);
    setTrackingStatus(TRACKING_STATUS.LOADING);

    // 2. Foreground watch for continuous speed/heading display
    locationSubscription.current = await Location.watchPositionAsync(
      { accuracy: Location.Accuracy.BestForNavigation, distanceInterval: 10 },
      (loc) => {
        setLocation(loc.coords);
        setSpeed(Math.max(0, loc.coords.speed || 0) * 3.6); // convert m/s → km/h
        setHeading(loc.coords.heading || 0);
      }
    );

    // 3. Background permission + background task startup
    try {
      const { status: bgStatus } = await Location.requestBackgroundPermissionsAsync();
      if (bgStatus === 'granted') {
        const isRegistered = await Location.hasStartedLocationUpdatesAsync(BACKGROUND_LOCATION_TASK).catch(() => false);
        if (!isRegistered) {
          await Location.startLocationUpdatesAsync(BACKGROUND_LOCATION_TASK, {
            accuracy: Location.Accuracy.Balanced,
            distanceInterval: 50, // update every 50 m to save battery
            deferredUpdatesInterval: 10000, // or every 10 s
            foregroundService: {
              notificationTitle: 'Thirakkundo',
              notificationBody: 'Detecting your train in the background…',
              notificationColor: '#6366f1',
            },
            pausesUpdatesAutomatically: false,
          });
          console.log('[TRACKING] Background location updates started.');
        }
      } else {
        console.warn('[TRACKING] Background permission not granted; background matching disabled.');
      }
    } catch (e) {
      console.warn('[TRACKING] Background startup error:', e.message);
    }

    return true;
  }, []);

  const updateLocation = useCallback(async () => {
    try {
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.BestForNavigation });
      setLocation(loc.coords);
      setSpeed(Math.max(0, loc.coords.speed || 0) * 3.6);
      setHeading(loc.coords.heading || 0);
      return loc.coords;
    } catch (e) {
      setTrackingStatus(TRACKING_STATUS.ERROR);
      return null;
    }
  }, []);

  /**
   * Persist the active station code so the background task can pass it to /api/trains/match.
   * Call this from TrackingScreen whenever the nearest station changes or the user enters/exits.
   */
  const setActiveStationCode = useCallback(async (stationCode) => {
    if (stationCode) {
      await AsyncStorage.setItem('active_station_code', stationCode);
    } else {
      await AsyncStorage.removeItem('active_station_code');
    }
  }, []);

  /**
   * Boarding detection (foreground path).
   * Returns the most likely recently-departed train when speed threshold is met.
   * Direction comparison is a future enhancement.
   */
  const checkBoarding = useCallback((recentDepartures) => {
    if (speed < 20) return null; // Not moving fast enough to be on a train

    // Find the most recently departed train from the live board
    const probableTrain = recentDepartures?.find(t => t.status?.hasDeparted);
    return probableTrain || null;
  }, [speed, heading]);

  useEffect(() => {
    return () => {
      if (locationSubscription.current) locationSubscription.current.remove();
    };
  }, []);

  return {
    isTracking,
    trackingStatus,
    setTrackingStatus,
    distanceMeters,
    setDistanceMeters,
    location,
    speed,
    heading,
    startTracking,
    stopTracking,
    updateLocation,
    checkBoarding,
    setActiveStationCode,
  };
};
