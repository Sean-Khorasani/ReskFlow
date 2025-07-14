import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useCart } from '../hooks/useCart';
import { createOrder } from '../services/api';

interface DeliveryAddress {
  id: string;
  type: 'home' | 'work' | 'other';
  address: string;
  instructions?: string;
}

interface PaymentMethod {
  id: string;
  type: 'card' | 'cash' | 'wallet';
  last4?: string;
  brand?: string;
}

export default function CheckoutScreen() {
  const navigation = useNavigation();
  const { items, total, restaurantId, clearCart } = useCart();
  
  const [selectedAddress, setSelectedAddress] = useState<DeliveryAddress>({
    id: '1',
    type: 'home',
    address: '123 Main St, Apt 4B, New York, NY 10001',
    instructions: 'Ring doorbell twice',
  });
  
  const [selectedPayment, setSelectedPayment] = useState<PaymentMethod>({
    id: '1',
    type: 'card',
    last4: '4242',
    brand: 'Visa',
  });
  
  const [reskflowInstructions, setDeliveryInstructions] = useState('');
  const [promoCode, setPromoCode] = useState('');
  const [loading, setLoading] = useState(false);

  const addresses: DeliveryAddress[] = [
    {
      id: '1',
      type: 'home',
      address: '123 Main St, Apt 4B, New York, NY 10001',
      instructions: 'Ring doorbell twice',
    },
    {
      id: '2',
      type: 'work',
      address: '456 Office Plaza, Suite 200, New York, NY 10002',
    },
  ];

  const paymentMethods: PaymentMethod[] = [
    {
      id: '1',
      type: 'card',
      last4: '4242',
      brand: 'Visa',
    },
    {
      id: '2',
      type: 'cash',
    },
    {
      id: '3',
      type: 'wallet',
      brand: 'Apple Pay',
    },
  ];

  const handlePlaceOrder = async () => {
    if (!selectedAddress) {
      Alert.alert('Error', 'Please select a reskflow address');
      return;
    }
    
    if (!selectedPayment) {
      Alert.alert('Error', 'Please select a payment method');
      return;
    }

    setLoading(true);
    try {
      const orderData = {
        restaurantId,
        items: items.map(item => ({
          productId: item.productId,
          quantity: item.quantity,
          specialInstructions: item.specialInstructions,
        })),
        reskflowAddress: selectedAddress.address,
        reskflowInstructions: reskflowInstructions || selectedAddress.instructions,
        paymentMethodId: selectedPayment.id,
        promoCode: promoCode || undefined,
      };

      const order = await createOrder(orderData);
      clearCart();
      
      Alert.alert(
        'Order Placed!',
        'Your order has been placed successfully.',
        [
          {
            text: 'Track Order',
            onPress: () => navigation.navigate('OrderTracking' as never, { orderId: order.id } as never),
          },
        ]
      );
    } catch (error) {
      Alert.alert('Error', 'Failed to place order. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const getAddressIcon = (type: string) => {
    switch (type) {
      case 'home':
        return 'home';
      case 'work':
        return 'briefcase';
      default:
        return 'map-marker';
    }
  };

  const getPaymentIcon = (type: string, brand?: string) => {
    if (type === 'cash') return 'cash';
    if (type === 'wallet') {
      if (brand === 'Apple Pay') return 'apple';
      return 'wallet';
    }
    return 'credit-card';
  };

  return (
    <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
      {/* Delivery Address */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Delivery Address</Text>
          <TouchableOpacity onPress={() => navigation.navigate('Address' as never)}>
            <Text style={styles.changeButton}>Change</Text>
          </TouchableOpacity>
        </View>
        
        {addresses.map((address) => (
          <TouchableOpacity
            key={address.id}
            style={[
              styles.optionCard,
              selectedAddress?.id === address.id && styles.selectedOption,
            ]}
            onPress={() => setSelectedAddress(address)}
          >
            <View style={styles.optionIcon}>
              <Icon name={getAddressIcon(address.type)} size={24} color="#007AFF" />
            </View>
            <View style={styles.optionContent}>
              <Text style={styles.optionTitle}>
                {address.type.charAt(0).toUpperCase() + address.type.slice(1)}
              </Text>
              <Text style={styles.optionSubtitle}>{address.address}</Text>
              {address.instructions && (
                <Text style={styles.optionNote}>{address.instructions}</Text>
              )}
            </View>
            <View style={[styles.radio, selectedAddress?.id === address.id && styles.radioSelected]} />
          </TouchableOpacity>
        ))}
      </View>

      {/* Delivery Instructions */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Delivery Instructions</Text>
        <TextInput
          style={styles.textInput}
          placeholder="Add instructions for your driver (optional)"
          value={reskflowInstructions}
          onChangeText={setDeliveryInstructions}
          multiline
          numberOfLines={3}
          placeholderTextColor="#9CA3AF"
        />
      </View>

      {/* Payment Method */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Payment Method</Text>
          <TouchableOpacity onPress={() => navigation.navigate('PaymentMethods' as never)}>
            <Text style={styles.changeButton}>Change</Text>
          </TouchableOpacity>
        </View>
        
        {paymentMethods.map((payment) => (
          <TouchableOpacity
            key={payment.id}
            style={[
              styles.optionCard,
              selectedPayment?.id === payment.id && styles.selectedOption,
            ]}
            onPress={() => setSelectedPayment(payment)}
          >
            <View style={styles.optionIcon}>
              <Icon name={getPaymentIcon(payment.type, payment.brand)} size={24} color="#007AFF" />
            </View>
            <View style={styles.optionContent}>
              {payment.type === 'card' ? (
                <>
                  <Text style={styles.optionTitle}>
                    {payment.brand} •••• {payment.last4}
                  </Text>
                  <Text style={styles.optionSubtitle}>Credit Card</Text>
                </>
              ) : payment.type === 'cash' ? (
                <>
                  <Text style={styles.optionTitle}>Cash on Delivery</Text>
                  <Text style={styles.optionSubtitle}>Pay when you receive</Text>
                </>
              ) : (
                <>
                  <Text style={styles.optionTitle}>{payment.brand}</Text>
                  <Text style={styles.optionSubtitle}>Digital Wallet</Text>
                </>
              )}
            </View>
            <View style={[styles.radio, selectedPayment?.id === payment.id && styles.radioSelected]} />
          </TouchableOpacity>
        ))}
      </View>

      {/* Promo Code */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Promo Code</Text>
        <View style={styles.promoContainer}>
          <TextInput
            style={styles.promoInput}
            placeholder="Enter promo code"
            value={promoCode}
            onChangeText={setPromoCode}
            autoCapitalize="characters"
            placeholderTextColor="#9CA3AF"
          />
          <TouchableOpacity style={styles.promoButton}>
            <Text style={styles.promoButtonText}>Apply</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Order Summary */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Order Summary</Text>
        <View style={styles.summaryCard}>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Items ({items.length})</Text>
            <Text style={styles.summaryValue}>${total.toFixed(2)}</Text>
          </View>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Delivery Fee</Text>
            <Text style={styles.summaryValue}>$3.99</Text>
          </View>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Service Fee</Text>
            <Text style={styles.summaryValue}>$2.00</Text>
          </View>
          <View style={styles.divider} />
          <View style={styles.summaryRow}>
            <Text style={styles.totalLabel}>Total</Text>
            <Text style={styles.totalValue}>${(total + 3.99 + 2.00).toFixed(2)}</Text>
          </View>
        </View>
      </View>

      {/* Place Order Button */}
      <TouchableOpacity
        style={[styles.placeOrderButton, loading && styles.disabledButton]}
        onPress={handlePlaceOrder}
        disabled={loading}
      >
        {loading ? (
          <ActivityIndicator color="#FFFFFF" />
        ) : (
          <>
            <Icon name="check-circle" size={20} color="#FFFFFF" />
            <Text style={styles.placeOrderText}>Place Order • ${(total + 3.99 + 2.00).toFixed(2)}</Text>
          </>
        )}
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F9FAFB',
  },
  section: {
    backgroundColor: '#FFFFFF',
    padding: 16,
    marginBottom: 8,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#111827',
  },
  changeButton: {
    fontSize: 14,
    color: '#007AFF',
    fontWeight: '500',
  },
  optionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    backgroundColor: '#F9FAFB',
    borderRadius: 12,
    marginBottom: 12,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  selectedOption: {
    borderColor: '#007AFF',
    backgroundColor: '#E6F2FF',
  },
  optionIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#E6F2FF',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  optionContent: {
    flex: 1,
  },
  optionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#111827',
  },
  optionSubtitle: {
    fontSize: 14,
    color: '#6B7280',
    marginTop: 2,
  },
  optionNote: {
    fontSize: 12,
    color: '#9CA3AF',
    marginTop: 4,
    fontStyle: 'italic',
  },
  radio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: '#D1D5DB',
    marginLeft: 12,
  },
  radioSelected: {
    borderColor: '#007AFF',
    backgroundColor: '#007AFF',
  },
  textInput: {
    backgroundColor: '#F3F4F6',
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    color: '#111827',
    minHeight: 80,
    textAlignVertical: 'top',
  },
  promoContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  promoInput: {
    flex: 1,
    backgroundColor: '#F3F4F6',
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 16,
    color: '#111827',
    marginRight: 12,
  },
  promoButton: {
    backgroundColor: '#007AFF',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
  },
  promoButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
  summaryCard: {
    backgroundColor: '#F9FAFB',
    borderRadius: 8,
    padding: 16,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  summaryLabel: {
    fontSize: 16,
    color: '#6B7280',
  },
  summaryValue: {
    fontSize: 16,
    color: '#111827',
  },
  divider: {
    height: 1,
    backgroundColor: '#E5E7EB',
    marginVertical: 12,
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
  placeOrderButton: {
    flexDirection: 'row',
    backgroundColor: '#007AFF',
    marginHorizontal: 16,
    marginVertical: 24,
    paddingVertical: 16,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  disabledButton: {
    opacity: 0.6,
  },
  placeOrderText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
    marginLeft: 8,
  },
});