import React, { createContext, useContext, useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { useDispatch, useSelector } from 'react-redux';
import { RootState, AppDispatch } from '@/store';
import { loadProfile, logout } from '@/store/slices/authSlice';

interface AuthContextType {
  isAuthenticated: boolean;
  merchant: any;
  loading: boolean;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType>({
  isAuthenticated: false,
  merchant: null,
  loading: true,
  logout: () => {},
});

export const useAuth = () => useContext(AuthContext);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const router = useRouter();
  const dispatch = useDispatch<AppDispatch>();
  const { isAuthenticated, merchant, loading } = useSelector((state: RootState) => state.auth);
  const [isInitialized, setIsInitialized] = useState(false);

  useEffect(() => {
    const initAuth = async () => {
      const token = localStorage.getItem('merchantToken');
      if (token) {
        try {
          await dispatch(loadProfile()).unwrap();
        } catch (error) {
          // Token is invalid
          localStorage.removeItem('merchantToken');
        }
      }
      setIsInitialized(true);
    };

    initAuth();
  }, [dispatch]);

  useEffect(() => {
    if (isInitialized && !loading) {
      const publicPaths = ['/login', '/register', '/'];
      const isPublicPath = publicPaths.includes(router.pathname);

      if (!isAuthenticated && !isPublicPath) {
        router.push('/login');
      } else if (isAuthenticated && router.pathname === '/login') {
        router.push('/dashboard');
      }
    }
  }, [isAuthenticated, loading, router, isInitialized]);

  const handleLogout = () => {
    dispatch(logout());
    router.push('/login');
  };

  return (
    <AuthContext.Provider
      value={{
        isAuthenticated,
        merchant,
        loading: loading || !isInitialized,
        logout: handleLogout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};