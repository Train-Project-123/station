import React, { useEffect, useRef } from 'react';
import {
  View,
  Text,
  Animated,
  StyleSheet,
  SafeAreaView,
} from 'react-native';

/**
 * Toast notification system (Sonner-inspired for React Native)
 *
 * Usage:
 *   const { showToast } = useToast();
 *   showToast('You are near Kakkanchery', 'success');
 *   showToast('You are outside the boundary', 'warning');
 */

// ─── Toast Context ─────────────────────────────────────────────────────────────
import { createContext, useContext, useState, useCallback } from 'react';

const ToastContext = createContext(null);

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const showToast = useCallback((message, type = 'default', duration = 3500) => {
    const id = Date.now().toString() + Math.random().toString(36).substring(7);
    setToasts((prev) => [...prev, { id, message, type, duration }]);
  }, []);

  const removeToast = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <ToastContainer toasts={toasts} onRemove={removeToast} />
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>');
  return ctx;
}

// ─── Toast Container ───────────────────────────────────────────────────────────
function ToastContainer({ toasts, onRemove }) {
  if (toasts.length === 0) return null;

  return (
    <View style={styles.container} pointerEvents="none">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onRemove={onRemove} />
      ))}
    </View>
  );
}

// ─── Toast Item ────────────────────────────────────────────────────────────────
function ToastItem({ toast, onRemove }) {
  const translateY = useRef(new Animated.Value(-20)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // Slide in
    Animated.parallel([
      Animated.spring(translateY, {
        toValue: 0,
        useNativeDriver: true,
        tension: 100,
        friction: 10,
      }),
      Animated.timing(opacity, {
        toValue: 1,
        duration: 200,
        useNativeDriver: true,
      }),
    ]).start();

    // Auto-dismiss
    const timer = setTimeout(() => {
      Animated.parallel([
        Animated.timing(translateY, {
          toValue: -20,
          duration: 250,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 0,
          duration: 250,
          useNativeDriver: true,
        }),
      ]).start(() => onRemove(toast.id));
    }, toast.duration);

    return () => clearTimeout(timer);
  }, []);

  const typeStyles = {
    default: { bg: '#18181b', border: '#27272a', icon: '💬', text: '#fafafa' },
    success: { bg: '#14532d', border: '#16a34a', icon: '✅', text: '#4ade80' },
    warning: { bg: '#422006', border: '#d97706', icon: '⚠️', text: '#fbbf24' },
    error: { bg: '#450a0a', border: '#dc2626', icon: '❌', text: '#f87171' },
    info: { bg: '#1e1b4b', border: '#6366f1', icon: 'ℹ️', text: '#a5b4fc' },
  };

  const style = typeStyles[toast.type] || typeStyles.default;

  return (
    <Animated.View
      style={[
        styles.toast,
        {
          backgroundColor: style.bg,
          borderColor: style.border,
          transform: [{ translateY }],
          opacity,
        },
      ]}
    >
      <Text style={styles.icon}>{style.icon}</Text>
      <Text style={[styles.message, { color: style.text }]} numberOfLines={2}>
        {toast.message}
      </Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 60,
    left: 16,
    right: 16,
    zIndex: 9999,
    gap: 8,
    alignItems: 'stretch',
  },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1,
    gap: 10,
    shadowColor: '#000',
    shadowOpacity: 0.5,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 12,
    elevation: 8,
  },
  icon: {
    fontSize: 16,
  },
  message: {
    flex: 1,
    fontSize: 14,
    fontWeight: '500',
    lineHeight: 20,
  },
});
