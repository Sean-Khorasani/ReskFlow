import { useQuery } from 'react-query';
import { useSocket } from './useSocket';
import { useEffect } from 'react';
import api from '@/services/api';

export function useOrder(orderId: string) {
  const { socket } = useSocket();

  const { data: order, isLoading: loading, refetch } = useQuery(
    ['order', orderId],
    async () => {
      const response = await api.get(`/orders/${orderId}`);
      return response.data;
    },
    {
      enabled: !!orderId,
      refetchInterval: false,
    }
  );

  // Listen for updates to this specific order
  useEffect(() => {
    if (!socket || !orderId) return;

    const handleUpdate = (updatedOrder: any) => {
      if (updatedOrder.id === orderId) {
        refetch();
      }
    };

    socket.on('order:updated', handleUpdate);
    socket.on(`order:${orderId}:updated`, refetch);

    return () => {
      socket.off('order:updated', handleUpdate);
      socket.off(`order:${orderId}:updated`, refetch);
    };
  }, [socket, orderId, refetch]);

  return {
    order,
    loading,
    refetch,
  };
}