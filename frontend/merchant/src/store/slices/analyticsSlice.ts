import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import { analyticsApi } from '../../services/api';

interface DashboardStats {
  todayRevenue: number;
  todayOrders: number;
  todayCustomers: number;
  averageOrderValue: number;
  revenueChange: number;
  ordersChange: number;
  customersChange: number;
  avgOrderChange: number;
  popularProducts: Array<{
    id: string;
    name: string;
    sales: number;
    revenue: number;
  }>;
  recentOrders: Array<{
    id: string;
    orderNumber: string;
    customerName: string;
    total: number;
    status: string;
    createdAt: string;
  }>;
}

interface SalesData {
  revenue: Array<{ date: string; amount: number }>;
  orders: Array<{ date: string; count: number }>;
  categories: Array<{ name: string; revenue: number }>;
  hourlyDistribution: Array<{ hour: number; orders: number }>;
}

interface ProductAnalytics {
  topProducts: Array<{
    id: string;
    name: string;
    salesCount: number;
    revenue: number;
    averageRating: number;
  }>;
  categoryPerformance: Array<{
    category: string;
    products: number;
    sales: number;
    revenue: number;
  }>;
  stockAlerts: Array<{
    id: string;
    name: string;
    currentStock: number;
    threshold: number;
  }>;
}

interface AnalyticsState {
  dashboardStats: DashboardStats | null;
  salesData: SalesData | null;
  productAnalytics: ProductAnalytics | null;
  loading: boolean;
  error: string | null;
  dateRange: {
    startDate: string;
    endDate: string;
  };
}

const initialState: AnalyticsState = {
  dashboardStats: null,
  salesData: null,
  productAnalytics: null,
  loading: false,
  error: null,
  dateRange: {
    startDate: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    endDate: new Date().toISOString().split('T')[0],
  },
};

export const fetchDashboardStats = createAsyncThunk(
  'analytics/fetchDashboardStats',
  async () => {
    const response = await analyticsApi.getDashboardStats();
    return response.data;
  }
);

export const fetchSalesAnalytics = createAsyncThunk(
  'analytics/fetchSalesAnalytics',
  async ({ startDate, endDate }: { startDate: string; endDate: string }) => {
    const response = await analyticsApi.getSalesAnalytics({ startDate, endDate });
    return response.data;
  }
);

export const fetchProductAnalytics = createAsyncThunk(
  'analytics/fetchProductAnalytics',
  async ({ startDate, endDate }: { startDate: string; endDate: string }) => {
    const response = await analyticsApi.getProductAnalytics({ startDate, endDate });
    return response.data;
  }
);

const analyticsSlice = createSlice({
  name: 'analytics',
  initialState,
  reducers: {
    setDateRange: (state, action) => {
      state.dateRange = action.payload;
    },
    clearError: (state) => {
      state.error = null;
    },
  },
  extraReducers: (builder) => {
    // Dashboard Stats
    builder
      .addCase(fetchDashboardStats.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchDashboardStats.fulfilled, (state, action) => {
        state.loading = false;
        state.dashboardStats = action.payload;
      })
      .addCase(fetchDashboardStats.rejected, (state, action) => {
        state.loading = false;
        state.error = action.error.message || 'Failed to fetch dashboard stats';
      });
    
    // Sales Analytics
    builder
      .addCase(fetchSalesAnalytics.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchSalesAnalytics.fulfilled, (state, action) => {
        state.loading = false;
        state.salesData = action.payload;
      })
      .addCase(fetchSalesAnalytics.rejected, (state, action) => {
        state.loading = false;
        state.error = action.error.message || 'Failed to fetch sales analytics';
      });
    
    // Product Analytics
    builder
      .addCase(fetchProductAnalytics.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchProductAnalytics.fulfilled, (state, action) => {
        state.loading = false;
        state.productAnalytics = action.payload;
      })
      .addCase(fetchProductAnalytics.rejected, (state, action) => {
        state.loading = false;
        state.error = action.error.message || 'Failed to fetch product analytics';
      });
  },
});

export const { setDateRange, clearError } = analyticsSlice.actions;
export default analyticsSlice.reducer;