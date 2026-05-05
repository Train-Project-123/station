import React, { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Modal,
  TextInput,
  SafeAreaView,
  ActivityIndicator,
  Alert
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { addStation, updateStation, deleteStation } from '../utils/api';

const AdminPanel = ({ isOpen, onClose, allStations, onRefreshStations, showToast, onViewStation }) => {
  const [drawerTab, setDrawerTab] = useState('add');
  const [isEditMode, setIsEditMode] = useState(false);
  const [editingStationId, setEditingStationId] = useState(null);
  const [adminLoading, setAdminLoading] = useState(false);
  const [adminForm, setAdminForm] = useState({
    name: '', code: '', zone: '', state: '', lat: '', lng: ''
  });

  const handleSave = async () => {
    if (!adminForm.name || !adminForm.code || !adminForm.lat || !adminForm.lng) {
      if (showToast) showToast('Please fill all fields', 'warning');
      else Alert.alert('Warning', 'Please fill all fields');
      return;
    }
    setAdminLoading(true);
    try {
      const data = {
        stationName: adminForm.name,
        stationCode: adminForm.code,
        zone: adminForm.zone || 'SR',
        division: 'TVC',
        state: adminForm.state || 'Kerala',
        latitude: parseFloat(adminForm.lat),
        longitude: parseFloat(adminForm.lng)
      };

      const res = isEditMode ? await updateStation(editingStationId, data) : await addStation(data);
      if (res.success) {
        if (showToast) showToast(isEditMode ? 'Updated!' : 'Added!', 'success');
        setAdminForm({ name: '', code: '', zone: '', state: '', lat: '', lng: '' });
        setIsEditMode(false);
        setEditingStationId(null);
        setDrawerTab('list');
        onRefreshStations();
      } else {
        if (showToast) showToast(res.message || 'Failed', 'error');
      }
    } catch (e) {
      if (showToast) showToast('Network error', 'error');
    } finally {
      setAdminLoading(false);
    }
  };

  const handleEdit = (s) => {
    setAdminForm({
      name: s.stationName,
      code: s.stationCode,
      zone: s.zone,
      state: s.state,
      lat: (s.coordinates?.lat || s.location?.coordinates?.[1] || '').toString(),
      lng: (s.coordinates?.lng || s.location?.coordinates?.[0] || '').toString(),
    });
    setEditingStationId(s._id);
    setIsEditMode(true);
    setDrawerTab('add');
  };

  const handleDelete = (s) => {
    Alert.alert(
      'Delete Station',
      `Are you sure you want to delete ${s.stationName}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        { 
          text: 'Delete', 
          style: 'destructive',
          onPress: async () => {
            try {
              const res = await deleteStation(s._id);
              if (res.success) {
                if (showToast) showToast('Deleted!', 'success');
                onRefreshStations();
              }
            } catch (e) {
              if (showToast) showToast('Delete failed', 'error');
            }
          }
        }
      ]
    );
  };

  return (
    <Modal visible={isOpen} animationType="slide" transparent={false} onRequestClose={onClose}>
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <View>
            <Text style={styles.title}>ADMIN PANEL</Text>
            <Text style={styles.subtitle}>Station Directory Management</Text>
          </View>
          <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
            <Ionicons name="close" size={24} color="#fafafa" />
          </TouchableOpacity>
        </View>

        <View style={styles.tabs}>
          <TouchableOpacity 
            style={[styles.tab, drawerTab === 'add' && styles.tabActive]} 
            onPress={() => setDrawerTab('add')}
          >
            <Ionicons name="add-circle-outline" size={18} color={drawerTab === 'add' ? "#fff" : "#71717a"} />
            <Text style={[styles.tabText, drawerTab === 'add' && styles.tabTextActive]}>
              {isEditMode ? 'Edit Station' : 'Add New'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity 
            style={[styles.tab, drawerTab === 'list' && styles.tabActive]} 
            onPress={() => { setDrawerTab('list'); setIsEditMode(false); setEditingStationId(null); setAdminForm({ name: '', code: '', zone: '', state: '', lat: '', lng: '' }); }}
          >
            <Ionicons name="list" size={18} color={drawerTab === 'list' ? "#fff" : "#71717a"} />
            <Text style={[styles.tabText, drawerTab === 'list' && styles.tabTextActive]}>Directory</Text>
          </TouchableOpacity>
        </View>

        <ScrollView style={styles.scroll} contentContainerStyle={{ paddingBottom: 40 }}>
          {drawerTab === 'add' ? (
            <View style={styles.form}>
              <View style={styles.inputGroup}>
                <Text style={styles.label}>STATION CODE</Text>
                <TextInput 
                  style={styles.input} 
                  placeholder="e.g. ERS" 
                  placeholderTextColor="#3f3f46"
                  value={adminForm.code}
                  onChangeText={(v) => setAdminForm(p => ({ ...p, code: v.toUpperCase() }))}
                />
              </View>
              <View style={styles.inputGroup}>
                <Text style={styles.label}>STATION NAME</Text>
                <TextInput 
                  style={styles.input} 
                  placeholder="e.g. Ernakulam Junction" 
                  placeholderTextColor="#3f3f46"
                  value={adminForm.name}
                  onChangeText={(v) => setAdminForm(p => ({ ...p, name: v }))}
                />
              </View>
              <View style={{ flexDirection: 'row', gap: 12 }}>
                <View style={[styles.inputGroup, { flex: 1 }]}>
                  <Text style={styles.label}>LATITUDE</Text>
                  <TextInput 
                    style={styles.input} 
                    placeholder="9.96..." 
                    placeholderTextColor="#3f3f46"
                    keyboardType="numeric"
                    value={adminForm.lat}
                    onChangeText={(v) => setAdminForm(p => ({ ...p, lat: v }))}
                  />
                </View>
                <View style={[styles.inputGroup, { flex: 1 }]}>
                  <Text style={styles.label}>LONGITUDE</Text>
                  <TextInput 
                    style={styles.input} 
                    placeholder="76.29..." 
                    placeholderTextColor="#3f3f46"
                    keyboardType="numeric"
                    value={adminForm.lng}
                    onChangeText={(v) => setAdminForm(p => ({ ...p, lng: v }))}
                  />
                </View>
              </View>
              
              <TouchableOpacity style={styles.saveBtn} onPress={handleSave} disabled={adminLoading}>
                {adminLoading ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.saveBtnText}>{isEditMode ? 'Update Station' : 'Create Station'}</Text>
                )}
              </TouchableOpacity>

              {isEditMode && (
                <TouchableOpacity 
                  style={styles.cancelBtn} 
                  onPress={() => { setIsEditMode(false); setEditingStationId(null); setAdminForm({ name: '', code: '', zone: '', state: '', lat: '', lng: '' }); }}
                >
                  <Text style={styles.cancelBtnText}>Cancel Editing</Text>
                </TouchableOpacity>
              )}
            </View>
          ) : (
            <View style={styles.list}>
              {allStations.length === 0 ? (
                <View style={styles.emptyState}>
                  <Ionicons name="search-outline" size={40} color="#27272a" />
                  <Text style={styles.emptyText}>No stations found in directory</Text>
                </View>
              ) : (
                allStations.map((s) => (
                  <View key={s._id} style={styles.listItem}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.itemCode}>{s.stationCode}</Text>
                      <Text style={styles.itemName}>{s.stationName}</Text>
                      <Text style={styles.itemMeta}>{s.zone} · {s.state}</Text>
                    </View>
                    <View style={styles.itemActions}>
                      <TouchableOpacity 
                        style={[styles.actionBtn, { backgroundColor: '#18181b' }]} 
                        onPress={() => { onClose(); if (onViewStation) onViewStation(s); }}
                      >
                        <Ionicons name="eye" size={18} color="#fafafa" />
                      </TouchableOpacity>
                      <TouchableOpacity style={styles.actionBtn} onPress={() => handleEdit(s)}>
                        <Ionicons name="pencil" size={18} color="#818cf8" />
                      </TouchableOpacity>
                      <TouchableOpacity style={[styles.actionBtn, { backgroundColor: '#450a0a' }]} onPress={() => handleDelete(s)}>
                        <Ionicons name="trash" size={18} color="#ef4444" />
                      </TouchableOpacity>
                    </View>
                  </View>
                ))
              )}
            </View>
          )}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#09090b' },
  header: { 
    flexDirection: 'row', 
    justifyContent: 'space-between', 
    alignItems: 'center',
    padding: 24,
    borderBottomWidth: 1,
    borderBottomColor: '#18181b'
  },
  title: { color: '#fff', fontSize: 20, fontWeight: '900', letterSpacing: 2 },
  subtitle: { color: '#71717a', fontSize: 12, marginTop: 2 },
  closeBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#18181b',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#27272a'
  },
  tabs: { 
    flexDirection: 'row', 
    padding: 16,
    gap: 12,
    backgroundColor: '#09090b'
  },
  tab: { 
    flex: 1, 
    flexDirection: 'row',
    height: 44,
    borderRadius: 12,
    backgroundColor: '#18181b',
    alignItems: 'center', 
    justifyContent: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: '#27272a'
  },
  tabActive: { 
    backgroundColor: '#1e1b4b',
    borderColor: '#312e81'
  },
  tabText: { color: '#71717a', fontWeight: '700', fontSize: 13 },
  tabTextActive: { color: '#818cf8' },
  scroll: { flex: 1 },
  form: { padding: 24, gap: 20 },
  inputGroup: { gap: 8 },
  label: { color: '#71717a', fontSize: 11, fontWeight: '800', letterSpacing: 1 },
  input: { 
    backgroundColor: '#09090b', 
    color: '#fff', 
    padding: 14, 
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#27272a',
    fontSize: 15
  },
  saveBtn: { 
    backgroundColor: '#1e1b4b', 
    padding: 16, 
    borderRadius: 12, 
    alignItems: 'center',
    marginTop: 10,
    borderWidth: 1,
    borderColor: '#312e81'
  },
  saveBtnText: { color: '#818cf8', fontWeight: '900', textTransform: 'uppercase', letterSpacing: 1 },
  cancelBtn: { padding: 12, alignItems: 'center' },
  cancelBtnText: { color: '#71717a', fontSize: 13, textDecorationLine: 'underline' },
  list: { padding: 16, gap: 12 },
  listItem: { 
    flexDirection: 'row',
    padding: 16, 
    backgroundColor: '#18181b', 
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#27272a',
    alignItems: 'center'
  },
  itemCode: { color: '#818cf8', fontSize: 14, fontWeight: '900', letterSpacing: 1 },
  itemName: { color: '#fafafa', fontSize: 16, fontWeight: '700', marginTop: 2 },
  itemMeta: { color: '#52525b', fontSize: 12, marginTop: 4 },
  itemActions: { flexDirection: 'row', gap: 8 },
  actionBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: '#27272a',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#3f3f46'
  },
  emptyState: { alignItems: 'center', padding: 60, gap: 12 },
  emptyText: { color: '#3f3f46', fontSize: 14, fontWeight: '600' }
});

export default AdminPanel;
