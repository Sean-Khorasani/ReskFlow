import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  Alert,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useQuery } from '@tanstack/react-query';
import MapView, { Marker, PROVIDER_GOOGLE } from 'react-native-maps';
import Icon from 'react-native-vector-icons/MaterialIcons';
import { useLocationContext } from '../contexts/LocationContext';
import { useSocketContext } from '../contexts/SocketContext';
import { useAuthStore } from '../stores/authStore';
import { DeliveryCard } from '../components/DeliveryCard';
import { StatusToggle } from '../components/StatusToggle';
import { api } from '../services/api';

export const HomeScreen: React.FC = () => {
  const navigation = useNavigation();
  const { user } = useAuthStore();
  const { location, startTracking, stopTracking } = useLocationContext();
  const { socket } = useSocketContext();
  const [isOnline, setIsOnline] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const { data: activeDeliveries, refetch } = useQuery({
    queryKey: ['activeDeliveries'],
    queryFn: () => api.getActiveDeliveries(),
    enabled: !!user,
  });

  const { data: stats } = useQuery({
    queryKey: ['driverStats'],
    queryFn: () => api.getDriverStats(),
    enabled: !!user,
  });

  useEffect(() => {
    if (isOnline && location) {
      startTracking();
      socket?.emit('driver:online', { location });
    } else {
      stopTracking();
      socket?.emit('driver:offline');
    }
  }, [isOnline, location, socket, startTracking, stopTracking]);

  const handleDeliveryAccept = async (reskflowId: string) => {
    try {
      await api.acceptDelivery(reskflowId);
      Alert.alert('Success', 'Delivery accepted successfully');
      refetch();
    } catch (error) {
      Alert.alert('Error', 'Failed to accept reskflow');
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerTop}>
          <Text style={styles.greeting}>Hello, {user?.firstName}!</Text>
          <StatusToggle
            isOnline={isOnline}
            onToggle={setIsOnline}
          />
        </View>
        <View style={styles.statsContainer}>
          <View style={styles.statItem}>
            <Text style={styles.statValue}>{stats?.todayDeliveries || 0}</Text>
            <Text style={styles.statLabel}>Today</Text>
          </View>
          <View style={styles.statItem}>
            <Text style={styles.statValue}>${stats?.todayEarnings?.toFixed(2) || '0.00'}</Text>
            <Text style={styles.statLabel}>Earnings</Text>
          </View>
          <View style={styles.statItem}>
            <Text style={styles.statValue}>{stats?.rating?.toFixed(1) || '0.0'}</Text>
            <Text style={styles.statLabel}>Rating</Text>
          </View>
        </View>
      </View>

      {location && (
        <View style={styles.mapContainer}>
          <MapView
            provider={PROVIDER_GOOGLE}
            style={styles.map}
            initialRegion={{
              latitude: location.latitude,
              longitude: location.longitude,
              latitudeDelta: 0.0922,
              longitudeDelta: 0.0421,
            }}
            showsUserLocation
            followsUserLocation
          >
            <Marker
              coordinate={{
                latitude: location.latitude,
                longitude: location.longitude,
              }}
              title="Your Location"
            />
            {activeDeliveries?.map((reskflow: any) => (
              <Marker
                key={reskflow.id}
                coordinate={{
                  latitude: reskflow.nextStop.latitude,
                  longitude: reskflow.nextStop.longitude,
                }}
                title={reskflow.trackingNumber}
                description={reskflow.nextStop.address}
              >
                <Icon name="location-on" size={40} color="#FF6B6B" />
              </Marker>
            ))}
          </MapView>
        </View>
      )}

      <ScrollView
        style={styles.deliveriesContainer}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
      >
        <Text style={styles.sectionTitle}>Active Deliveries</Text>
        {activeDeliveries?.length === 0 ? (
          <View style={styles.emptyState}>
            <Icon name="inbox" size={64} color="#ccc" />
            <Text style={styles.emptyText}>No active deliveries</Text>
          </View>
        ) : (
          activeDeliveries?.map((reskflow: any) => (
            <DeliveryCard
              key={reskflow.id}
              reskflow={reskflow}
              onPress={() => navigation.navigate('DeliveryDetails', { reskflowId: reskflow.id })}
              onAccept={() => handleDeliveryAccept(reskflow.id)}
            />
          ))
        )}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  header: {
    backgroundColor: '#fff',
    padding: 20,
    paddingTop: 40,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  headerTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  greeting: {
    fontSize: 24,
    fontWeight: '600',
    color: '#333',
  },
  statsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-around',
  },
  statItem: {
    alignItems: 'center',
  },
  statValue: {
    fontSize: 24,
    fontWeight: '700',
    color: '#4A90E2',
  },
  statLabel: {
    fontSize: 14,
    color: '#666',
    marginTop: 4,
  },
  mapContainer: {
    height: 300,
    marginVertical: 10,
  },
  map: {
    flex: 1,
  },
  deliveriesContainer: {
    flex: 1,
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: '#333',
    marginBottom: 15,
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 40,
  },
  emptyText: {
    fontSize: 16,
    color: '#999',
    marginTop: 10,
  },
});