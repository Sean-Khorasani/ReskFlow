import { useQuery, useMutation, useQueryClient } from 'react-query';
import { useSocket } from './useSocket';
import { useEffect } from 'react';
import api from '@/services/api';

interface Order {
  id: string;
  orderNumber: string;
  status: string;
  type: string;
  customer: {
    id: string;
    name: string;
    email: string;
    phone: string;
    avatar?: string;
  };
  items: any[];
  total: number;
  subtotal: number;
  tax: number;
  reskflowFee: number;
  serviceFee: number;
  tip: number;
  itemCount: number;
  createdAt: string;
  acceptedAt?: string;
  preparingAt?: string;
  readyAt?: string;
  estimatedReadyTime?: string;
  isScheduled: boolean;
  scheduledFor?: string;
  reskflowAddress?: any;
  instructions?: string;
}

interface OrderStats {
  todayOrders: number;
  todayRevenue: number;
  avgPrepTime: number;
  activeOrders: number;
  rating: number;
  orderChange: number;
  revenueChange: number;
}

export function useOrders() {
  const queryClient = useQueryClient();
  const { socket } = useSocket();

  // Fetch orders
  const { data, loading, error } = useQuery<{
    orders: Order[];
    stats: OrderStats;
  }>(
    'merchant-orders',
    async () => {
      const response = await api.get('/merchants/orders');
      return response.data;
    },
    {
      refetchInterval: 30000, // Refetch every 30 seconds
    }
  );

  // Listen for real-time updates
  useEffect(() => {
    if (!socket) return;

    // New order
    socket.on('order:new', (order: Order) => {
      queryClient.setQueryData('merchant-orders', (old: any) => ({
        ...old,
        orders: [order, ...(old?.orders || [])],
        stats: {
          ...old?.stats,
          activeOrders: (old?.stats?.activeOrders || 0) + 1,
          todayOrders: (old?.stats?.todayOrders || 0) + 1,
        },
      }));
    });

    // Order updates
    socket.on('order:updated', (updatedOrder: Order) => {
      queryClient.setQueryData('merchant-orders', (old: any) => ({
        ...old,
        orders: old?.orders?.map((order: Order) =>
          order.id === updatedOrder.id ? updatedOrder : order
        ) || [],
      }));
    });

    // Order cancelled
    socket.on('order:cancelled', (orderId: string) => {
      queryClient.setQueryData('merchant-orders', (old: any) => ({
        ...old,
        orders: old?.orders?.map((order: Order) =>
          order.id === orderId ? { ...order, status: 'CANCELLED' } : order
        ) || [],
        stats: {
          ...old?.stats,
          activeOrders: Math.max((old?.stats?.activeOrders || 0) - 1, 0),
        },
      }));
    });

    return () => {
      socket.off('order:new');
      socket.off('order:updated');
      socket.off('order:cancelled');
    };
  }, [socket, queryClient]);

  return {
    orders: data?.orders || [],
    stats: data?.stats || {
      todayOrders: 0,
      todayRevenue: 0,
      avgPrepTime: 0,
      activeOrders: 0,
      rating: 0,
      orderChange: 0,
      revenueChange: 0,
    },
    loading: !data && !error,
    error,
    refetch: () => queryClient.invalidateQueries('merchant-orders'),
  };
}