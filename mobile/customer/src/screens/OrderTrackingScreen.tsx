import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Image,
  Dimensions,
  Alert,
  RefreshControl,
} from 'react-native';
import { useRoute, useNavigation } from '@react-navigation/native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import MapView, { Marker, Polyline } from 'react-native-maps';
import { getOrder, trackOrder } from '../services/api';

const { width: screenWidth } = Dimensions.get('window');

interface OrderStatus {
  status: string;
  timestamp: string;
  completed: boolean;
}

interface Order {
  id: string;
  status: string;
  restaurantName: string;
  restaurantAddress: string;
  restaurantImage?: string;
  reskflowAddress: string;
  estimatedDeliveryTime: string;
  driver?: {
    name: string;
    phone: string;
    photo?: string;
    rating: number;
    location?: {
      latitude: number;
      longitude: number;
    };
  };
  items: Array<{
    name: string;
    quantity: number;
    price: number;
  }>;
  total: number;
  statuses: OrderStatus[];
}

export default function OrderTrackingScreen() {
  const route = useRoute();
  const navigation = useNavigation();
  const { orderId } = route.params as { orderId: string };
  
  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    fetchOrderDetails();
    // Poll for updates every 30 seconds
    const interval = setInterval(fetchOrderDetails, 30000);
    return () => clearInterval(interval);
  }, [orderId]);

  const fetchOrderDetails = async () => {
    try {
      const data = await getOrder(orderId);
      setOrder(data);
    } catch (error) {
      console.error('Error fetching order:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const onRefresh = () => {
    setRefreshing(true);
    fetchOrderDetails();
  };

  const handleCallDriver = () => {
    if (order?.driver?.phone) {
      Alert.alert('Call Driver', `Calling ${order.driver.name}...`);
    }
  };

  const handleContactSupport = () => {
    Alert.alert('Support', 'Opening support chat...');
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'pending':
        return 'clock-outline';
      case 'confirmed':
        return 'check-circle';
      case 'preparing':
        return 'chef-hat';
      case 'ready':
        return 'package-variant';
      case 'picked_up':
        return 'bike';
      case 'delivered':
        return 'check-all';
      default:
        return 'circle-outline';
    }
  };

  const getStatusText = (status: string) => {
    switch (status) {
      case 'pending':
        return 'Order Placed';
      case 'confirmed':
        return 'Restaurant Confirmed';
      case 'preparing':
        return 'Preparing Your Order';
      case 'ready':
        return 'Ready for Pickup';
      case 'picked_up':
        return 'Driver Picked Up';
      case 'delivered':
        return 'Delivered';
      default:
        return status;
    }
  };

  if (loading || !order) {
    return (
      <View style={styles.loadingContainer}>
        <Text>Loading order details...</Text>
      </View>
    );
  }

  const isDelivered = order.status === 'delivered';
  const hasDriver = order.status === 'picked_up' && order.driver;

  return (
    <ScrollView
      style={styles.container}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      {/* Map Section */}
      {hasDriver && order.driver?.location && (
        <View style={styles.mapContainer}>
          <MapView
            style={styles.map}
            initialRegion={{
              latitude: order.driver.location.latitude,
              longitude: order.driver.location.longitude,
              latitudeDelta: 0.02,
              longitudeDelta: 0.02,
            }}
          >
            <Marker
              coordinate={order.driver.location}
              title="Driver Location"
            >
              <View style={styles.driverMarker}>
                <Icon name="bike" size={24} color="#007AFF" />
              </View>
            </Marker>
          </MapView>
        </View>
      )}

      {/* Status Header */}
      <View style={styles.statusHeader}>
        <Icon
          name={isDelivered ? 'check-circle' : 'clock-outline'}
          size={48}
          color={isDelivered ? '#10B981' : '#007AFF'}
        />
        <Text style={styles.statusTitle}>
          {isDelivered ? 'Order Delivered!' : `Estimated Delivery: ${new Date(order.estimatedDeliveryTime).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}`}
        </Text>
        <Text style={styles.statusSubtitle}>
          {isDelivered ? 'Thank you for your order!' : 'Your order is on the way'}
        </Text>
      </View>

      {/* Driver Info */}
      {hasDriver && order.driver && (
        <View style={styles.driverCard}>
          <Image
            source={{ uri: order.driver.photo || 'https://via.placeholder.com/60' }}
            style={styles.driverPhoto}
          />
          <View style={styles.driverInfo}>
            <Text style={styles.driverName}>{order.driver.name}</Text>
            <View style={styles.driverRating}>
              <Icon name="star" size={16} color="#FFB800" />
              <Text style={styles.ratingText}>{order.driver.rating.toFixed(1)}</Text>
            </View>
          </View>
          <TouchableOpacity style={styles.callButton} onPress={handleCallDriver}>
            <Icon name="phone" size={24} color="#007AFF" />
          </TouchableOpacity>
        </View>
      )}

      {/* Order Progress */}
      <View style={styles.progressSection}>
        <Text style={styles.sectionTitle}>Order Progress</Text>
        {order.statuses.map((status, index) => (
          <View key={status.status} style={styles.progressItem}>
            <View style={styles.progressLine}>
              <View style={[styles.progressDot, status.completed && styles.progressDotCompleted]}>
                <Icon
                  name={getStatusIcon(status.status)}
                  size={20}
                  color={status.completed ? '#007AFF' : '#D1D5DB'}
                />
              </View>
              {index < order.statuses.length - 1 && (
                <View style={[styles.progressConnector, status.completed && styles.progressConnectorCompleted]} />
              )}
            </View>
            <View style={styles.progressContent}>
              <Text style={[styles.progressText, status.completed && styles.progressTextCompleted]}>
                {getStatusText(status.status)}
              </Text>
              {status.timestamp && (
                <Text style={styles.progressTime}>
                  {new Date(status.timestamp).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                </Text>
              )}
            </View>
          </View>
        ))}
      </View>

      {/* Order Details */}
      <View style={styles.detailsSection}>
        <Text style={styles.sectionTitle}>Order Details</Text>
        <View style={styles.restaurantInfo}>
          <Image
            source={{ uri: order.restaurantImage || 'https://via.placeholder.com/60' }}
            style={styles.restaurantImage}
          />
          <View style={styles.restaurantDetails}>
            <Text style={styles.restaurantName}>{order.restaurantName}</Text>
            <Text style={styles.restaurantAddress}>{order.restaurantAddress}</Text>
          </View>
        </View>

        <View style={styles.itemsList}>
          {order.items.map((item, index) => (
            <View key={index} style={styles.orderItem}>
              <Text style={styles.itemQuantity}>{item.quantity}x</Text>
              <Text style={styles.itemName}>{item.name}</Text>
              <Text style={styles.itemPrice}>${(item.price * item.quantity).toFixed(2)}</Text>
            </View>
          ))}
        </View>

        <View style={styles.totalRow}>
          <Text style={styles.totalLabel}>Total</Text>
          <Text style={styles.totalValue}>${order.total.toFixed(2)}</Text>
        </View>
      </View>

      {/* Delivery Address */}
      <View style={styles.addressSection}>
        <Icon name="map-marker" size={24} color="#007AFF" />
        <View style={styles.addressContent}>
          <Text style={styles.addressLabel}>Delivery Address</Text>
          <Text style={styles.addressText}>{order.reskflowAddress}</Text>
        </View>
      </View>

      {/* Actions */}
      <View style={styles.actions}>
        {isDelivered ? (
          <TouchableOpacity style={styles.primaryButton}>
            <Icon name="refresh" size={20} color="#FFFFFF" />
            <Text style={styles.primaryButtonText}>Order Again</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity style={styles.secondaryButton} onPress={handleContactSupport}>
            <Icon name="message-text" size={20} color="#007AFF" />
            <Text style={styles.secondaryButtonText}>Contact Support</Text>
          </TouchableOpacity>
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F9FAFB',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  mapContainer: {
    height: 200,
    backgroundColor: '#E5E7EB',
  },
  map: {
    flex: 1,
  },
  driverMarker: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  statusHeader: {
    backgroundColor: '#FFFFFF',
    padding: 24,
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  statusTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: '#111827',
    marginTop: 12,
  },
  statusSubtitle: {
    fontSize: 16,
    color: '#6B7280',
    marginTop: 4,
  },
  driverCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    padding: 16,
    marginTop: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  driverPhoto: {
    width: 60,
    height: 60,
    borderRadius: 30,
    marginRight: 12,
  },
  driverInfo: {
    flex: 1,
  },
  driverName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#111827',
  },
  driverRating: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
  },
  ratingText: {
    fontSize: 14,
    color: '#6B7280',
    marginLeft: 4,
  },
  callButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#E6F2FF',
    justifyContent: 'center',
    alignItems: 'center',
  },
  progressSection: {
    backgroundColor: '#FFFFFF',
    padding: 20,
    marginTop: 8,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#111827',
    marginBottom: 16,
  },
  progressItem: {
    flexDirection: 'row',
    marginBottom: 24,
  },
  progressLine: {
    alignItems: 'center',
    marginRight: 16,
  },
  progressDot: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#F3F4F6',
    justifyContent: 'center',
    alignItems: 'center',
  },
  progressDotCompleted: {
    backgroundColor: '#E6F2FF',
  },
  progressConnector: {
    width: 2,
    height: 40,
    backgroundColor: '#E5E7EB',
    position: 'absolute',
    top: 40,
  },
  progressConnectorCompleted: {
    backgroundColor: '#007AFF',
  },
  progressContent: {
    flex: 1,
    paddingTop: 8,
  },
  progressText: {
    fontSize: 16,
    color: '#9CA3AF',
  },
  progressTextCompleted: {
    color: '#111827',
    fontWeight: '500',
  },
  progressTime: {
    fontSize: 14,
    color: '#6B7280',
    marginTop: 2,
  },
  detailsSection: {
    backgroundColor: '#FFFFFF',
    padding: 20,
    marginTop: 8,
  },
  restaurantInfo: {
    flexDirection: 'row',
    marginBottom: 16,
  },
  restaurantImage: {
    width: 60,
    height: 60,
    borderRadius: 8,
    marginRight: 12,
  },
  restaurantDetails: {
    flex: 1,
  },
  restaurantName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#111827',
  },
  restaurantAddress: {
    fontSize: 14,
    color: '#6B7280',
    marginTop: 4,
  },
  itemsList: {
    borderTopWidth: 1,
    borderTopColor: '#E5E7EB',
    paddingTop: 16,
  },
  orderItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  itemQuantity: {
    fontSize: 16,
    fontWeight: '500',
    color: '#6B7280',
    width: 30,
  },
  itemName: {
    flex: 1,
    fontSize: 16,
    color: '#111827',
  },
  itemPrice: {
    fontSize: 16,
    fontWeight: '500',
    color: '#111827',
  },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: '#E5E7EB',
    paddingTop: 16,
    marginTop: 8,
  },
  totalLabel: {
    fontSize: 18,
    fontWeight: '600',
    color: '#111827',
  },
  totalValue: {
    fontSize: 18,
    fontWeight: '600',
    color: '#007AFF',
  },
  addressSection: {
    flexDirection: 'row',
    backgroundColor: '#FFFFFF',
    padding: 20,
    marginTop: 8,
  },
  addressContent: {
    flex: 1,
    marginLeft: 12,
  },
  addressLabel: {
    fontSize: 14,
    color: '#6B7280',
    marginBottom: 4,
  },
  addressText: {
    fontSize: 16,
    color: '#111827',
  },
  actions: {
    padding: 20,
  },
  primaryButton: {
    flexDirection: 'row',
    backgroundColor: '#007AFF',
    paddingVertical: 16,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
    marginLeft: 8,
  },
  secondaryButton: {
    flexDirection: 'row',
    backgroundColor: '#E6F2FF',
    paddingVertical: 16,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#007AFF',
    marginLeft: 8,
  },
});