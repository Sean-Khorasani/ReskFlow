import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Alert,
  Animated,
} from 'react-native';
import MapView, { Marker, Polyline } from 'react-native-maps';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useNavigation } from '@react-navigation/native';
import { useSocket } from '../hooks/useSocket';
import { useAuth } from '../contexts/AuthContext';
import { colors } from '../theme';

interface DeliveryRequest {
  id: string;
  orderId: string;
  pickupAddress: string;
  reskflowAddress: string;
  customerName: string;
  merchantName: string;
  estimatedTime: number;
  distance: number;
  earnings: number;
  items: number;
  pickupLocation: {
    latitude: number;
    longitude: number;
  };
  reskflowLocation: {
    latitude: number;
    longitude: number;
  };
}

export default function DeliveryRequestScreen() {
  const navigation = useNavigation();
  const socket = useSocket();
  const { user } = useAuth();
  const [request, setRequest] = useState<DeliveryRequest | null>(null);
  const [timeLeft, setTimeLeft] = useState(30); // 30 seconds to accept
  const fadeAnim = useState(new Animated.Value(0))[0];

  useEffect(() => {
    // Listen for reskflow requests
    if (socket) {
      socket.on('reskflow-request', (data: DeliveryRequest) => {
        setRequest(data);
        setTimeLeft(30);
        // Animate entry
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 300,
          useNativeDriver: true,
        }).start();
      });

      return () => {
        socket.off('reskflow-request');
      };
    }
  }, [socket, fadeAnim]);

  useEffect(() => {
    // Countdown timer
    if (request && timeLeft > 0) {
      const timer = setTimeout(() => {
        setTimeLeft(timeLeft - 1);
      }, 1000);
      return () => clearTimeout(timer);
    } else if (timeLeft === 0) {
      handleDecline();
    }
  }, [timeLeft, request]);

  const handleAccept = async () => {
    if (!request || !socket) return;

    socket.emit('accept-reskflow', {
      requestId: request.id,
      driverId: user?.id,
    });

    Alert.alert('Success', 'Delivery accepted!', [
      {
        text: 'OK',
        onPress: () => {
          navigation.navigate('DeliveryDetails' as never, { orderId: request.orderId } as never);
        },
      },
    ]);
  };

  const handleDecline = () => {
    if (!request || !socket) return;

    socket.emit('decline-reskflow', {
      requestId: request.id,
      driverId: user?.id,
    });

    // Animate exit
    Animated.timing(fadeAnim, {
      toValue: 0,
      duration: 300,
      useNativeDriver: true,
    }).start(() => {
      setRequest(null);
    });
  };

  if (!request) {
    return (
      <View style={styles.container}>
        <View style={styles.waitingContainer}>
          <Icon name="truck-reskflow" size={100} color={colors.gray400} />
          <Text style={styles.waitingTitle}>Waiting for reskflow requests...</Text>
          <Text style={styles.waitingSubtitle}>
            Make sure you're online to receive requests
          </Text>
        </View>
      </View>
    );
  }

  const region = {
    latitude: (request.pickupLocation.latitude + request.reskflowLocation.latitude) / 2,
    longitude: (request.pickupLocation.longitude + request.reskflowLocation.longitude) / 2,
    latitudeDelta: Math.abs(request.pickupLocation.latitude - request.reskflowLocation.latitude) * 1.5,
    longitudeDelta: Math.abs(request.pickupLocation.longitude - request.reskflowLocation.longitude) * 1.5,
  };

  return (
    <Animated.View style={[styles.container, { opacity: fadeAnim }]}>
      <View style={styles.header}>
        <Text style={styles.timer}>{timeLeft}s</Text>
        <Text style={styles.headerTitle}>New Delivery Request</Text>
        <TouchableOpacity onPress={handleDecline}>
          <Icon name="close" size={24} color={colors.gray600} />
        </TouchableOpacity>
      </View>

      <MapView
        style={styles.map}
        region={region}
        showsUserLocation
        showsMyLocationButton={false}
      >
        <Marker
          coordinate={request.pickupLocation}
          title="Pickup"
          description={request.merchantName}
        >
          <View style={styles.markerContainer}>
            <Icon name="store" size={24} color={colors.white} />
          </View>
        </Marker>
        
        <Marker
          coordinate={request.reskflowLocation}
          title="Delivery"
          description={request.customerName}
        >
          <View style={[styles.markerContainer, { backgroundColor: colors.success }]}>
            <Icon name="home" size={24} color={colors.white} />
          </View>
        </Marker>

        <Polyline
          coordinates={[request.pickupLocation, request.reskflowLocation]}
          strokeColor={colors.primary}
          strokeWidth={3}
          geodesic
        />
      </MapView>

      <ScrollView style={styles.details} showsVerticalScrollIndicator={false}>
        <View style={styles.earningsCard}>
          <Text style={styles.earningsLabel}>Estimated Earnings</Text>
          <Text style={styles.earningsAmount}>${request.earnings.toFixed(2)}</Text>
        </View>

        <View style={styles.infoSection}>
          <View style={styles.infoRow}>
            <Icon name="map-marker" size={20} color={colors.primary} />
            <View style={styles.infoContent}>
              <Text style={styles.infoLabel}>Distance</Text>
              <Text style={styles.infoValue}>{request.distance} miles</Text>
            </View>
          </View>

          <View style={styles.infoRow}>
            <Icon name="clock-outline" size={20} color={colors.primary} />
            <View style={styles.infoContent}>
              <Text style={styles.infoLabel}>Estimated Time</Text>
              <Text style={styles.infoValue}>{request.estimatedTime} mins</Text>
            </View>
          </View>

          <View style={styles.infoRow}>
            <Icon name="shopping" size={20} color={colors.primary} />
            <View style={styles.infoContent}>
              <Text style={styles.infoLabel}>Items</Text>
              <Text style={styles.infoValue}>{request.items} items</Text>
            </View>
          </View>
        </View>

        <View style={styles.addressSection}>
          <View style={styles.addressCard}>
            <View style={styles.addressIcon}>
              <Icon name="store" size={20} color={colors.primary} />
            </View>
            <View style={styles.addressContent}>
              <Text style={styles.addressLabel}>Pickup from</Text>
              <Text style={styles.addressName}>{request.merchantName}</Text>
              <Text style={styles.addressText}>{request.pickupAddress}</Text>
            </View>
          </View>

          <View style={styles.addressDivider}>
            <View style={styles.dashedLine} />
          </View>

          <View style={styles.addressCard}>
            <View style={[styles.addressIcon, { backgroundColor: colors.successLight }]}>
              <Icon name="home" size={20} color={colors.success} />
            </View>
            <View style={styles.addressContent}>
              <Text style={styles.addressLabel}>Deliver to</Text>
              <Text style={styles.addressName}>{request.customerName}</Text>
              <Text style={styles.addressText}>{request.reskflowAddress}</Text>
            </View>
          </View>
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <TouchableOpacity
          style={[styles.button, styles.declineButton]}
          onPress={handleDecline}
        >
          <Text style={styles.declineButtonText}>Decline</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.button, styles.acceptButton]}
          onPress={handleAccept}
        >
          <Text style={styles.acceptButtonText}>Accept</Text>
        </TouchableOpacity>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.white,
  },
  waitingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  waitingTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: colors.gray900,
    marginTop: 20,
  },
  waitingSubtitle: {
    fontSize: 16,
    color: colors.gray600,
    marginTop: 8,
    textAlign: 'center',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.gray200,
  },
  timer: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.primary,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.gray900,
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
  earningsCard: {
    backgroundColor: colors.primaryLight,
    padding: 20,
    borderRadius: 12,
    alignItems: 'center',
    marginBottom: 20,
  },
  earningsLabel: {
    fontSize: 14,
    color: colors.primary,
    marginBottom: 4,
  },
  earningsAmount: {
    fontSize: 32,
    fontWeight: '700',
    color: colors.primary,
  },
  infoSection: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginBottom: 24,
  },
  infoRow: {
    alignItems: 'center',
  },
  infoContent: {
    alignItems: 'center',
    marginTop: 8,
  },
  infoLabel: {
    fontSize: 12,
    color: colors.gray600,
  },
  infoValue: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.gray900,
    marginTop: 2,
  },
  addressSection: {
    marginBottom: 20,
  },
  addressCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  addressIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.primaryLight,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  addressContent: {
    flex: 1,
  },
  addressLabel: {
    fontSize: 12,
    color: colors.gray600,
    marginBottom: 4,
  },
  addressName: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.gray900,
    marginBottom: 4,
  },
  addressText: {
    fontSize: 14,
    color: colors.gray700,
    lineHeight: 20,
  },
  addressDivider: {
    paddingVertical: 16,
    paddingLeft: 20,
  },
  dashedLine: {
    borderLeftWidth: 2,
    borderLeftColor: colors.gray300,
    borderStyle: 'dashed',
    height: 40,
    marginLeft: 20,
  },
  footer: {
    flexDirection: 'row',
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: colors.gray200,
  },
  button: {
    flex: 1,
    paddingVertical: 16,
    borderRadius: 8,
    alignItems: 'center',
  },
  declineButton: {
    backgroundColor: colors.gray100,
    marginRight: 8,
  },
  acceptButton: {
    backgroundColor: colors.primary,
    marginLeft: 8,
  },
  declineButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.gray700,
  },
  acceptButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.white,
  },
});