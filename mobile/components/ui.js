import React from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator } from 'react-native';

// ─── Card ──────────────────────────────────────────────────────────────────────
export function Card({ children, className = '', style }) {
  return (
    <View
      style={[
        {
          backgroundColor: '#18181b',
          borderRadius: 16,
          borderWidth: 1,
          borderColor: '#27272a',
          overflow: 'hidden',
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

export function CardHeader({ children, style }) {
  return (
    <View style={[{ paddingHorizontal: 20, paddingTop: 20, paddingBottom: 12 }, style]}>
      {children}
    </View>
  );
}

export function CardContent({ children, style }) {
  return (
    <View style={[{ paddingHorizontal: 20, paddingBottom: 16 }, style]}>
      {children}
    </View>
  );
}

export function CardFooter({ children, style }) {
  return (
    <View
      style={[
        {
          paddingHorizontal: 20,
          paddingVertical: 16,
          borderTopWidth: 1,
          borderTopColor: '#27272a',
          flexDirection: 'row',
          alignItems: 'center',
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

// ─── Badge ─────────────────────────────────────────────────────────────────────
export function Badge({ label, variant = 'default', style }) {
  const variantStyles = {
    default: { backgroundColor: '#27272a', color: '#a1a1aa' },
    primary: { backgroundColor: '#4f46e5', color: '#ffffff' },
    success: { backgroundColor: '#16a34a', color: '#ffffff' },
    destructive: { backgroundColor: '#dc2626', color: '#ffffff' },
    warning: { backgroundColor: '#d97706', color: '#ffffff' },
    outline: { backgroundColor: 'transparent', color: '#a1a1aa', borderWidth: 1, borderColor: '#27272a' },
  };

  const vs = variantStyles[variant] || variantStyles.default;

  return (
    <View
      style={[
        {
          paddingHorizontal: 10,
          paddingVertical: 4,
          borderRadius: 100,
          alignSelf: 'flex-start',
          ...vs,
        },
        style,
      ]}
    >
      <Text style={{ fontSize: 11, fontWeight: '600', color: vs.color, letterSpacing: 0.5 }}>
        {label}
      </Text>
    </View>
  );
}

// ─── Button ────────────────────────────────────────────────────────────────────
export function Button({
  onPress,
  label,
  variant = 'default',
  loading = false,
  disabled = false,
  icon,
  style,
}) {
  const variantStyles = {
    default: {
      container: { backgroundColor: '#6366f1' },
      text: { color: '#ffffff' },
    },
    outline: {
      container: { backgroundColor: 'transparent', borderWidth: 1, borderColor: '#27272a' },
      text: { color: '#fafafa' },
    },
    ghost: {
      container: { backgroundColor: 'transparent' },
      text: { color: '#a1a1aa' },
    },
    destructive: {
      container: { backgroundColor: '#ef4444' },
      text: { color: '#ffffff' },
    },
  };

  const vs = variantStyles[variant] || variantStyles.default;

  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled || loading}
      activeOpacity={0.75}
      style={[
        {
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          paddingVertical: 14,
          paddingHorizontal: 24,
          borderRadius: 12,
          gap: 8,
          opacity: disabled || loading ? 0.5 : 1,
          ...vs.container,
        },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={vs.text.color} size="small" />
      ) : (
        <>
          {icon && icon}
          <Text style={{ fontSize: 15, fontWeight: '600', ...vs.text }}>{label}</Text>
        </>
      )}
    </TouchableOpacity>
  );
}

// ─── Separator ─────────────────────────────────────────────────────────────────
export function Separator({ style }) {
  return (
    <View style={[{ height: 1, backgroundColor: '#27272a', marginVertical: 12 }, style]} />
  );
}

// ─── Skeleton ──────────────────────────────────────────────────────────────────
export function Skeleton({ width = '100%', height = 20, style }) {
  return (
    <View
      style={[
        {
          width,
          height,
          backgroundColor: '#27272a',
          borderRadius: 8,
        },
        style,
      ]}
    />
  );
}

// ─── Avatar ────────────────────────────────────────────────────────────────────
export function Avatar({ letter = '?', size = 48, backgroundColor = '#4f46e5', style }) {
  return (
    <View
      style={[
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor,
          alignItems: 'center',
          justifyContent: 'center',
        },
        style,
      ]}
    >
      <Text style={{ color: '#ffffff', fontSize: size * 0.4, fontWeight: '700' }}>
        {letter}
      </Text>
    </View>
  );
}
