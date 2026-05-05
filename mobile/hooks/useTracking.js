import { useState, useRef, useCallback, useEffect } from 'react';
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
  const [speed, setSpeed] = useState(0);
  const [heading, setHeading] = useState(0);
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
    setSpeed(0);
  }, []);

  const startTracking = useCallback(async () => {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
      setTrackingStatus(TRACKING_STATUS.ERROR);
      return false;
    }

    setIsTracking(true);
    setTrackingStatus(TRACKING_STATUS.LOADING);

    // Watch position for continuous speed and heading
    locationSubscription.current = await Location.watchPositionAsync(
      { accuracy: Location.Accuracy.High, distanceInterval: 10 },
      (loc) => {
        setLocation(loc.coords);
        setSpeed((loc.coords.speed || 0) * 3.6); // km/h
        setHeading(loc.coords.heading || 0);
      }
    );

    return true;
  }, []);

  const updateLocation = useCallback(async () => {
    try {
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      setLocation(loc.coords);
      setSpeed((loc.coords.speed || 0) * 3.6);
      setHeading(loc.coords.heading || 0);
      return loc.coords;
    } catch (e) {
      setTrackingStatus(TRACKING_STATUS.ERROR);
      return null;
    }
  }, []);

  // Boarding detection logic
  const checkBoarding = useCallback((recentDepartures) => {
    if (speed < 20) return null; // Not moving fast enough
    
    // In a real app, we'd compare 'heading' with track direction from DB
    // For now, we correlate speed with a train that JUST departed (< 5 mins ago)
    const probableTrain = recentDepartures?.find(t => {
      // Check if train departed recently (status.hasDeparted is true)
      return t.status?.hasDeparted;
    });

    return probableTrain;
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
    checkBoarding
  };
};
