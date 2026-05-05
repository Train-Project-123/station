import React from 'react';
import { View, Text, Modal, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';

const AdminAuthModal = ({ isOpen, onClose, passcodeInput, setPasscodeInput, onVerify, error, loading }) => {
  return (
    <Modal visible={isOpen} transparent={true} animationType="fade">
      <View style={styles.overlay}>
        <View style={styles.modal}>
          <Text style={styles.title}>Admin Access</Text>
          <Text style={styles.subtitle}>Enter passcode to manage stations</Text>
          
          <TextInput
            style={[styles.input, error && styles.inputError]}
            placeholder="Passcode"
            placeholderTextColor="#71717a"
            secureTextEntry
            value={passcodeInput}
            onChangeText={setPasscodeInput}
            keyboardType="numeric"
          />
          
          {error && <Text style={styles.errorText}>Invalid Passcode</Text>}

          <View style={styles.footer}>
            <TouchableOpacity onPress={onClose} style={styles.btnSecondary}>
              <Text style={styles.btnText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={onVerify} style={styles.btnPrimary} disabled={loading}>
              {loading ? <ActivityIndicator color="#000" /> : <Text style={styles.btnPrimaryText}>Verify</Text>}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', justifyContent: 'center', alignItems: 'center' },
  modal: { backgroundColor: '#09090b', padding: 24, borderRadius: 16, width: '85%', borderSize: 1, borderColor: '#18181b' },
  title: { color: '#fff', fontSize: 20, fontWeight: 'bold', marginBottom: 8 },
  subtitle: { color: '#a1a1aa', fontSize: 14, marginBottom: 20 },
  input: { backgroundColor: '#18181b', color: '#fff', padding: 12, borderRadius: 8, marginBottom: 12 },
  inputError: { borderColor: '#ef4444', borderWidth: 1 },
  errorText: { color: '#ef4444', fontSize: 12, marginBottom: 12 },
  footer: { flexDirection: 'row', justifyContent: 'flex-end', gap: 12, marginTop: 12 },
  btnSecondary: { padding: 12 },
  btnPrimary: { backgroundColor: '#fff', paddingHorizontal: 24, paddingVertical: 12, borderRadius: 8 },
  btnText: { color: '#a1a1aa' },
  btnPrimaryText: { color: '#000', fontWeight: 'bold' }
});

export default AdminAuthModal;
