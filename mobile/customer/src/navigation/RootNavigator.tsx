import React from 'react';
import { createStackNavigator } from '@react-navigation/stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useAuth } from '../contexts/AuthContext';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

// Auth Screens
import LoginScreen from '../screens/LoginScreen';
import RegisterScreen from '../screens/RegisterScreen';

// Main Screens
import HomeScreen from '../screens/HomeScreen';
import SearchScreen from '../screens/SearchScreen';
import CartScreen from '../screens/CartScreen';
import OrdersScreen from '../screens/OrdersScreen';
import ProfileScreen from '../screens/ProfileScreen';

// Detail Screens
import RestaurantScreen from '../screens/RestaurantScreen';
import ProductDetailScreen from '../screens/ProductDetailScreen';
import CheckoutScreen from '../screens/CheckoutScreen';
import OrderTrackingScreen from '../screens/OrderTrackingScreen';
import AddressScreen from '../screens/AddressScreen';
import PaymentMethodsScreen from '../screens/PaymentMethodsScreen';

export type RootStackParamList = {
  Auth: undefined;
  Main: undefined;
  Restaurant: { restaurantId: string };
  ProductDetail: { productId: string };
  Checkout: undefined;
  OrderTracking: { orderId: string };
  Address: { mode: 'select' | 'manage' };
  PaymentMethods: undefined;
};

export type AuthStackParamList = {
  Login: undefined;
  Register: undefined;
};

export type MainTabParamList = {
  Home: undefined;
  Search: undefined;
  Cart: undefined;
  Orders: undefined;
  Profile: undefined;
};

const RootStack = createStackNavigator<RootStackParamList>();
const AuthStack = createStackNavigator<AuthStackParamList>();
const MainTab = createBottomTabNavigator<MainTabParamList>();

const AuthNavigator = () => (
  <AuthStack.Navigator
    screenOptions={{
      headerShown: false,
    }}
  >
    <AuthStack.Screen name="Login" component={LoginScreen} />
    <AuthStack.Screen name="Register" component={RegisterScreen} />
  </AuthStack.Navigator>
);

const MainNavigator = () => (
  <MainTab.Navigator
    screenOptions={({ route }) => ({
      tabBarIcon: ({ focused, color, size }) => {
        let iconName;

        switch (route.name) {
          case 'Home':
            iconName = 'home';
            break;
          case 'Search':
            iconName = 'magnify';
            break;
          case 'Cart':
            iconName = 'cart';
            break;
          case 'Orders':
            iconName = 'receipt';
            break;
          case 'Profile':
            iconName = 'account';
            break;
        }

        return <Icon name={iconName!} size={size} color={color} />;
      },
      tabBarActiveTintColor: '#007AFF',
      tabBarInactiveTintColor: '#9CA3AF',
      headerShown: false,
    })}
  >
    <MainTab.Screen name="Home" component={HomeScreen} />
    <MainTab.Screen name="Search" component={SearchScreen} />
    <MainTab.Screen name="Cart" component={CartScreen} />
    <MainTab.Screen name="Orders" component={OrdersScreen} />
    <MainTab.Screen name="Profile" component={ProfileScreen} />
  </MainTab.Navigator>
);

export const RootNavigator = () => {
  const { isAuthenticated } = useAuth();

  return (
    <RootStack.Navigator
      screenOptions={{
        headerShown: false,
      }}
    >
      {!isAuthenticated ? (
        <RootStack.Screen name="Auth" component={AuthNavigator} />
      ) : (
        <>
          <RootStack.Screen name="Main" component={MainNavigator} />
          <RootStack.Screen 
            name="Restaurant" 
            component={RestaurantScreen}
            options={{ headerShown: true, title: '' }}
          />
          <RootStack.Screen 
            name="ProductDetail" 
            component={ProductDetailScreen}
            options={{ headerShown: true, title: 'Product Details' }}
          />
          <RootStack.Screen 
            name="Checkout" 
            component={CheckoutScreen}
            options={{ headerShown: true, title: 'Checkout' }}
          />
          <RootStack.Screen 
            name="OrderTracking" 
            component={OrderTrackingScreen}
            options={{ headerShown: true, title: 'Track Order' }}
          />
          <RootStack.Screen 
            name="Address" 
            component={AddressScreen}
            options={{ headerShown: true, title: 'Addresses' }}
          />
          <RootStack.Screen 
            name="PaymentMethods" 
            component={PaymentMethodsScreen}
            options={{ headerShown: true, title: 'Payment Methods' }}
          />
        </>
      )}
    </RootStack.Navigator>
  );
};