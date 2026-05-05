import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  SafeAreaView,
  StatusBar,
  TouchableOpacity,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';

import { haversineDistance, formatDistance } from '../utils/haversine';
import { fetchNearbyStations, fetchStationLiveBoard, fetchAllStations, verifyAdminPasscode, fetchTrainDetails } from '../utils/api';
import { useTracking, TRACKING_STATUS } from '../hooks/useTracking';
import { useLiveBoard } from '../hooks/useLiveBoard';
import { useToast } from './Toast';

import { styles } from './TrackingScreen.styles';
import AdminPanel from './AdminPanel';
import AdminAuthModal from './AdminAuthModal';
import StationDetailsModal from './StationDetailsModal';
import TrainDetailsModal from './TrainDetailsModal';

// ─── Constants ─────────────────────────────────────────────────────────────────
const BOUNDARY_METERS = 500;

// ─── Utilities ───────────────────────────────────────────────────────────────

const fmt12h = (timeStr) => {
  if (!timeStr || timeStr === '--:--' || !timeStr.includes(':')) return null;
  try {
    const [h, m] = timeStr.split(':').map(Number);
    const period = h >= 12 ? 'PM' : 'AM';
    const hour = h % 12 || 12;
    return `${hour}:${String(m).padStart(2, '0')} ${period}`;
  } catch { return null; }
};

