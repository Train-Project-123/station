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
} from 'react-native';
import * as Location from 'expo-location';

import { haversineDistance, formatDistance, isWithinBoundary } from '../utils/haversine';
import { fetchNearbyStations } from '../utils/api';
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
  const [permissionStatus, setPermissionStatus] = useState(PERMISSION_STATUS.CHECKING);

  // ── Tracking State ────────────────────────────────────────────────────────
  const [trackingStatus, setTrackingStatus] = useState(TRACKING_STATUS.IDLE);
  const [isTracking, setIsTracking] = useState(false);
  const [userLocation, setUserLocation] = useState(null);
  const [nearestStation, setNearestStation] = useState(null);
  const [allStations, setAllStations] = useState([]);
  const [distanceMeters, setDistanceMeters] = useState(null);
  const [lastChecked, setLastChecked] = useState(null);
  const [intervalMode, setIntervalMode] = useState(null);
  const [locationError, setLocationError] = useState(null);

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
  }, []);

  // ── STEP 1: Check existing permission on app open ─────────────────────────
  useEffect(() => {
    checkExistingPermission();
  }, []);

  const checkExistingPermission = async () => {
    try {
      const { status } = await Location.getForegroundPermissionsAsync();

      if (status === 'granted') {
        // Already allowed — skip the prompt screen and go straight to tracking
        setPermissionStatus(PERMISSION_STATUS.GRANTED);
        beginTracking(); // auto-start
      } else if (status === 'denied') {
        // Previously denied permanently
        setPermissionStatus(PERMISSION_STATUS.BLOCKED);
      } else {
        // 'undetermined' — show our permission prompt screen
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

      const inside = minDist !== Infinity && isWithinBoundary(minDist, BOUNDARY_METERS);
      const prevStatus = currentStatusRef.current;

      if (inside) {
        if (prevStatus !== TRACKING_STATUS.INSIDE) {
          showToast(`You are near ${nearest.stationName}`, 'success');
          setIntervalMode('30s');
          scheduleInterval(INTERVAL_INSIDE);
        }
        setTrackingStatus(TRACKING_STATUS.INSIDE);
        currentStatusRef.current = TRACKING_STATUS.INSIDE;
      } else {
        if (prevStatus === TRACKING_STATUS.INSIDE) {
          showToast('You are outside the boundary', 'warning');
          setIntervalMode('5min');
          scheduleInterval(INTERVAL_OUTSIDE);
        } else if (prevStatus === TRACKING_STATUS.LOADING) {
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
            <Text style={styles.appBadgeText}>🚉 Railway Station Finder · TEST BUILD</Text>
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
            <Text style={styles.appTitle}>🚉 Station Finder</Text>
            <Text style={styles.appSubtitle}>Indian Railway Geo Tracker</Text>
          </View>
          <View style={styles.headerRight}>
            <Badge label="TEST" variant="primary" />
            <View style={styles.locationGrantedPill}>
              <View style={styles.greenDot} />
              <Text style={styles.locationGrantedText}>GPS On</Text>
            </View>
          </View>
        </View>

        <Separator />

        {/* ── STATUS CARD ── */}
        <Card style={styles.card}>
          <CardHeader>
            <View style={styles.statusRow}>
              <Text style={styles.sectionLabel}>Tracking Status</Text>
              {isTracking && (
                <Animated.View
                  style={[styles.liveDot, { backgroundColor: sc.dot, transform: [{ scale: pulseAnim }] }]}
                />
              )}
            </View>
          </CardHeader>
          <CardContent>
            <View style={[styles.statusBanner, { backgroundColor: sc.bg, borderColor: sc.dot }]}>
              <Text style={[styles.statusText, { color: sc.color }]}>{sc.label}</Text>
            </View>

            {distanceMeters !== null && nearestStation && (
              <View style={styles.distanceRow}>
                <Text style={styles.distanceLabel}>Distance to</Text>
                <Text style={styles.stationNameInline}>{nearestStation.stationName}</Text>
                <Text style={styles.distanceValue}>{formatDistance(distanceMeters)}</Text>
              </View>
            )}

            <View style={styles.thresholdInfo}>
              <Text style={styles.thresholdText}>
                Boundary threshold: <Text style={styles.thresholdValue}>500 m</Text>
              </Text>
              {intervalMode && (
                <Text style={styles.intervalText}>
                  Check interval: <Text style={styles.intervalValue}>{intervalMode}</Text>
                </Text>
              )}
            </View>
          </CardContent>
          <CardFooter>
            {!isTracking ? (
              <Button
                label="Start Tracking"
                variant="default"
                onPress={startTracking}
                loading={trackingStatus === TRACKING_STATUS.LOADING}
                style={{ flex: 1 }}
              />
            ) : (
              <Button
                label="Stop Tracking"
                variant="destructive"
                onPress={stopTracking}
                style={{ flex: 1 }}
              />
            )}
          </CardFooter>
        </Card>

        {/* ── NEAREST STATION CARD ── */}
        {nearestStation && (
          <Card style={styles.card}>
            <CardHeader>
              <Text style={styles.sectionLabel}>Nearest Station</Text>
            </CardHeader>
            <CardContent>
              <View style={styles.stationRow}>
                <Avatar
                  letter={nearestStation.stationName[0]}
                  size={52}
                  backgroundColor={trackingStatus === TRACKING_STATUS.INSIDE ? '#15803d' : '#4f46e5'}
                />
                <View style={styles.stationInfo}>
                  <Text style={styles.stationName}>{nearestStation.stationName}</Text>
                  <Text style={styles.stationCode}>{nearestStation.stationCode}</Text>
                  <View style={styles.badgeRow}>
                    <Badge
                      label={trackingStatus === TRACKING_STATUS.INSIDE ? 'Inside 500m' : 'Outside 500m'}
                      variant={trackingStatus === TRACKING_STATUS.INSIDE ? 'success' : 'warning'}
                    />
                  </View>
                </View>
              </View>

              <Separator />

              <View style={styles.detailGrid}>
                <DetailItem label="Zone" value={nearestStation.zone} />
                <DetailItem label="Division" value={nearestStation.division} />
                <DetailItem label="State" value={nearestStation.state} />
                <DetailItem label="Code" value={nearestStation.stationCode} />
                <DetailItem 
                  label="Station Lat" 
                  value={(nearestStation.coordinates?.lat ?? nearestStation.location?.coordinates?.[1])?.toFixed(6) || 'N/A'} 
                />
                <DetailItem 
                  label="Station Lng" 
                  value={(nearestStation.coordinates?.lng ?? nearestStation.location?.coordinates?.[0])?.toFixed(6) || 'N/A'} 
                />
              </View>

              {distanceMeters !== null && (
                <>
                  <Separator />
                  <View style={styles.distanceBig}>
                    <Text style={styles.distanceBigLabel}>Distance</Text>
                    <Text
                      style={[
                        styles.distanceBigValue,
                        { color: distanceMeters <= BOUNDARY_METERS ? '#4ade80' : '#fbbf24' },
                      ]}
                    >
                      {formatDistance(distanceMeters)}
                    </Text>
                    <Text style={styles.distanceBigSub}>
                      {distanceMeters <= BOUNDARY_METERS
                        ? `${BOUNDARY_METERS - distanceMeters}m inside boundary`
                        : `${distanceMeters - BOUNDARY_METERS}m outside boundary`}
                    </Text>
                  </View>
                </>
              )}
            </CardContent>
          </Card>
        )}

        {/* ── LOCATION DEBUG CARD ── */}
        {userLocation && (
          <Card style={styles.card}>
            <CardHeader>
              <Text style={styles.sectionLabel}>Your Location</Text>
            </CardHeader>
            <CardContent>
              <View style={styles.coordRow}>
                <View style={styles.coordItem}>
                  <Text style={styles.coordLabel}>Latitude</Text>
                  <Text style={styles.coordValue}>{userLocation.lat.toFixed(6)}</Text>
                </View>
                <View style={styles.coordDivider} />
                <View style={styles.coordItem}>
                  <Text style={styles.coordLabel}>Longitude</Text>
                  <Text style={styles.coordValue}>{userLocation.lng.toFixed(6)}</Text>
                </View>
              </View>
              {lastChecked && (
                <Text style={styles.lastChecked}>
                  Last updated:{' '}
                  {lastChecked.toLocaleTimeString('en-IN', {
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                  })}
                </Text>
              )}
            </CardContent>
          </Card>
        )}

        {/* ── LOADING SKELETONS ── */}
        {trackingStatus === TRACKING_STATUS.LOADING && (
          <Card style={styles.card}>
            <CardContent style={{ gap: 12, paddingTop: 16 }}>
              <Skeleton height={20} width="60%" />
              <Skeleton height={16} width="40%" />
              <Skeleton height={48} />
            </CardContent>
          </Card>
        )}

        {/* ── ERROR STATE ── */}
        {locationError && (
          <Card style={[styles.card, { borderColor: '#dc2626' }]}>
            <CardContent>
              <Text style={styles.errorTitle}>⚠️ Location Error</Text>
              <Text style={styles.errorText}>{locationError}</Text>
              <Button
                label="Retry"
                variant="outline"
                onPress={startTracking}
                style={{ marginTop: 12 }}
              />
            </CardContent>
          </Card>
        )}

        {/* ── HOW IT WORKS CARD ── */}
        <Card style={styles.card}>
          <CardHeader>
            <Text style={styles.sectionLabel}>How It Works</Text>
          </CardHeader>
          <CardContent>
            <InfoRow icon="📍" text="Gets your GPS location via expo-location" />
            <InfoRow icon="📏" text="Calculates distance using Haversine formula" />
            <InfoRow icon="🟢" text="Inside 500m → checks every 30 seconds" />
            <InfoRow icon="🟡" text="Outside 500m → checks every 5 minutes" />
            <InfoRow icon="🔔" text="Shows toast notifications on boundary change" />
          </CardContent>
        </Card>

        <View style={{ height: 32 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

// ─── Sub-components ────────────────────────────────────────────────────────────
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
});
