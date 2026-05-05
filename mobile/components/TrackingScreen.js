import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  SafeAreaView,
  StatusBar,
  TouchableOpacity,
  TextInput,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';

import { haversineDistance, formatDistance } from '../utils/haversine';
import { fetchNearbyStations, fetchStationLiveBoard, fetchAllStations, verifyAdminPasscode, fetchTrainDetails } from '../utils/api';
import { useTracking } from '../hooks/useTracking';
import { useLiveBoard } from '../hooks/useLiveBoard';
import { useToast } from './Toast';

import { styles } from './TrackingScreen.styles';
import AdminPanel from './AdminPanel';
import AdminAuthModal from './AdminAuthModal';
import StationDetailsModal from './StationDetailsModal';
import TrainDetailsModal from './TrainDetailsModal';

// ─── Constants ─────────────────────────────────────────────────────────────────
const BOUNDARY_METERS = 500;
const INTERVAL_INSIDE = 30 * 1000;     // 30 seconds
const INTERVAL_OUTSIDE = 5 * 60 * 1000; // 5 minutes

const TRACKING_STATUS = {
  IDLE: 'idle',
  LOADING: 'loading',
  INSIDE: 'inside',
  OUTSIDE: 'outside',
  ERROR: 'error',
};

// ─── Utilities ───────────────────────────────────────────────────────────────

// HH:MM 24h string → h:mm AM/PM
const fmt12h = (timeStr) => {
  if (!timeStr || timeStr === '--:--' || !timeStr.includes(':')) return null;
  try {
    const [h, m] = timeStr.split(':').map(Number);
    const period = h >= 12 ? 'PM' : 'AM';
    const hour = h % 12 || 12;
    return `${hour}:${String(m).padStart(2, '0')} ${period}`;
  } catch { return null; }
};

// True if "HH:MM" is within [now, now + 12 hours]
const isWithin2Hours = (timeStr) => {
  if (!timeStr || !timeStr.includes(':')) return false;
  try {
    const now = new Date();
    const [h, m] = timeStr.split(':').map(Number);
    const t = new Date(now);
    t.setHours(h, m, 0, 0);
    
    let diff = t - now;
    if (diff < -20 * 60 * 60 * 1000) {
      diff += 24 * 60 * 60 * 1000;
    }
    
    return diff >= -120000 && diff <= 12 * 60 * 60 * 1000; 
  } catch { return false; }
};

const getTrainState = (train) => {
  if (train.status?.hasDeparted) return 'departed';
  if (train.status?.hasArrived) return 'at_station';
  return 'upcoming';
};

const getArrivalLabel = (train) => {
  const arrival = train.expectedArrival || train.expected?.arrival || train.scheduled?.arrival;
  if (!arrival) return null;
  
  const time = fmt12h(arrival);
  const isApproaching = train.isApproaching;
  const delay = train.delayMinutes || 0;

  return {
    time,
    badge: isApproaching ? 'Approaching' : (delay > 0 ? `+${delay} min` : 'On Time'),
    badgeColor: isApproaching ? '#3b82f6' : (delay > 0 ? '#ef4444' : '#10b981')
  };
};

