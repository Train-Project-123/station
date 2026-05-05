import { useState, useRef, useCallback } from 'react';
import * as Location from 'expo-location';

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
  const locationSubscription = useRef(null);

  const stopTracking = useCallback(() => {
    if (locationSubscription.current) {
      locationSubscription.current.remove();
      locationSubscription.current = null;
    }
    setIsTracking(false);
    setTrackingStatus(TRACKING_STATUS.IDLE);
    setDistanceMeters(null);
    setLocation(null);
  }, []);

  const startTracking = useCallback(async () => {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
      setTrackingStatus(TRACKING_STATUS.ERROR);
      return false;
    }

    setIsTracking(true);
    setTrackingStatus(TRACKING_STATUS.LOADING);
    return true;
  }, []);

  const updateLocation = useCallback(async () => {
    try {
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      setLocation(loc.coords);
      return loc.coords;
    } catch (e) {
      setTrackingStatus(TRACKING_STATUS.ERROR);
      return null;
    }
  }, []);

  return {
    isTracking,
    trackingStatus,
    setTrackingStatus,
    distanceMeters,
    setDistanceMeters,
    location,
    startTracking,
    stopTracking,
    updateLocation
  };
};
