import { useState, useCallback, useEffect, useRef } from 'react';
import { fetchStationLiveBoard } from '../utils/api';

export const useLiveBoard = (stationCode) => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const timerRef = useRef(null);

  const refresh = useCallback(async () => {
    if (!stationCode) return;
    setLoading(true);
    try {
      const response = await fetchStationLiveBoard(stationCode);
      if (response.success) {
        setData(response.data);
        setError(null);
        
        // Tiered Polling Strategy
        // 1. Train AT STATION or APPROACHING -> 15-30s
        // 2. Otherwise -> 120s (2 min)
        const hasUrgent = (response.data.atStation?.length > 0 || response.data.approaching?.length > 0);
        const nextInterval = hasUrgent ? 30000 : 120000;
        
        scheduleNext(nextInterval);
      } else {
        setError(response.message || 'Failed to fetch');
        scheduleNext(60000); // Retry in 1m on error
      }
    } catch (err) {
      setError(err.message);
      scheduleNext(60000);
    } finally {
      setLoading(false);
    }
  }, [stationCode]);

  const scheduleNext = (ms) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(refresh, ms);
  };

  useEffect(() => {
    refresh();
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [refresh]);

  return { data, loading, error, refresh };
};
