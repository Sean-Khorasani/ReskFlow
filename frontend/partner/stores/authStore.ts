import { create } from 'zustand';
import { authApi } from '../services/api';

interface Partner {
  id: string;
  companyName: string;
  email: string;
  phone: string;
  address: string;
  status: 'active' | 'suspended' | 'pending';
  totalDrivers: number;
  activeDrivers: number;
  totalVehicles: number;
  createdAt: string;
}

interface AuthState {
  partner: Partner | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;

  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  fetchProfile: () => Promise<void>;
  updateProfile: (data: Partial<Partner>) => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  partner: null,
  isAuthenticated: false,
  isLoading: false,
  error: null,

  login: async (email: string, password: string) => {
    set({ isLoading: true, error: null });
    try {
      const response = await authApi.login(email, password);
      const { token, partner } = response.data;
      
      localStorage.setItem('partner_token', token);
      set({ partner, isAuthenticated: true, isLoading: false });
    } catch (error: any) {
      set({ error: error.response?.data?.message || 'Login failed', isLoading: false });
      throw error;
    }
  },

  logout: async () => {
    try {
      await authApi.logout();
    } catch (error) {
      console.error('Logout error:', error);
    } finally {
      localStorage.removeItem('partner_token');
      set({ partner: null, isAuthenticated: false });
    }
  },

  fetchProfile: async () => {
    set({ isLoading: true });
    try {
      const response = await authApi.getProfile();
      set({ partner: response.data, isAuthenticated: true, isLoading: false });
    } catch (error) {
      set({ isLoading: false, isAuthenticated: false });
      throw error;
    }
  },

  updateProfile: async (data: Partial<Partner>) => {
    set({ isLoading: true });
    try {
      const response = await authApi.updateProfile(data);
      set({ partner: response.data, isLoading: false });
    } catch (error) {
      set({ isLoading: false });
      throw error;
    }
  },
}));