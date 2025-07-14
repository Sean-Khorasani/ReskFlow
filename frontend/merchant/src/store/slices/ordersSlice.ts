import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import { orderApi } from '../../services/api';

interface OrderItem {
  id: string;
  productId: string;
  productName: string;
  quantity: number;
  price: number;
  specialInstructions?: string;
}

interface Order {
  id: string;
  orderNumber: string;
  customerId: string;
  customerName: string;
  customerPhone: string;
  customerEmail: string;
  status: 'pending' | 'confirmed' | 'preparing' | 'ready' | 'picked_up' | 'delivered' | 'cancelled';
  items: OrderItem[];
  subtotal: number;
  tax: number;
  reskflowFee: number;
  total: number;
  reskflowAddress: string;
  reskflowInstructions?: string;
  paymentMethod: string;
  paymentStatus: string;
  createdAt: string;
  updatedAt: string;
  estimatedReadyTime?: string;
  actualReadyTime?: string;
  driverId?: string;
  driverName?: string;
}

interface OrdersState {
  orders: Order[];
  selectedOrder: Order | null;
  loading: boolean;
  error: string | null;
  filters: {
    status?: string;
    date?: string;
  };
  stats: {
    pending: number;
    preparing: number;
    ready: number;
    completed: number;
  };
}

const initialState: OrdersState = {
  orders: [],
  selectedOrder: null,
  loading: false,
  error: null,
  filters: {},
  stats: {
    pending: 0,
    preparing: 0,
    ready: 0,
    completed: 0,
  },
};

export const fetchOrders = createAsyncThunk(
  'orders/fetchOrders',
  async (params?: { status?: string; date?: string }) => {
    const response = await orderApi.getOrders(params);
    return response.data;
  }
);

export const fetchOrder = createAsyncThunk(
  'orders/fetchOrder',
  async (id: string) => {
    const response = await orderApi.getOrder(id);
    return response.data;
  }
);

export const acceptOrder = createAsyncThunk(
  'orders/acceptOrder',
  async (id: string) => {
    const response = await orderApi.acceptOrder(id);
    return response.data;
  }
);

export const rejectOrder = createAsyncThunk(
  'orders/rejectOrder',
  async ({ id, reason }: { id: string; reason: string }) => {
    const response = await orderApi.rejectOrder(id, reason);
    return response.data;
  }
);

export const markOrderAsReady = createAsyncThunk(
  'orders/markAsReady',
  async (id: string) => {
    const response = await orderApi.markAsReady(id);
    return response.data;
  }
);

export const updateOrderStatus = createAsyncThunk(
  'orders/updateStatus',
  async ({ id, status }: { id: string; status: string }) => {
    const response = await orderApi.updateOrderStatus(id, status);
    return response.data;
  }
);

const ordersSlice = createSlice({
  name: 'orders',
  initialState,
  reducers: {
    setFilters: (state, action) => {
      state.filters = action.payload;
    },
    clearFilters: (state) => {
      state.filters = {};
    },
    setSelectedOrder: (state, action) => {
      state.selectedOrder = action.payload;
    },
    updateOrderInList: (state, action) => {
      const index = state.orders.findIndex(o => o.id === action.payload.id);
      if (index !== -1) {
        state.orders[index] = action.payload;
      }
      if (state.selectedOrder?.id === action.payload.id) {
        state.selectedOrder = action.payload;
      }
    },
    addNewOrder: (state, action) => {
      state.orders.unshift(action.payload);
      // Update stats
      const status = action.payload.status;
      if (status === 'pending') state.stats.pending++;
    },
    clearError: (state) => {
      state.error = null;
    },
  },
  extraReducers: (builder) => {
    // Fetch Orders
    builder
      .addCase(fetchOrders.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchOrders.fulfilled, (state, action) => {
        state.loading = false;
        state.orders = action.payload.orders;
        state.stats = action.payload.stats;
      })
      .addCase(fetchOrders.rejected, (state, action) => {
        state.loading = false;
        state.error = action.error.message || 'Failed to fetch orders';
      });
    
    // Fetch Single Order
    builder
      .addCase(fetchOrder.fulfilled, (state, action) => {
        state.selectedOrder = action.payload;
      });
    
    // Accept Order
    builder
      .addCase(acceptOrder.fulfilled, (state, action) => {
        const index = state.orders.findIndex(o => o.id === action.payload.id);
        if (index !== -1) {
          state.orders[index] = action.payload;
        }
        if (state.selectedOrder?.id === action.payload.id) {
          state.selectedOrder = action.payload;
        }
        // Update stats
        state.stats.pending--;
        state.stats.preparing++;
      });
    
    // Reject Order
    builder
      .addCase(rejectOrder.fulfilled, (state, action) => {
        const index = state.orders.findIndex(o => o.id === action.payload.id);
        if (index !== -1) {
          state.orders[index] = action.payload;
        }
        if (state.selectedOrder?.id === action.payload.id) {
          state.selectedOrder = action.payload;
        }
        // Update stats
        state.stats.pending--;
      });
    
    // Mark as Ready
    builder
      .addCase(markOrderAsReady.fulfilled, (state, action) => {
        const index = state.orders.findIndex(o => o.id === action.payload.id);
        if (index !== -1) {
          state.orders[index] = action.payload;
        }
        if (state.selectedOrder?.id === action.payload.id) {
          state.selectedOrder = action.payload;
        }
        // Update stats
        state.stats.preparing--;
        state.stats.ready++;
      });
    
    // Update Order Status
    builder
      .addCase(updateOrderStatus.fulfilled, (state, action) => {
        const index = state.orders.findIndex(o => o.id === action.payload.id);
        if (index !== -1) {
          state.orders[index] = action.payload;
        }
        if (state.selectedOrder?.id === action.payload.id) {
          state.selectedOrder = action.payload;
        }
      });
  },
});

export const {
  setFilters,
  clearFilters,
  setSelectedOrder,
  updateOrderInList,
  addNewOrder,
  clearError,
} = ordersSlice.actions;

export default ordersSlice.reducer;