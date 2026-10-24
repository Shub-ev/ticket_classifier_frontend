import { useCallback, useEffect, useState } from 'react';
import { api, friendlyError, normalizeGroups, normalizeTicket, toList } from '../services/api';

const loadHumanReview = async () => toList(await api.fetchHumanReviewTickets()).map(normalizeTicket);
const loadAssigned = async () => toList(await api.fetchAssignedTickets()).map(normalizeTicket);
const loadGroups = async () => normalizeGroups(await api.fetchAssignmentGroups());

/** Shared fetch-hook: list response, normalizes tickets/groups, exposes loading/error/refetch */
function useApiList(loader) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let canceled = false;
    (async () => {
      try {
        const data = await loader();
        if (!canceled) {
          setItems(data);
          setError(null);
        }
      } catch (e) {
        if (!canceled) setError(friendlyError(e));
      } finally {
        if (!canceled) setLoading(false);
      }
    })();
    return () => {
      canceled = true;
    };
  }, [loader]);

  const refetch = useCallback(async () => {
    try {
      const data = await loader();
      setItems(data);
      setError(null);
    } catch (e) {
      setError(friendlyError(e));
    }
  }, [loader]);

  return { items, loading, error, refetch };
}

export const useHumanReviewTickets = () => useApiList(loadHumanReview);
export const useAssignedTickets = () => useApiList(loadAssigned);
export const useAssignmentGroups = () => useApiList(loadGroups);
