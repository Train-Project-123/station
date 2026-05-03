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
  TextInput,
  Modal,
  KeyboardAvoidingView,
} from 'react-native';
import * as Location from 'expo-location';
import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import { Accelerometer } from 'expo-sensors';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { BACKGROUND_LOCATION_TASK } from '../utils/backgroundTask';

import { haversineDistance, formatDistance, isWithinBoundary } from '../utils/haversine';
import { fetchNearbyStations, fetchStationLiveBoard, addStation, fetchAllStations, verifyAdminPasscode, updateStation, deleteStation } from '../utils/api';
import { performMatch } from '../utils/trainDetection';
import { getRoadDistance } from '../utils/ors';
import { useToast } from './Toast';
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



  // ── Permission Gate State ─────────────────────────────────────────────────

  // ── Permission Gate State ─────────────────────────────────────────────────
  const [permissionStatus, setPermissionStatus] = useState(PERMISSION_STATUS.CHECKING);

  // ── Tracking State ────────────────────────────────────────────────────────
  const [trackingStatus, setTrackingStatus] = useState(TRACKING_STATUS.IDLE);
  const [isTracking, setIsTracking] = useState(false);
  const [userLocation, setUserLocation] = useState(null);
  const [nearestStation, setNearestStation] = useState(null);
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
  
  const [activeTab, setActiveTab] = useState('track'); // 'track', 'speed', 'history', 'settings'
  const [liveSpeed, setLiveSpeed] = useState(0);
  const [tripHistory, setTripHistory] = useState([]);
  
  // ── Drawer & Admin State ──
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [drawerTab, setDrawerTab] = useState('add'); // 'add', 'list'
  const [allStations, setAllStations] = useState([]);
  const [allStationsLoading, setAllStationsLoading] = useState(false);

  // ── Auth & Security State ──
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [passcodeInput, setPasscodeInput] = useState('');
  const [authError, setAuthError] = useState(false);

  // ── Admin Form State ──
  const [adminForm, setAdminForm] = useState({
    name: '',
    code: '',
    zone: '',
    state: '',
    lat: '',
    lng: ''
  });
  const [adminLoading, setAdminLoading] = useState(false);
  const [editingStationId, setEditingStationId] = useState(null);
  const [isEditMode, setIsEditMode] = useState(false);

  // ── Confirmation Modal State ──
  const [confirmModal, setConfirmModal] = useState({
    visible: false,
    title: '',
    message: '',
    onConfirm: null,
    type: 'danger' // 'danger' | 'info' | 'warning'
  });

  // ── Speed Monitor State (Step 1) ──────────────────────────────────────────
  const [speedHistory, setSpeedHistory] = useState([]); // Rolling last 5 speeds
  const [triggerTicks, setTriggerTicks] = useState(0); // Consecutive 5s intervals where avg > 20kmph
  const [isSpeedMonitorActive, setIsSpeedMonitorActive] = useState(false);
  const speedMonitorIntervalRef = useRef(null);

  const [isViewModalOpen, setIsViewModalOpen] = useState(false);
  const [viewingStation, setViewingStation] = useState(null);

  const loadAllStations = async () => {
    setAllStationsLoading(true);
    try {
      const stations = await fetchAllStations();
      setAllStations(stations);
    } catch (err) {
      showToast('Error loading stations', 'error');
    } finally {
      setAllStationsLoading(false);
    }
  };

  useEffect(() => {
    if (isDrawerOpen && drawerTab === 'list') {
      loadAllStations();
    }
  }, [isDrawerOpen, drawerTab]);

  // ── Load History on Mount ──────────────────────────────────────────────────
  useEffect(() => {
    const loadHistory = async () => {
      try {
        const stored = await AsyncStorage.getItem('trip_history');
        if (stored) {
          const parsed = JSON.parse(stored);
          // DEEP SCRUB: Deduplicate by ID and ensure every trip has an ID
          const unique = parsed.reduce((acc, current) => {
            const x = acc.find(item => item.id === current.id);
            if (!x) return acc.concat([current]);
            return acc;
          }, []);
          setTripHistory(unique);
        }
      } catch (err) {}
    };
    loadHistory();
  }, []);

  // ── Save to History Function ──────────────────────────────────────────────
  const addToHistory = async (trip) => {
    try {
      // Ensure trip has a unique ID to prevent "duplicate key" crashes
      const uniqueId = trip.id || `${Date.now()}-${Math.floor(Math.random() * 10000)}`;
      const tripWithId = { ...trip, id: uniqueId };

      const stored = await AsyncStorage.getItem('trip_history');
      const currentHistory = stored ? JSON.parse(stored) : [];
      
      // Filter out any existing trips with the same ID (deduplication)
      const filteredHistory = currentHistory.filter(t => t.id !== uniqueId);
      const newHistory = [tripWithId, ...filteredHistory.slice(0, 19)]; // Keep last 20
      
      setTripHistory(newHistory);
      await AsyncStorage.setItem('trip_history', JSON.stringify(newHistory));
    } catch (err) {
      console.error('[HISTORY] Save failed:', err.message);
    }
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
    if (Platform.OS === 'web') return; // Accelerometer not supported on web

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

  // ── STEP 1: Speed Monitor Logic ───────────────────────────────────────────
  useEffect(() => {
    if (trackingStatus === TRACKING_STATUS.INSIDE && !isSpeedMonitorActive) {
      setIsSpeedMonitorActive(true);
      startSpeedMonitor();
    } else if (trackingStatus !== TRACKING_STATUS.INSIDE && isSpeedMonitorActive) {
      stopSpeedMonitor();
      setIsSpeedMonitorActive(false);
    }
  }, [trackingStatus, isSpeedMonitorActive]);

  const startSpeedMonitor = () => {
    if (speedMonitorIntervalRef.current) clearInterval(speedMonitorIntervalRef.current);
    
    speedMonitorIntervalRef.current = setInterval(async () => {
      try {
        const { coords } = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
        const currentSpeedKmph = (coords.speed || 0) * 3.6;
        
        setSpeedHistory(prev => {
          const next = [...prev, currentSpeedKmph].slice(-5);
          const avg = next.length > 0 ? next.reduce((a, b) => a + b, 0) / next.length : 0;
          
          if (avg > 20) {
            setTriggerTicks(t => {
              const nextT = t + 1;
              if (nextT >= 9) { // 45 seconds
                const T_trigger = Math.floor(Date.now() / 1000);
                stopSpeedMonitor();
                setIsSpeedMonitorActive(false);
                handleSpeedTrigger(T_trigger);
                return 0;
              }
              return nextT;
            });
          } else {
            setTriggerTicks(0);
          }
          return next;
        });
      } catch (err) {
        console.error('[SPEED MONITOR] GPS poll failed:', err.message);
      }
    }, 5000);
  };

  const stopSpeedMonitor = () => {
    if (speedMonitorIntervalRef.current) {
      clearInterval(speedMonitorIntervalRef.current);
      speedMonitorIntervalRef.current = null;
    }
    setTriggerTicks(0);
    setSpeedHistory([]);
  };

  const handleSpeedTrigger = async (T_trigger) => {
    if (!nearestStation || !liveBoard || !liveBoard.trains) {
      // If no data, reset monitor and try again later
      setTimeout(() => {
        if (currentStatusRef.current === TRACKING_STATUS.INSIDE) {
          setIsSpeedMonitorActive(true);
          startSpeedMonitor();
        }
      }, 10000);
      return;
    }

    showToast('High speed detected! Matching train...', 'info');

    try {
      const result = await performMatch(T_trigger, nearestStation.stationCode, liveBoard.trains);
      
      if (result.status === 'SUCCESS') {
        const matched = {
          train: result.train,
          departureStation: nearestStation.stationName,
          confidence: result.confidence,
          timestamp: new Date().toISOString()
        };
        
        setMatchedTrainData(matched);
        await AsyncStorage.setItem('matched_train_result', JSON.stringify(matched));
        showToast(`Match Found: ${result.train.trainName} (${result.confidence})`, 'success');
      } else if (result.status === 'FALSE_TRIGGER' || result.status === 'NO_CANDIDATES' || result.status === 'LOW_CONFIDENCE') {
        const msg = result.status === 'FALSE_TRIGGER' ? 'False trigger detected. Resuming...' : 
                    result.status === 'LOW_CONFIDENCE' ? 'Low confidence match. Discarding...' :
                    'No matching train found. Resuming...';
        showToast(msg, 'warning');
        if (currentStatusRef.current === TRACKING_STATUS.INSIDE) {
          setIsSpeedMonitorActive(true);
          startSpeedMonitor();
        }
      }
    } catch (err) {
      console.error('[DETECTION] Match failed:', err);
      showToast('Error matching train.', 'error');
    }
  };

  const intervalRef = useRef(null);
  const currentStatusRef = useRef(TRACKING_STATUS.IDLE);
  const [intervalMs, setIntervalMs] = useState(null); // Managed by status effects

  // ── Animations ────────────────────────────────────────────────────────────
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const fadeAnim = useRef(new Animated.Value(Platform.OS === 'web' ? 1 : 0)).current;
  const slideAnim = useRef(new Animated.Value(Platform.OS === 'web' ? 0 : 40)).current;

  // Fade-in permission screen on mount
  useEffect(() => {
    const useNativeDriver = Platform.OS !== 'web';
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 600, useNativeDriver }),
      Animated.spring(slideAnim, { toValue: 0, tension: 80, friction: 10, useNativeDriver }),
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
              id: `${Date.now()}-${Math.floor(Math.random() * 1000)}`,
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
      const useNativeDriver = Platform.OS !== 'web';
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1.3, duration: 700, useNativeDriver }),
          Animated.timing(pulseAnim, { toValue: 1, duration: 700, useNativeDriver }),
        ])
      ).start();
    } else {
      pulseAnim.setValue(1);
    }
  }, [isTracking]);

  // ── Effect: Handle Tracking Interval based on ms state ──
  useEffect(() => {
    if (isTracking && intervalMs) {
      if (intervalRef.current) clearInterval(intervalRef.current);
      intervalRef.current = setInterval(() => {
        checkLocation();
      }, intervalMs);
      return () => {
        if (intervalRef.current) clearInterval(intervalRef.current);
      };
    } else {
      if (intervalRef.current) clearInterval(intervalRef.current);
    }
  }, [isTracking, intervalMs, checkLocation]);

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
          setIntervalMs(INTERVAL_INSIDE);

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
          setIntervalMs(INTERVAL_OUTSIDE);
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
  }, [
    showToast, 
    setLastChecked, 
    setUserLocation, 
    setLocationError, 
    setAllStations, 
    setNearestStation, 
    setDistanceMeters, 
    setRoadDistance, 
    setRoadDuration, 
    setLiveBoard, 
    setLiveBoardError, 
    setLiveBoardLoading, 
    setTrackingStatus, 
    setIntervalMode,
    setIntervalMs
  ]);

  // ── Begin tracking (called after permission granted) ──────────────────────
  const beginTracking = useCallback(async () => {
    setTrackingStatus(TRACKING_STATUS.LOADING);
    currentStatusRef.current = TRACKING_STATUS.LOADING;
    setIsTracking(true);
    setLocationError(null);
    setIntervalMs(INTERVAL_INSIDE);
    
      try {
        // Expo Go Android doesn't support background location
        if (Platform.OS === 'android' && Constants?.appOwnership === 'expo') {
          console.log('[LOCATION] Background tracking skipped (Expo Go limitation)');
        } else {
          await Location.startLocationUpdatesAsync(BACKGROUND_LOCATION_TASK, {
            accuracy: Location.Accuracy.Balanced,
            distanceInterval: 50,
            showsBackgroundLocationIndicator: true,
          });
        }
      } catch (e) {
        console.log('Background location start error:', e);
      }
    
    await checkLocation();
    showToast('Location fetched successfully', 'info');
  }, [checkLocation, showToast, setIntervalMs]);

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
    setIntervalMs(null);
    showToast('Tracking stopped', 'default');
  }, [showToast, setIntervalMs]);

  const confirmBoarding = async () => {
    showToast('Boarding Confirmed!', 'success');
    if (matchedTrainData) {
      addToHistory({
        id: `${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        trainName: matchedTrainData.train.trainName,
        trainNumber: matchedTrainData.train.trainNumber,
        date: new Date().toLocaleDateString(),
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        route: `${matchedTrainData.train.fromCode || 'Unknown'} → ${matchedTrainData.train.toCode || 'Unknown'}`
      });
    }
    setMatchedTrainData(null);
    await AsyncStorage.removeItem('matched_train_result');
    await AsyncStorage.removeItem('last_history_id');
  };

  const rejectBoarding = async () => {
    showToast('Match rejected. Recalculating...', 'info');
    setMatchedTrainData(null);
    await AsyncStorage.removeItem('matched_train_result');
    
    // Resume speed monitor
    if (currentStatusRef.current === TRACKING_STATUS.INSIDE) {
      setIsSpeedMonitorActive(true);
      startSpeedMonitor();
    }
  };

  // ── Cleanup on unmount ───────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);



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
            <Text style={styles.splashTitle}>Thirakkundo</Text>
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
            <Text style={styles.appBadgeText}><Ionicons name="train" size={12} color="#a1a1aa" />  Thirakkundo · TEST BUILD</Text>
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

  const renderAuthModal = () => (
    <Modal
      visible={isAuthModalOpen}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={() => setIsAuthModalOpen(false)}
    >
      <KeyboardAvoidingView 
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.authModalContainer}
      >
        <TouchableOpacity 
          style={styles.authModalBackdrop} 
          activeOpacity={1} 
          onPress={() => setIsAuthModalOpen(false)} 
        />
        <View style={styles.authModalContent}>
          <View style={styles.authModalHeader}>
            <Ionicons name="lock-closed" size={32} color="#6366f1" />
            <Text style={styles.authModalTitle}>ADMIN ACCESS</Text>
            <Text style={styles.authModalSub}>Enter 4-digit passcode</Text>
          </View>
          
          <View style={styles.passcodeContainer}>
            <TextInput
              style={[styles.passcodeInput, authError && { borderColor: '#ef4444' }]}
              placeholder="••••"
              placeholderTextColor="#27272a"
              keyboardType="number-pad"
              maxLength={4}
              secureTextEntry
              autoFocus
              value={passcodeInput}
              onChangeText={async (val) => {
                setPasscodeInput(val);
                setAuthError(false);
                if (val.length === 4) {
                  try {
                    const res = await verifyAdminPasscode(val);
                    if (res.success) {
                      setTimeout(() => {
                        setIsAuthModalOpen(false);
                        setPasscodeInput('');
                        setIsDrawerOpen(true);
                        showToast('Welcome, Admin', 'success');
                      }, 300);
                    } else {
                      setAuthError(true);
                      showToast('Invalid Passcode', 'error');
                      setPasscodeInput('');
                    }
                  } catch (e) {
                    showToast('Connection Error', 'error');
                  }
                }
              }}
            />
          </View>

          {/* Fixed-height container to prevent UI jerking */}
          <View style={{ height: 20, justifyContent: 'center', marginTop: 10 }}>
            {authError && (
              <Text style={{ color: '#ef4444', fontSize: 13, fontWeight: '600', textAlign: 'center' }}>
                Passcode incorrect
              </Text>
            )}
          </View>

          <TouchableOpacity 
            style={styles.authCancelBtn}
            onPress={() => setIsAuthModalOpen(false)}
          >
            <Text style={styles.authCancelText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );

  const renderConfirmModal = () => (
    <Modal
      visible={confirmModal.visible}
      transparent
      animationType="fade"
      onRequestClose={() => setConfirmModal(p => ({...p, visible: false}))}
    >
      <View style={styles.confirmOverlay}>
        <View style={styles.confirmContent}>
          <View style={[styles.confirmIconContainer, { backgroundColor: confirmModal.type === 'danger' ? '#450a0a' : '#1e1b4b' }]}>
            <Ionicons 
              name={confirmModal.type === 'danger' ? "trash-outline" : "alert-circle-outline"} 
              size={32} 
              color={confirmModal.type === 'danger' ? "#ef4444" : "#6366f1"} 
            />
          </View>
          <Text style={styles.confirmTitle}>{confirmModal.title}</Text>
          <Text style={styles.confirmMessage}>{confirmModal.message}</Text>
          
          <View style={styles.confirmActionRow}>
            <TouchableOpacity 
              style={styles.confirmCancelBtn}
              onPress={() => setConfirmModal(p => ({...p, visible: false}))}
            >
              <Text style={styles.confirmCancelText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity 
              style={[styles.confirmBtn, { backgroundColor: confirmModal.type === 'danger' ? '#ef4444' : '#6366f1' }]}
              onPress={() => {
                if (confirmModal.onConfirm) confirmModal.onConfirm();
                setConfirmModal(p => ({...p, visible: false}));
              }}
            >
              <Text style={styles.confirmBtnText}>Confirm</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );

  const renderAdminPanel = () => {
    if (!isDrawerOpen) return null;
    return (
      <Modal
        visible={isDrawerOpen}
        animationType="slide"
        statusBarTranslucent
        onRequestClose={() => {
          setConfirmModal({
            visible: true,
            title: 'Exit Admin?',
            message: 'Are you sure you want to exit the admin panel?',
            type: 'info',
            onConfirm: () => setIsDrawerOpen(false)
          });
        }}
      >
        <View style={[styles.drawerContent, { width: '100%' }]}>
          <SafeAreaView style={{ flex: 1, backgroundColor: '#09090b' }}>
            <View style={[styles.drawerHeader, { paddingTop: Platform.OS === 'android' ? 20 : 0 }]}>
              <View>
                <Text style={styles.drawerTitle}>ADMIN PANEL</Text>
                <Text style={{ color: '#71717a', fontSize: 12 }}>Manage Stations & Metadata</Text>
              </View>
              <TouchableOpacity 
                style={styles.exitAdminBtn}
                onPress={() => {
                  setConfirmModal({
                    visible: true,
                    title: 'Exit Admin?',
                    message: 'Return to tracking mode?',
                    type: 'info',
                    onConfirm: () => setIsDrawerOpen(false)
                  });
                }}
              >
                <Ionicons name="exit-outline" size={20} color="#ef4444" />
                <Text style={styles.exitAdminText}>Exit</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.drawerTabs}>
              <TouchableOpacity 
                style={[styles.drawerTab, (drawerTab === 'add' || isEditMode) && styles.drawerTabActive]} 
                onPress={() => {
                  setIsEditMode(false);
                  setEditingStationId(null);
                  setDrawerTab('add');
                }}
              >
                <Ionicons name="add-circle" size={18} color={(drawerTab === 'add' || isEditMode) ? '#fff' : '#71717a'} />
                <Text style={[styles.drawerTabText, (drawerTab === 'add' || isEditMode) && styles.drawerTabTextActive]}>
                  {isEditMode ? 'Editing' : 'Add Station'}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity 
                style={[styles.drawerTab, drawerTab === 'list' && !isEditMode && styles.drawerTabActive]} 
                onPress={() => {
                  setIsEditMode(false);
                  setDrawerTab('list');
                }}
              >
                <Ionicons name="list" size={18} color={(drawerTab === 'list' && !isEditMode) ? '#fff' : '#71717a'} />
                <Text style={[styles.drawerTabText, (drawerTab === 'list' && !isEditMode) && styles.drawerTabTextActive]}>Directory</Text>
              </TouchableOpacity>
            </View>

            <ScrollView style={{ flex: 1 }}>
              <View style={{ padding: 20 }}>
                {(drawerTab === 'add' || isEditMode) ? (
                  <View style={{ gap: 12 }}>
                    <Text style={styles.minimalLabel}>{isEditMode ? 'UPDATE STATION' : 'MANUAL ADDITION'}</Text>
                    {!isEditMode && (
                      <View style={styles.inputGroup}>
                        <Text style={styles.inputLabel}>Station Code</Text>
                        <View style={{ flexDirection: 'row', gap: 8 }}>
                          <View style={[styles.inputWrapper, { flex: 1 }]}>
                            <TextInput 
                              style={styles.nativeInput}
                              placeholder="e.g. CLT"
                              placeholderTextColor="#3f3f46"
                              onChangeText={(val) => setAdminForm(p => ({...p, code: val.toUpperCase()}))}
                              value={adminForm.code}
                            />
                          </View>
                          <TouchableOpacity 
                            style={styles.fetchBtn}
                            onPress={async () => {
                              if(!adminForm.code) return;
                              setAdminLoading(true);
                              try {
                                const res = await fetchStationLiveBoard(adminForm.code);
                                if(res && res.data && res.data.station) {
                                  const s = res.data.station;
                                  setAdminForm(p => ({
                                    ...p, 
                                    name: s.name || p.name,
                                    zone: s.zone || p.zone,
                                    state: s.state || p.state,
                                    lat: s.coordinates?.lat?.toString() || p.lat,
                                    lng: s.coordinates?.lng?.toString() || p.lng
                                  }));
                                  showToast('Details fetched!', 'success');
                                }
                              } catch(e) {
                                showToast('Fetch failed', 'error');
                              } finally {
                                setAdminLoading(false);
                              }
                            }}
                          >
                            <Text style={styles.fetchBtnText}>Fetch</Text>
                          </TouchableOpacity>
                        </View>
                      </View>
                    )}

                    <View style={styles.inputGroup}>
                      <Text style={styles.inputLabel}>Station Name</Text>
                      <View style={styles.inputWrapper}>
                        <TextInput 
                          style={styles.nativeInput}
                          placeholder="e.g. Kozhikode Main"
                          placeholderTextColor="#3f3f46"
                          onChangeText={(val) => setAdminForm(p => ({...p, name: val}))}
                          value={adminForm.name}
                        />
                      </View>
                    </View>

                    {isEditMode && (
                      <View style={styles.inputGroup}>
                        <Text style={styles.inputLabel}>Station Code</Text>
                        <View style={styles.inputWrapper}>
                          <TextInput 
                            style={styles.nativeInput}
                            placeholder="e.g. CLT"
                            placeholderTextColor="#3f3f46"
                            onChangeText={(val) => setAdminForm(p => ({...p, code: val.toUpperCase()}))}
                            value={adminForm.code}
                          />
                        </View>
                      </View>
                    )}

                    <View style={{ flexDirection: 'row', gap: 12 }}>
                      <View style={[styles.inputGroup, { flex: 1 }]}>
                        <Text style={styles.inputLabel}>Zone</Text>
                        <View style={styles.inputWrapper}>
                          <TextInput 
                            style={styles.nativeInput}
                            placeholder="SR"
                            placeholderTextColor="#3f3f46"
                            onChangeText={(val) => setAdminForm(p => ({...p, zone: val}))}
                            value={adminForm.zone}
                          />
                        </View>
                      </View>
                      <View style={[styles.inputGroup, { flex: 1 }]}>
                        <Text style={styles.inputLabel}>State</Text>
                        <View style={styles.inputWrapper}>
                          <TextInput 
                            style={styles.nativeInput}
                            placeholder="Kerala"
                            placeholderTextColor="#3f3f46"
                            onChangeText={(val) => setAdminForm(p => ({...p, state: val}))}
                            value={adminForm.state}
                          />
                        </View>
                      </View>
                    </View>

                    <View style={{ flexDirection: 'row', gap: 12 }}>
                      <View style={[styles.inputGroup, { flex: 1 }]}>
                        <Text style={styles.inputLabel}>Lat</Text>
                        <View style={styles.inputWrapper}>
                          <TextInput 
                            style={styles.nativeInput}
                            placeholder="11.25"
                            keyboardType="numeric"
                            placeholderTextColor="#3f3f46"
                            onChangeText={(val) => setAdminForm(p => ({...p, lat: val}))}
                            value={adminForm.lat}
                          />
                        </View>
                      </View>
                      <View style={[styles.inputGroup, { flex: 1 }]}>
                        <Text style={styles.inputLabel}>Lng</Text>
                        <View style={styles.inputWrapper}>
                          <TextInput 
                            style={styles.nativeInput}
                            placeholder="75.78"
                            keyboardType="numeric"
                            placeholderTextColor="#3f3f46"
                            onChangeText={(val) => setAdminForm(p => ({...p, lng: val}))}
                            value={adminForm.lng}
                          />
                        </View>
                      </View>
                    </View>

                    <TouchableOpacity 
                      style={[styles.saveBtn, { marginTop: 20 }]}
                      disabled={adminLoading}
                      onPress={async () => {
                        if (!adminForm.name || !adminForm.code || !adminForm.lat || !adminForm.lng) {
                          showToast('Please fill all fields', 'warning');
                          return;
                        }

                        setAdminLoading(true);
                        try {
                          const data = {
                            stationName: adminForm.name,
                            stationCode: adminForm.code,
                            zone: adminForm.zone || 'SR',
                            division: 'TVC', // Default for now
                            state: adminForm.state || 'Kerala',
                            latitude: parseFloat(adminForm.lat),
                            longitude: parseFloat(adminForm.lng)
                          };

                          console.log('[ADMIN] Saving station data:', data);

                          let res;
                          if (isEditMode) {
                            res = await updateStation(editingStationId, data);
                          } else {
                            res = await addStation(data);
                          }

                          console.log('[ADMIN] Server Response:', res);

                          if(res.success) {
                            showToast(isEditMode ? 'Station updated!' : 'Station added!', 'success');
                            setAdminForm({ name: '', code: '', zone: '', state: '', lat: '', lng: '' });
                            setIsEditMode(false);
                            setEditingStationId(null);
                            setDrawerTab('list');
                            loadAllStations();
                          } else {
                            showToast(res.message || 'Operation failed', 'error');
                          }
                        } catch(e) {
                          console.error('[ADMIN] Save Error Detail:', e);
                          showToast('Network error', 'error');
                        } finally {
                          setAdminLoading(false);
                        }
                      }}
                    >
                      {adminLoading ? (
                        <Text style={styles.saveBtnText}>Processing...</Text>
                      ) : (
                        <Text style={styles.saveBtnText}>{isEditMode ? 'Update Station' : 'Add Station'}</Text>
                      )}
                    </TouchableOpacity>

                    {isEditMode && (
                      <TouchableOpacity 
                        style={styles.cancelEditBtn}
                        onPress={() => {
                          setIsEditMode(false);
                          setEditingStationId(null);
                          setAdminForm({ name: '', code: '', zone: '', state: '', lat: '', lng: '' });
                          setDrawerTab('list');
                        }}
                      >
                        <Text style={styles.cancelEditText}>Cancel Edit</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                ) : (
                  <View style={{ gap: 12 }}>
                    <Text style={styles.minimalLabel}>STATION DIRECTORY ({allStations.length})</Text>
                    {allStationsLoading ? (
                      <Text style={{ color: '#71717a', textAlign: 'center', marginTop: 20 }}>Loading database...</Text>
                    ) : allStations.length === 0 ? (
                      <Text style={{ color: '#71717a', textAlign: 'center', marginTop: 20 }}>No stations found.</Text>
                    ) : (
                      allStations.map((station, i) => (
                        <View key={`station-${station._id || i}-${i}`} style={styles.stationListItem}>
                          <View style={{ flex: 1 }}>
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                              <Text style={styles.stationListCode}>{station.stationCode}</Text>
                              <Text style={styles.stationListName} numberOfLines={1}>{station.stationName}</Text>
                            </View>
                            <Text style={styles.stationListSub}>{station.zone} • {station.state}</Text>
                          </View>
                          <View style={styles.stationActionRow}>
                            <TouchableOpacity 
                              style={styles.stationViewBtn}
                              onPress={() => {
                                setViewingStation(station);
                                setIsViewModalOpen(true);
                              }}
                            >
                              <Ionicons name="eye-outline" size={18} color="#fafafa" />
                            </TouchableOpacity>
                            <TouchableOpacity 
                              style={styles.stationEditBtn}
                              onPress={() => {
                                setIsEditMode(true);
                                setEditingStationId(station._id);
                                setAdminForm({
                                  name: station.stationName,
                                  code: station.stationCode,
                                  zone: station.zone,
                                  state: station.state,
                                  lat: (station.coordinates?.lat ?? station.location?.coordinates?.[1] ?? '').toString(),
                                  lng: (station.coordinates?.lng ?? station.location?.coordinates?.[0] ?? '').toString()
                                });
                                setDrawerTab('add');
                              }}
                            >
                              <Ionicons name="create-outline" size={18} color="#6366f1" />
                            </TouchableOpacity>
                            <TouchableOpacity 
                              style={styles.stationDeleteBtn}
                              onPress={() => {
                                setConfirmModal({
                                  visible: true,
                                  title: 'Delete Station?',
                                  message: `Are you sure you want to remove ${station.stationName}? This cannot be undone.`,
                                  type: 'danger',
                                  onConfirm: async () => {
                                    try {
                                      const res = await deleteStation(station._id);
                                      if (res.success) {
                                        showToast('Station deleted', 'success');
                                        loadAllStations();
                                      }
                                    } catch (e) {
                                      showToast('Delete failed', 'error');
                                    }
                                  }
                                });
                              }}
                            >
                              <Ionicons name="trash-outline" size={18} color="#ef4444" />
                            </TouchableOpacity>
                          </View>
                        </View>
                      ))
                    )}
                  </View>
                )}
              </View>
            </ScrollView>
          </SafeAreaView>
        </View>
      </Modal>
    );
  };

  const renderViewStationModal = () => (
    <Modal
      visible={isViewModalOpen}
      transparent
      animationType="fade"
      onRequestClose={() => setIsViewModalOpen(false)}
    >
      <View style={styles.confirmOverlay}>
        <View style={[styles.confirmContent, { width: '90%', padding: 0, overflow: 'hidden' }]}>
          <View style={{ backgroundColor: '#1e1b4b', padding: 24, width: '100%', alignItems: 'center' }}>
            <Ionicons name="location" size={40} color="#818cf8" />
            <Text style={[styles.confirmTitle, { marginTop: 12 }]}>Station Details</Text>
          </View>
          
          <View style={{ padding: 24, width: '100%', gap: 16 }}>
            <DetailItem label="Full Name" value={viewingStation?.stationName || '—'} />
            <DetailItem label="Station Code" value={viewingStation?.stationCode || '—'} />
            
            <View style={{ flexDirection: 'row', gap: 20 }}>
              <View style={{ flex: 1 }}>
                <DetailItem label="Zone" value={viewingStation?.zone || '—'} />
              </View>
              <View style={{ flex: 1 }}>
                <DetailItem label="State" value={viewingStation?.state || '—'} />
              </View>
            </View>

            <View style={{ flexDirection: 'row', gap: 20 }}>
              <View style={{ flex: 1 }}>
                <DetailItem label="Latitude" value={viewingStation?.coordinates?.lat || viewingStation?.location?.coordinates?.[1] || '—'} />
              </View>
              <View style={{ flex: 1 }}>
                <DetailItem label="Longitude" value={viewingStation?.coordinates?.lng || viewingStation?.location?.coordinates?.[0] || '—'} />
              </View>
            </View>
          </View>

          <TouchableOpacity 
            style={[styles.saveBtn, { width: '80%', marginBottom: 24, marginTop: 0 }]}
            onPress={() => setIsViewModalOpen(false)}
          >
            <Text style={styles.saveBtnText}>Close</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );

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
            <Text style={styles.appTitle}>Thirakkundo</Text>
            <Text style={styles.appSubtitle}>Smart Auto-Detection</Text>
          </View>
          <View style={styles.headerRight}>
            <TouchableOpacity 
              style={styles.menuBtn}
              onPress={() => {
                setDrawerTab('list');
                setIsAuthModalOpen(true);
              }}
            >
              <Ionicons name="grid" size={20} color="#fafafa" />
            </TouchableOpacity>
          </View>
        </View>

        {activeTab === 'track' && (
          <View style={styles.tabContent}>
            {matchedTrainData && (
              <View style={styles.premiumCard}>
                <View style={styles.premiumHeader}>
                  <Ionicons name="train" size={28} color="#10b981" style={{ marginRight: 8 }} />
                  <Text style={styles.premiumTitle}>Are You inside this train?</Text>
                </View>
                <Text style={styles.premiumText}>
                  We think you're traveling on <Text style={styles.boldText}>{matchedTrainData.train.trainNumber} - {matchedTrainData.train.trainName}</Text> from {matchedTrainData.departureStation}.
                </Text>
                <View style={styles.confirmationButtons}>
                  <TouchableOpacity 
                    style={[styles.premiumButton, { flex: 1, marginRight: 10 }]}
                    onPress={confirmBoarding}
                  >
                    <Text style={styles.premiumButtonText}>Confirm</Text>
                  </TouchableOpacity>
                  <TouchableOpacity 
                    style={[styles.premiumButton, { flex: 1, backgroundColor: '#3f3f46' }]}
                    onPress={rejectBoarding}
                  >
                    <Text style={styles.premiumButtonText}>No</Text>
                  </TouchableOpacity>
                </View>
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
                  <View key={`live-train-${train.trainNumber}-${idx}`} style={styles.trainRowMinimal}>
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
                tripHistory.map((trip, i) => (
                  <View key={`trip-${trip.id}-${i}`} style={styles.historyItem}>
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
              <Text style={styles.minimalLabel}>QUICK ACTIONS</Text>
              <TouchableOpacity 
                style={[styles.saveBtn, { marginTop: 0 }]}
                onPress={() => {
                  setDrawerTab('add');
                  setIsAuthModalOpen(true);
                }}
              >
                <Text style={styles.saveBtnText}>Open Admin Panel</Text>
              </TouchableOpacity>
            </View>

            <View style={[styles.minimalCard, { marginTop: 16 }]}>
              <Text style={styles.minimalLabel}>DATA MANAGEMENT</Text>
              <TouchableOpacity 
                style={[styles.saveBtn, { backgroundColor: '#450a0a', shadowColor: '#ef4444' }]}
                onPress={async () => {
                  setTripHistory([]);
                  await AsyncStorage.removeItem('trip_history');
                  await AsyncStorage.removeItem('last_history_id');
                  showToast('History cleared!', 'info');
                }}
              >
                <Text style={styles.saveBtnText}>Clear Journey History</Text>
              </TouchableOpacity>
            </View>

            <View style={[styles.minimalCard, { marginTop: 16 }]}>
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
      {renderAdminPanel()}
      {renderAuthModal()}
      {renderConfirmModal()}
      {renderViewStationModal()}
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
    ...Platform.select({
      web: {
        boxShadow: '0 4px 12px rgba(99, 102, 241, 0.4)',
      },
      default: {
        shadowColor: '#6366f1',
        shadowOpacity: 0.4,
        shadowOffset: { width: 0, height: 4 },
        shadowRadius: 12,
        elevation: 6,
      }
    })
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

  // ── Confirmation Modal Styles ──
  confirmOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.8)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  confirmContent: {
    width: '85%',
    backgroundColor: '#09090b',
    borderRadius: 20,
    padding: 24,
    borderWidth: 1,
    borderColor: '#27272a',
    alignItems: 'center',
  },
  confirmIconContainer: {
    width: 64,
    height: 64,
    borderRadius: 32,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  confirmTitle: {
    color: '#fafafa',
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 8,
  },
  confirmMessage: {
    color: '#71717a',
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 24,
  },
  confirmActionRow: {
    flexDirection: 'row',
    gap: 12,
  },
  confirmCancelBtn: {
    flex: 1,
    height: 48,
    borderRadius: 12,
    backgroundColor: '#18181b',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#27272a',
  },
  confirmCancelText: {
    color: '#fafafa',
    fontWeight: '600',
  },
  confirmBtn: {
    flex: 1,
    height: 48,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  confirmBtnText: {
    color: '#fff',
    fontWeight: '700',
  },

  // ── Admin Panel / Drawer Styles ──
  exitAdminBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#450a0a',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    gap: 6,
    borderWidth: 1,
    borderColor: '#ef444433',
  },
  exitAdminText: {
    color: '#ef4444',
    fontSize: 12,
    fontWeight: '700',
  },
  stationActionRow: {
    flexDirection: 'row',
    gap: 8,
  },
  stationViewBtn: {
    width: 36,
    height: 36,
    borderRadius: 8,
    backgroundColor: '#27272a',
    justifyContent: 'center',
    alignItems: 'center',
  },
  stationEditBtn: {
    width: 36,
    height: 36,
    borderRadius: 8,
    backgroundColor: '#1e1b4b',
    justifyContent: 'center',
    alignItems: 'center',
  },
  stationDeleteBtn: {
    width: 36,
    height: 36,
    borderRadius: 8,
    backgroundColor: '#450a0a',
    justifyContent: 'center',
    alignItems: 'center',
  },
  cancelEditBtn: {
    marginTop: 12,
    alignItems: 'center',
    padding: 10,
  },
  cancelEditText: {
    color: '#71717a',
    fontSize: 14,
    textDecorationLine: 'underline',
  },
  authModalContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  authModalBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.85)',
  },
  authModalContent: {
    width: '80%',
    backgroundColor: '#09090b',
    borderRadius: 24,
    padding: 30,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#27272a',
    ...Platform.select({
      web: { boxShadow: '0 20px 40px rgba(0,0,0,0.6)' },
      default: { elevation: 10 }
    })
  },
  authModalHeader: {
    alignItems: 'center',
    marginBottom: 24,
  },
  authModalTitle: {
    fontSize: 18,
    fontWeight: '900',
    color: '#fafafa',
    marginTop: 12,
    letterSpacing: 2,
  },
  authModalSub: {
    fontSize: 13,
    color: '#71717a',
    marginTop: 4,
  },
  passcodeContainer: {
    width: '100%',
    marginBottom: 24,
  },
  passcodeInput: {
    width: '100%',
    height: 60,
    backgroundColor: '#18181b',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#27272a',
    color: '#fff',
    fontSize: 32,
    textAlign: 'center',
    letterSpacing: 10,
    fontWeight: '700',
  },
  authCancelBtn: {
    padding: 10,
  },
  authCancelText: {
    color: '#71717a',
    fontSize: 14,
    fontWeight: '600',
  },

  // ── Drawer Styles ──
  drawerOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 1000,
    flexDirection: 'row',
  },
  drawerBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
  },
  drawerContent: {
    width: '85%',
    backgroundColor: '#09090b',
    height: '100%',
    borderRightWidth: 1,
    borderRightColor: '#27272a',
    ...Platform.select({
      web: { boxShadow: '10px 0 30px rgba(0,0,0,0.5)' },
      default: { elevation: 20 }
    })
  },
  drawerHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#18181b',
  },
  drawerTitle: {
    fontSize: 18,
    fontWeight: '900',
    color: '#fff',
    letterSpacing: 2,
  },
  drawerTabs: {
    flexDirection: 'row',
    padding: 20,
    gap: 12,
  },
  drawerTab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 40,
    borderRadius: 8,
    backgroundColor: '#18181b',
    borderWidth: 1,
    borderColor: '#27272a',
  },
  drawerTabActive: {
    backgroundColor: '#6366f1',
    borderColor: '#818cf8',
  },
  drawerTabText: {
    fontSize: 13,
    color: '#71717a',
    fontWeight: '700',
  },
  drawerTabTextActive: {
    color: '#fff',
  },
  menuBtn: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: '#18181b',
    borderWidth: 1,
    borderColor: '#27272a',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stationListItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    backgroundColor: '#18181b',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#27272a',
    marginBottom: 8,
  },
  stationListLeft: {
    flex: 1,
    gap: 4,
  },
  stationListCode: {
    fontSize: 14,
    fontWeight: '900',
    color: '#818cf8', // Bright indigo
    letterSpacing: 1,
  },
  stationListName: {
    fontSize: 16,
    fontWeight: '700',
    color: '#fafafa',
  },
  stationListSub: {
    fontSize: 12,
    color: '#a1a1aa', // Bright zinc
    marginTop: 2,
  },
  stationListMeta: {
    fontSize: 11,
    color: '#71717a',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },

  // ── Admin Form Styles ──
  inputGroup: {
    marginBottom: 10,
  },
  inputLabel: {
    fontSize: 10,
    fontWeight: '800',
    color: '#71717a',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 6,
  },
  inputWrapper: {
    backgroundColor: '#09090b',
    borderWidth: 1,
    borderColor: '#27272a',
    borderRadius: 8,
    paddingHorizontal: 12,
    height: 44,
    justifyContent: 'center',
  },
  nativeInput: {
    color: '#fff',
    fontSize: 14,
    height: '100%',
  },
  fetchBtn: {
    backgroundColor: '#27272a',
    paddingHorizontal: 15,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#3f3f46',
  },
  fetchBtnText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  saveBtn: {
    backgroundColor: '#6366f1',
    height: 48,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 8,
    shadowColor: '#6366f1',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  saveBtnText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 1,
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
  confirmationButtons: {
    flexDirection: 'row',
    marginTop: 15,
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
    ...Platform.select({
      web: {
        textShadow: '0 2px 10px rgba(0,0,0,0.75)'
      }
    })
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

