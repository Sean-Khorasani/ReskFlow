import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Switch,
  Alert,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useNavigation } from '@react-navigation/native';
import { useAuth } from '../contexts/AuthContext';
import { colors } from '../theme';

interface MenuItem {
  icon: string;
  title: string;
  subtitle?: string;
  onPress?: () => void;
  hasSwitch?: boolean;
  switchValue?: boolean;
  onSwitchChange?: (value: boolean) => void;
}

export default function ProfileScreen() {
  const navigation = useNavigation();
  const { user, logout } = useAuth();
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const [soundEnabled, setSoundEnabled] = useState(true);

  const handleLogout = () => {
    Alert.alert(
      'Logout',
      'Are you sure you want to logout?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Logout',
          style: 'destructive',
          onPress: () => logout(),
        },
      ],
      { cancelable: true }
    );
  };

  const accountItems: MenuItem[] = [
    {
      icon: 'account-edit',
      title: 'Edit Profile',
      subtitle: 'Update your personal information',
      onPress: () => console.log('Edit Profile'),
    },
    {
      icon: 'car',
      title: 'Vehicle Information',
      subtitle: 'Update vehicle and insurance details',
      onPress: () => console.log('Vehicle Info'),
    },
    {
      icon: 'file-document',
      title: 'Documents',
      subtitle: 'Manage your documents',
      onPress: () => console.log('Documents'),
    },
    {
      icon: 'bank',
      title: 'Bank Account',
      subtitle: 'Manage payout methods',
      onPress: () => console.log('Bank Account'),
    },
  ];

  const preferencesItems: MenuItem[] = [
    {
      icon: 'bell',
      title: 'Push Notifications',
      hasSwitch: true,
      switchValue: notificationsEnabled,
      onSwitchChange: setNotificationsEnabled,
    },
    {
      icon: 'volume-high',
      title: 'Sound Alerts',
      hasSwitch: true,
      switchValue: soundEnabled,
      onSwitchChange: setSoundEnabled,
    },
    {
      icon: 'map-marker-radius',
      title: 'Delivery Zones',
      subtitle: 'Set your preferred reskflow areas',
      onPress: () => console.log('Delivery Zones'),
    },
  ];

  const supportItems: MenuItem[] = [
    {
      icon: 'help-circle',
      title: 'Help Center',
      onPress: () => console.log('Help Center'),
    },
    {
      icon: 'message-text',
      title: 'Contact Support',
      onPress: () => console.log('Contact Support'),
    },
    {
      icon: 'shield-check',
      title: 'Safety Center',
      onPress: () => console.log('Safety Center'),
    },
    {
      icon: 'information',
      title: 'About',
      onPress: () => console.log('About'),
    },
  ];

  const renderMenuItem = (item: MenuItem, index: number) => (
    <TouchableOpacity
      key={index}
      style={styles.menuItem}
      onPress={item.onPress}
      disabled={item.hasSwitch}
    >
      <View style={styles.menuItemLeft}>
        <View style={styles.iconContainer}>
          <Icon name={item.icon} size={24} color={colors.gray700} />
        </View>
        <View style={styles.menuItemContent}>
          <Text style={styles.menuItemTitle}>{item.title}</Text>
          {item.subtitle && (
            <Text style={styles.menuItemSubtitle}>{item.subtitle}</Text>
          )}
        </View>
      </View>
      {item.hasSwitch ? (
        <Switch
          value={item.switchValue}
          onValueChange={item.onSwitchChange}
          trackColor={{ false: colors.gray300, true: colors.primary }}
          thumbColor={colors.white}
        />
      ) : (
        <Icon name="chevron-right" size={24} color={colors.gray400} />
      )}
    </TouchableOpacity>
  );

  return (
    <ScrollView style={styles.container}>
      {/* Profile Header */}
      <View style={styles.header}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>
            {user?.name?.charAt(0).toUpperCase() || 'D'}
          </Text>
        </View>
        <Text style={styles.name}>{user?.name || 'Driver'}</Text>
        <Text style={styles.email}>{user?.email}</Text>
        <View style={styles.statsRow}>
          <View style={styles.stat}>
            <Text style={styles.statValue}>4.92</Text>
            <Text style={styles.statLabel}>Rating</Text>
          </View>
          <View style={styles.stat}>
            <Text style={styles.statValue}>1,234</Text>
            <Text style={styles.statLabel}>Deliveries</Text>
          </View>
          <View style={styles.stat}>
            <Text style={styles.statValue}>98%</Text>
            <Text style={styles.statLabel}>Acceptance</Text>
          </View>
        </View>
      </View>

      {/* Menu Sections */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Account</Text>
        {accountItems.map(renderMenuItem)}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Preferences</Text>
        {preferencesItems.map(renderMenuItem)}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Support</Text>
        {supportItems.map(renderMenuItem)}
      </View>

      {/* Logout Button */}
      <TouchableOpacity style={styles.logoutButton} onPress={handleLogout}>
        <Icon name="logout" size={24} color={colors.error} />
        <Text style={styles.logoutText}>Logout</Text>
      </TouchableOpacity>

      <View style={styles.footer}>
        <Text style={styles.version}>Version 1.0.0</Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.gray50,
  },
  header: {
    backgroundColor: colors.white,
    padding: 24,
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: colors.gray200,
  },
  avatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  avatarText: {
    fontSize: 32,
    fontWeight: '600',
    color: colors.white,
  },
  name: {
    fontSize: 24,
    fontWeight: '600',
    color: colors.gray900,
    marginBottom: 4,
  },
  email: {
    fontSize: 16,
    color: colors.gray600,
    marginBottom: 24,
  },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    width: '100%',
  },
  stat: {
    alignItems: 'center',
  },
  statValue: {
    fontSize: 20,
    fontWeight: '600',
    color: colors.gray900,
  },
  statLabel: {
    fontSize: 14,
    color: colors.gray600,
    marginTop: 4,
  },
  section: {
    backgroundColor: colors.white,
    marginTop: 16,
    paddingVertical: 8,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.gray500,
    textTransform: 'uppercase',
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: 16,
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
    backgroundColor: colors.gray100,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  menuItemContent: {
    flex: 1,
  },
  menuItemTitle: {
    fontSize: 16,
    color: colors.gray900,
  },
  menuItemSubtitle: {
    fontSize: 14,
    color: colors.gray600,
    marginTop: 2,
  },
  logoutButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.white,
    marginTop: 16,
    paddingVertical: 16,
  },
  logoutText: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.error,
    marginLeft: 8,
  },
  footer: {
    paddingVertical: 24,
    alignItems: 'center',
  },
  version: {
    fontSize: 14,
    color: colors.gray500,
  },
});