// ─── Main Screen ───────────────────────────────────────────────────────────────
export default function TrackingScreen() {
  const { showToast } = useToast();
  
  // Logic Hooks
  const { 
    isTracking, 
    trackingStatus,
    setTrackingStatus,
    distanceMeters,
    setDistanceMeters,
    location,
    speed,
    startTracking, 
    stopTracking,
    updateLocation
  } = useTracking();

  const [nearestStation, setNearestStation] = useState(null);
  
  const { 
    data: liveBoard,
    loading: liveBoardLoading,
    refresh: refreshLiveBoard 
  } = useLiveBoard(nearestStation?.stationCode);

  const [activeTab, setActiveTab] = useState('track'); 
  const [tripHistory, setTripHistory] = useState([]);

  // Modals & Admin State
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [allStations, setAllStations] = useState([]);
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

  // Tracking Action Wrappers
  const handleStartTracking = async () => {
    const success = await startTracking();
    if (success) {
      showToast('Tracking started', 'success');
      const coords = await updateLocation();
      if (coords) performInitialCheck(coords);
    } else {
      showToast('Location permission denied', 'error');
    }
  };

  const handleStopTracking = () => {
    stopTracking();
    setNearestStation(null);
    showToast('Tracking stopped', 'info');
  };

  const performInitialCheck = async (coords) => {
    try {
      const res = await fetchNearbyStations(coords.latitude, coords.longitude, 5000);
      const stations = res.stations || [];
      
      let nearest = null;
      let minDist = Infinity;
      stations.forEach(s => {
        const d = haversineDistance(coords.latitude, coords.longitude, s.coordinates?.lat, s.coordinates?.lng);
        if (d < minDist) { minDist = d; nearest = s; }
      });

      setNearestStation(nearest);
      setDistanceMeters(minDist);
      
      if (nearest && minDist < BOUNDARY_METERS) {
        setTrackingStatus(TRACKING_STATUS.INSIDE);
      } else {
        setTrackingStatus(TRACKING_STATUS.OUTSIDE);
      }
    } catch (e) {
      console.error('[TRACKING] Location check failed:', e);
    }
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
        loadAllStations();
      } else {
        setAuthError(true);
      }
    } catch (e) {
      console.error('[AUTH] Admin verification failed:', e);
    } finally {
      setAuthLoading(false);
    }
  };

  const loadAllStations = async () => {
    try {
      const stations = await fetchAllStations();
      console.log(`[STATIONS] Fetched ${stations.length} stations`);
      if (stations.length === 0) {
        Alert.alert('Debug', 'Backend returned 0 stations. Check DB.');
      }
      setAllStations(stations);
    } catch (err) {
      console.error('[STATIONS] Failed to load stations:', err);
      Alert.alert('Error', 'Failed to load station directory. Check network.');
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

  useEffect(() => {
    const loadHistory = async () => {
      try {
        const stored = await AsyncStorage.getItem('trip_history');
        if (stored) setTripHistory(JSON.parse(stored));
      } catch (err) {}
    };
    loadHistory();
    loadAllStations();
  }, []);

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
                <Text style={[styles.mainActionText, isTracking && { color: '#fff' }]}>
                  {isTracking ? 'Stop Tracking' : 'Start Tracking'}
                </Text>
              </TouchableOpacity>
              <View style={styles.statusMinimalWrapper}>
                <Text style={styles.statusMinimalText}>{sc.label}</Text>
              </View>
            </View>

            {isTracking && (
              <TouchableOpacity 
                style={{ position: 'absolute', top: 20, right: 20, backgroundColor: '#18181b', padding: 12, borderRadius: 12, borderWidth: 1, borderColor: '#27272a', zIndex: 10, alignItems: 'center' }}
                onPress={() => setActiveTab('speed')}
              >
                <Text style={{ color: '#fff', fontSize: 18, fontWeight: '900' }}>{Math.round(speed || 0)}</Text>
                <Text style={{ color: '#71717a', fontSize: 9, fontWeight: '700' }}>KM/H</Text>
              </TouchableOpacity>
            )}
            {isTracking && (
              <View style={[styles.minimalCard, { alignItems: 'center', paddingVertical: 30 }]}>
                <Text style={styles.minimalLabel}>CURRENT SPEED</Text>
                <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
                  <Text style={{ fontSize: 64, fontWeight: '900', color: '#fff' }}>{Math.round(speed || 0)}</Text>
                  <Text style={{ fontSize: 18, fontWeight: '700', color: '#71717a', marginLeft: 8 }}>KM/H</Text>
                </View>
                {speed > 20 && (
                  <View style={{ backgroundColor: '#10b98122', paddingHorizontal: 12, paddingVertical: 4, borderRadius: 100, marginTop: 10 }}>
                    <Text style={{ color: '#10b981', fontSize: 12, fontWeight: '800' }}>DETECTING MOTION</Text>
                  </View>
                )}
              </View>
            )}

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
                <View style={styles.minimalHeader}>
                  <Text style={styles.minimalLabel}>LIVE DEPARTURES</Text>
                  <TouchableOpacity onPress={() => refreshLiveBoard()}>
                    <Ionicons name="refresh" size={14} color="#71717a" />
                  </TouchableOpacity>
                </View>
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
                      <Text style={styles.trainDestText}>{train.toCode} · {train.expectedArrival || train.scheduledArrival}</Text>
                    </View>
                    <TouchableOpacity 
                      style={[styles.trainViewBtn, { width: 44, height: 44, borderRadius: 12 }]} 
                      onPress={() => { setViewingTrain(train); setIsTrainModalOpen(true); }}
                    >
                      <Ionicons name="eye" size={20} color="#fff" />
                    </TouchableOpacity>
                  </View>
                ))}
                {liveBoard.trains.length > 5 && (
                  <TouchableOpacity onPress={() => { setViewingStation(nearestStation); setIsViewModalOpen(true); }} style={{ marginTop: 10, alignItems: 'center' }}>
                    <Text style={[styles.moreText, { color: '#818cf8', fontWeight: '700' }]}>See all trains</Text>
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
        {activeTab === 'speed' && (
          <View style={[styles.tabContent, { flex: 1, justifyContent: 'center', alignItems: 'center', minHeight: 400 }]}>
            <View style={{ width: 220, height: 220, borderRadius: 110, borderWidth: 8, borderColor: '#1e1b4b', justifyContent: 'center', alignItems: 'center', backgroundColor: '#0c0a09' }}>
              <Text style={{ fontSize: 72, fontWeight: '900', color: '#fff' }}>{Math.round(speed || 0)}</Text>
              <Text style={{ fontSize: 16, fontWeight: '800', color: '#818cf8', letterSpacing: 2 }}>KM/H</Text>
            </View>
            <View style={{ marginTop: 40, alignItems: 'center' }}>
              <Text style={{ color: '#71717a', fontSize: 14, fontWeight: '700', letterSpacing: 1 }}>{isTracking ? 'TRACKING ACTIVE' : 'TRACKING IDLE'}</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12, backgroundColor: '#18181b', paddingHorizontal: 16, paddingVertical: 8, borderRadius: 100 }}>
                <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: isTracking ? '#10b981' : '#ef4444' }} />
                <Text style={{ color: isTracking ? '#10b981' : '#ef4444', fontSize: 12, fontWeight: '800' }}>{isTracking ? 'GPS SIGNAL OK' : 'GPS DISCONNECTED'}</Text>
              </View>
            </View>
          </View>
        )}
      </ScrollView>

      <View style={styles.bottomNav}>
        <TouchableOpacity style={styles.navItem} onPress={() => setActiveTab('track')}>
          <Ionicons name="location" size={22} color={activeTab === 'track' ? "#fafafa" : "#71717a"} />
          <Text style={[styles.navText, activeTab === 'track' && styles.navTextActive]}>Track</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.navItem} onPress={() => setActiveTab('speed')}>
          <Ionicons name="speedometer" size={22} color={activeTab === 'speed' ? "#fafafa" : "#71717a"} />
          <Text style={[styles.navText, activeTab === 'speed' && styles.navTextActive]}>Speed</Text>
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
        onViewStation={(s) => {
          setViewingStation(s);
          setIsViewModalOpen(true);
        }}
      />
      <AdminAuthModal 
        isOpen={isAuthModalOpen} 
        onClose={() => setIsAuthModalOpen(false)} 
        passcodeInput={passcodeInput} 
        setPasscodeInput={setPasscodeInput} 
        onVerify={handleAdminAuth} 
        error={authError} 
        loading={authLoading} 
      />
      <StationDetailsModal 
        isOpen={isViewModalOpen} 
        onClose={() => setIsViewModalOpen(false)} 
        station={viewingStation} 
        liveBoard={liveBoard} 
        allStations={allStations} 
      />
      <TrainDetailsModal 
        isOpen={isTrainModalOpen} 
        onClose={() => setIsTrainModalOpen(false)} 
        train={viewingTrain} 
        loading={trainDetailLoading} 
        routeData={trainDetailData} 
        allStations={allStations} 
      />
    </SafeAreaView>
  );
}
