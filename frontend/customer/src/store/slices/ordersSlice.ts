import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import axios from 'axios';

export interface Order {
  id: string;
  customerId: string;
  merchantId: string;
  merchantName: string;
  items: Array<{
    productId: string;
    name: string;
    quantity: number;
    price: number;
  }>;
  status: 'pending' | 'confirmed' | 'preparing' | 'ready' | 'picked_up' | 'delivered' | 'cancelled';
  subtotal: number;
  tax: number;
  reskflowFee: number;
  total: number;
  reskflowAddress: string;
  reskflowInstructions?: string;
  estimatedDeliveryTime: string;
  driverId?: string;
  driverName?: string;
  driverPhone?: string;
  trackingUrl?: string;
  createdAt: string;
  updatedAt: string;
}

interface OrdersState {
  currentOrder: Order | null;
  orders: Order[];
  isLoading: boolean;
  error: string | null;
  isPlacingOrder: boolean;
}

const initialState: OrdersState = {
  currentOrder: null,
  orders: [],
  isLoading: false,
  error: null,
  isPlacingOrder: false,
};

export const placeOrder = createAsyncThunk(
  'orders/place',
  async (orderData: {
    merchantId: string;
    items: any[];
    reskflowAddress: string;
    reskflowInstructions?: string;
    paymentMethod: string;
  }) => {
    const response = await axios.post('/api/orders', orderData);
    return response.data;
  }
);

export const fetchOrders = createAsyncThunk(
  'orders/fetchAll',
  async () => {
    const response = await axios.get('/api/orders');
    return response.data;
  }
);

export const fetchOrderById = createAsyncThunk(
  'orders/fetchById',
  async (orderId: string) => {
    const response = await axios.get(`/api/orders/${orderId}`);
    return response.data;
  }
);

export const trackOrder = createAsyncThunk(
  'orders/track',
  async (orderId: string) => {
    const response = await axios.get(`/api/orders/${orderId}/track`);
    return response.data;
  }
);

const ordersSlice = createSlice({
  name: 'orders',
  initialState,
  reducers: {
    updateOrderStatus: (state, action) => {
      const { orderId, status } = action.payload;
      if (state.currentOrder && state.currentOrder.id === orderId) {
        state.currentOrder.status = status;
      }
      const order = state.orders.find(o => o.id === orderId);
      if (order) {
        order.status = status;
      }
    },
    clearCurrentOrder: (state) => {
      state.currentOrder = null;
    },
  },
  extraReducers: (builder) => {
    builder
      // Place order
      .addCase(placeOrder.pending, (state) => {
        state.isPlacingOrder = true;
        state.error = null;
      })
      .addCase(placeOrder.fulfilled, (state, action) => {
        state.isPlacingOrder = false;
        state.currentOrder = action.payload.order;
        state.orders.unshift(action.payload.order);
      })
      .addCase(placeOrder.rejected, (state, action) => {
        state.isPlacingOrder = false;
        state.error = action.error.message || 'Failed to place order';
      })
      // Fetch orders
      .addCase(fetchOrders.pending, (state) => {
        state.isLoading = true;
        state.error = null;
      })
      .addCase(fetchOrders.fulfilled, (state, action) => {
        state.isLoading = false;
        state.orders = action.payload.orders;
      })
      .addCase(fetchOrders.rejected, (state, action) => {
        state.isLoading = false;
        state.error = action.error.message || 'Failed to fetch orders';
      })
      // Fetch order by ID
      .addCase(fetchOrderById.fulfilled, (state, action) => {
        state.currentOrder = action.payload.order;
      })
      // Track order
      .addCase(trackOrder.fulfilled, (state, action) => {
        if (state.currentOrder) {
          state.currentOrder = { ...state.currentOrder, ...action.payload };
        }
      });
  },
});

export const { updateOrderStatus, clearCurrentOrder } = ordersSlice.actions;
export default ordersSlice.reducer;