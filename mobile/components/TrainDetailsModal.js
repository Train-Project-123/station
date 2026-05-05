import React from 'react';
import {
  View,
  Text,
  Modal,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { styles } from './TrackingScreen.styles';

const formatTime = (ts) => {
  if (!ts || typeof ts !== 'number') return null;
  try {
    const date = new Date(ts * 1000);
    return date.toLocaleTimeString('en-IN', {
      hour: 'numeric', minute: '2-digit', hour12: true,
      timeZone: 'Asia/Kolkata'
    });
  } catch { return null; }
};

export default function TrainDetailsModal({
  isOpen,
  onClose,
  train,
  loading,
  routeData,
  allStations
}) {
  const rawData = routeData?.data || routeData;
  const liveData = rawData?.liveData || rawData;
  const fullRoute = liveData?.route || rawData?.route || [];

  // --- Dynamic Focus Logic ---
  let focusIndex = fullRoute.findIndex(stop =>
    (stop.hasArrived || !!stop.actualArrival) &&
    !(stop.hasDeparted || !!stop.actualDeparture)
  );

  if (focusIndex === -1) {
    focusIndex = fullRoute.findIndex(stop =>
      !(stop.hasArrived || !!stop.actualArrival) &&
      !(stop.hasDeparted || !!stop.actualDeparture)
    );
  }

  if (focusIndex === -1) focusIndex = 0;

  const startIndex = Math.max(0, focusIndex - 2);
  const endIndex = Math.min(fullRoute.length - 1, focusIndex + 2);
  const displayRoute = fullRoute.slice(startIndex, endIndex + 1);

  return (
    <Modal
      visible={isOpen}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={styles.confirmOverlay}>
        <View style={[styles.confirmContent, { width: '94%', height: '85%', padding: 0, overflow: 'hidden' }]}>
          <View style={{ backgroundColor: '#1e1b4b', padding: 20, width: '100%', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: '#818cf8', fontSize: 12, fontWeight: '700', letterSpacing: 1 }}>TRAIN STATUS</Text>
              <Text style={{ color: '#fff', fontSize: 20, fontWeight: '900', marginTop: 2 }}>{train?.trainNumber}</Text>
              <Text style={{ color: '#a1a1aa', fontSize: 13 }} numberOfLines={1}>{train?.trainName}</Text>
            </View>
            <TouchableOpacity onPress={onClose} style={{ padding: 8 }}>
              <Ionicons name="close" size={24} color="#fafafa" />
            </TouchableOpacity>
          </View>

          <ScrollView
            style={{ flex: 1, backgroundColor: '#09090b' }}
            contentContainerStyle={{ padding: 16, width: '100%' }}
          >
            {loading ? (
              <View style={{ padding: 40, alignItems: 'center' }}>
                <ActivityIndicator size="large" color="#6366f1" />
                <Text style={{ color: '#71717a', marginTop: 12 }}>Fetching live route...</Text>
              </View>
            ) : displayRoute.length > 0 ? (
              <View style={{ width: '100%', paddingRight: 10 }}>
                {displayRoute.map((stop, idx) => {
                  const isPassed = stop.hasDeparted || !!stop.actualDeparture;
                  const isCurrent = (stop.hasArrived || !!stop.actualArrival) && !isPassed;
                  const delayMin = stop.delayArrivalMinutes || stop.delayDepartureMinutes || stop.delay || 0;
                  const isDelayed = delayMin > 0;

                  // Resolve Station Name (Case-Insensitive)
                  const resolvedStation = allStations.find(s =>
                    s.stationCode?.toUpperCase().trim() === stop.stationCode?.toUpperCase().trim()
                  );
                  const resolvedName = resolvedStation?.stationName || stop.stationName || stop.stationCode;

                  // Hide line if it's the absolute last station in the train's journey
                  const isAbsoluteLast = stop.stationCode === fullRoute[fullRoute.length - 1]?.stationCode;

                  return (
                    <View key={`route-${stop.stationCode}-${idx}`} style={{ flexDirection: 'row', width: '100%' }}>
                      {/* Timeline Track */}
                      <View style={{ alignItems: 'center', width: 30 }}>
                        <View style={{
                          width: 2,
                          flex: 1,
                          backgroundColor: isPassed ? '#3b82f6' : '#3f3f46',
                          zIndex: 1,
                          opacity: isAbsoluteLast ? 0 : 1
                        }} />
                        <View style={{
                          position: 'absolute',
                          top: 0,
                          width: 24,
                          height: 24,
                          borderRadius: 12,
                          backgroundColor: isCurrent ? '#3b82f6' : (isPassed ? '#3b82f6' : '#18181b'),
                          alignItems: 'center',
                          justifyContent: 'center',
                          borderWidth: 2,
                          borderColor: isCurrent ? '#fff' : '#3f3f46',
                          zIndex: 10,
                        }}>
                          {isCurrent ? (
                            <Ionicons name="train" size={12} color="#fff" />
                          ) : (
                            <View style={{
                              width: 6,
                              height: 6,
                              borderRadius: 3,
                              backgroundColor: isPassed ? '#fff' : '#3f3f46'
                            }} />
                          )}
                        </View>
                      </View>

                      {/* Station Card */}
                      <View style={{ flex: 1, marginLeft: 12, marginBottom: 24, minWidth: 200 }}>
                        <View style={[
                          styles.premiumTimelineCard,
                          { width: '100%' },
                          isCurrent && { borderColor: '#3b82f6', backgroundColor: 'rgba(59, 130, 246, 0.05)' },
                          isPassed && !isCurrent && { opacity: 0.9 }
                        ]}>
                          <Text style={[styles.timelineStationName, isCurrent && { color: '#60a5fa' }]}>
                            {resolvedName}
                          </Text>
                          <Text style={{ color: '#71717a', fontSize: 12, fontWeight: '700' }}>{stop.stationCode}</Text>

                          <View style={{ flexDirection: 'row', gap: 8, marginTop: 8, alignItems: 'center' }}>
                            {isDelayed && (
                              <View style={styles.delayBadgeSmall}>
                                <Text style={styles.delayBadgeTextSmall}>{delayMin}min Late</Text>
                              </View>
                            )}
                            {stop.platform && (
                              <View style={styles.pfBadgeSmall}>
                                <Text style={styles.pfBadgeTextSmall}>PF {stop.platform}</Text>
                              </View>
                            )}
                          </View>

                          <View style={{ marginTop: 16 }}>
                            <Text style={styles.timeLabelSmall}>Arrival</Text>
                            <Text style={[styles.timeValueSmall, isPassed && { color: '#60a5fa' }]}>
                              {formatTime(stop.actualArrival || stop.scheduledArrival)}
                            </Text>
                            <Text style={styles.timeSubSmall}>{formatTime(stop.scheduledArrival)}</Text>
                          </View>

                          <View style={{ marginTop: 12 }}>
                            <Text style={styles.timeLabelSmall}>Departure</Text>
                            <Text style={[styles.timeValueSmall, isPassed && { color: '#60a5fa' }]}>
                              {formatTime(stop.actualDeparture || stop.scheduledDeparture)}
                            </Text>
                            <Text style={styles.timeSubSmall}>{formatTime(stop.scheduledDeparture)}</Text>
                          </View>
                        </View>
                      </View>
                    </View>
                  );
                })}
              </View>
            ) : (
              <View style={{ padding: 40, alignItems: 'center' }}>
                <Ionicons name="alert-circle-outline" size={32} color="#3f3f46" />
                <Text style={{ color: '#71717a', marginTop: 12 }}>No route data available</Text>
              </View>
            )}
          </ScrollView>

          <TouchableOpacity
            style={{ backgroundColor: '#18181b', padding: 16, alignItems: 'center', borderTopWidth: 1, borderTopColor: '#27272a' }}
            onPress={onClose}
          >
            <Text style={{ color: '#fafafa', fontWeight: '700' }}>Close Details</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}
