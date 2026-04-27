import React, { useEffect, useRef } from 'react';
import {
  View,
  Text,
  Animated,
  StyleSheet,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { createContext, useContext, useState, useCallback } from 'react';

/**
 * Toast notification system (Minimalist & Premium)
 */

const ToastContext = createContext(null);

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const showToast = useCallback((message, type = 'default', duration = 3000) => {
    const id = Date.now().toString();
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

function ToastItem({ toast, onRemove }) {
  const translateY = useRef(new Animated.Value(-30)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.spring(translateY, {
        toValue: 0,
        useNativeDriver: true,
        damping: 15,
        stiffness: 120,
      }),
      Animated.timing(opacity, {
        toValue: 1,
        duration: 250,
        useNativeDriver: true,
      }),
    ]).start();

    const timer = setTimeout(() => {
      Animated.parallel([
        Animated.timing(translateY, {
          toValue: -15,
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
    default: { color: '#fafafa', icon: 'chatbox-ellipses-outline' },
    success: { color: '#4ade80', icon: 'checkmark-circle-outline' },
    warning: { color: '#fbbf24', icon: 'alert-circle-outline' },
    error: { color: '#f87171', icon: 'close-circle-outline' },
    info: { color: '#818cf8', icon: 'information-circle-outline' },
  };

  const style = typeStyles[toast.type] || typeStyles.default;

  return (
    <Animated.View
      style={[
        styles.toast,
        {
          borderColor: 'rgba(255,255,255,0.1)',
          transform: [{ translateY }],
          opacity,
        },
      ]}
    >
      <View style={[styles.indicator, { backgroundColor: style.color }]} />
      <Ionicons name={style.icon} size={18} color={style.color} />
      <Text style={styles.message} numberOfLines={2}>
        {toast.message}
      </Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 54 : 44,
    left: 20,
    right: 20,
    zIndex: 9999,
    gap: 10,
    alignItems: 'center',
  },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1c1c1e',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 14,
    borderWidth: 0.5,
    gap: 10,
    width: '100%',
    ...Platform.select({
      web: {
        boxShadow: '0 4px 10px rgba(0, 0, 0, 0.4)',
      },
      default: {
        shadowColor: '#000',
        shadowOpacity: 0.4,
        shadowOffset: { width: 0, height: 4 },
        shadowRadius: 10,
        elevation: 8,
      }
    })
  },
  indicator: {
    position: 'absolute',
    left: 0,
    top: '25%',
    bottom: '25%',
    width: 3,
    borderTopRightRadius: 2,
    borderBottomRightRadius: 2,
  },
  message: {
    flex: 1,
    fontSize: 13,
    fontWeight: '600',
    color: '#fafafa',
    letterSpacing: -0.2,
  },
});

