import React, { useRef, useEffect } from 'react';
import { View, StyleSheet, Animated, Text, Dimensions, Easing } from 'react-native';

const { width, height } = Dimensions.get('window');

/**
 * Cinematic Silhouette Train Intro
 * A professional, high-end animation of a train silhouette passing through a misty landscape.
 */
export default function Intro3D({ onFinish }) {
  const trainMove = useRef(new Animated.Value(0)).current;
  const fadeOut = useRef(new Animated.Value(1)).current;
  const textReveal = useRef(new Animated.Value(0)).current;
  const screenScale = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    // 1. High-speed train movement (Faster: 2.5s)
    Animated.timing(trainMove, {
      toValue: 1,
      duration: 2500,
      easing: Easing.bezier(0.4, 0, 0.2, 1),
      useNativeDriver: true,
    }).start();

    // 2. Text reveal (Snappier: 0.8s)
    Animated.timing(textReveal, {
      toValue: 1,
      duration: 800,
      delay: 300,
      useNativeDriver: true,
    }).start();

    // 3. Cinematic Zoom & Fade Transition
    const timer = setTimeout(() => {
      Animated.parallel([
        Animated.timing(fadeOut, {
          toValue: 0,
          duration: 800,
          useNativeDriver: true,
        }),
        Animated.timing(screenScale, {
          toValue: 1.5,
          duration: 800,
          useNativeDriver: true,
        }),
      ]).start(onFinish);
    }, 2200);

    return () => clearTimeout(timer);
  }, []);

  const trainX = trainMove.interpolate({
    inputRange: [0, 1],
    outputRange: [-width * 2, width * 1.5],
  });

  return (
    <Animated.View style={[
      styles.container, 
      { opacity: fadeOut, transform: [{ scale: screenScale }] }
    ]}>
      {/* ── Cinematic Gradient Sky ── */}
      <View style={styles.sky} />
      
      {/* ── Misty Foreground Layers ── */}
      <View style={[styles.mist, { bottom: 100, opacity: 0.2 }]} />
      <View style={[styles.mist, { bottom: 50, opacity: 0.1 }]} />

      {/* ── High-Speed Train Silhouette ── */}
      <Animated.View style={[styles.trainContainer, { transform: [{ translateX: trainX }] }]}>
        <View style={styles.trainBody}>
          {/* Animated Windows (Light passing by) */}
          <View style={styles.windowContainer}>
            {[...Array(12)].map((_, i) => (
              <View key={i} style={styles.window} />
            ))}
          </View>
          {/* Front Headlight Glow */}
          <View style={styles.headlightGlow} />
        </View>
        <View style={styles.trainShadow} />
      </Animated.View>

      {/* ── Professional Typography ── */}
      <Animated.View style={[styles.overlay, { opacity: textReveal }]}>
        <Text style={styles.title}>STATION FINDER</Text>
        <View style={styles.line} />
        <Text style={styles.sub}>THE FUTURE OF RAIL DETECTION</Text>
      </Animated.View>

      {/* ── Track Silhouette ── */}
      <View style={styles.track} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#050505',
    overflow: 'hidden',
  },
  sky: {
    position: 'absolute',
    top: 0,
    width: '100%',
    height: '60%',
    backgroundColor: '#09090b',
  },
  mist: {
    position: 'absolute',
    width: '200%',
    height: 200,
    backgroundColor: '#10b981',
    borderRadius: 100,
    left: -width / 2,
  },
  trainContainer: {
    position: 'absolute',
    bottom: 120,
    width: width * 2,
    height: 60,
  },
  trainBody: {
    width: '100%',
    height: '100%',
    backgroundColor: '#000',
    borderRadius: 10,
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 40,
  },
  windowContainer: {
    flexDirection: 'row',
    gap: 15,
  },
  window: {
    width: 25,
    height: 12,
    backgroundColor: 'rgba(16, 185, 129, 0.4)',
    borderRadius: 2,
  },
  headlightGlow: {
    position: 'absolute',
    right: 0,
    width: 100,
    height: 100,
    backgroundColor: 'rgba(16, 185, 129, 0.1)',
    borderRadius: 50,
  },
  trainShadow: {
    position: 'absolute',
    bottom: -10,
    width: '100%',
    height: 20,
    backgroundColor: 'rgba(0,0,0,0.5)',
    filter: 'blur(10px)',
  },
  track: {
    position: 'absolute',
    bottom: 118,
    width: '100%',
    height: 2,
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  title: {
    fontSize: 28,
    fontWeight: '900',
    color: '#fff',
    letterSpacing: 8,
  },
  line: {
    width: 40,
    height: 2,
    backgroundColor: '#10b981',
    marginVertical: 15,
  },
  sub: {
    fontSize: 10,
    color: '#71717a',
    fontWeight: '700',
    letterSpacing: 4,
  }
});
