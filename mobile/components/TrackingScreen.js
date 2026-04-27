import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  SafeAreaView,
  StatusBar,
  Animated,
  StyleSheet,
  Platform,
  Linking,
  TouchableOpacity,
  Image,
} from 'react-native';
import * as Location from 'expo-location';
import { Ionicons } from '@expo/vector-icons';
import { Accelerometer } from 'expo-sensors';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { BACKGROUND_LOCATION_TASK } from '../utils/backgroundTask';

import { haversineDistance, formatDistance, isWithinBoundary } from '../utils/haversine';
import { fetchNearbyStations, fetchStationLiveBoard } from '../utils/api';
import { getRoadDistance } from '../utils/ors';
import { useToast } from './Toast';
import Intro3D from './Intro3D';
import {
  Card,
  CardHeader,
  CardContent,
  CardFooter,
  Badge,
  Button,
  Separator,
  Avatar,
  Skeleton,
} from './ui';

// ─── Constants ─────────────────────────────────────────────────────────────────
const BOUNDARY_METERS = 500;
const INTERVAL_INSIDE = 30 * 1000;     // 30 seconds
const INTERVAL_OUTSIDE = 5 * 60 * 1000; // 5 minutes

const PERMISSION_STATUS = {
  CHECKING: 'checking',  // app just opened, checking existing permission
  PROMPT: 'prompt',      // need to ask the user
  GRANTED: 'granted',    // permission allowed
  DENIED: 'denied',      // user said no (one-time or permanent)
  BLOCKED: 'blocked',    // permanently denied — must open Settings
};

const TRACKING_STATUS = {
  IDLE: 'idle',
  LOADING: 'loading',
  INSIDE: 'inside',
  OUTSIDE: 'outside',
  ERROR: 'error',
};

