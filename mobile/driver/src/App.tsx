import React, { useEffect } from 'react';
import { StatusBar } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import SplashScreen from 'react-native-splash-screen';
import { AuthProvider } from './contexts/AuthContext';
import { LocationProvider } from './contexts/LocationContext';
import { SocketProvider } from './contexts/SocketContext';
import { RootNavigator } from './navigation/RootNavigator';
import { setupNotifications } from './services/notifications';
import { useAuthStore } from './stores/authStore';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 2,
      staleTime: 5 * 60 * 1000, // 5 minutes
    },
  },
});

function App(): JSX.Element {
  const { initialize } = useAuthStore();

  useEffect(() => {
    // Initialize app
    const initApp = async () => {
      await initialize();
      await setupNotifications();
      SplashScreen?.hide();
    };

    initApp();
  }, [initialize]);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <QueryClientProvider client={queryClient}>
        <SafeAreaProvider>
          <AuthProvider>
            <LocationProvider>
              <SocketProvider>
                <NavigationContainer>
                  <StatusBar barStyle="dark-content" backgroundColor="#ffffff" />
                  <RootNavigator />
                </NavigationContainer>
              </SocketProvider>
            </LocationProvider>
          </AuthProvider>
        </SafeAreaProvider>
      </QueryClientProvider>
    </GestureHandlerRootView>
  );
}

export default App;