import { useState, useCallback, useEffect } from 'react';
import { fetchStationLiveBoard } from '../utils/api';

export const useLiveBoard = (stationCode) => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const refresh = useCallback(async () => {
    if (!stationCode) return;
    setLoading(true);
    try {
      const response = await fetchStationLiveBoard(stationCode);
      if (response.success) {
        setData(response.data);
        setError(null);
      } else {
        setError(response.message || 'Failed to fetch');
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [stationCode]);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 30000); // 30s auto-refresh
    return () => clearInterval(interval);
  }, [refresh]);

  return { data, loading, error, refresh };
};
