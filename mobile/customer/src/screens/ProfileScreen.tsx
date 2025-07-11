import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Image,
  Alert,
  Switch,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useAuth } from '../contexts/AuthContext';

interface MenuItem {
  icon: string;
  title: string;
  subtitle?: string;
  action: () => void;
  showArrow?: boolean;
  showSwitch?: boolean;
  value?: boolean;
}

export default function ProfileScreen() {
  const navigation = useNavigation();
  const { user, logout } = useAuth();
  const [notifications, setNotifications] = useState(true);
  const [promotions, setPromotions] = useState(true);

  const handleLogout = () => {
    Alert.alert(
      'Logout',
      'Are you sure you want to logout?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Logout',
          style: 'destructive',
          onPress: async () => {
            await logout();
            navigation.navigate('Login' as never);
          },
        },
      ]
    );
  };

  const menuSections = [
    {
      title: 'Account',
      items: [
        {
          icon: 'map-marker',
          title: 'Delivery Addresses',
          subtitle: 'Manage your addresses',
          action: () => navigation.navigate('Address' as never),
          showArrow: true,
        },
        {
          icon: 'credit-card',
          title: 'Payment Methods',
          subtitle: 'Manage payment options',
          action: () => navigation.navigate('PaymentMethods' as never),
          showArrow: true,
        },
        {
          icon: 'receipt',
          title: 'Order History',
          subtitle: 'View past orders',
          action: () => navigation.navigate('Orders' as never),
          showArrow: true,
        },
      ],
    },
    {
      title: 'Preferences',
      items: [
        {
          icon: 'bell',
          title: 'Push Notifications',
          action: () => setNotifications(!notifications),
          showSwitch: true,
          value: notifications,
        },
        {
          icon: 'tag',
          title: 'Promotional Emails',
          action: () => setPromotions(!promotions),
          showSwitch: true,
          value: promotions,
        },
      ],
    },
    {
      title: 'Support',
      items: [
        {
          icon: 'help-circle',
          title: 'Help Center',
          action: () => Alert.alert('Help', 'Opening help center...'),
          showArrow: true,
        },
        {
          icon: 'message-text',
          title: 'Contact Support',
          action: () => Alert.alert('Support', 'Opening support chat...'),
          showArrow: true,
        },
        {
          icon: 'information',
          title: 'About ReskFlow',
          action: () => Alert.alert('About', 'ReskFlow v1.0.0'),
          showArrow: true,
        },
      ],
    },
    {
      title: 'Legal',
      items: [
        {
          icon: 'file-document',
          title: 'Terms of Service',
          action: () => Alert.alert('Terms', 'Opening terms...'),
          showArrow: true,
        },
        {
          icon: 'shield-check',
          title: 'Privacy Policy',
          action: () => Alert.alert('Privacy', 'Opening privacy policy...'),
          showArrow: true,
        },
      ],
    },
  ];

  const renderMenuItem = (item: MenuItem) => (
    <TouchableOpacity
      key={item.title}
      style={styles.menuItem}
      onPress={item.action}
      disabled={item.showSwitch}
    >
      <View style={styles.menuItemLeft}>
        <View style={styles.iconContainer}>
          <Icon name={item.icon} size={24} color="#007AFF" />
        </View>
        <View style={styles.menuItemContent}>
          <Text style={styles.menuItemTitle}>{item.title}</Text>
          {item.subtitle && (
            <Text style={styles.menuItemSubtitle}>{item.subtitle}</Text>
          )}
        </View>
      </View>
      {item.showArrow && (
        <Icon name="chevron-right" size={24} color="#9CA3AF" />
      )}
      {item.showSwitch && (
        <Switch
          value={item.value}
          onValueChange={item.action}
          trackColor={{ false: '#D1D5DB', true: '#93C5FD' }}
          thumbColor={item.value ? '#007AFF' : '#F3F4F6'}
        />
      )}
    </TouchableOpacity>
  );

  return (
    <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
      {/* Profile Header */}
      <View style={styles.header}>
        <Image
          source={{ uri: user?.avatar || 'https://via.placeholder.com/100' }}
          style={styles.avatar}
        />
        <Text style={styles.name}>{user?.name || 'Guest User'}</Text>
        <Text style={styles.email}>{user?.email || 'guest@example.com'}</Text>
        <TouchableOpacity style={styles.editButton}>
          <Icon name="pencil" size={16} color="#007AFF" />
          <Text style={styles.editButtonText}>Edit Profile</Text>
        </TouchableOpacity>
      </View>

      {/* Menu Sections */}
      {menuSections.map((section) => (
        <View key={section.title} style={styles.section}>
          <Text style={styles.sectionTitle}>{section.title}</Text>
          <View style={styles.sectionContent}>
            {section.items.map(renderMenuItem)}
          </View>
        </View>
      ))}

      {/* Logout Button */}
      <TouchableOpacity style={styles.logoutButton} onPress={handleLogout}>
        <Icon name="logout" size={20} color="#EF4444" />
        <Text style={styles.logoutText}>Logout</Text>
      </TouchableOpacity>

      {/* Version */}
      <Text style={styles.version}>Version 1.0.0</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F9FAFB',
  },
  header: {
    alignItems: 'center',
    padding: 20,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  avatar: {
    width: 100,
    height: 100,
    borderRadius: 50,
    marginBottom: 16,
  },
  name: {
    fontSize: 24,
    fontWeight: '600',
    color: '#111827',
    marginBottom: 4,
  },
  email: {
    fontSize: 16,
    color: '#6B7280',
    marginBottom: 16,
  },
  editButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: '#E6F2FF',
    borderRadius: 20,
  },
  editButtonText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#007AFF',
    marginLeft: 6,
  },
  section: {
    marginTop: 24,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#6B7280',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginLeft: 20,
    marginBottom: 8,
  },
  sectionContent: {
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: '#E5E7EB',
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  menuItemLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  iconContainer: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#E6F2FF',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  menuItemContent: {
    flex: 1,
  },
  menuItemTitle: {
    fontSize: 16,
    fontWeight: '500',
    color: '#111827',
  },
  menuItemSubtitle: {
    fontSize: 14,
    color: '#6B7280',
    marginTop: 2,
  },
  logoutButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FEE2E2',
    marginHorizontal: 20,
    marginTop: 32,
    paddingVertical: 14,
    borderRadius: 8,
  },
  logoutText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#EF4444',
    marginLeft: 8,
  },
  version: {
    fontSize: 14,
    color: '#9CA3AF',
    textAlign: 'center',
    marginTop: 20,
    marginBottom: 40,
  },
});