// ─── Main Screen ───────────────────────────────────────────────────────────────
export default function TrackingScreen() {
  const { showToast } = useToast();

  // ── 3D Intro State ──────────────────────────────────────────────────────
  const [showIntro, setShowIntro] = useState(true);

  // ── Permission Gate State ─────────────────────────────────────────────────

  // ── Permission Gate State ─────────────────────────────────────────────────
  const [permissionStatus, setPermissionStatus] = useState(PERMISSION_STATUS.CHECKING);

  // ── Tracking State ────────────────────────────────────────────────────────
  const [trackingStatus, setTrackingStatus] = useState(TRACKING_STATUS.IDLE);
  const [isTracking, setIsTracking] = useState(false);
  const [userLocation, setUserLocation] = useState(null);
  const [nearestStation, setNearestStation] = useState(null);
  const [allStations, setAllStations] = useState([]);
  const [distanceMeters, setDistanceMeters] = useState(null); // Straight-line distance
  const [roadDistance, setRoadDistance] = useState(null);     // ORS road distance
  const [roadDuration, setRoadDuration] = useState(null);     // ORS road duration
  const [lastChecked, setLastChecked] = useState(null);
  const [intervalMode, setIntervalMode] = useState(null);
  const [locationError, setLocationError] = useState(null);

  // ── Live Board State ──────────────────────────────────────────────────────
  const [liveBoard, setLiveBoard] = useState(null);        // { totalTrains, trains[] }
  const [liveBoardLoading, setLiveBoardLoading] = useState(false);
  const [liveBoardError, setLiveBoardError] = useState(null);
  const [matchedTrainData, setMatchedTrainData] = useState(null);
  
  // ── Navigation State ──────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState('track'); // 'track', 'speed', 'history', 'settings'
  const [liveSpeed, setLiveSpeed] = useState(0);
  const [tripHistory, setTripHistory] = useState([]);

  // ── Load History on Mount ──────────────────────────────────────────────────
  useEffect(() => {
    const loadHistory = async () => {
      try {
        const stored = await AsyncStorage.getItem('trip_history');
        if (stored) setTripHistory(JSON.parse(stored));
      } catch (err) {}
    };
    loadHistory();
  }, []);

  // ── Save to History Function ──────────────────────────────────────────────
  const addToHistory = async (trip) => {
    try {
      const stored = await AsyncStorage.getItem('trip_history');
      const currentHistory = stored ? JSON.parse(stored) : [];
      const newHistory = [trip, ...currentHistory.slice(0, 19)]; // Keep last 20
      setTripHistory(newHistory);
      await AsyncStorage.setItem('trip_history', JSON.stringify(newHistory));
    } catch (err) {}
  };

  // ── Dynamic Speed Watcher ─────────────────────────────────────────────────
  useEffect(() => {
    let subscription = null;
    if (activeTab === 'speed') {
      (async () => {
        const { status } = await Location.getForegroundPermissionsAsync();
        if (status === 'granted') {
          subscription = await Location.watchPositionAsync(
            { 
              accuracy: Location.Accuracy.BestForNavigation, 
              distanceInterval: 0,
              timeInterval: 500 
            },
            (location) => {
              if (location.coords.speed !== null && location.coords.speed >= 0) {
                // Convert m/s to km/h
                setLiveSpeed(location.coords.speed * 3.6);
              }
            }
          );
        }
      })();
    }
    return () => {
      if (subscription) {
        subscription.remove();
      }
    };
  }, [activeTab]);

  // ── Shake Detection ───────────────────────────────────────────────────────
  useEffect(() => {
    let subscription = null;
    
    // Check accelerometer every 100ms
    Accelerometer.setUpdateInterval(100);

    subscription = Accelerometer.addListener(({ x, y, z }) => {
      // Calculate magnitude of acceleration vector (1g is resting gravity)
      const force = Math.sqrt(x * x + y * y + z * z);
      
      // If force exceeds 2.0g, it's a solid shake
      if (force > 2.0 && activeTab !== 'speed') {
        setActiveTab('speed');
      }
    });

    return () => {
      if (subscription) {
        subscription.remove();
      }
    };
  }, [activeTab]);

  const intervalRef = useRef(null);
  const currentStatusRef = useRef(TRACKING_STATUS.IDLE);

  // ── Animations ────────────────────────────────────────────────────────────
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(40)).current;

  // Fade-in permission screen on mount
  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 600, useNativeDriver: true }),
      Animated.spring(slideAnim, { toValue: 0, tension: 80, friction: 10, useNativeDriver: true }),
    ]).start();
    
    // Poll for matched train from background task
    const pollInterval = setInterval(async () => {
      try {
        const dataStr = await AsyncStorage.getItem('matched_train_result');
        if (dataStr) {
          const data = JSON.parse(dataStr);
          setMatchedTrainData(data);
          
          // If this is a new match, add to history
          const lastId = await AsyncStorage.getItem('last_history_id');
          if (data.trainNumber !== lastId) {
            addToHistory({
              id: Date.now().toString(),
              trainName: data.trainName,
              trainNumber: data.trainNumber,
              date: new Date().toLocaleDateString(),
              time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
              route: `${data.source} → ${data.destination}`
            });
            await AsyncStorage.setItem('last_history_id', data.trainNumber);
          }
        }
      } catch (err) {}
    }, 5000);
    return () => clearInterval(pollInterval);
  }, [tripHistory]);

  // ── STEP 1: Check existing permission on app open ─────────────────────────
  useEffect(() => {
    checkExistingPermission();
  }, []);

  const checkExistingPermission = async () => {
    try {
      const { status } = await Location.getForegroundPermissionsAsync();

      if (status === 'granted') {
       
        setPermissionStatus(PERMISSION_STATUS.GRANTED);
        beginTracking(); 
      } else if (status === 'denied') {
       
        setPermissionStatus(PERMISSION_STATUS.BLOCKED);
      } else {
        setPermissionStatus(PERMISSION_STATUS.PROMPT);
      }
    } catch {
      setPermissionStatus(PERMISSION_STATUS.PROMPT);
    }
  };

  // ── STEP 2: Request permission when user taps "Allow Location" ────────────
  const requestPermission = async () => {
    try {
      const { status, canAskAgain } = await Location.requestForegroundPermissionsAsync();

      if (status === 'granted') {
        // Also request background permission
        await Location.requestBackgroundPermissionsAsync();
        
        setPermissionStatus(PERMISSION_STATUS.GRANTED);
        showToast('Location access granted!', 'success');
        beginTracking(); // auto-start tracking immediately
      } else if (!canAskAgain) {
        // Permanently denied — direct to Settings
        setPermissionStatus(PERMISSION_STATUS.BLOCKED);
        showToast('Location blocked. Please enable in Settings.', 'error');
      } else {
        setPermissionStatus(PERMISSION_STATUS.DENIED);
        showToast('Location permission denied', 'warning');
      }
    } catch (err) {
      showToast('Failed to request location permission', 'error');
    }
  };

  // ── Open device Settings for blocked permission ───────────────────────────
  const openSettings = () => {
    Linking.openSettings();
  };

  // ── Retry from denied state ───────────────────────────────────────────────
  const retryPermission = () => {
    setPermissionStatus(PERMISSION_STATUS.PROMPT);
  };

  // ── Pulse animation while tracking ───────────────────────────────────────
  useEffect(() => {
    if (isTracking) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1.3, duration: 700, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1, duration: 700, useNativeDriver: true }),
        ])
      ).start();
    } else {
      pulseAnim.setValue(1);
    }
  }, [isTracking]);

  // ── Core geofencing check ─────────────────────────────────────────────────
  const checkLocation = useCallback(async () => {
    try {
      const { coords } = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
      });

      const { latitude, longitude } = coords;
      setUserLocation({ lat: latitude, lng: longitude });
      setLastChecked(new Date());
      setLocationError(null);

      let stations = [];
      try {
        const result = await fetchNearbyStations(latitude, longitude, 5000);
        stations = result.stations || [];
        setAllStations(stations);
      } catch (apiErr) {
        console.warn('[API] Backend unavailable:', apiErr.message);
      }

      // Haversine distance to every station → find nearest
      let nearest = null;
      let minDist = Infinity;

      stations.forEach((station) => {
        const sLat = station.coordinates?.lat ?? station.location?.coordinates?.[1];
        const sLng = station.coordinates?.lng ?? station.location?.coordinates?.[0];
        if (sLat === undefined || sLng === undefined) return;

        const dist = haversineDistance(latitude, longitude, sLat, sLng);
        if (dist < minDist) {
          minDist = dist;
          nearest = station;
        }
      });

      setNearestStation(nearest);
      setDistanceMeters(minDist === Infinity ? null : Math.round(minDist));

      // ── Get real road distance for the nearest station ──
      let actualDistance = minDist;
      if (nearest) {
        const sLat = nearest.coordinates?.lat ?? nearest.location?.coordinates?.[1];
        const sLng = nearest.coordinates?.lng ?? nearest.location?.coordinates?.[0];
        
        const roadData = await getRoadDistance(latitude, longitude, sLat, sLng);
        if (roadData) {
          setRoadDistance(roadData.distanceMeters);
          setRoadDuration(roadData.durationSeconds);
          actualDistance = roadData.distanceMeters; // Use road distance for boundary check if available
        } else {
          setRoadDistance(null);
          setRoadDuration(null);
        }
      }

      const inside = actualDistance !== Infinity && isWithinBoundary(actualDistance, BOUNDARY_METERS);
      const prevStatus = currentStatusRef.current;

      if (inside) {
        if (prevStatus !== TRACKING_STATUS.INSIDE) {
          showToast(`You are near ${nearest.stationName}`, 'success');
          setIntervalMode('30s');
          scheduleInterval(INTERVAL_INSIDE);

          // ── Auto-fetch live board when user first enters station ──
          setLiveBoard(null);
          setLiveBoardError(null);
          setLiveBoardLoading(true);
          fetchStationLiveBoard(nearest.stationCode)
            .then((data) => {
              setLiveBoard(data);
              showToast(`${data.totalTrains} train(s) at ${nearest.stationCode} in next 2h`, 'info');
            })
            .catch((err) => {
              console.warn('[LIVE BOARD]', err.message);
              setLiveBoardError(err.message);
            })
            .finally(() => setLiveBoardLoading(false));
        }
        setTrackingStatus(TRACKING_STATUS.INSIDE);
        currentStatusRef.current = TRACKING_STATUS.INSIDE;
      } else {
        if (prevStatus === TRACKING_STATUS.INSIDE || prevStatus === TRACKING_STATUS.LOADING) {
          showToast('You are outside the boundary', 'warning');
          setIntervalMode('5min');
          scheduleInterval(INTERVAL_OUTSIDE);
        }
        setTrackingStatus(TRACKING_STATUS.OUTSIDE);
        currentStatusRef.current = TRACKING_STATUS.OUTSIDE;
      }
    } catch (err) {
      console.error('[LOCATION ERROR]', err.message);
      setLocationError(err.message);
      showToast('Failed to get location', 'error');
      setTrackingStatus(TRACKING_STATUS.ERROR);
      currentStatusRef.current = TRACKING_STATUS.ERROR;
    }
  }, [showToast]);

  // ── Interval scheduler ────────────────────────────────────────────────────
  const scheduleInterval = useCallback((ms) => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    intervalRef.current = setInterval(() => {
      checkLocation();
    }, ms);
  }, [checkLocation]);

  // ── Begin tracking (called after permission granted) ──────────────────────
  const beginTracking = useCallback(async () => {
    setTrackingStatus(TRACKING_STATUS.LOADING);
    currentStatusRef.current = TRACKING_STATUS.LOADING;
    setIsTracking(true);
    setLocationError(null);
    
    try {
      await Location.startLocationUpdatesAsync(BACKGROUND_LOCATION_TASK, {
        accuracy: Location.Accuracy.Balanced,
        distanceInterval: 50, // Only trigger if moved 50 meters
        showsBackgroundLocationIndicator: true,
      });
    } catch (e) {
      console.log('Background location start error:', e);
    }
    
    await checkLocation();
    showToast('Location fetched successfully', 'info');
  }, [checkLocation, showToast]);

  // ── Manual start (button press) ───────────────────────────────────────────
  const startTracking = useCallback(async () => {
    await beginTracking();
  }, [beginTracking]);

  // ── Stop tracking ─────────────────────────────────────────────────────────
  const stopTracking = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    setIsTracking(false);
    
    Location.hasStartedLocationUpdatesAsync(BACKGROUND_LOCATION_TASK).then((hasStarted) => {
      if (hasStarted) Location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
    });

    setTrackingStatus(TRACKING_STATUS.IDLE);
    currentStatusRef.current = TRACKING_STATUS.IDLE;
    setIntervalMode(null);
    showToast('Tracking stopped', 'default');
  }, [showToast]);

  // ── Cleanup on unmount ───────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  // ─── RENDER: Real-time 3D Intro ──────────────────────────────────────────
  if (showIntro) {
    return <Intro3D onFinish={() => setShowIntro(false)} />;
  }

  // ─── RENDER: Permission checking splash ────────────────────────────────────
  if (permissionStatus === PERMISSION_STATUS.CHECKING) {
    return (
      <SafeAreaView style={styles.safe}>
        <StatusBar barStyle="light-content" backgroundColor="#09090b" />
        <View style={styles.permissionCenter}>
          <Animated.View style={{ opacity: fadeAnim }}>
            <View style={styles.splashIcon}>
              <Text style={styles.splashEmoji}>🚉</Text>
            </View>
            <Text style={styles.splashTitle}>Station Finder</Text>
            <Text style={styles.splashSub}>Checking permissions...</Text>
          </Animated.View>
        </View>
      </SafeAreaView>
    );
  }

  // ─── RENDER: Permission Prompt Screen ─────────────────────────────────────
  if (
    permissionStatus === PERMISSION_STATUS.PROMPT ||
    permissionStatus === PERMISSION_STATUS.DENIED ||
    permissionStatus === PERMISSION_STATUS.BLOCKED
  ) {
    const isBlocked = permissionStatus === PERMISSION_STATUS.BLOCKED;
    const isDenied = permissionStatus === PERMISSION_STATUS.DENIED;

    return (
      <SafeAreaView style={styles.safe}>
        <StatusBar barStyle="light-content" backgroundColor="#09090b" />
        <Animated.View
          style={[
            styles.permissionScreen,
            { opacity: fadeAnim, transform: [{ translateY: slideAnim }] },
          ]}
        >
          {/* Icon */}
          <View style={styles.permIconWrapper}>
            <View style={[styles.permIconBg, isBlocked && { backgroundColor: '#450a0a' }]}>
              <Text style={styles.permIconEmoji}>{isBlocked ? '🔒' : '📍'}</Text>
            </View>
            {/* Glow ring */}
            <View
              style={[
                styles.permIconRing,
                isBlocked && { borderColor: '#dc2626' },
              ]}
            />
          </View>

          {/* Title */}
          <Text style={styles.permTitle}>
            {isBlocked
              ? 'Location Blocked'
              : isDenied
              ? 'Permission Denied'
              : 'Allow Location Access'}
          </Text>

          {/* Description */}
          <Text style={styles.permDesc}>
            {isBlocked
              ? 'You previously blocked location access. Please open your device Settings and enable location permission for this app.'
              : isDenied
              ? 'Location access was denied. This app needs your GPS location to find nearby railway stations and track your proximity.'
              : 'This app needs your GPS location to:\n\n• Find nearby railway stations\n• Calculate your distance to stations\n• Alert you when you enter or exit a station boundary'}
          </Text>

          {/* Feature chips */}
          {!isBlocked && !isDenied && (
            <View style={styles.featChips}>
              <FeatureChip icon="📡" label="GPS Only" />
              <FeatureChip icon="🔒" label="Private" />
              <FeatureChip icon="⚡" label="Accurate" />
            </View>
          )}

          {/* Privacy note */}
          <View style={styles.privacyNote}>
            <Text style={styles.privacyText}>
              🔐 Your location is never stored or shared. It's only used locally to detect nearby stations.
            </Text>
          </View>

          {/* Action buttons */}
          <View style={styles.permButtons}>
            {isBlocked ? (
              <>
                <Button
                  label="Open Settings"
                  variant="default"
                  onPress={openSettings}
                  style={styles.permBtn}
                />
                <Button
                  label="Check Again"
                  variant="outline"
                  onPress={checkExistingPermission}
                  style={styles.permBtn}
                />
              </>
            ) : isDenied ? (
              <>
                <Button
                  label="Try Again"
                  variant="default"
                  onPress={retryPermission}
                  style={styles.permBtn}
                />
                <Button
                  label="Open Settings"
                  variant="outline"
                  onPress={openSettings}
                  style={styles.permBtn}
                />
              </>
            ) : (
              <Button
                label="Allow Location Access"
                variant="default"
                onPress={requestPermission}
                style={[styles.permBtn, styles.permBtnPrimary]}
              />
            )}
          </View>

          {/* App badge */}
          <View style={styles.appBadge}>
            <Text style={styles.appBadgeText}><Ionicons name="train" size={12} color="#a1a1aa" />  Railway Station Finder · TEST BUILD</Text>
          </View>
        </Animated.View>
      </SafeAreaView>
    );
  }

  // ─── RENDER: Main Tracking Screen (permission === GRANTED) ─────────────────
  const statusConfig = {
    [TRACKING_STATUS.IDLE]: { label: 'Not Tracking', color: '#a1a1aa', bg: '#27272a', dot: '#71717a' },
    [TRACKING_STATUS.LOADING]: { label: 'Getting Location...', color: '#a5b4fc', bg: '#1e1b4b', dot: '#6366f1' },
    [TRACKING_STATUS.INSIDE]: { label: 'Near Station ✓', color: '#4ade80', bg: '#14532d', dot: '#22c55e' },
    [TRACKING_STATUS.OUTSIDE]: { label: 'Outside Boundary', color: '#fbbf24', bg: '#422006', dot: '#f59e0b' },
    [TRACKING_STATUS.ERROR]: { label: 'Location Error', color: '#f87171', bg: '#450a0a', dot: '#ef4444' },
  };

  const sc = statusConfig[trackingStatus] || statusConfig[TRACKING_STATUS.IDLE];

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="light-content" backgroundColor="#09090b" />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {/* ── HEADER ── */}
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <Text style={styles.appTitle}>Station Finder</Text>
            <Text style={styles.appSubtitle}>Smart Auto-Detection</Text>
          </View>
          <View style={styles.headerRight}>
            <View style={styles.locationGrantedPill}>
              <View style={[styles.greenDot, isTracking ? { backgroundColor: '#10b981' } : { backgroundColor: '#71717a' }]} />
              <Text style={[styles.locationGrantedText, isTracking ? { color: '#10b981' } : { color: '#a1a1aa' }]}>
                {isTracking ? 'Live' : 'Paused'}
              </Text>
            </View>
          </View>
        </View>

        {activeTab === 'track' && (
          <View style={styles.tabContent}>
            {matchedTrainData && (
              <View style={styles.premiumCard}>
                <View style={styles.premiumHeader}>
                  <Ionicons name="train" size={28} color="#10b981" style={{ marginRight: 8 }} />
                  <Text style={styles.premiumTitle}>Train Detected</Text>
                </View>
                <Text style={styles.premiumText}>
                  You're currently traveling on <Text style={styles.boldText}>{matchedTrainData.train.trainNumber} - {matchedTrainData.train.trainName}</Text> from {matchedTrainData.departureStation}.
                </Text>
                <TouchableOpacity 
                  style={styles.premiumButton}
                  onPress={() => {
                    showToast('Boarding Confirmed!', 'success');
                    setMatchedTrainData(null);
                    AsyncStorage.removeItem('matched_train_result');
                  }}
                >
                  <Text style={styles.premiumButtonText}>Confirm Boarding</Text>
                </TouchableOpacity>
              </View>
            )}

            {/* Main Action Area */}
            <View style={styles.actionContainer}>
              <TouchableOpacity 
                style={[styles.mainActionButton, isTracking ? styles.mainActionStop : styles.mainActionStart]}
                onPress={isTracking ? stopTracking : startTracking}
                disabled={trackingStatus === TRACKING_STATUS.LOADING}
              >
                {trackingStatus === TRACKING_STATUS.LOADING ? (
                  <Text style={[styles.mainActionText, isTracking && { color: '#fff' }]}>Loading...</Text>
                ) : (
                  <Text style={[styles.mainActionText, isTracking && { color: '#fff' }]}>{isTracking ? 'Stop Tracking' : 'Start Tracking'}</Text>
                )}
              </TouchableOpacity>
              <View style={styles.statusMinimalWrapper}>
                <Text style={styles.statusMinimalText}>{sc.label}</Text>
              </View>
            </View>

            {nearestStation && distanceMeters !== null && (
              <View style={styles.minimalCard}>
                <View style={styles.minimalRow}>
                  <View>
                    <Text style={styles.minimalLabel}>NEAREST STATION</Text>
                    <Text style={styles.minimalValue}>{nearestStation.stationName}</Text>
                    <Text style={styles.minimalSub}>{nearestStation.stationCode}</Text>
                  </View>
                  <View style={styles.minimalRight}>
                    <Text style={styles.minimalDistance}>
                      {roadDistance !== null ? formatDistance(roadDistance) : formatDistance(distanceMeters)}
                    </Text>
                    <Text style={[styles.minimalStatus, (distanceMeters !== null && distanceMeters <= BOUNDARY_METERS) ? {color: '#10b981'} : {color: '#f59e0b'}]}>
                      {(distanceMeters !== null && distanceMeters <= BOUNDARY_METERS) ? 'In Range' : 'Out of Range'}
                    </Text>
                  </View>
                </View>
              </View>
            )}

            {(liveBoardLoading || liveBoard || liveBoardError) && (
              <View style={styles.minimalCard}>
                <View style={styles.minimalHeader}>
                  <Text style={styles.minimalLabel}>LIVE DEPARTURES</Text>
                  {liveBoardLoading && <Text style={styles.minimalSub}>Updating...</Text>}
                </View>
                
                {liveBoardError && (
                  <Text style={styles.errorTextMinimal}>{liveBoardError}</Text>
                )}
                
                {liveBoard && !liveBoardLoading && liveBoard.trains.length === 0 && (
                  <Text style={styles.emptyText}>No trains in next 2 hours.</Text>
                )}

                {liveBoard && !liveBoardLoading && liveBoard.trains.slice(0, 3).map((train, idx) => (
                  <View key={idx} style={styles.trainRowMinimal}>
                    <View style={styles.trainRowLeft}>
                      <Text style={styles.trainNumText}>{train.trainNumber}</Text>
                      <Text style={styles.trainDestText}>{train.toCode || 'Unknown'}</Text>
                    </View>
                    <View style={styles.trainRowRight}>
                      <Text style={styles.trainTimeText}>{train.expected?.departure || train.scheduled?.departure || '--:--'}</Text>
                      {train.delay?.departure && train.delay.departure !== '0 min' && (
                        <Text style={styles.trainDelayText}>+{train.delay.departure}</Text>
                      )}
                    </View>
                  </View>
                ))}
                {liveBoard && liveBoard.trains.length > 3 && (
                  <Text style={styles.moreText}>+{liveBoard.trains.length - 3} more trains</Text>
                )}
              </View>
            )}
          </View>
        )}

        {activeTab === 'speed' && (
          <View style={styles.tabContent}>
            <View style={[styles.minimalCard, { alignItems: 'center', paddingVertical: 50, marginTop: 20 }]}>
              <View style={styles.speedCircle}>
                <Text style={styles.minimalLabel}>CURRENT SPEED</Text>
                <View style={styles.speedValueRow}>
                  <Text style={styles.speedValueMain}>
                    {Math.round(liveSpeed)}
                  </Text>
                  <Text style={styles.speedUnit}>KM/H</Text>
                </View>
                <View style={styles.speedIndicatorBar}>
                  <View style={[styles.speedIndicatorFill, { width: `${Math.min(liveSpeed, 120) / 1.2}%` }]} />
                </View>
              </View>
              
              <View style={styles.accuracyNote}>
                <Ionicons name="shield-checkmark" size={14} color="#10b981" />
                <Text style={styles.accuracyText}>High-Precision GPS Active</Text>
              </View>

              <Text style={styles.speedDisclaimer}>
                Using BestForNavigation mode. Data is updated every 500ms for maximum accuracy while traveling.
              </Text>
            </View>
          </View>
        )}

        {activeTab === 'history' && (
          <View style={styles.tabContent}>
            <View style={styles.minimalCard}>
              <Text style={styles.minimalLabel}>JOURNEY HISTORY</Text>
              {tripHistory.length === 0 ? (
                <Text style={styles.emptyText}>No recent trips detected yet.</Text>
              ) : (
                tripHistory.map((trip) => (
                  <View key={trip.id} style={styles.historyItem}>
                    <View style={styles.historyIcon}>
                      <Ionicons name="train-outline" size={20} color="#10b981" />
                    </View>
                    <View style={styles.historyInfo}>
                      <Text style={styles.historyTrain}>{trip.trainName}</Text>
                      <Text style={styles.historyRoute}>{trip.route}</Text>
                    </View>
                    <View style={styles.historyMeta}>
                      <Text style={styles.historyDate}>{trip.date}</Text>
                      <Text style={styles.historyTime}>{trip.time}</Text>
                    </View>
                  </View>
                ))
              )}
            </View>
          </View>
        )}

        {activeTab === 'settings' && (
          <View style={styles.tabContent}>
            <View style={styles.minimalCard}>
              <Text style={styles.minimalLabel}>DEBUG INFO</Text>
              {userLocation ? (
                <View style={styles.debugRow}>
                  <Text style={styles.debugText}>Lat: {userLocation.lat.toFixed(5)}</Text>
                  <Text style={styles.debugText}>Lng: {userLocation.lng.toFixed(5)}</Text>
                </View>
              ) : (
                <Text style={styles.debugText}>Location not available</Text>
              )}
              <Text style={styles.debugText}>Threshold: 500m</Text>
              {intervalMode && <Text style={styles.debugText}>Polling: {intervalMode}</Text>}
            </View>
          </View>
        )}
        
        <View style={{ height: 100 }} />
      </ScrollView>

      {/* ── BOTTOM NAV BAR ── */}
      <View style={styles.bottomNav}>
        <TouchableOpacity style={styles.navItem} onPress={() => setActiveTab('track')}>
          <Ionicons name={activeTab === 'track' ? "location" : "location-outline"} size={22} color={activeTab === 'track' ? "#fafafa" : "#71717a"} style={{ marginBottom: 4 }} />
          <Text style={[styles.navText, activeTab === 'track' && styles.navTextActive]}>Track</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.navItem} onPress={() => setActiveTab('speed')}>
          <Ionicons name={activeTab === 'speed' ? "speedometer" : "speedometer-outline"} size={22} color={activeTab === 'speed' ? "#fafafa" : "#71717a"} style={{ marginBottom: 4 }} />
          <Text style={[styles.navText, activeTab === 'speed' && styles.navTextActive]}>Speed</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.navItem} onPress={() => setActiveTab('history')}>
          <Ionicons name={activeTab === 'history' ? "time" : "time-outline"} size={22} color={activeTab === 'history' ? "#fafafa" : "#71717a"} style={{ marginBottom: 4 }} />
          <Text style={[styles.navText, activeTab === 'history' && styles.navTextActive]}>History</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.navItem} onPress={() => setActiveTab('settings')}>
          <Ionicons name={activeTab === 'settings' ? "settings" : "settings-outline"} size={22} color={activeTab === 'settings' ? "#fafafa" : "#71717a"} style={{ marginBottom: 4 }} />
          <Text style={[styles.navText, activeTab === 'settings' && styles.navTextActive]}>Settings</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

