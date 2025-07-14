import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  RefreshControl,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { colors } from '../theme';
import api from '../services/api';

interface Delivery {
  id: string;
  orderId: string;
  date: string;
  customerName: string;
  merchantName: string;
  status: 'completed' | 'cancelled';
  earnings: number;
  tip: number;
  distance: number;
  duration: number;
  rating?: number;
}

export default function DeliveryHistoryScreen() {
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<'all' | 'completed' | 'cancelled'>('all');

  useEffect(() => {
    fetchDeliveries();
  }, [filter]);

  const fetchDeliveries = async () => {
    try {
      const response = await api.get('/driver/deliveries', {
        params: { status: filter === 'all' ? undefined : filter },
      });
      setDeliveries(response.data.deliveries);
    } catch (error) {
      console.error('Failed to fetch deliveries:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const onRefresh = () => {
    setRefreshing(true);
    fetchDeliveries();
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  const formatTime = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  };

  const formatDuration = (minutes: number) => {
    if (minutes < 60) {
      return `${minutes}m`;
    }
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `${hours}h ${mins}m`;
  };

  const renderDelivery = ({ item }: { item: Delivery }) => (
    <TouchableOpacity style={styles.reskflowCard}>
      <View style={styles.reskflowHeader}>
        <View>
          <Text style={styles.orderId}>Order #{item.orderId.slice(-6).toUpperCase()}</Text>
          <Text style={styles.reskflowDate}>
            {formatDate(item.date)} at {formatTime(item.date)}
          </Text>
        </View>
        <View style={styles.earningsContainer}>
          <Text style={styles.earnings}>${item.earnings.toFixed(2)}</Text>
          {item.tip > 0 && (
            <Text style={styles.tip}>+${item.tip.toFixed(2)} tip</Text>
          )}
        </View>
      </View>

      <View style={styles.reskflowRoute}>
        <View style={styles.routePoint}>
          <Icon name="store" size={16} color={colors.gray600} />
          <Text style={styles.routeText} numberOfLines={1}>
            {item.merchantName}
          </Text>
        </View>
        <Icon name="arrow-down" size={16} color={colors.gray400} />
        <View style={styles.routePoint}>
          <Icon name="home" size={16} color={colors.gray600} />
          <Text style={styles.routeText} numberOfLines={1}>
            {item.customerName}
          </Text>
        </View>
      </View>

      <View style={styles.reskflowStats}>
        <View style={styles.stat}>
          <Icon name="map-marker-distance" size={16} color={colors.gray500} />
          <Text style={styles.statText}>{item.distance.toFixed(1)} mi</Text>
        </View>
        <View style={styles.stat}>
          <Icon name="clock-outline" size={16} color={colors.gray500} />
          <Text style={styles.statText}>{formatDuration(item.duration)}</Text>
        </View>
        {item.rating && (
          <View style={styles.stat}>
            <Icon name="star" size={16} color={colors.warning} />
            <Text style={styles.statText}>{item.rating.toFixed(1)}</Text>
          </View>
        )}
        {item.status === 'cancelled' && (
          <View style={[styles.statusBadge, styles.cancelledBadge]}>
            <Text style={styles.cancelledText}>Cancelled</Text>
          </View>
        )}
      </View>
    </TouchableOpacity>
  );

  const renderEmpty = () => (
    <View style={styles.emptyContainer}>
      <Icon name="truck-reskflow-outline" size={80} color={colors.gray400} />
      <Text style={styles.emptyTitle}>No deliveries yet</Text>
      <Text style={styles.emptySubtitle}>
        Your completed deliveries will appear here
      </Text>
    </View>
  );

  const renderHeader = () => (
    <View style={styles.filterContainer}>
      <TouchableOpacity
        style={[styles.filterButton, filter === 'all' && styles.filterButtonActive]}
        onPress={() => setFilter('all')}
      >
        <Text style={[styles.filterText, filter === 'all' && styles.filterTextActive]}>
          All
        </Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={[styles.filterButton, filter === 'completed' && styles.filterButtonActive]}
        onPress={() => setFilter('completed')}
      >
        <Text style={[styles.filterText, filter === 'completed' && styles.filterTextActive]}>
          Completed
        </Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={[styles.filterButton, filter === 'cancelled' && styles.filterButtonActive]}
        onPress={() => setFilter('cancelled')}
      >
        <Text style={[styles.filterText, filter === 'cancelled' && styles.filterTextActive]}>
          Cancelled
        </Text>
      </TouchableOpacity>
    </View>
  );

  return (
    <View style={styles.container}>
      <FlatList
        data={deliveries}
        renderItem={renderDelivery}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        ListHeaderComponent={renderHeader}
        ListEmptyComponent={renderEmpty}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.gray50,
  },
  listContent: {
    flexGrow: 1,
  },
  filterContainer: {
    flexDirection: 'row',
    padding: 16,
    backgroundColor: colors.white,
    borderBottomWidth: 1,
    borderBottomColor: colors.gray200,
  },
  filterButton: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    marginHorizontal: 4,
    borderRadius: 8,
  },
  filterButtonActive: {
    backgroundColor: colors.primary,
  },
  filterText: {
    fontSize: 14,
    fontWeight: '500',
    color: colors.gray700,
  },
  filterTextActive: {
    color: colors.white,
  },
  reskflowCard: {
    backgroundColor: colors.white,
    marginHorizontal: 16,
    marginVertical: 8,
    padding: 16,
    borderRadius: 12,
    ...Platform.select({
      ios: {
        shadowColor: colors.black,
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.05,
        shadowRadius: 4,
      },
      android: {
        elevation: 2,
      },
    }),
  },
  reskflowHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  orderId: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.gray900,
  },
  reskflowDate: {
    fontSize: 14,
    color: colors.gray600,
    marginTop: 2,
  },
  earningsContainer: {
    alignItems: 'flex-end',
  },
  earnings: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.gray900,
  },
  tip: {
    fontSize: 14,
    color: colors.success,
    marginTop: 2,
  },
  reskflowRoute: {
    backgroundColor: colors.gray50,
    padding: 12,
    borderRadius: 8,
    marginBottom: 12,
  },
  routePoint: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 4,
  },
  routeText: {
    fontSize: 14,
    color: colors.gray700,
    marginLeft: 8,
    flex: 1,
  },
  reskflowStats: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  stat: {
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: 16,
  },
  statText: {
    fontSize: 12,
    color: colors.gray600,
    marginLeft: 4,
  },
  statusBadge: {
    marginLeft: 'auto',
  },
  cancelledBadge: {
    backgroundColor: colors.errorLight,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
  },
  cancelledText: {
    fontSize: 12,
    fontWeight: '500',
    color: colors.error,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 60,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.gray900,
    marginTop: 16,
  },
  emptySubtitle: {
    fontSize: 16,
    color: colors.gray600,
    marginTop: 8,
  },
});