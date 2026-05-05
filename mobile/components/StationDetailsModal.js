import React, { useState, useMemo } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Modal,
  TextInput,
  ActivityIndicator
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import TrainDetailsModal from './TrainDetailsModal';
import { fetchTrainDetails } from '../utils/api';

const StationDetailsModal = ({ isOpen, onClose, station, liveBoard, allStations }) => {
  const [trainSearchQuery, setTrainSearchQuery] = useState('');
  const [isTrainModalOpen, setIsTrainModalOpen] = useState(false);
  const [viewingTrain, setViewingTrain] = useState(null);
  const [trainDetailData, setTrainDetailData] = useState(null);
  const [trainDetailLoading, setTrainDetailLoading] = useState(false);


  const fmt12h = (timeStr) => {
    if (!timeStr || timeStr === '--:--' || !timeStr.includes(':')) return null;
    try {
      const [h, m] = timeStr.split(':').map(Number);
      const period = h >= 12 ? 'PM' : 'AM';
      const hour = h % 12 || 12;
      return `${hour}:${String(m).padStart(2, '0')} ${period}`;
    } catch { return null; }
  };

  const getTrainState = (train) => {
    if (train.status?.hasDeparted) return 'departed';
    if (train.status?.hasArrived) return 'at_station';
    return 'upcoming';
  };

  const filteredBoard = useMemo(() => {
    if (!liveBoard) return null;
    const filterFn = (t) => !trainSearchQuery || 
      t.trainNumber?.includes(trainSearchQuery) || 
      t.toCode?.toLowerCase().includes(trainSearchQuery.toLowerCase());

    return {
      ...liveBoard,
      atStation: liveBoard.atStation?.filter(filterFn) || [],
      approaching: liveBoard.approaching?.filter(filterFn) || [],
      upcoming: liveBoard.upcoming?.filter(filterFn) || [],
      gone: liveBoard.gone?.filter(filterFn) || [],
      trains: liveBoard.trains?.filter(filterFn) || []
    };
  }, [liveBoard, trainSearchQuery]);
  
  if (!station) return null;

  const handleViewTrain = async (train) => {
    setViewingTrain(train);
    setIsTrainModalOpen(true);
    setTrainDetailLoading(true);
    setTrainDetailData(null);
    try {
      const res = await fetchTrainDetails(train.trainNumber);
      setTrainDetailData(res.data || res);
    } catch (e) {
      setTrainDetailData(null);
    } finally {
      setTrainDetailLoading(false);
    }
  };

  const renderTrainRow = (train) => {
    const state = getTrainState(train);
    const resolvedDest = allStations.find(s =>
      s.stationCode?.toUpperCase().trim() === train.toCode?.toUpperCase().trim()
    )?.stationName || train.toCode || 'Unknown';
    
    const depTime = fmt12h(train.scheduled?.departure);
    const arrTime = fmt12h(train.expectedArrival || train.scheduledArrival);
    const delay = train.delayMinutes || 0;

    const isAtStation = state === 'at_station';
    const isDeparted = state === 'departed';

    return (
      <View key={train.trainNumber} style={[styles.trainRow, isAtStation && styles.atStationRow, isDeparted && styles.departedRow]}>
        <View style={{ flex: 1 }}>
          <View style={styles.trainHeader}>
            <Text style={styles.trainNum}>{train.trainNumber}</Text>
            <Text style={styles.trainName} numberOfLines={1}>{train.trainName}</Text>
          </View>
          <Text style={styles.destText}>to {resolvedDest}</Text>
        </View>

        <View style={styles.rightActions}>
          <View style={styles.timeInfo}>
            {isAtStation ? (
              <Text style={styles.atStationText}>
                {train.platform ? `Platform ${train.platform}` : 'At Platform'}
              </Text>
            ) : isDeparted ? (
              <Text style={styles.departedText}>Departed</Text>
            ) : (
              <Text style={styles.upcomingTime}>{arrTime ? `Arrives ${arrTime}` : 'Upcoming'}</Text>
            )}
            {!isDeparted && delay > 0 && <Text style={styles.delayText}>+{delay} min delay</Text>}
          </View>
          <TouchableOpacity style={styles.viewBtn} onPress={() => handleViewTrain(train)}>
            <Ionicons name="eye-outline" size={16} color="#fafafa" />
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  return (
    <Modal visible={isOpen} animationType="slide" transparent={true} onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.content}>
          <View style={styles.header}>
            <View style={styles.headerLeft}>
              <Ionicons name="location" size={24} color="#818cf8" />
              <View>
                <Text style={styles.title}>{station.stationName}</Text>
                <Text style={styles.subtitle}>{station.stationCode} · {station.zone}</Text>
              </View>
            </View>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
              <Ionicons name="close" size={24} color="#fafafa" />
            </TouchableOpacity>
          </View>

          <View style={styles.searchBar}>
            <Ionicons name="search" size={18} color="#71717a" />
            <TextInput
              style={styles.searchInput}
              placeholder="Search train or destination..."
              placeholderTextColor="#3f3f46"
              value={trainSearchQuery}
              onChangeText={setTrainSearchQuery}
            />
          </View>

          <ScrollView style={styles.scroll} contentContainerStyle={{ padding: 20 }}>
            {!filteredBoard || filteredBoard.trains.length === 0 ? (
              <View style={styles.empty}>
                <Ionicons name="calendar-outline" size={40} color="#27272a" />
                <Text style={styles.emptyText}>No trains scheduled</Text>
              </View>
            ) : (
              <>
                {filteredBoard.atStation?.length > 0 && (
                  <View style={styles.section}>
                    <Text style={[styles.sectionTitle, { color: '#4ade80' }]}>At Station</Text>
                    {filteredBoard.atStation.map(renderTrainRow)}
                  </View>
                )}

                {filteredBoard.approaching?.length > 0 && (
                  <View style={styles.section}>
                    <Text style={[styles.sectionTitle, { color: '#3b82f6' }]}>Approaching</Text>
                    {filteredBoard.approaching.map(renderTrainRow)}
                  </View>
                )}

                {filteredBoard.upcoming?.length > 0 && (
                  <View style={styles.section}>
                    <Text style={styles.sectionTitle}>Upcoming</Text>
                    {filteredBoard.upcoming.map(renderTrainRow)}
                  </View>
                )}

                {filteredBoard.gone?.length > 0 && (
                  <View style={styles.section}>
                    <Text style={[styles.sectionTitle, { color: '#71717a' }]}>Departed</Text>
                    {filteredBoard.gone.map(renderTrainRow)}
                  </View>
                )}
              </>
            )}
          </ScrollView>
        </View>
      </View>

      <TrainDetailsModal
        isOpen={isTrainModalOpen}
        onClose={() => setIsTrainModalOpen(false)}
        train={viewingTrain}
        loading={trainDetailLoading}
        routeData={trainDetailData}
        allStations={allStations}
      />
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', justifyContent: 'flex-end' },
  content: { 
    backgroundColor: '#09090b', 
    height: '85%', 
    borderTopLeftRadius: 32, 
    borderTopRightRadius: 32,
    borderWidth: 1,
    borderColor: '#27272a',
    overflow: 'hidden'
  },
  header: { 
    flexDirection: 'row', 
    justifyContent: 'space-between', 
    alignItems: 'center', 
    padding: 24,
    borderBottomWidth: 1,
    borderBottomColor: '#18181b'
  },
  headerLeft: { flexDirection: 'row', gap: 12, alignItems: 'center' },
  title: { color: '#fff', fontSize: 18, fontWeight: '900', letterSpacing: 0.5 },
  subtitle: { color: '#71717a', fontSize: 12, fontWeight: '600' },
  closeBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#18181b', alignItems: 'center', justifyContent: 'center' },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    margin: 20,
    paddingHorizontal: 16,
    backgroundColor: '#18181b',
    borderRadius: 14,
    height: 48,
    borderWidth: 1,
    borderColor: '#27272a'
  },
  searchInput: { flex: 1, color: '#fff', marginLeft: 12, fontSize: 14 },
  scroll: { flex: 1 },
  section: { marginBottom: 24 },
  sectionTitle: { fontSize: 11, fontWeight: '800', color: '#818cf8', letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 12 },
  trainRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    backgroundColor: '#18181b',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#27272a',
    marginBottom: 10
  },
  atStationRow: { backgroundColor: 'rgba(74, 222, 128, 0.05)', borderColor: 'rgba(74, 222, 128, 0.15)' },
  departedRow: { opacity: 0.5 },
  trainHeader: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  trainNum: { color: '#fff', fontSize: 15, fontWeight: '800' },
  trainName: { color: '#71717a', fontSize: 12, flex: 1 },
  destText: { color: '#a1a1aa', fontSize: 13, marginTop: 4 },
  rightActions: { flexDirection: 'row', gap: 12, alignItems: 'center' },
  timeInfo: { alignItems: 'flex-end' },
  upcomingTime: { color: '#fff', fontSize: 14, fontWeight: '700' },
  atStationText: { color: '#4ade80', fontSize: 14, fontWeight: '800' },
  departedText: { color: '#71717a', fontSize: 14, fontWeight: '600' },
  delayText: { color: '#fb923c', fontSize: 10, fontWeight: '700', marginTop: 2 },
  viewBtn: { width: 32, height: 32, borderRadius: 10, backgroundColor: '#27272a', alignItems: 'center', justifyContent: 'center' },
  empty: { padding: 60, alignItems: 'center', gap: 12 },
  emptyText: { color: '#3f3f46', fontSize: 14, fontWeight: '600' }
});

export default StationDetailsModal;