// ─── Sub-components ────────────────────────────────────────────────────────────

function LiveTrainRow({ train }) {
  const isCancelled = train.status?.isCancelled || train.status?.isArrivalCancelled;
  const isDiverted = train.status?.isDiverted;
  const hasArrived = train.status?.hasArrived;
  const hasDeparted = train.status?.hasDeparted;

  let statusLabel = 'Scheduled';
  let statusColor = '#a1a1aa';
  if (isCancelled) { statusLabel = 'Cancelled'; statusColor = '#ef4444'; }
  else if (hasDeparted) { statusLabel = 'Departed'; statusColor = '#71717a'; }
  else if (hasArrived) { statusLabel = 'Arrived'; statusColor = '#4ade80'; }
  else if (isDiverted) { statusLabel = 'Diverted'; statusColor = '#f59e0b'; }
  else if (train.delay?.arrival && train.delay.arrival !== '0 min') { statusLabel = 'Delayed'; statusColor = '#fb923c'; }

  return (
    <View style={styles.liveBoardRow}>
      {/* Train number + name */}
      <View style={styles.liveBoardLeft}>
        <Text style={styles.liveBoardTrainNum}>{train.trainNumber}</Text>
        <Text style={styles.liveBoardTrainName} numberOfLines={1}>{train.trainName ?? '—'}</Text>
        <Text style={styles.liveBoardRoute} numberOfLines={1}>
          {train.fromCode ?? '?'} → {train.toCode ?? '?'}
        </Text>
      </View>

      {/* Times + status */}
      <View style={styles.liveBoardRight}>
        <View style={styles.liveBoardTimeRow}>
          <Text style={styles.liveBoardTimeLabel}>Arr</Text>
          <Text style={styles.liveBoardTime}>{train.expected?.arrival ?? train.scheduled?.arrival ?? '—'}</Text>
        </View>
        <View style={styles.liveBoardTimeRow}>
          <Text style={styles.liveBoardTimeLabel}>Dep</Text>
          <Text style={styles.liveBoardTime}>{train.expected?.departure ?? train.scheduled?.departure ?? '—'}</Text>
        </View>
        {train.platform && (
          <Text style={styles.liveBoardPlatform}>PF {train.platform}</Text>
        )}
        <Text style={[styles.liveBoardStatus, { color: statusColor }]}>{statusLabel}</Text>
        {train.delay?.arrival && train.delay.arrival !== '0 min' && !isCancelled && (
          <Text style={styles.liveBoardDelay}>+{train.delay.arrival}</Text>
        )}
      </View>
    </View>
  );
}
function DetailItem({ label, value }) {
  return (
    <View style={styles.detailItem}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue}>{value}</Text>
    </View>
  );
}

