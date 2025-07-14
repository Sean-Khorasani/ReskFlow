import { createContext, useContext, useEffect, ReactNode } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { RootState, AppDispatch } from '@/store';
import { setUser } from '@/store/slices/authSlice';
import axios from 'axios';
import Cookies from 'js-cookie';

interface AuthContextType {
  isAuthenticated: boolean;
  isLoading: boolean;
}

const AuthContext = createContext<AuthContextType>({
  isAuthenticated: false,
  isLoading: true,
});

export const useAuth = () => useContext(AuthContext);

interface AuthProviderProps {
  children: ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
  const dispatch = useDispatch<AppDispatch>();
  const { user, token } = useSelector((state: RootState) => state.auth);
  const isAuthenticated = !!user && !!token;

  useEffect(() => {
    // Set up axios interceptor for authentication
    const requestInterceptor = axios.interceptors.request.use(
      (config) => {
        const token = Cookies.get('token');
        if (token) {
          config.headers.Authorization = `Bearer ${token}`;
        }
        return config;
      },
      (error) => {
        return Promise.reject(error);
      }
    );

    // Fetch user profile if token exists but user data doesn't
    const fetchUserProfile = async () => {
      const token = Cookies.get('token');
      if (token && !user) {
        try {
          const response = await axios.get('/api/auth/me');
          dispatch(setUser(response.data.user));
        } catch (error) {
          // Token is invalid, remove it
          Cookies.remove('token');
        }
      }
    };

    fetchUserProfile();

    return () => {
      axios.interceptors.request.eject(requestInterceptor);
    };
  }, [dispatch, user]);

  return (
    <AuthContext.Provider value={{ isAuthenticated, isLoading: false }}>
      {children}
    </AuthContext.Provider>
  );
}