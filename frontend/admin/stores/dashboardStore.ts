import { create } from 'zustand';
import { dashboardApi } from '../services/api';

interface DashboardStats {
  totalRevenue: number;
  revenueChange: number;
  totalOrders: number;
  ordersChange: number;
  totalUsers: number;
  usersChange: number;
  totalMerchants: number;
  merchantsChange: number;
  activeDrivers: number;
  driversChange: number;
  avgDeliveryTime: number;
  reskflowTimeChange: number;
}

interface RealtimeMetrics {
  activeOrders: number;
  onlineDrivers: number;
  onlineUsers: number;
  ordersPerMinute: number;
}

interface ChartData {
  revenue: Array<{ date: string; amount: number }>;
  orders: Array<{ date: string; count: number }>;
  users: Array<{ date: string; count: number }>;
  ordersByStatus: Array<{ status: string; count: number }>;
}

interface DashboardState {
  stats: DashboardStats | null;
  realtimeMetrics: RealtimeMetrics | null;
  chartData: ChartData | null;
  loading: boolean;
  error: string | null;
  period: string;
  
  fetchStats: () => Promise<void>;
  fetchRealtimeMetrics: () => Promise<void>;
  fetchChartData: (period: string) => Promise<void>;
  setPeriod: (period: string) => void;
}

export const useDashboardStore = create<DashboardState>((set, get) => ({
  stats: null,
  realtimeMetrics: null,
  chartData: null,
  loading: false,
  error: null,
  period: '7days',
  
  fetchStats: async () => {
    set({ loading: true, error: null });
    try {
      const response = await dashboardApi.getStats();
      set({ stats: response.data, loading: false });
    } catch (error: any) {
      set({ 
        error: error.response?.data?.message || 'Failed to fetch stats', 
        loading: false 
      });
    }
  },
  
  fetchRealtimeMetrics: async () => {
    try {
      const response = await dashboardApi.getRealtimeMetrics();
      set({ realtimeMetrics: response.data });
    } catch (error) {
      console.error('Failed to fetch realtime metrics:', error);
    }
  },
  
  fetchChartData: async (period: string) => {
    set({ loading: true, error: null });
    try {
      const response = await dashboardApi.getChartData({ period });
      set({ chartData: response.data, loading: false });
    } catch (error: any) {
      set({ 
        error: error.response?.data?.message || 'Failed to fetch chart data', 
        loading: false 
      });
    }
  },
  
  setPeriod: (period: string) => {
    set({ period });
    get().fetchChartData(period);
  },
}));