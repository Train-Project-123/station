import './global.css';
import React from 'react';
import { ToastProvider } from './components/Toast';
import TrackingScreen from './components/TrackingScreen';

export default function App() {
  return (
    <ToastProvider>
      <TrackingScreen />
    </ToastProvider>
  );
}
