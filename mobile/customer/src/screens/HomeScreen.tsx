import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  Image,
  FlatList,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useQuery } from '@tanstack/react-query';
import Icon from 'react-native-vector-icons/MaterialIcons';
import LinearGradient from 'react-native-linear-gradient';
import { Card, Button, Searchbar } from 'react-native-paper';
import { useAuthStore } from '../stores/authStore';
import { api } from '../services/api';
import { DeliveryCard } from '../components/DeliveryCard';
import { ServiceCard } from '../components/ServiceCard';
import { PromoCard } from '../components/PromoCard';

const services = [
  { id: '1', title: 'Express', icon: 'flash-on', color: '#FF6B6B' },
  { id: '2', title: 'Standard', icon: 'local-shipping', color: '#4ECDC4' },
  { id: '3', title: 'Economy', icon: 'schedule', color: '#45B7D1' },
  { id: '4', title: 'International', icon: 'flight', color: '#96CEB4' },
];

export const HomeScreen: React.FC = () => {
  const navigation = useNavigation();
  const { user } = useAuthStore();
  const [searchQuery, setSearchQuery] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const { data: recentDeliveries, refetch } = useQuery({
    queryKey: ['recentDeliveries'],
    queryFn: () => api.getRecentDeliveries(),
  });

  const { data: promotions } = useQuery({
    queryKey: ['promotions'],
    queryFn: () => api.getPromotions(),
  });

  const onRefresh = async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  };

  const handleTrackDelivery = () => {
    if (searchQuery.trim()) {
      navigation.navigate('TrackingDetails', { trackingNumber: searchQuery });
    }
  };

  return (
    <ScrollView
      style={styles.container}
      showsVerticalScrollIndicator={false}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
      }
    >
      {/* Header */}
      <LinearGradient
        colors={['#4A90E2', '#5BA3F5']}
        style={styles.header}
      >
        <View style={styles.headerContent}>
          <View>
            <Text style={styles.greeting}>Hello, {user?.firstName}!</Text>
            <Text style={styles.subGreeting}>Where would you like to send today?</Text>
          </View>
          <TouchableOpacity
            style={styles.notificationButton}
            onPress={() => navigation.navigate('Notifications')}
          >
            <Icon name="notifications" size={24} color="#fff" />
            <View style={styles.notificationBadge}>
              <Text style={styles.badgeText}>3</Text>
            </View>
          </TouchableOpacity>
        </View>

        {/* Search/Track */}
        <View style={styles.searchContainer}>
          <Searchbar
            placeholder="Track your reskflow"
            onChangeText={setSearchQuery}
            value={searchQuery}
            onSubmitEditing={handleTrackDelivery}
            style={styles.searchBar}
            iconColor="#4A90E2"
          />
        </View>
      </LinearGradient>

      {/* Quick Actions */}
      <View style={styles.quickActions}>
        <TouchableOpacity
          style={styles.actionButton}
          onPress={() => navigation.navigate('SendPackage')}
        >
          <LinearGradient
            colors={['#FF6B6B', '#FF8E53']}
            style={styles.actionGradient}
          >
            <Icon name="send" size={32} color="#fff" />
          </LinearGradient>
          <Text style={styles.actionText}>Send</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.actionButton}
          onPress={() => navigation.navigate('TrackingList')}
        >
          <LinearGradient
            colors={['#4ECDC4', '#44A08D']}
            style={styles.actionGradient}
          >
            <Icon name="location-on" size={32} color="#fff" />
          </LinearGradient>
          <Text style={styles.actionText}>Track</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.actionButton}
          onPress={() => navigation.navigate('Schedule')}
        >
          <LinearGradient
            colors={['#45B7D1', '#2196F3']}
            style={styles.actionGradient}
          >
            <Icon name="event" size={32} color="#fff" />
          </LinearGradient>
          <Text style={styles.actionText}>Schedule</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.actionButton}
          onPress={() => navigation.navigate('Wallet')}
        >
          <LinearGradient
            colors={['#96CEB4', '#74B49B']}
            style={styles.actionGradient}
          >
            <Icon name="account-balance-wallet" size={32} color="#fff" />
          </LinearGradient>
          <Text style={styles.actionText}>Wallet</Text>
        </TouchableOpacity>
      </View>

      {/* Services */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Our Services</Text>
        <FlatList
          horizontal
          showsHorizontalScrollIndicator={false}
          data={services}
          renderItem={({ item }) => (
            <ServiceCard
              service={item}
              onPress={() => navigation.navigate('ServiceDetails', { service: item })}
            />
          )}
          keyExtractor={(item) => item.id}
        />
      </View>

      {/* Promotions */}
      {promotions && promotions.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Special Offers</Text>
          <FlatList
            horizontal
            showsHorizontalScrollIndicator={false}
            data={promotions}
            renderItem={({ item }) => <PromoCard promo={item} />}
            keyExtractor={(item) => item.id}
          />
        </View>
      )}

      {/* Recent Deliveries */}
      {recentDeliveries && recentDeliveries.length > 0 && (
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Recent Deliveries</Text>
            <TouchableOpacity onPress={() => navigation.navigate('DeliveryHistory')}>
              <Text style={styles.seeAll}>See all</Text>
            </TouchableOpacity>
          </View>
          {recentDeliveries.slice(0, 3).map((reskflow: any) => (
            <DeliveryCard
              key={reskflow.id}
              reskflow={reskflow}
              onPress={() => navigation.navigate('DeliveryDetails', { reskflowId: reskflow.id })}
            />
          ))}
        </View>
      )}

      {/* Connect Wallet CTA */}
      {!user?.walletAddress && (
        <Card style={styles.walletCTA}>
          <Card.Content>
            <View style={styles.walletCTAContent}>
              <Icon name="account-balance-wallet" size={48} color="#4A90E2" />
              <View style={styles.walletCTAText}>
                <Text style={styles.walletCTATitle}>Connect Your Wallet</Text>
                <Text style={styles.walletCTASubtitle}>
                  Pay with crypto and earn rewards
                </Text>
              </View>
            </View>
            <Button
              mode="contained"
              onPress={() => navigation.navigate('ConnectWallet')}
              style={styles.connectButton}
            >
              Connect Wallet
            </Button>
          </Card.Content>
        </Card>
      )}
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  header: {
    paddingTop: 50,
    paddingBottom: 30,
    paddingHorizontal: 20,
    borderBottomLeftRadius: 30,
    borderBottomRightRadius: 30,
  },
  headerContent: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  greeting: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#fff',
  },
  subGreeting: {
    fontSize: 16,
    color: '#fff',
    opacity: 0.9,
    marginTop: 5,
  },
  notificationButton: {
    position: 'relative',
  },
  notificationBadge: {
    position: 'absolute',
    top: -5,
    right: -5,
    backgroundColor: '#FF6B6B',
    borderRadius: 10,
    width: 20,
    height: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  badgeText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: 'bold',
  },
  searchContainer: {
    marginTop: 10,
  },
  searchBar: {
    backgroundColor: '#fff',
    elevation: 0,
  },
  quickActions: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingVertical: 30,
    paddingHorizontal: 20,
  },
  actionButton: {
    alignItems: 'center',
  },
  actionGradient: {
    width: 60,
    height: 60,
    borderRadius: 30,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 10,
  },
  actionText: {
    fontSize: 14,
    color: '#333',
    fontWeight: '500',
  },
  section: {
    paddingHorizontal: 20,
    marginBottom: 30,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 15,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#333',
  },
  seeAll: {
    fontSize: 14,
    color: '#4A90E2',
    fontWeight: '500',
  },
  walletCTA: {
    margin: 20,
    marginBottom: 40,
  },
  walletCTAContent: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 20,
  },
  walletCTAText: {
    marginLeft: 20,
    flex: 1,
  },
  walletCTATitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
  },
  walletCTASubtitle: {
    fontSize: 14,
    color: '#666',
    marginTop: 5,
  },
  connectButton: {
    backgroundColor: '#4A90E2',
  },
});