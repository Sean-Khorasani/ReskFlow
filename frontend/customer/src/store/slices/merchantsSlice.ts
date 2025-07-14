import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import axios from 'axios';

export interface Merchant {
  id: string;
  name: string;
  description: string;
  cuisine?: string;
  image?: string;
  rating: number;
  reviewCount: number;
  reskflowTime: string;
  reskflowFee: number;
  minimumOrder: number;
  address: string;
  phone: string;
  hours: {
    [key: string]: { open: string; close: string };
  };
  isOpen: boolean;
  categories: string[];
}

interface MerchantsState {
  merchants: Merchant[];
  currentMerchant: Merchant | null;
  isLoading: boolean;
  error: string | null;
  filters: {
    cuisine: string | null;
    rating: number | null;
    reskflowTime: number | null;
    search: string;
  };
}

const initialState: MerchantsState = {
  merchants: [],
  currentMerchant: null,
  isLoading: false,
  error: null,
  filters: {
    cuisine: null,
    rating: null,
    reskflowTime: null,
    search: '',
  },
};

export const fetchMerchants = createAsyncThunk(
  'merchants/fetchAll',
  async (params?: { lat?: number; lng?: number; radius?: number }) => {
    const response = await axios.get('/api/merchants', { params });
    return response.data;
  }
);

export const fetchMerchantById = createAsyncThunk(
  'merchants/fetchById',
  async (merchantId: string) => {
    const response = await axios.get(`/api/merchants/${merchantId}`);
    return response.data;
  }
);

export const searchMerchants = createAsyncThunk(
  'merchants/search',
  async (query: string) => {
    const response = await axios.get('/api/merchants/search', { params: { q: query } });
    return response.data;
  }
);

const merchantsSlice = createSlice({
  name: 'merchants',
  initialState,
  reducers: {
    setFilter: (state, action) => {
      state.filters = { ...state.filters, ...action.payload };
    },
    clearFilters: (state) => {
      state.filters = initialState.filters;
    },
  },
  extraReducers: (builder) => {
    builder
      // Fetch all
      .addCase(fetchMerchants.pending, (state) => {
        state.isLoading = true;
        state.error = null;
      })
      .addCase(fetchMerchants.fulfilled, (state, action) => {
        state.isLoading = false;
        state.merchants = action.payload.merchants;
      })
      .addCase(fetchMerchants.rejected, (state, action) => {
        state.isLoading = false;
        state.error = action.error.message || 'Failed to fetch merchants';
      })
      // Fetch by ID
      .addCase(fetchMerchantById.pending, (state) => {
        state.isLoading = true;
        state.error = null;
      })
      .addCase(fetchMerchantById.fulfilled, (state, action) => {
        state.isLoading = false;
        state.currentMerchant = action.payload.merchant;
      })
      .addCase(fetchMerchantById.rejected, (state, action) => {
        state.isLoading = false;
        state.error = action.error.message || 'Failed to fetch merchant';
      })
      // Search
      .addCase(searchMerchants.fulfilled, (state, action) => {
        state.merchants = action.payload.merchants;
      });
  },
});

export const { setFilter, clearFilters } = merchantsSlice.actions;
export default merchantsSlice.reducer;