import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Alert,
  Linking,
  Platform,
} from 'react-native';
import MapView, { Marker, Polyline } from 'react-native-maps';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useRoute, useNavigation } from '@react-navigation/native';
import { useSocket } from '../hooks/useSocket';
import { useAuth } from '../contexts/AuthContext';
import { colors } from '../theme';
import api from '../services/api';

interface OrderDetails {
  id: string;
  status: 'assigned' | 'picked_up' | 'on_the_way' | 'delivered';
  merchantName: string;
  merchantAddress: string;
  merchantPhone: string;
  customerName: string;
  customerAddress: string;
  customerPhone: string;
  items: Array<{
    name: string;
    quantity: number;
    specialInstructions?: string;
  }>;
  subtotal: number;
  reskflowFee: number;
  tip: number;
  total: number;
  paymentMethod: string;
  reskflowInstructions?: string;
  pickupLocation: {
    latitude: number;
    longitude: number;
  };
  reskflowLocation: {
    latitude: number;
    longitude: number;
  };
}

export default function DeliveryDetailsScreen() {
  const route = useRoute();
  const navigation = useNavigation();
  const socket = useSocket();
  const { user } = useAuth();
  const { orderId } = route.params as { orderId: string };
  
  const [order, setOrder] = useState<OrderDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);

  useEffect(() => {
    fetchOrderDetails();
  }, [orderId]);

  useEffect(() => {
    // Listen for order updates
    if (socket) {
      socket.on('order-update', (data) => {
        if (data.orderId === orderId) {
          setOrder(data.order);
        }
      });

      return () => {
        socket.off('order-update');
      };
    }
  }, [socket, orderId]);

  const fetchOrderDetails = async () => {
    try {
      const response = await api.get(`/orders/${orderId}/driver-details`);
      setOrder(response.data.order);
    } catch (error) {
      Alert.alert('Error', 'Failed to load order details');
    } finally {
      setLoading(false);
    }
  };

  const updateOrderStatus = async (newStatus: string) => {
    if (!order || updating) return;

    setUpdating(true);
    try {
      await api.post(`/orders/${orderId}/status`, { status: newStatus });
      
      // Update local state
      setOrder({ ...order, status: newStatus as any });

      // Emit socket event
      if (socket) {
        socket.emit('order-status-update', {
          orderId,
          status: newStatus,
          driverId: user?.id,
        });
      }

      if (newStatus === 'delivered') {
        Alert.alert('Success', 'Delivery completed!', [
          {
            text: 'OK',
            onPress: () => navigation.navigate('Home' as never),
          },
        ]);
      }
    } catch (error) {
      Alert.alert('Error', 'Failed to update order status');
    } finally {
      setUpdating(false);
    }
  };

  const handleCall = (phone: string) => {
    Linking.openURL(`tel:${phone}`);
  };

  const handleNavigation = (location: { latitude: number; longitude: number }, label: string) => {
    const scheme = Platform.select({ ios: 'maps:0,0?q=', android: 'geo:0,0?q=' });
    const latLng = `${location.latitude},${location.longitude}`;
    const url = Platform.select({
      ios: `${scheme}${label}@${latLng}`,
      android: `${scheme}${latLng}(${label})`,
    });

    if (url) {
      Linking.openURL(url);
    }
  };

  const getNextStatus = () => {
    switch (order?.status) {
      case 'assigned':
        return { status: 'picked_up', label: 'Mark as Picked Up', icon: 'package-variant' };
      case 'picked_up':
        return { status: 'on_the_way', label: 'Start Delivery', icon: 'truck-reskflow' };
      case 'on_the_way':
        return { status: 'delivered', label: 'Complete Delivery', icon: 'check-circle' };
      default:
        return null;
    }
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <Text>Loading order details...</Text>
      </View>
    );
  }

  if (!order) {
    return (
      <View style={styles.errorContainer}>
        <Text>Order not found</Text>
      </View>
    );
  }

  const nextStatus = getNextStatus();
  const region = {
    latitude: (order.pickupLocation.latitude + order.reskflowLocation.latitude) / 2,
    longitude: (order.pickupLocation.longitude + order.reskflowLocation.longitude) / 2,
    latitudeDelta: Math.abs(order.pickupLocation.latitude - order.reskflowLocation.latitude) * 1.5,
    longitudeDelta: Math.abs(order.pickupLocation.longitude - order.reskflowLocation.longitude) * 1.5,
  };

  return (
    <View style={styles.container}>
      <MapView
        style={styles.map}
        region={region}
        showsUserLocation
        showsMyLocationButton
      >
        <Marker
          coordinate={order.pickupLocation}
          title="Pickup"
          description={order.merchantName}
        >
          <View style={styles.markerContainer}>
            <Icon name="store" size={24} color={colors.white} />
          </View>
        </Marker>
        
        <Marker
          coordinate={order.reskflowLocation}
          title="Delivery"
          description={order.customerName}
        >
          <View style={[styles.markerContainer, { backgroundColor: colors.success }]}>
            <Icon name="home" size={24} color={colors.white} />
          </View>
        </Marker>

        <Polyline
          coordinates={[order.pickupLocation, order.reskflowLocation]}
          strokeColor={colors.primary}
          strokeWidth={3}
          geodesic
        />
      </MapView>

      <ScrollView style={styles.details} showsVerticalScrollIndicator={false}>
        {/* Status */}
        <View style={styles.statusCard}>
          <Text style={styles.statusLabel}>Current Status</Text>
          <Text style={styles.statusValue}>
            {order.status.replace('_', ' ').toUpperCase()}
          </Text>
        </View>

        {/* Pickup Location */}
        {(order.status === 'assigned' || order.status === 'picked_up') && (
          <View style={styles.locationCard}>
            <View style={styles.locationHeader}>
              <View style={styles.locationIcon}>
                <Icon name="store" size={20} color={colors.primary} />
              </View>
              <Text style={styles.locationTitle}>Pickup Location</Text>
            </View>
            
            <Text style={styles.locationName}>{order.merchantName}</Text>
            <Text style={styles.locationAddress}>{order.merchantAddress}</Text>
            
            <View style={styles.actionButtons}>
              <TouchableOpacity
                style={styles.actionButton}
                onPress={() => handleCall(order.merchantPhone)}
              >
                <Icon name="phone" size={20} color={colors.primary} />
                <Text style={styles.actionButtonText}>Call</Text>
              </TouchableOpacity>
              
              <TouchableOpacity
                style={styles.actionButton}
                onPress={() => handleNavigation(order.pickupLocation, order.merchantName)}
              >
                <Icon name="navigation" size={20} color={colors.primary} />
                <Text style={styles.actionButtonText}>Navigate</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Delivery Location */}
        {(order.status === 'picked_up' || order.status === 'on_the_way') && (
          <View style={styles.locationCard}>
            <View style={styles.locationHeader}>
              <View style={[styles.locationIcon, { backgroundColor: colors.successLight }]}>
                <Icon name="home" size={20} color={colors.success} />
              </View>
              <Text style={styles.locationTitle}>Delivery Location</Text>
            </View>
            
            <Text style={styles.locationName}>{order.customerName}</Text>
            <Text style={styles.locationAddress}>{order.customerAddress}</Text>
            
            {order.reskflowInstructions && (
              <View style={styles.instructionsBox}>
                <Icon name="information" size={16} color={colors.warning} />
                <Text style={styles.instructionsText}>{order.reskflowInstructions}</Text>
              </View>
            )}
            
            <View style={styles.actionButtons}>
              <TouchableOpacity
                style={styles.actionButton}
                onPress={() => handleCall(order.customerPhone)}
              >
                <Icon name="phone" size={20} color={colors.primary} />
                <Text style={styles.actionButtonText}>Call</Text>
              </TouchableOpacity>
              
              <TouchableOpacity
                style={styles.actionButton}
                onPress={() => handleNavigation(order.reskflowLocation, order.customerName)}
              >
                <Icon name="navigation" size={20} color={colors.primary} />
                <Text style={styles.actionButtonText}>Navigate</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Order Items */}
        <View style={styles.itemsCard}>
          <Text style={styles.sectionTitle}>Order Items</Text>
          {order.items.map((item, index) => (
            <View key={index} style={styles.item}>
              <Text style={styles.itemQuantity}>{item.quantity}x</Text>
              <View style={styles.itemDetails}>
                <Text style={styles.itemName}>{item.name}</Text>
                {item.specialInstructions && (
                  <Text style={styles.itemInstructions}>{item.specialInstructions}</Text>
                )}
              </View>
            </View>
          ))}
        </View>

        {/* Payment Info */}
        <View style={styles.paymentCard}>
          <Text style={styles.sectionTitle}>Payment Information</Text>
          <View style={styles.paymentRow}>
            <Text style={styles.paymentLabel}>Payment Method</Text>
            <Text style={styles.paymentValue}>{order.paymentMethod}</Text>
          </View>
          <View style={styles.paymentRow}>
            <Text style={styles.paymentLabel}>Order Total</Text>
            <Text style={styles.paymentValue}>${order.total.toFixed(2)}</Text>
          </View>
          {order.paymentMethod === 'cash' && (
            <View style={styles.cashWarning}>
              <Icon name="cash" size={20} color={colors.warning} />
              <Text style={styles.cashWarningText}>
                Collect ${order.total.toFixed(2)} from customer
              </Text>
            </View>
          )}
        </View>

        {/* Earnings */}
        <View style={styles.earningsCard}>
          <Text style={styles.earningsLabel}>Your Earnings</Text>
          <Text style={styles.earningsAmount}>
            ${(order.reskflowFee + order.tip).toFixed(2)}
          </Text>
          {order.tip > 0 && (
            <Text style={styles.tipText}>Includes ${order.tip.toFixed(2)} tip</Text>
          )}
        </View>
      </ScrollView>

      {/* Action Button */}
      {nextStatus && (
        <View style={styles.footer}>
          <TouchableOpacity
            style={[styles.primaryButton, updating && styles.disabledButton]}
            onPress={() => updateOrderStatus(nextStatus.status)}
            disabled={updating}
          >
            <Icon name={nextStatus.icon} size={24} color={colors.white} />
            <Text style={styles.primaryButtonText}>{nextStatus.label}</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.white,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  map: {
    height: 200,
  },
  markerContainer: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  details: {
    flex: 1,
    padding: 16,
  },
  statusCard: {
    backgroundColor: colors.primaryLight,
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
    marginBottom: 16,
  },
  statusLabel: {
    fontSize: 14,
    color: colors.primary,
    marginBottom: 4,
  },
  statusValue: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.primary,
  },
  locationCard: {
    backgroundColor: colors.gray50,
    padding: 16,
    borderRadius: 12,
    marginBottom: 16,
  },
  locationHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  locationIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.primaryLight,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  locationTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.gray900,
  },
  locationName: {
    fontSize: 16,
    fontWeight: '500',
    color: colors.gray900,
    marginBottom: 4,
  },
  locationAddress: {
    fontSize: 14,
    color: colors.gray700,
    lineHeight: 20,
    marginBottom: 12,
  },
  instructionsBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: colors.warningLight,
    padding: 12,
    borderRadius: 8,
    marginBottom: 12,
  },
  instructionsText: {
    fontSize: 14,
    color: colors.gray800,
    marginLeft: 8,
    flex: 1,
  },
  actionButtons: {
    flexDirection: 'row',
    justifyContent: 'space-around',
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  actionButtonText: {
    fontSize: 14,
    fontWeight: '500',
    color: colors.primary,
    marginLeft: 6,
  },
  itemsCard: {
    backgroundColor: colors.gray50,
    padding: 16,
    borderRadius: 12,
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.gray900,
    marginBottom: 12,
  },
  item: {
    flexDirection: 'row',
    marginBottom: 12,
  },
  itemQuantity: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.gray900,
    marginRight: 12,
    minWidth: 30,
  },
  itemDetails: {
    flex: 1,
  },
  itemName: {
    fontSize: 14,
    color: colors.gray900,
  },
  itemInstructions: {
    fontSize: 12,
    color: colors.gray600,
    marginTop: 2,
    fontStyle: 'italic',
  },
  paymentCard: {
    backgroundColor: colors.gray50,
    padding: 16,
    borderRadius: 12,
    marginBottom: 16,
  },
  paymentRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  paymentLabel: {
    fontSize: 14,
    color: colors.gray700,
  },
  paymentValue: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.gray900,
  },
  cashWarning: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.warningLight,
    padding: 12,
    borderRadius: 8,
    marginTop: 8,
  },
  cashWarningText: {
    fontSize: 14,
    fontWeight: '500',
    color: colors.warning,
    marginLeft: 8,
  },
  earningsCard: {
    backgroundColor: colors.successLight,
    padding: 20,
    borderRadius: 12,
    alignItems: 'center',
    marginBottom: 20,
  },
  earningsLabel: {
    fontSize: 14,
    color: colors.success,
    marginBottom: 4,
  },
  earningsAmount: {
    fontSize: 28,
    fontWeight: '700',
    color: colors.success,
  },
  tipText: {
    fontSize: 12,
    color: colors.success,
    marginTop: 4,
  },
  footer: {
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: colors.gray200,
  },
  primaryButton: {
    flexDirection: 'row',
    backgroundColor: colors.primary,
    paddingVertical: 16,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  disabledButton: {
    opacity: 0.6,
  },
  primaryButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.white,
    marginLeft: 8,
  },
});