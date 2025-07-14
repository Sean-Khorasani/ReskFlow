import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import axios from 'axios';

export interface Product {
  id: string;
  merchantId: string;
  name: string;
  description: string;
  price: number;
  category: string;
  image?: string;
  available: boolean;
  preparationTime: number;
  dietary?: string[];
  allergens?: string[];
}

interface ProductsState {
  items: Product[];
  categories: string[];
  isLoading: boolean;
  error: string | null;
  filters: {
    category: string | null;
    dietary: string[];
    priceRange: [number, number];
    search: string;
  };
}

const initialState: ProductsState = {
  items: [],
  categories: [],
  isLoading: false,
  error: null,
  filters: {
    category: null,
    dietary: [],
    priceRange: [0, 100],
    search: '',
  },
};

export const fetchProductsByMerchant = createAsyncThunk(
  'products/fetchByMerchant',
  async (merchantId: string) => {
    const response = await axios.get(`/api/products/merchant/${merchantId}`);
    return response.data;
  }
);

export const searchProducts = createAsyncThunk(
  'products/search',
  async (params: { query: string; filters?: any }) => {
    const response = await axios.get('/api/products/search', { params });
    return response.data;
  }
);

const productsSlice = createSlice({
  name: 'products',
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
      // Fetch by merchant
      .addCase(fetchProductsByMerchant.pending, (state) => {
        state.isLoading = true;
        state.error = null;
      })
      .addCase(fetchProductsByMerchant.fulfilled, (state, action) => {
        state.isLoading = false;
        state.items = action.payload.products;
        state.categories = [...new Set(action.payload.products.map((p: Product) => p.category))];
      })
      .addCase(fetchProductsByMerchant.rejected, (state, action) => {
        state.isLoading = false;
        state.error = action.error.message || 'Failed to fetch products';
      })
      // Search
      .addCase(searchProducts.pending, (state) => {
        state.isLoading = true;
        state.error = null;
      })
      .addCase(searchProducts.fulfilled, (state, action) => {
        state.isLoading = false;
        state.items = action.payload.products;
      })
      .addCase(searchProducts.rejected, (state, action) => {
        state.isLoading = false;
        state.error = action.error.message || 'Search failed';
      });
  },
});

export const { setFilter, clearFilters } = productsSlice.actions;
export default productsSlice.reducer;