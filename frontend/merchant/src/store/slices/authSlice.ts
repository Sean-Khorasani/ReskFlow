import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import { authApi } from '../../services/api';

interface Merchant {
  id: string;
  name: string;
  email: string;
  businessName: string;
  businessType: string;
  phone: string;
  address: string;
  image?: string;
  rating?: number;
  reviewCount?: number;
  isOpen: boolean;
}

interface AuthState {
  merchant: Merchant | null;
  token: string | null;
  isAuthenticated: boolean;
  loading: boolean;
  error: string | null;
}

const initialState: AuthState = {
  merchant: null,
  token: null,
  isAuthenticated: false,
  loading: false,
  error: null,
};

export const login = createAsyncThunk(
  'auth/login',
  async ({ email, password }: { email: string; password: string }) => {
    const response = await authApi.login(email, password);
    const { token, merchant } = response.data;
    localStorage.setItem('merchantToken', token);
    return { token, merchant };
  }
);

export const loadProfile = createAsyncThunk(
  'auth/loadProfile',
  async () => {
    const response = await authApi.getProfile();
    return response.data;
  }
);

export const updateProfile = createAsyncThunk(
  'auth/updateProfile',
  async (data: any) => {
    const response = await authApi.updateProfile(data);
    return response.data;
  }
);

const authSlice = createSlice({
  name: 'auth',
  initialState,
  reducers: {
    logout: (state) => {
      localStorage.removeItem('merchantToken');
      state.merchant = null;
      state.token = null;
      state.isAuthenticated = false;
    },
    clearError: (state) => {
      state.error = null;
    },
  },
  extraReducers: (builder) => {
    // Login
    builder
      .addCase(login.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(login.fulfilled, (state, action) => {
        state.loading = false;
        state.isAuthenticated = true;
        state.token = action.payload.token;
        state.merchant = action.payload.merchant;
      })
      .addCase(login.rejected, (state, action) => {
        state.loading = false;
        state.error = action.error.message || 'Login failed';
      });
    
    // Load Profile
    builder
      .addCase(loadProfile.pending, (state) => {
        state.loading = true;
      })
      .addCase(loadProfile.fulfilled, (state, action) => {
        state.loading = false;
        state.merchant = action.payload;
        state.isAuthenticated = true;
      })
      .addCase(loadProfile.rejected, (state) => {
        state.loading = false;
        state.isAuthenticated = false;
      });
    
    // Update Profile
    builder
      .addCase(updateProfile.fulfilled, (state, action) => {
        state.merchant = action.payload;
      });
  },
});

export const { logout, clearError } = authSlice.actions;
export default authSlice.reducer;