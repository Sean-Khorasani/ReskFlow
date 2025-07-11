import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Alert,
  Modal,
  TextInput,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

interface PaymentMethod {
  id: string;
  type: 'card' | 'paypal' | 'apple_pay' | 'google_pay';
  name: string;
  last4?: string;
  brand?: string;
  expiryDate?: string;
  email?: string;
  isDefault: boolean;
}

export default function PaymentMethodsScreen() {
  const navigation = useNavigation();
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([
    {
      id: '1',
      type: 'card',
      name: 'Visa',
      last4: '4242',
      brand: 'Visa',
      expiryDate: '12/25',
      isDefault: true,
    },
    {
      id: '2',
      type: 'card',
      name: 'Mastercard',
      last4: '8888',
      brand: 'Mastercard',
      expiryDate: '09/24',
      isDefault: false,
    },
    {
      id: '3',
      type: 'paypal',
      name: 'PayPal',
      email: 'user@example.com',
      isDefault: false,
    },
  ]);

  const [showModal, setShowModal] = useState(false);
  const [formData, setFormData] = useState({
    cardNumber: '',
    cardholderName: '',
    expiryMonth: '',
    expiryYear: '',
    cvv: '',
  });

  const handleAddCard = () => {
    setFormData({
      cardNumber: '',
      cardholderName: '',
      expiryMonth: '',
      expiryYear: '',
      cvv: '',
    });
    setShowModal(true);
  };

  const handleSaveCard = () => {
    // Validation
    if (!formData.cardNumber || !formData.cardholderName || !formData.expiryMonth || !formData.expiryYear || !formData.cvv) {
      Alert.alert('Error', 'Please fill in all fields');
      return;
    }

    if (formData.cardNumber.replace(/\s/g, '').length !== 16) {
      Alert.alert('Error', 'Please enter a valid card number');
      return;
    }

    if (formData.cvv.length !== 3) {
      Alert.alert('Error', 'Please enter a valid CVV');
      return;
    }

    // Add new card
    const newCard: PaymentMethod = {
      id: Date.now().toString(),
      type: 'card',
      name: formData.cardholderName,
      last4: formData.cardNumber.slice(-4),
      brand: formData.cardNumber.startsWith('4') ? 'Visa' : 'Mastercard',
      expiryDate: `${formData.expiryMonth}/${formData.expiryYear}`,
      isDefault: paymentMethods.length === 0,
    };

    setPaymentMethods(prev => [...prev, newCard]);
    setShowModal(false);
    Alert.alert('Success', 'Card added successfully');
  };

  const handleDeleteMethod = (id: string) => {
    const method = paymentMethods.find(m => m.id === id);
    if (method?.isDefault) {
      Alert.alert('Error', 'Cannot delete default payment method');
      return;
    }

    Alert.alert(
      'Delete Payment Method',
      'Are you sure you want to delete this payment method?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            setPaymentMethods(prev => prev.filter(m => m.id !== id));
          },
        },
      ]
    );
  };

  const handleSetDefault = (id: string) => {
    setPaymentMethods(prev =>
      prev.map(method => ({
        ...method,
        isDefault: method.id === id,
      }))
    );
  };

  const getCardIcon = (brand?: string) => {
    switch (brand) {
      case 'Visa':
        return 'credit-card';
      case 'Mastercard':
        return 'credit-card';
      case 'American Express':
        return 'credit-card';
      default:
        return 'credit-card-outline';
    }
  };

  const getPaymentIcon = (type: string) => {
    switch (type) {
      case 'paypal':
        return 'alpha-p-circle';
      case 'apple_pay':
        return 'apple';
      case 'google_pay':
        return 'google';
      default:
        return 'credit-card';
    }
  };

  const formatCardNumber = (text: string) => {
    const cleaned = text.replace(/\s/g, '');
    const chunks = cleaned.match(/.{1,4}/g) || [];
    return chunks.join(' ');
  };

  const renderPaymentMethod = ({ item }: { item: PaymentMethod }) => (
    <View style={styles.methodCard}>
      <View style={styles.methodHeader}>
        <View style={styles.methodInfo}>
          <Icon
            name={item.type === 'card' ? getCardIcon(item.brand) : getPaymentIcon(item.type)}
            size={32}
            color={item.type === 'paypal' ? '#00457C' : '#007AFF'}
          />
          <View style={styles.methodDetails}>
            {item.type === 'card' ? (
              <>
                <Text style={styles.methodName}>
                  {item.brand} •••• {item.last4}
                </Text>
                <Text style={styles.methodSubtitle}>Expires {item.expiryDate}</Text>
              </>
            ) : (
              <>
                <Text style={styles.methodName}>{item.name}</Text>
                {item.email && (
                  <Text style={styles.methodSubtitle}>{item.email}</Text>
                )}
              </>
            )}
          </View>
        </View>
        {item.isDefault && (
          <View style={styles.defaultBadge}>
            <Text style={styles.defaultText}>Default</Text>
          </View>
        )}
      </View>

      <View style={styles.methodActions}>
        {!item.isDefault && (
          <TouchableOpacity
            style={styles.actionButton}
            onPress={() => handleSetDefault(item.id)}
          >
            <Icon name="check-circle-outline" size={18} color="#007AFF" />
            <Text style={styles.actionText}>Set Default</Text>
          </TouchableOpacity>
        )}
        
        <TouchableOpacity
          style={styles.actionButton}
          onPress={() => handleDeleteMethod(item.id)}
        >
          <Icon name="delete-outline" size={18} color="#EF4444" />
          <Text style={[styles.actionText, { color: '#EF4444' }]}>Remove</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  return (
    <View style={styles.container}>
      <FlatList
        data={paymentMethods}
        renderItem={renderPaymentMethod}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Icon name="credit-card-off" size={64} color="#D1D5DB" />
            <Text style={styles.emptyTitle}>No payment methods</Text>
            <Text style={styles.emptySubtitle}>
              Add a payment method for faster checkout
            </Text>
          </View>
        }
      />

      {/* Other Payment Options */}
      <View style={styles.otherOptions}>
        <Text style={styles.sectionTitle}>Other Payment Options</Text>
        
        <TouchableOpacity style={styles.optionButton}>
          <Icon name="apple" size={24} color="#000000" />
          <Text style={styles.optionText}>Add Apple Pay</Text>
          <Icon name="chevron-right" size={24} color="#9CA3AF" />
        </TouchableOpacity>
        
        <TouchableOpacity style={styles.optionButton}>
          <Icon name="google" size={24} color="#4285F4" />
          <Text style={styles.optionText}>Add Google Pay</Text>
          <Icon name="chevron-right" size={24} color="#9CA3AF" />
        </TouchableOpacity>
        
        <TouchableOpacity style={styles.optionButton}>
          <Icon name="cash" size={24} color="#10B981" />
          <Text style={styles.optionText}>Cash on Delivery</Text>
          <Icon name="chevron-right" size={24} color="#9CA3AF" />
        </TouchableOpacity>
      </View>

      <TouchableOpacity style={styles.addButton} onPress={handleAddCard}>
        <Icon name="plus" size={24} color="#FFFFFF" />
        <Text style={styles.addButtonText}>Add New Card</Text>
      </TouchableOpacity>

      {/* Add Card Modal */}
      <Modal
        visible={showModal}
        animationType="slide"
        transparent
        onRequestClose={() => setShowModal(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.modalContainer}
        >
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Add New Card</Text>
              <TouchableOpacity onPress={() => setShowModal(false)}>
                <Icon name="close" size={24} color="#6B7280" />
              </TouchableOpacity>
            </View>

            {/* Card Number */}
            <Text style={styles.inputLabel}>Card Number</Text>
            <TextInput
              style={styles.input}
              placeholder="1234 5678 9012 3456"
              value={formatCardNumber(formData.cardNumber)}
              onChangeText={(text) => {
                const cleaned = text.replace(/\s/g, '');
                if (cleaned.length <= 16 && /^\d*$/.test(cleaned)) {
                  setFormData(prev => ({ ...prev, cardNumber: cleaned }));
                }
              }}
              keyboardType="numeric"
              maxLength={19}
              placeholderTextColor="#9CA3AF"
            />

            {/* Cardholder Name */}
            <Text style={styles.inputLabel}>Cardholder Name</Text>
            <TextInput
              style={styles.input}
              placeholder="John Doe"
              value={formData.cardholderName}
              onChangeText={(text) => setFormData(prev => ({ ...prev, cardholderName: text }))}
              autoCapitalize="words"
              placeholderTextColor="#9CA3AF"
            />

            {/* Expiry and CVV */}
            <View style={styles.row}>
              <View style={styles.halfInput}>
                <Text style={styles.inputLabel}>Expiry Date</Text>
                <View style={styles.expiryContainer}>
                  <TextInput
                    style={[styles.input, styles.expiryInput]}
                    placeholder="MM"
                    value={formData.expiryMonth}
                    onChangeText={(text) => {
                      if (text.length <= 2 && /^\d*$/.test(text)) {
                        setFormData(prev => ({ ...prev, expiryMonth: text }));
                      }
                    }}
                    keyboardType="numeric"
                    maxLength={2}
                    placeholderTextColor="#9CA3AF"
                  />
                  <Text style={styles.expirySeparator}>/</Text>
                  <TextInput
                    style={[styles.input, styles.expiryInput]}
                    placeholder="YY"
                    value={formData.expiryYear}
                    onChangeText={(text) => {
                      if (text.length <= 2 && /^\d*$/.test(text)) {
                        setFormData(prev => ({ ...prev, expiryYear: text }));
                      }
                    }}
                    keyboardType="numeric"
                    maxLength={2}
                    placeholderTextColor="#9CA3AF"
                  />
                </View>
              </View>
              
              <View style={styles.halfInput}>
                <Text style={styles.inputLabel}>CVV</Text>
                <TextInput
                  style={styles.input}
                  placeholder="123"
                  value={formData.cvv}
                  onChangeText={(text) => {
                    if (text.length <= 3 && /^\d*$/.test(text)) {
                      setFormData(prev => ({ ...prev, cvv: text }));
                    }
                  }}
                  keyboardType="numeric"
                  maxLength={3}
                  secureTextEntry
                  placeholderTextColor="#9CA3AF"
                />
              </View>
            </View>

            {/* Security Notice */}
            <View style={styles.securityNotice}>
              <Icon name="lock" size={16} color="#10B981" />
              <Text style={styles.securityText}>
                Your payment information is encrypted and secure
              </Text>
            </View>

            {/* Action Buttons */}
            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.cancelButton}
                onPress={() => setShowModal(false)}
              >
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.saveButton}
                onPress={handleSaveCard}
              >
                <Text style={styles.saveButtonText}>Save Card</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F9FAFB',
  },
  listContent: {
    padding: 16,
  },
  methodCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 2,
  },
  methodHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  methodInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  methodDetails: {
    marginLeft: 12,
    flex: 1,
  },
  methodName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#111827',
  },
  methodSubtitle: {
    fontSize: 14,
    color: '#6B7280',
    marginTop: 2,
  },
  defaultBadge: {
    backgroundColor: '#E6F2FF',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  defaultText: {
    fontSize: 12,
    fontWeight: '500',
    color: '#007AFF',
  },
  methodActions: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: '#E5E7EB',
    paddingTop: 12,
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: 20,
  },
  actionText: {
    fontSize: 14,
    color: '#007AFF',
    marginLeft: 4,
  },
  otherOptions: {
    backgroundColor: '#FFFFFF',
    paddingVertical: 16,
    marginBottom: 100,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#374151',
    paddingHorizontal: 16,
    marginBottom: 12,
  },
  optionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 16,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  optionText: {
    flex: 1,
    fontSize: 16,
    color: '#111827',
    marginLeft: 12,
  },
  emptyContainer: {
    alignItems: 'center',
    paddingVertical: 64,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#374151',
    marginTop: 16,
  },
  emptySubtitle: {
    fontSize: 16,
    color: '#6B7280',
    marginTop: 8,
    textAlign: 'center',
  },
  addButton: {
    position: 'absolute',
    bottom: 20,
    left: 20,
    right: 20,
    flexDirection: 'row',
    backgroundColor: '#007AFF',
    paddingVertical: 16,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 5,
  },
  addButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
    marginLeft: 8,
  },
  modalContainer: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  modalContent: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    maxHeight: '90%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 24,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: '#111827',
  },
  inputLabel: {
    fontSize: 14,
    fontWeight: '500',
    color: '#374151',
    marginBottom: 8,
    marginTop: 16,
  },
  input: {
    backgroundColor: '#F3F4F6',
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    color: '#111827',
  },
  row: {
    flexDirection: 'row',
    marginHorizontal: -8,
  },
  halfInput: {
    flex: 1,
    marginHorizontal: 8,
  },
  expiryContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  expiryInput: {
    flex: 1,
  },
  expirySeparator: {
    fontSize: 16,
    color: '#6B7280',
    marginHorizontal: 8,
  },
  securityNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F0FDF4',
    padding: 12,
    borderRadius: 8,
    marginTop: 16,
  },
  securityText: {
    fontSize: 14,
    color: '#10B981',
    marginLeft: 8,
    flex: 1,
  },
  modalActions: {
    flexDirection: 'row',
    marginTop: 24,
  },
  cancelButton: {
    flex: 1,
    paddingVertical: 14,
    alignItems: 'center',
    marginRight: 8,
  },
  cancelButtonText: {
    fontSize: 16,
    fontWeight: '500',
    color: '#6B7280',
  },
  saveButton: {
    flex: 1,
    backgroundColor: '#007AFF',
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: 'center',
    marginLeft: 8,
  },
  saveButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
  },
});