// ─── Main Screen ───────────────────────────────────────────────────────────────
export default function TrackingScreen() {
  const { showToast } = useToast();
  const [nearestStation, setNearestStation] = useState(null);
  const [distanceMeters, setDistanceMeters] = useState(null);
  const [roadDistance, setRoadDistance] = useState(null);
  const [trackingStatus, setTrackingStatus] = useState(TRACKING_STATUS.IDLE);
  const [locationError, setLocationError] = useState(null);
  const [lastChecked, setLastChecked] = useState(null);
  const [intervalMode, setIntervalMode] = useState('Off');
  const [liveSpeed, setLiveSpeed] = useState(0);
  const [matchedTrainData, setMatchedTrainData] = useState(null);
  const [liveBoard, setLiveBoard] = useState(null);
  const [liveBoardError, setLiveBoardError] = useState(null);
  const [liveBoardLoading, setLiveBoardLoading] = useState(false);

  const { 
    isTracking, 
    setIsTracking,
    startTracking: startNativeTracking, 
    stopTracking: stopNativeTracking 
  } = useTracking((loc, speed) => {
    // Optional: add custom logic for speed alerts here
  });

  const { 
    refresh: refreshLiveBoard 
  } = useLiveBoard(nearestStation?.stationCode);

  const [activeTab, setActiveTab] = useState('track'); 
  const [tripHistory, setTripHistory] = useState([]);

  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [allStations, setAllStations] = useState([]);
  const [allStationsLoading, setAllStationsLoading] = useState(false);
  
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [passcodeInput, setPasscodeInput] = useState('');
  const [authError, setAuthError] = useState(false);
  const [authLoading, setAuthLoading] = useState(false);

  const [isViewModalOpen, setIsViewModalOpen] = useState(false);
  const [viewingStation, setViewingStation] = useState(null);

  const [isTrainModalOpen, setIsTrainModalOpen] = useState(false);
  const [viewingTrain, setViewingTrain] = useState(null);

  const [stationModalBoard, setStationModalBoard] = useState(null);
  const [stationModalLoading, setStationModalLoading] = useState(false);
  const [trainDetailData, setTrainDetailData] = useState(null);
  const [trainDetailLoading, setTrainDetailLoading] = useState(false);
  const [trainSearchQuery, setTrainSearchQuery] = useState('');
  const lastSpeedPosRef = useRef(null);

  const handleStartTracking = async () => {
    const success = await startTracking();
    if (success) {
      showToast('Tracking started', 'success');
      updateLocation();
    } else {
      showToast('Location permission denied', 'error');
    }
  };

  const handleStopTracking = () => {
    stopTracking();
    showToast('Tracking stopped', 'info');
  };

  const handleAdminAuth = async () => {
    if (!passcodeInput) return;
    setAuthLoading(true);
    setAuthError(false);
    try {
      const res = await verifyAdminPasscode(passcodeInput);
      if (res.success) {
        setIsAuthModalOpen(false);
        setPasscodeInput('');
        setIsDrawerOpen(true);
      } else {
        setAuthError(true);
      }
    } catch (e) {
    } finally {
      setAuthLoading(false);
    }
  };

  const loadAllStations = async () => {
    setAllStationsLoading(true);
    try {
      const stations = await fetchAllStations();
      setAllStations(stations);
    } catch (err) {
    } finally {
      setAllStationsLoading(false);
    }
  };

  useEffect(() => {
    if (isTrainModalOpen && viewingTrain) {
      setTrainDetailLoading(true);
      setTrainDetailData(null);
      fetchTrainDetails(viewingTrain.trainNumber)
        .then(data => setTrainDetailData(data.data || data))
        .catch(() => setTrainDetailData(null))
        .finally(() => setTrainDetailLoading(false));
    }
  }, [isTrainModalOpen, viewingTrain]);

  const refreshStationData = useCallback(async (stationCode, isMain = false) => {
    if (!stationCode || stationModalLoading || liveBoardLoading) return;

    if (isMain) setLiveBoardLoading(true);
    else setStationModalLoading(true);

    try {
      const res = await fetchStationLiveBoard(stationCode, 8);
      if (res.success) {
        if (isMain) setLiveBoard(res.data);
        else setStationModalBoard(res.data);
      }
    } catch (err) {
    } finally {
      setLiveBoardLoading(false);
      setStationModalLoading(false);
    }
  }, [stationModalLoading, liveBoardLoading]);

  // Load History on Mount
  useEffect(() => {
    const loadHistory = async () => {
      try {
        const stored = await AsyncStorage.getItem('trip_history');
        if (stored) {
          setTripHistory(JSON.parse(stored));
        }
      } catch (err) { }
    };
    loadHistory();
    loadAllStations();
  }, []);

  // Save to History Function
  const addToHistory = async (trip) => {
    try {
      const uniqueId = trip.id || `${Date.now()}-${Math.floor(Math.random() * 10000)}`;
      const tripWithId = { ...trip, id: uniqueId };
      const stored = await AsyncStorage.getItem('trip_history');
      const currentHistory = stored ? JSON.parse(stored) : [];
      const newHistory = [tripWithId, ...currentHistory.slice(0, 19)];
      setTripHistory(newHistory);
      await AsyncStorage.setItem('trip_history', JSON.stringify(newHistory));
    } catch (err) { }
  };

  // Speed Watcher logic removed for brevity (already in useTracking ideally, but kept if needed)
  // Shake Detection removed for brevity (already modularized or can be)

  const startTracking = async () => {
    setIsTracking(true);
    setTrackingStatus(TRACKING_STATUS.LOADING);
    await checkLocation();
  };

  const stopTracking = () => {
    setIsTracking(false);
    setTrackingStatus(TRACKING_STATUS.IDLE);
    setLiveBoard(null);
  };

  const checkLocation = async () => {
    try {
      const { coords } = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      const { latitude, longitude } = coords;
      const res = await fetchNearbyStations(latitude, longitude, 5000);
      const stations = res.stations || [];
      
      let nearest = null;
      let minDist = Infinity;
      stations.forEach(s => {
        const d = haversineDistance(latitude, longitude, s.coordinates?.lat, s.coordinates?.lng);
        if (d < minDist) { minDist = d; nearest = s; }
      });

      setNearestStation(nearest);
      setDistanceMeters(minDist);
      
      if (nearest && minDist < BOUNDARY_METERS) {
        setTrackingStatus(TRACKING_STATUS.INSIDE);
        refreshStationData(nearest.stationCode, true);
      } else {
        setTrackingStatus(TRACKING_STATUS.OUTSIDE);
      }
    } catch (e) {}
  };

  const statusConfig = {
    [TRACKING_STATUS.IDLE]: { label: 'Not Tracking', dot: '#71717a' },
    [TRACKING_STATUS.LOADING]: { label: 'Getting Location...', dot: '#6366f1' },
    [TRACKING_STATUS.INSIDE]: { label: 'Near Station ✓', dot: '#22c55e' },
    [TRACKING_STATUS.OUTSIDE]: { label: 'Outside Boundary', dot: '#f59e0b' },
    [TRACKING_STATUS.ERROR]: { label: 'Location Error', dot: '#ef4444' },
  };

  const sc = statusConfig[trackingStatus] || statusConfig[TRACKING_STATUS.IDLE];

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="light-content" backgroundColor="#09090b" />
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <Text style={styles.appTitle}>Thirakkundo</Text>
            <Text style={styles.appSubtitle}>Smart Auto-Detection</Text>
          </View>
          <TouchableOpacity style={styles.menuBtn} onPress={() => setIsAuthModalOpen(true)}>
            <Ionicons name="grid" size={20} color="#fafafa" />
          </TouchableOpacity>
        </View>

        {activeTab === 'track' && (
          <View style={styles.tabContent}>
            <View style={styles.actionContainer}>
              <TouchableOpacity
                style={[styles.mainActionButton, isTracking ? styles.mainActionStop : styles.mainActionStart]}
                onPress={isTracking ? handleStopTracking : handleStartTracking}
              >
                <Text style={[styles.mainActionText, isTracking && { color: '#fff' }]}>{isTracking ? 'Stop Tracking' : 'Start Tracking'}</Text>
              </TouchableOpacity>
              <View style={styles.statusMinimalWrapper}>
                <Text style={styles.statusMinimalText}>{sc.label}</Text>
              </View>
            </View>

            {nearestStation && (
              <View style={styles.minimalCard}>
                <View style={styles.minimalRow}>
                  <View>
                    <Text style={styles.minimalLabel}>NEAREST STATION</Text>
                    <Text style={styles.minimalValue}>{nearestStation.stationName}</Text>
                    <Text style={styles.minimalSub}>{nearestStation.stationCode}</Text>
                  </View>
                  <View style={styles.minimalRight}>
                    <Text style={styles.minimalDistance}>{formatDistance(distanceMeters)}</Text>
                  </View>
                </View>
              </View>
            )}

            {liveBoard && (
              <View style={styles.minimalCard}>
                <Text style={styles.minimalLabel}>LIVE DEPARTURES</Text>
                {liveBoard.trains.slice(0, 5).map((train, idx) => (
                  <View key={idx} style={styles.trainRowMinimal}>
                    <View style={styles.trainRowLeft}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        <Text style={styles.trainNumText}>{train.trainNumber}</Text>
                        {train.isApproaching && (
                          <View style={{ backgroundColor: '#3b82f6', paddingHorizontal: 4, borderRadius: 4 }}>
                            <Text style={{ color: '#fff', fontSize: 8, fontWeight: '800' }}>APP</Text>
                          </View>
                        )}
                      </View>
                      <Text style={styles.trainDestText}>{train.toCode}</Text>
                    </View>
                    <TouchableOpacity style={styles.trainViewBtn} onPress={() => { setViewingTrain(train); setIsTrainModalOpen(true); }}>
                      <Ionicons name="eye-outline" size={16} color="#fafafa" />
                    </TouchableOpacity>
                  </View>
                ))}
                {liveBoard.trains.length > 5 && (
                  <TouchableOpacity onPress={() => { setViewingStation(nearestStation); setIsViewModalOpen(true); }}>
                    <Text style={styles.moreText}>See more</Text>
                  </TouchableOpacity>
                )}
              </View>
            )}
          </View>
        )}

        {activeTab === 'history' && (
          <View style={styles.tabContent}>
            <View style={styles.minimalCard}>
              <Text style={styles.minimalLabel}>JOURNEY HISTORY</Text>
              {tripHistory.map((trip, i) => (
                <View key={i} style={styles.historyItem}>
                  <View style={styles.historyInfo}>
                    <Text style={styles.historyTrain}>{trip.trainName}</Text>
                    <Text style={styles.historyRoute}>{trip.route}</Text>
                  </View>
                </View>
              ))}
            </View>
          </View>
        )}
      </ScrollView>

      <View style={styles.bottomNav}>
        <TouchableOpacity style={styles.navItem} onPress={() => setActiveTab('track')}>
          <Ionicons name="location" size={22} color={activeTab === 'track' ? "#fafafa" : "#71717a"} />
          <Text style={[styles.navText, activeTab === 'track' && styles.navTextActive]}>Track</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.navItem} onPress={() => setActiveTab('history')}>
          <Ionicons name="time" size={22} color={activeTab === 'history' ? "#fafafa" : "#71717a"} />
          <Text style={[styles.navText, activeTab === 'history' && styles.navTextActive]}>History</Text>
        </TouchableOpacity>
      </View>

      <AdminPanel 
        isOpen={isDrawerOpen} 
        onClose={() => setIsDrawerOpen(false)} 
        allStations={allStations} 
        onRefreshStations={loadAllStations} 
        showToast={showToast}
      />
      <AdminAuthModal isOpen={isAuthModalOpen} onClose={() => setIsAuthModalOpen(false)} passcodeInput={passcodeInput} setPasscodeInput={setPasscodeInput} onVerify={handleAdminAuth} error={authError} loading={authLoading} />
      <StationDetailsModal isOpen={isViewModalOpen} onClose={() => setIsViewModalOpen(false)} station={viewingStation} liveBoard={stationModalBoard} allStations={allStations} />
      <TrainDetailsModal isOpen={isTrainModalOpen} onClose={() => setIsTrainModalOpen(false)} train={viewingTrain} loading={trainDetailLoading} routeData={trainDetailData} allStations={allStations} />
    </SafeAreaView>
  );
}