function InfoRow({ icon, text }) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoIcon}>{icon}</Text>
      <Text style={styles.infoText}>{text}</Text>
    </View>
  );
}

function FeatureChip({ icon, label }) {
  return (
    <View style={styles.featureChip}>
      <Text style={styles.featureChipIcon}>{icon}</Text>
      <Text style={styles.featureChipLabel}>{label}</Text>
    </View>
  );
}

// ─── Styles ────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: '#09090b',
    paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight : 0,
  },

  // ── Shared Splash/Permission ──
  permissionCenter: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  splashIcon: {
    alignItems: 'center',
    marginBottom: 16,
  },
  splashEmoji: {
    fontSize: 56,
  },
  splashTitle: {
    fontSize: 28,
    fontWeight: '800',
    color: '#fafafa',
    textAlign: 'center',
    marginBottom: 8,
  },
  splashSub: {
    fontSize: 14,
    color: '#71717a',
    textAlign: 'center',
  },

  // ── Permission Screen ──
  permissionScreen: {
    flex: 1,
    paddingHorizontal: 28,
    paddingTop: 60,
    paddingBottom: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  permIconWrapper: {
    width: 120,
    height: 120,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 32,
  },
  permIconBg: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: '#1e1b4b',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'absolute',
  },
  permIconRing: {
    width: 120,
    height: 120,
    borderRadius: 60,
    borderWidth: 2,
    borderColor: '#6366f1',
    borderStyle: 'dashed',
    position: 'absolute',
    opacity: 0.6,
  },
  permIconEmoji: {
    fontSize: 44,
  },
  permTitle: {
    fontSize: 26,
    fontWeight: '800',
    color: '#fafafa',
    textAlign: 'center',
    marginBottom: 16,
    letterSpacing: -0.5,
  },
  permDesc: {
    fontSize: 15,
    color: '#a1a1aa',
    textAlign: 'center',
    lineHeight: 24,
    marginBottom: 28,
  },
  featChips: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 28,
    flexWrap: 'wrap',
    justifyContent: 'center',
  },
  featureChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#18181b',
    borderWidth: 1,
    borderColor: '#27272a',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 100,
  },
  featureChipIcon: {
    fontSize: 14,
  },
  featureChipLabel: {
    fontSize: 13,
    color: '#a1a1aa',
    fontWeight: '500',
  },
  privacyNote: {
    backgroundColor: '#18181b',
    borderWidth: 1,
    borderColor: '#27272a',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginBottom: 32,
    width: '100%',
  },
  privacyText: {
    fontSize: 12,
    color: '#71717a',
    textAlign: 'center',
    lineHeight: 18,
  },
  permButtons: {
    width: '100%',
    gap: 12,
    marginBottom: 32,
  },
  permBtn: {
    width: '100%',
  },
  permBtnPrimary: {
    shadowColor: '#6366f1',
    shadowOpacity: 0.4,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 12,
    elevation: 6,
  },
  appBadge: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: '#18181b',
    borderRadius: 100,
    borderWidth: 1,
    borderColor: '#27272a',
  },
  appBadgeText: {
    fontSize: 12,
    color: '#52525b',
    fontWeight: '500',
  },

  // ── Main Screen ──
  scroll: { flex: 1 },
  content: { padding: 16, gap: 16 },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
  },
  headerLeft: { gap: 2 },
  headerRight: { alignItems: 'flex-end', gap: 6 },
  appTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: '#fafafa',
    letterSpacing: -0.5,
  },
  appSubtitle: {
    fontSize: 13,
    color: '#71717a',
    fontWeight: '400',
  },
  locationGrantedPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#14532d',
    borderWidth: 1,
    borderColor: '#16a34a',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 100,
  },
  greenDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#4ade80',
  },
  locationGrantedText: {
    fontSize: 11,
    color: '#4ade80',
    fontWeight: '600',
  },
  card: { marginBottom: 0 },
  sectionLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#a1a1aa',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  liveDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  statusBanner: {
    paddingVertical: 16,
    paddingHorizontal: 20,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    marginBottom: 16,
  },
  statusText: { fontSize: 18, fontWeight: '700' },
  distanceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 12,
    flexWrap: 'wrap',
  },
  distanceLabel: { fontSize: 14, color: '#a1a1aa' },
  stationNameInline: { fontSize: 14, color: '#fafafa', fontWeight: '600' },
  distanceValue: { fontSize: 14, color: '#6366f1', fontWeight: '700' },
  thresholdInfo: { gap: 4 },
  thresholdText: { fontSize: 12, color: '#71717a' },
  thresholdValue: { color: '#a1a1aa', fontWeight: '600' },
  intervalText: { fontSize: 12, color: '#71717a' },
  intervalValue: { color: '#6366f1', fontWeight: '600' },
  stationRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 16,
    marginBottom: 4,
  },
  stationInfo: { flex: 1, gap: 4 },
  stationName: {
    fontSize: 20,
    fontWeight: '800',
    color: '#fafafa',
    letterSpacing: -0.3,
  },
  stationCode: {
    fontSize: 13,
    color: '#71717a',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontWeight: '500',
  },
  badgeRow: { flexDirection: 'row', gap: 6, marginTop: 4 },
  detailGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  detailItem: { width: '45%', gap: 2 },
  detailLabel: {
    fontSize: 11,
    color: '#71717a',
    fontWeight: '500',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  detailValue: { fontSize: 14, color: '#fafafa', fontWeight: '600' },
  distanceBig: { alignItems: 'center', paddingVertical: 8, gap: 4 },
  distanceBigLabel: {
    fontSize: 12,
    color: '#71717a',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  distanceBigValue: { fontSize: 40, fontWeight: '800', letterSpacing: -1 },
  distanceBigSub: { fontSize: 13, color: '#a1a1aa' },
  coordRow: { flexDirection: 'row', alignItems: 'center' },
  coordItem: { flex: 1, gap: 4 },
  coordDivider: {
    width: 1,
    height: 40,
    backgroundColor: '#27272a',
    marginHorizontal: 16,
  },
  coordLabel: {
    fontSize: 11,
    color: '#71717a',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  coordValue: {
    fontSize: 15,
    color: '#fafafa',
    fontWeight: '600',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  lastChecked: {
    fontSize: 12,
    color: '#52525b',
    marginTop: 12,
    textAlign: 'right',
  },
  errorTitle: { fontSize: 16, fontWeight: '700', color: '#f87171', marginBottom: 8 },
  errorText: { fontSize: 13, color: '#a1a1aa', lineHeight: 20 },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingVertical: 6,
  },
  infoIcon: { fontSize: 16, width: 24 },
  infoText: { flex: 1, fontSize: 14, color: '#a1a1aa', lineHeight: 20 },

  // ── Live Board ──────────────────────────────────────────────────────────────
  liveBoardRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingVertical: 12,
    paddingHorizontal: 4,
    borderBottomWidth: 1,
    borderBottomColor: '#27272a',
    gap: 8,
  },
  liveBoardLeft: {
    flex: 1,
    gap: 3,
  },
  liveBoardTrainNum: {
    fontSize: 15,
    fontWeight: '800',
    color: '#fafafa',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  
  // ── Bottom Nav Bar ────────────────────────────────────────────────────────
  bottomNav: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 80,
    backgroundColor: 'rgba(9, 9, 11, 0.85)',
    borderTopWidth: 1,
    borderTopColor: '#27272a',
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    paddingBottom: 20, // For home indicator
    backdropFilter: 'blur(10px)',
  },
  navItem: {
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1,
  },
  navIcon: {
    fontSize: 22,
    marginBottom: 4,
    opacity: 0.5,
  },
  navIconActive: {
    opacity: 1,
  },
  navText: {
    fontSize: 10,
    color: '#71717a',
    fontWeight: '600',
  },
  navTextActive: {
    color: '#fafafa',
  },

  // ── Minimal Premium UI Additions ──────────────────────────────────────────
  tabContent: {
    flex: 1,
    gap: 16,
    paddingTop: 8,
  },
  premiumCard: {
    backgroundColor: 'rgba(16, 185, 129, 0.1)',
    borderRadius: 20,
    padding: 20,
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.3)',
  },
  premiumHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  premiumIcon: {
    fontSize: 24,
    marginRight: 8,
  },
  premiumTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#10b981',
  },
  premiumText: {
    fontSize: 15,
    color: '#e4e4e7',
    lineHeight: 22,
    marginBottom: 16,
  },
  boldText: {
    fontWeight: '800',
    color: '#fff',
  },
  premiumButton: {
    backgroundColor: '#10b981',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  premiumButtonText: {
    color: '#000',
    fontWeight: '700',
    fontSize: 15,
  },
  actionContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 24,
  },
  mainActionButton: {
    width: 200,
    height: 60,
    borderRadius: 30,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  mainActionStart: {
    backgroundColor: '#fff',
  },
  mainActionStop: {
    backgroundColor: '#27272a',
    borderWidth: 1,
    borderColor: '#3f3f46',
  },
  mainActionText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#000',
  },
  statusMinimalText: {
    fontSize: 13,
    color: '#a1a1aa',
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  statusMinimalWrapper: {
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: '#18181b',
    borderWidth: 1,
    borderColor: '#27272a',
    marginTop: 8,
  },
  minimalCard: {
    backgroundColor: '#1c1c1e',
    borderRadius: 20,
    padding: 20,
  },
  minimalLabel: {
    fontSize: 11,
    color: '#71717a',
    fontWeight: '700',
    letterSpacing: 1,
    marginBottom: 8,
  },
  minimalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  minimalValue: {
    fontSize: 18,
    fontWeight: '700',
    color: '#fff',
  },
  minimalSub: {
    fontSize: 13,
    color: '#a1a1aa',
    marginTop: 2,
  },
  minimalRight: {
    alignItems: 'flex-end',
  },
  minimalDistance: {
    fontSize: 28,
    fontWeight: '800',
    color: '#818cf8',
    letterSpacing: -0.5,
  },
  minimalStatus: {
    fontSize: 12,
    fontWeight: '600',
    marginTop: 2,
  },
  minimalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  trainRowMinimal: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#27272a',
  },
  trainRowLeft: {
    flex: 1,
  },
  trainRowRight: {
    alignItems: 'flex-end',
  },
  trainNumText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#fff',
  },
  trainDestText: {
    fontSize: 13,
    color: '#a1a1aa',
    marginTop: 2,
  },
  trainTimeText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#fff',
  },
  trainDelayText: {
    fontSize: 12,
    color: '#f59e0b',
    fontWeight: '600',
    marginTop: 2,
  },
  moreText: {
    fontSize: 13,
    color: '#6366f1',
    textAlign: 'center',
    marginTop: 12,
    fontWeight: '600',
  },
  historyItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.05)',
  },
  historyIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(16, 185, 129, 0.1)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  historyInfo: {
    flex: 1,
  },
  historyTrain: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
  },
  historyRoute: {
    color: '#71717a',
    fontSize: 11,
    marginTop: 2,
  },
  historyMeta: {
    alignItems: 'flex-end',
  },
  historyDate: {
    color: '#10b981',
    fontSize: 10,
    fontWeight: '700',
  },
  historyTime: {
    color: '#3f3f46',
    fontSize: 10,
    marginTop: 2,
  },
  emptyText: {
    fontSize: 14,
    color: '#a1a1aa',
    fontStyle: 'italic',
    paddingVertical: 10,
  },
  errorTextMinimal: {
    color: '#ef4444',
    fontSize: 13,
    marginBottom: 8,
  },
  debugRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  debugText: {
    fontSize: 13,
    color: '#a1a1aa',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    marginBottom: 4,
  },

  liveBoardTrainName: {
    fontSize: 13,
    color: '#d4d4d8',
    fontWeight: '600',
  },
  liveBoardRoute: {
    fontSize: 12,
    color: '#71717a',
  },
  liveBoardRight: {
    alignItems: 'flex-end',
    gap: 3,
    minWidth: 100,
  },
  liveBoardTimeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  liveBoardTimeLabel: {
    fontSize: 11,
    color: '#52525b',
    width: 24,
    fontWeight: '600',
  },
  liveBoardTime: {
    fontSize: 13,
    color: '#a1a1aa',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontWeight: '600',
  },
  liveBoardPlatform: {
    fontSize: 11,
    color: '#6366f1',
    fontWeight: '700',
    backgroundColor: '#1e1b4b',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    overflow: 'hidden',
  },
  liveBoardStatus: {
    fontSize: 11,
    fontWeight: '700',
    marginTop: 2,
  },
  liveBoardDelay: {
    fontSize: 11,
    color: '#fb923c',
    fontWeight: '600',
  },
  liveBoardError: {
    paddingVertical: 12,
  },
  
  // ── Speedometer Styles ──
  speedCircle: {
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    paddingVertical: 20,
  },
  speedValueRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    marginVertical: 10,
  },
  speedValueMain: {
    fontSize: 92,
    fontWeight: '800',
    color: '#10b981',
    fontVariant: ['tabular-nums'],
    letterSpacing: -2,
  },
  speedUnit: {
    fontSize: 20,
    fontWeight: '700',
    color: '#71717a',
    marginLeft: 8,
    letterSpacing: 1,
  },
  speedIndicatorBar: {
    width: '80%',
    height: 6,
    backgroundColor: '#27272a',
    borderRadius: 3,
    marginTop: 20,
    overflow: 'hidden',
  },
  speedIndicatorFill: {
    height: '100%',
    backgroundColor: '#10b981',
    borderRadius: 3,
  },
  accuracyNote: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(16, 185, 129, 0.1)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    marginTop: 20,
    gap: 6,
  },
  accuracyText: {
    fontSize: 12,
    color: '#10b981',
    fontWeight: '600',
  },
  speedDisclaimer: {
    marginTop: 25,
    color: '#52525b',
    fontSize: 12,
    textAlign: 'center',
    paddingHorizontal: 30,
    lineHeight: 18,
  },

  // ── Intro Styles ──
  introContainer: {
    flex: 1,
    backgroundColor: '#000',
    alignItems: 'center',
    justifyContent: 'center',
  },
  introImage: {
    position: 'absolute',
    width: '100%',
    height: '100%',
  },
  introTrain: {
    position: 'absolute',
    width: 600,
    height: 300,
    bottom: 50,
  },
  fogOverlay: {
    position: 'absolute',
    top: 0,
    left: -200,
    width: '200%',
    height: '100%',
  },
  fogCloud: {
    width: 400,
    height: 400,
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    borderRadius: 200,
  },
  introOverlay: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    height: '100%',
  },
  introTitle: {
    fontSize: 32,
    fontWeight: '900',
    color: '#fff',
    letterSpacing: 8,
    textShadowColor: 'rgba(0, 0, 0, 0.75)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 10,
  },
  introLine: {
    width: 60,
    height: 3,
    backgroundColor: '#10b981',
    marginVertical: 15,
    borderRadius: 2,
  },
  introSub: {
    fontSize: 12,
    color: '#10b981',
    fontWeight: '700',
    letterSpacing: 4,
    textTransform: 'uppercase',
  },
});

