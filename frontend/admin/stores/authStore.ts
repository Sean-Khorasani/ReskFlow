import { create } from 'zustand';
import { authApi } from '../services/api';

interface Admin {
  id: string;
  name: string;
  email: string;
  role: string;
  permissions: string[];
}

interface AuthState {
  admin: Admin | null;
  isAuthenticated: boolean;
  loading: boolean;
  error: string | null;
  
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  loadProfile: () => Promise<void>;
  clearError: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  admin: null,
  isAuthenticated: false,
  loading: false,
  error: null,
  
  login: async (email: string, password: string) => {
    set({ loading: true, error: null });
    try {
      const response = await authApi.login(email, password);
      const { token, admin } = response.data;
      localStorage.setItem('adminToken', token);
      set({ admin, isAuthenticated: true, loading: false });
    } catch (error: any) {
      set({ 
        error: error.response?.data?.message || 'Login failed', 
        loading: false 
      });
      throw error;
    }
  },
  
  logout: () => {
    localStorage.removeItem('adminToken');
    set({ admin: null, isAuthenticated: false });
  },
  
  loadProfile: async () => {
    set({ loading: true });
    try {
      const response = await authApi.getProfile();
      set({ admin: response.data, isAuthenticated: true, loading: false });
    } catch (error) {
      set({ isAuthenticated: false, loading: false });
    }
  },
  
  clearError: () => set({ error: null }),
}));