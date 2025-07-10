import { useMutation, useQueryClient } from 'react-query';
import api from '@/services/api';

export function useOrderActions() {
  const queryClient = useQueryClient();

  const acceptOrderMutation = useMutation(
    async ({ orderId, estimatedTime }: { orderId: string; estimatedTime: number }) => {
      const response = await api.put(`/orders/${orderId}/accept`, { estimatedTime });
      return response.data;
    },
    {
      onSuccess: () => {
        queryClient.invalidateQueries('merchant-orders');
        queryClient.invalidateQueries('order');
      },
    }
  );

  const rejectOrderMutation = useMutation(
    async ({ orderId, reason }: { orderId: string; reason: string }) => {
      const response = await api.put(`/orders/${orderId}/reject`, { reason });
      return response.data;
    },
    {
      onSuccess: () => {
        queryClient.invalidateQueries('merchant-orders');
        queryClient.invalidateQueries('order');
      },
    }
  );

  const markReadyMutation = useMutation(
    async (orderId: string) => {
      const response = await api.put(`/orders/${orderId}/ready`);
      return response.data;
    },
    {
      onSuccess: () => {
        queryClient.invalidateQueries('merchant-orders');
        queryClient.invalidateQueries('order');
      },
    }
  );

  const updatePreparationTimeMutation = useMutation(
    async ({ orderId, time }: { orderId: string; time: number }) => {
      const response = await api.put(`/orders/${orderId}/preparation-time`, { time });
      return response.data;
    },
    {
      onSuccess: () => {
        queryClient.invalidateQueries('order');
      },
    }
  );

  return {
    acceptOrder: (orderId: string, estimatedTime: number) =>
      acceptOrderMutation.mutateAsync({ orderId, estimatedTime }),
    rejectOrder: (orderId: string, reason: string) =>
      rejectOrderMutation.mutateAsync({ orderId, reason }),
    markReady: (orderId: string) => markReadyMutation.mutateAsync(orderId),
    updatePreparationTime: (orderId: string, time: number) =>
      updatePreparationTimeMutation.mutateAsync({ orderId, time }),
    isLoading:
      acceptOrderMutation.isLoading ||
      rejectOrderMutation.isLoading ||
      markReadyMutation.isLoading ||
      updatePreparationTimeMutation.isLoading,
  };
}