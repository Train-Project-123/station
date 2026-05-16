import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  SafeAreaView,
  StatusBar,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Modal,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';

import { haversineDistance, formatDistance } from '../utils/haversine';
import { fetchNearbyStations, fetchStationLiveBoard, fetchAllStations, verifyAdminPasscode, fetchTrainDetails, fetchSetting, API_BASE_URL } from '../utils/api';
import { useTracking, TRACKING_STATUS } from '../hooks/useTracking';
import { useLiveBoard } from '../hooks/useLiveBoard';
import { useToast } from './Toast';

import { styles } from './TrackingScreen.styles';
import AdminPanel from './AdminPanel';
import AdminAuthModal from './AdminAuthModal';
import StationDetailsModal from './StationDetailsModal';
import TrainDetailsModal from './TrainDetailsModal';

// ─── Constants ─────────────────────────────────────────────────────────────────
// Removed static BOUNDARY_METERS, fetching dynamically from backend

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

const TrainRow = ({ train, onView, isGone }) => (
  <View style={styles.trainRowMinimal}>
    <View style={styles.trainRowLeft}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <Text style={styles.trainNumText}>{train.trainNumber}</Text>
        {train.isApproaching && (
          <View style={{ backgroundColor: '#3b82f6', paddingHorizontal: 4, borderRadius: 4 }}>
            <Text style={{ color: '#fff', fontSize: 8, fontWeight: '800' }}>APP</Text>
          </View>
        )}
      </View>
      <Text style={styles.trainDestText}>
        {train.toCode} · {fmt12h(train.expectedArrival || train.scheduledArrival) || train.expectedArrival || train.scheduledArrival}
      </Text>
    </View>
    <View style={styles.trainRowRight}>
      {train.platform && (
        <Text style={[styles.liveBoardPlatform, { marginBottom: 4 }]}>PF {train.platform}</Text>
      )}
      <TouchableOpacity
        style={[styles.trainViewBtn, isGone && { opacity: 0.6 }]}
        onPress={onView}
      >
        <Ionicons name="eye" size={18} color="#fff" />
      </TouchableOpacity>
    </View>
  </View>
);

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
    updateLocation,
    checkBoarding,
    setActiveStationCode,
  } = useTracking();

  const [nearestStation, setNearestStation] = useState(null);
  const [boundaryMeters, setBoundaryMeters] = useState(800);

  const {
    data: liveBoard,
    loading: liveBoardLoading,
    refresh: refreshLiveBoard
  } = useLiveBoard(nearestStation?.stationCode);

  const [activeTab, setActiveTab] = useState('track');
  const [tripHistory, setTripHistory] = useState([]);

  // ── Matched-train confirmation modal state ─────────────────────────────────
  const [pendingMatch, setPendingMatch] = useState(null); // { train, departureStation, timestamp }
  const [isConfirmModalOpen, setIsConfirmModalOpen] = useState(false);
  // Track which timestamps we've already shown a prompt for so we don't re-show
  const shownMatchRef = useRef(null);

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

  const handleStartTracking = async () => {
    const success = await startTracking();
    if (success) {
      showToast('Tracking started', 'success');
      await updateLocation();
    } else {
      showToast('Location permission denied', 'error');
    }
  };

  const handleStopTracking = () => {
    stopTracking();
    setNearestStation(null);
    setPendingMatch(null);
    setIsConfirmModalOpen(false);
    showToast('Tracking stopped', 'info');
  };

  // ── Station boundary detection + stationCode persistence ──────────────────
  useEffect(() => {
    if (isTracking && location && allStations && allStations.length > 0) {
      let nearest = null;
      let minDist = Infinity;
      allStations.forEach(s => {
        const lat = s.coordinates?.lat || s.location?.coordinates?.[1];
        const lng = s.coordinates?.lng || s.location?.coordinates?.[0];
        if (lat && lng) {
          const d = haversineDistance(location.latitude, location.longitude, lat, lng);
          if (d < minDist) { minDist = d; nearest = s; }
        }
      });

      setNearestStation(nearest);
      setDistanceMeters(minDist);

      if (nearest && minDist < boundaryMeters) {
        setTrackingStatus(TRACKING_STATUS.INSIDE);
        // Persist so background task can include stationCode in matchTrain()
        setActiveStationCode(nearest.stationCode);
      } else {
        setTrackingStatus(TRACKING_STATUS.OUTSIDE);
        setActiveStationCode(null); // user left the station area
      }
    }
  }, [location, isTracking, allStations, boundaryMeters, setDistanceMeters, setTrackingStatus, setActiveStationCode]);

  // ── Foreground boarding detection (speed > 20 km/h while inside station) ──
  useEffect(() => {
    if (
      isTracking &&
      trackingStatus === TRACKING_STATUS.INSIDE &&
      speed > 20 &&
      liveBoard?.trains
    ) {
      const match = checkBoarding(liveBoard.trains);
      if (match && shownMatchRef.current !== match.trainNumber) {
        shownMatchRef.current = match.trainNumber;
        setPendingMatch({
          train: {
            trainNumber: match.trainNumber,
            trainName: match.trainName || match.name || match.trainNumber,
          },
          departureStation: nearestStation?.stationCode,
          timestamp: new Date().toISOString(),
          source: 'foreground',
        });
        setIsConfirmModalOpen(true);
      }
    }
  }, [speed, isTracking, trackingStatus, liveBoard, checkBoarding, nearestStation]);

  // ── Poll AsyncStorage for background-matched train result ──────────────────
  useEffect(() => {
    if (!isTracking) return;

    const pollMatch = async () => {
      try {
        const raw = await AsyncStorage.getItem('matched_train_result');
        if (!raw) return;
        const result = JSON.parse(raw);
        // Show confirmation only once per unique timestamp
        if (result.timestamp && result.timestamp !== shownMatchRef.current) {
          shownMatchRef.current = result.timestamp;
          setPendingMatch({ ...result, source: 'background' });
          setIsConfirmModalOpen(true);
        }
      } catch (e) {
        console.warn('[TRACKING] Poll matched_train_result error:', e.message);
      }
    };

    const interval = setInterval(pollMatch, 15000); // check every 15 s
    pollMatch(); // check immediately on mount / tracking start
    return () => clearInterval(interval);
  }, [isTracking]);

  // ── Confirmation handlers ──────────────────────────────────────────────────
  const handleConfirmBoarding = async () => {
    if (!pendingMatch) return;
    setIsConfirmModalOpen(false);

    const trip = {
      trainName: pendingMatch.train.trainName || pendingMatch.train.trainNumber,
      trainNumber: pendingMatch.train.trainNumber,
      route: pendingMatch.departureStation || '—',
      boardedAt: pendingMatch.timestamp,
      source: pendingMatch.source,
    };

    try {
      const stored = await AsyncStorage.getItem('trip_history');
      const history = stored ? JSON.parse(stored) : [];
      history.unshift(trip);
      await AsyncStorage.setItem('trip_history', JSON.stringify(history.slice(0, 50)));
      setTripHistory(prev => [trip, ...prev].slice(0, 50));
      // Clear the pending match and the background result
      await AsyncStorage.removeItem('matched_train_result');
      setPendingMatch(null);
      showToast(`Boarded ${trip.trainName} confirmed! 🚂`, 'success');
    } catch (e) {
      console.error('[TRACKING] Save trip failed:', e);
    }
  };

  const handleDenyBoarding = async () => {
    setIsConfirmModalOpen(false);
    // Suppress this match; clear from storage so we don't re-prompt
    await AsyncStorage.removeItem('matched_train_result').catch(() => {});
    setPendingMatch(null);
    showToast('Match dismissed. Continuing detection…', 'info');
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
      const url = `${API_BASE_URL}/api/stations/all`;
      console.log(`[STATIONS] Attempting fetch from: ${url}`);
      const stations = await fetchAllStations();
      console.log(`[STATIONS] Fetched ${stations.length} stations`);
      if (stations.length === 0) {
        Alert.alert('Debug', 'Backend returned 0 stations. Check DB.');
      }
      setAllStations(stations);
    } catch (err) {
      console.error('[STATIONS] Failed to load stations:', err);
      Alert.alert('Error', `Failed to load station directory: ${err.message}`);
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

  const loadSettings = async () => {
    try {
      const res = await fetchSetting('tracking_radius');
      if (res.success && res.data && res.data.value) {
        setBoundaryMeters(Number(res.data.value));
      }
    } catch (err) {
      console.error('[SETTINGS] Failed to load tracking radius', err);
    }
  };

  useEffect(() => {
    const loadHistory = async () => {
      try {
        const stored = await AsyncStorage.getItem('trip_history');
        if (stored) setTripHistory(JSON.parse(stored));
      } catch (err) {}
    };
    loadSettings();
    loadHistory();
    loadAllStations();
  }, []);

  const statusConfig = {
    [TRACKING_STATUS.IDLE]: { label: 'Not Tracking', dot: '#71717a' },
    [TRACKING_STATUS.LOADING]: { label: 'Getting Location...', dot: '#6366f1' },
    [TRACKING_STATUS.INSIDE]: { label: 'You are inside', dot: '#22c55e' },
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
            <Text style={styles.appTitle}>
              {trackingStatus === TRACKING_STATUS.INSIDE ? nearestStation?.stationName : 'Thirakkundo'}
            </Text>
            <Text style={styles.appSubtitle}>
              {trackingStatus === TRACKING_STATUS.INSIDE ? 'Station Active' : 'Smart Auto-Detection'}
            </Text>
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
              <View style={[styles.statusMinimalWrapper, { borderColor: sc.dot + '40', backgroundColor: sc.dot + '15' }]}>
                <Text style={[styles.statusMinimalText, { color: sc.dot }]}>{sc.label}</Text>
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

            {isTracking && trackingStatus === TRACKING_STATUS.OUTSIDE && nearestStation && (
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

            {isTracking && (
              <View style={[styles.minimalCard, { alignItems: 'center', paddingVertical: 20 }]}>
                <Text style={styles.minimalLabel}>CURRENT SPEED</Text>
                <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
                  <Text style={{ fontSize: 48, fontWeight: '900', color: '#fff' }}>{Math.round(speed || 0)}</Text>
                  <Text style={{ fontSize: 14, fontWeight: '700', color: '#71717a', marginLeft: 8 }}>KM/H</Text>
                </View>
                {speed > 20 && (
                  <View style={{ backgroundColor: '#10b98122', paddingHorizontal: 12, paddingVertical: 4, borderRadius: 100, marginTop: 10 }}>
                    <Text style={{ color: '#10b981', fontSize: 12, fontWeight: '800' }}>DETECTING MOTION</Text>
                  </View>
                )}
              </View>
            )}

            {liveBoard && (
              <View style={styles.minimalCard}>
                <View style={styles.minimalHeader}>
                  <Text style={styles.minimalLabel}>
                    {trackingStatus === TRACKING_STATUS.INSIDE ? 'TRAINS AT STATION' : 'LIVE DEPARTURES'}
                  </Text>
                  <TouchableOpacity onPress={() => refreshLiveBoard()}>
                    <Ionicons name="refresh" size={14} color="#71717a" />
                  </TouchableOpacity>
                </View>

                {trackingStatus === TRACKING_STATUS.INSIDE ? (
                  <View>
                    {/* At Station */}
                    {liveBoard.atStation?.length > 0 && (
                      <View style={{ marginBottom: 16 }}>
                        <Text style={[styles.subSectionLabel, { marginTop: 0 }]}>At Station</Text>
                        {liveBoard.atStation.map((train, idx) => (
                          <TrainRow key={`at-${idx}`} train={train} onView={() => { setViewingTrain(train); setIsTrainModalOpen(true); }} />
                        ))}
                      </View>
                    )}

                    {/* Upcoming */}
                    {liveBoard.upcoming?.length > 0 && (
                      <View style={{ marginBottom: 16 }}>
                        <Text style={styles.subSectionLabel}>Upcoming</Text>
                        {liveBoard.upcoming.slice(0, 5).map((train, idx) => (
                          <TrainRow key={`up-${idx}`} train={train} onView={() => { setViewingTrain(train); setIsTrainModalOpen(true); }} />
                        ))}
                      </View>
                    )}

                    {/* Gone */}
                    {liveBoard.gone?.length > 0 && (
                      <View>
                        <Text style={styles.subSectionLabel}>Recently Departed</Text>
                        {liveBoard.gone.slice(0, 3).map((train, idx) => (
                          <TrainRow key={`gone-${idx}`} train={train} onView={() => { setViewingTrain(train); setIsTrainModalOpen(true); }} isGone />
                        ))}
                      </View>
                    )}
                  </View>
                ) : (
                  /* Outside view: simple list */
                  liveBoard.trains.slice(0, 5).map((train, idx) => (
                    <TrainRow key={`simple-${idx}`} train={train} onView={() => { setViewingTrain(train); setIsTrainModalOpen(true); }} />
                  ))
                )}

                {(liveBoard.trains.length > 5 || (trackingStatus === TRACKING_STATUS.INSIDE && liveBoard.trains.length > 0)) && (
                  <TouchableOpacity onPress={() => { setViewingStation(nearestStation); setIsViewModalOpen(true); }} style={{ marginTop: 10, alignItems: 'center' }}>
                    <Text style={[styles.moreText, { color: '#818cf8', fontWeight: '700' }]}>See full station board</Text>
                  </TouchableOpacity>
                )}
                
                {liveBoard.trains.length === 0 && !liveBoardLoading && (
                  <Text style={{ color: '#52525b', fontSize: 13, textAlign: 'center', paddingVertical: 10 }}>No trains found at this time.</Text>
                )}
              </View>
            )}
          </View>
        )}


        {activeTab === 'history' && (
          <View style={styles.tabContent}>
            <View style={styles.minimalCard}>
              <Text style={styles.minimalLabel}>JOURNEY HISTORY</Text>
              {tripHistory.length === 0 && (
                <Text style={{ color: '#52525b', fontSize: 13, marginTop: 8, textAlign: 'center' }}>No trips recorded yet.</Text>
              )}
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

      {/* ── Train Boarding Confirmation Modal ──────────────────────────────── */}
      <Modal
        visible={isConfirmModalOpen}
        transparent
        animationType="fade"
        onRequestClose={handleDenyBoarding}
      >
        <View style={styles.confirmOverlay}>
          <View style={styles.confirmContent}>
            <View style={[styles.confirmIconContainer, { backgroundColor: '#6366f115' }]}>
              <Ionicons name="train" size={32} color="#818cf8" />
            </View>
            <Text style={styles.confirmTitle}>Are you on this train?</Text>
            {pendingMatch && (
              <Text style={styles.confirmMessage}>
                We detected movement consistent with{'\n'}
                <Text style={{ color: '#fafafa', fontWeight: '700' }}>
                  {pendingMatch.train?.trainName || pendingMatch.train?.trainNumber}
                </Text>
                {pendingMatch.train?.trainNumber && pendingMatch.train?.trainName
                  ? `  (${pendingMatch.train.trainNumber})`
                  : ''
                }
                {'\n\n'}departing from{' '}
                <Text style={{ color: '#fafafa', fontWeight: '700' }}>
                  {pendingMatch.departureStation || 'your station'}
                </Text>.
              </Text>
            )}
            <View style={styles.confirmActionRow}>
              <TouchableOpacity style={styles.confirmCancelBtn} onPress={handleDenyBoarding}>
                <Text style={styles.confirmCancelText}>Not me</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.confirmBtn, { backgroundColor: '#6366f1' }]}
                onPress={handleConfirmBoarding}
              >
                <Text style={styles.confirmBtnText}>Yes, I'm on it!</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <AdminPanel
        isOpen={isDrawerOpen}
        onClose={() => setIsDrawerOpen(false)}
        allStations={allStations}
        onRefreshStations={loadAllStations}
        onSettingsSaved={loadSettings}
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
