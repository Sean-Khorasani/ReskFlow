import React, { useEffect } from 'react';
import { StatusBar } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { Provider as PaperProvider } from 'react-native-paper';
import WalletConnectProvider from '@walletconnect/react-native-dapp';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AuthProvider } from './contexts/AuthContext';
import { ThemeProvider } from './contexts/ThemeContext';
import { NotificationProvider } from './contexts/NotificationContext';
import { RootNavigator } from './navigation/RootNavigator';
import { theme } from './theme';
import { setupNotifications } from './services/notifications';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 2,
      staleTime: 5 * 60 * 1000,
    },
  },
});

const walletConnectorConfig = {
  redirectUrl: 'reskflow://app',
  storageOptions: {
    asyncStorage: AsyncStorage,
  },
};

function App(): JSX.Element {
  useEffect(() => {
    setupNotifications();
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <WalletConnectProvider {...walletConnectorConfig}>
        <QueryClientProvider client={queryClient}>
          <SafeAreaProvider>
            <ThemeProvider>
              <PaperProvider theme={theme}>
                <AuthProvider>
                  <NotificationProvider>
                    <NavigationContainer>
                      <StatusBar 
                        barStyle="dark-content" 
                        backgroundColor="#ffffff" 
                      />
                      <RootNavigator />
                    </NavigationContainer>
                  </NotificationProvider>
                </AuthProvider>
              </PaperProvider>
            </ThemeProvider>
          </SafeAreaProvider>
        </QueryClientProvider>
      </WalletConnectProvider>
    </GestureHandlerRootView>
  );
}

export default App;