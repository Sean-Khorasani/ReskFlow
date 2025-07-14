import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useAuth } from '../contexts/AuthContext';
import { colors } from '../theme';
import api from '../services/api';

interface EarningsData {
  today: {
    earnings: number;
    deliveries: number;
    hours: number;
    tips: number;
  };
  week: {
    earnings: number;
    deliveries: number;
    hours: number;
    tips: number;
  };
  lifetime: {
    earnings: number;
    deliveries: number;
    rating: number;
  };
  recentDeliveries: Array<{
    id: string;
    date: string;
    earnings: number;
    tip: number;
    distance: number;
    duration: number;
    customerName: string;
    merchantName: string;
  }>;
}

export default function EarningsScreen() {
  const { user } = useAuth();
  const [selectedPeriod, setSelectedPeriod] = useState<'today' | 'week'>('today');
  const [earnings, setEarnings] = useState<EarningsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    fetchEarnings();
  }, []);

  const fetchEarnings = async () => {
    try {
      const response = await api.get('/driver/earnings');
      setEarnings(response.data);
    } catch (error) {
      console.error('Failed to fetch earnings:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const onRefresh = () => {
    setRefreshing(true);
    fetchEarnings();
  };

  const formatCurrency = (amount: number) => {
    return `$${amount.toFixed(2)}`;
  };

  const formatDuration = (minutes: number) => {
    if (minutes < 60) {
      return `${minutes} min`;
    }
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `${hours}h ${mins}m`;
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <Text>Loading earnings...</Text>
      </View>
    );
  }

  if (!earnings) {
    return (
      <View style={styles.errorContainer}>
        <Text>Unable to load earnings data</Text>
      </View>
    );
  }

  const currentPeriodData = selectedPeriod === 'today' ? earnings.today : earnings.week;

  return (
    <ScrollView
      style={styles.container}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
      }
    >
      {/* Period Selector */}
      <View style={styles.periodSelector}>
        <TouchableOpacity
          style={[
            styles.periodButton,
            selectedPeriod === 'today' && styles.periodButtonActive,
          ]}
          onPress={() => setSelectedPeriod('today')}
        >
          <Text
            style={[
              styles.periodButtonText,
              selectedPeriod === 'today' && styles.periodButtonTextActive,
            ]}
          >
            Today
          </Text>
        </TouchableOpacity>
        
        <TouchableOpacity
          style={[
            styles.periodButton,
            selectedPeriod === 'week' && styles.periodButtonActive,
          ]}
          onPress={() => setSelectedPeriod('week')}
        >
          <Text
            style={[
              styles.periodButtonText,
              selectedPeriod === 'week' && styles.periodButtonTextActive,
            ]}
          >
            This Week
          </Text>
        </TouchableOpacity>
      </View>

      {/* Earnings Summary */}
      <View style={styles.earningsCard}>
        <Text style={styles.earningsLabel}>
          {selectedPeriod === 'today' ? "Today's Earnings" : "This Week's Earnings"}
        </Text>
        <Text style={styles.earningsAmount}>
          {formatCurrency(currentPeriodData.earnings)}
        </Text>
        {currentPeriodData.tips > 0 && (
          <Text style={styles.tipsText}>
            Includes {formatCurrency(currentPeriodData.tips)} in tips
          </Text>
        )}
      </View>

      {/* Stats Grid */}
      <View style={styles.statsGrid}>
        <View style={styles.statCard}>
          <Icon name="truck-reskflow" size={24} color={colors.primary} />
          <Text style={styles.statValue}>{currentPeriodData.deliveries}</Text>
          <Text style={styles.statLabel}>Deliveries</Text>
        </View>
        
        <View style={styles.statCard}>
          <Icon name="clock-outline" size={24} color={colors.primary} />
          <Text style={styles.statValue}>{currentPeriodData.hours}h</Text>
          <Text style={styles.statLabel}>Hours Online</Text>
        </View>
        
        <View style={styles.statCard}>
          <Icon name="cash" size={24} color={colors.primary} />
          <Text style={styles.statValue}>
            {currentPeriodData.hours > 0
              ? formatCurrency(currentPeriodData.earnings / currentPeriodData.hours)
              : '$0.00'}
          </Text>
          <Text style={styles.statLabel}>Per Hour</Text>
        </View>
      </View>

      {/* Lifetime Stats */}
      <View style={styles.lifetimeCard}>
        <Text style={styles.sectionTitle}>Lifetime Stats</Text>
        <View style={styles.lifetimeStats}>
          <View style={styles.lifetimeStat}>
            <Text style={styles.lifetimeValue}>
              {formatCurrency(earnings.lifetime.earnings)}
            </Text>
            <Text style={styles.lifetimeLabel}>Total Earnings</Text>
          </View>
          
          <View style={styles.lifetimeStat}>
            <Text style={styles.lifetimeValue}>
              {earnings.lifetime.deliveries}
            </Text>
            <Text style={styles.lifetimeLabel}>Total Deliveries</Text>
          </View>
          
          <View style={styles.lifetimeStat}>
            <View style={styles.ratingContainer}>
              <Text style={styles.lifetimeValue}>
                {earnings.lifetime.rating.toFixed(1)}
              </Text>
              <Icon name="star" size={20} color={colors.warning} />
            </View>
            <Text style={styles.lifetimeLabel}>Average Rating</Text>
          </View>
        </View>
      </View>

      {/* Recent Deliveries */}
      <View style={styles.recentSection}>
        <Text style={styles.sectionTitle}>Recent Deliveries</Text>
        {earnings.recentDeliveries.map((reskflow) => (
          <View key={reskflow.id} style={styles.reskflowCard}>
            <View style={styles.reskflowHeader}>
              <Text style={styles.reskflowDate}>
                {new Date(reskflow.date).toLocaleDateString()}
              </Text>
              <Text style={styles.reskflowEarnings}>
                {formatCurrency(reskflow.earnings)}
              </Text>
            </View>
            
            <View style={styles.reskflowDetails}>
              <Text style={styles.reskflowRoute}>
                {reskflow.merchantName} → {reskflow.customerName}
              </Text>
              <View style={styles.reskflowStats}>
                <View style={styles.reskflowStat}>
                  <Icon name="map-marker-distance" size={16} color={colors.gray600} />
                  <Text style={styles.reskflowStatText}>
                    {reskflow.distance.toFixed(1)} mi
                  </Text>
                </View>
                
                <View style={styles.reskflowStat}>
                  <Icon name="clock-outline" size={16} color={colors.gray600} />
                  <Text style={styles.reskflowStatText}>
                    {formatDuration(reskflow.duration)}
                  </Text>
                </View>
                
                {reskflow.tip > 0 && (
                  <View style={styles.reskflowStat}>
                    <Icon name="cash" size={16} color={colors.success} />
                    <Text style={[styles.reskflowStatText, { color: colors.success }]}>
                      +{formatCurrency(reskflow.tip)} tip
                    </Text>
                  </View>
                )}
              </View>
            </View>
          </View>
        ))}
      </View>

      {/* Payout Info */}
      <View style={styles.payoutCard}>
        <Icon name="information" size={20} color={colors.primary} />
        <Text style={styles.payoutText}>
          Earnings are deposited to your account every Tuesday
        </Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.gray50,
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
  periodSelector: {
    flexDirection: 'row',
    padding: 16,
    backgroundColor: colors.white,
  },
  periodButton: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
    borderRadius: 8,
    marginHorizontal: 4,
  },
  periodButtonActive: {
    backgroundColor: colors.primary,
  },
  periodButtonText: {
    fontSize: 16,
    fontWeight: '500',
    color: colors.gray700,
  },
  periodButtonTextActive: {
    color: colors.white,
  },
  earningsCard: {
    backgroundColor: colors.white,
    padding: 24,
    alignItems: 'center',
    marginBottom: 16,
  },
  earningsLabel: {
    fontSize: 16,
    color: colors.gray600,
    marginBottom: 8,
  },
  earningsAmount: {
    fontSize: 48,
    fontWeight: '700',
    color: colors.gray900,
  },
  tipsText: {
    fontSize: 14,
    color: colors.success,
    marginTop: 4,
  },
  statsGrid: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    marginBottom: 16,
  },
  statCard: {
    flex: 1,
    backgroundColor: colors.white,
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
    marginHorizontal: 4,
  },
  statValue: {
    fontSize: 24,
    fontWeight: '600',
    color: colors.gray900,
    marginTop: 8,
  },
  statLabel: {
    fontSize: 12,
    color: colors.gray600,
    marginTop: 4,
  },
  lifetimeCard: {
    backgroundColor: colors.white,
    padding: 20,
    marginHorizontal: 16,
    borderRadius: 12,
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.gray900,
    marginBottom: 16,
  },
  lifetimeStats: {
    flexDirection: 'row',
    justifyContent: 'space-around',
  },
  lifetimeStat: {
    alignItems: 'center',
  },
  lifetimeValue: {
    fontSize: 20,
    fontWeight: '600',
    color: colors.gray900,
  },
  lifetimeLabel: {
    fontSize: 12,
    color: colors.gray600,
    marginTop: 4,
  },
  ratingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  recentSection: {
    paddingHorizontal: 16,
    marginBottom: 16,
  },
  reskflowCard: {
    backgroundColor: colors.white,
    padding: 16,
    borderRadius: 12,
    marginBottom: 8,
  },
  reskflowHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  reskflowDate: {
    fontSize: 12,
    color: colors.gray600,
  },
  reskflowEarnings: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.gray900,
  },
  reskflowDetails: {
    gap: 8,
  },
  reskflowRoute: {
    fontSize: 14,
    color: colors.gray800,
  },
  reskflowStats: {
    flexDirection: 'row',
    gap: 16,
  },
  reskflowStat: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  reskflowStatText: {
    fontSize: 12,
    color: colors.gray600,
  },
  payoutCard: {
    flexDirection: 'row',
    backgroundColor: colors.primaryLight,
    padding: 16,
    marginHorizontal: 16,
    marginBottom: 24,
    borderRadius: 12,
    alignItems: 'center',
  },
  payoutText: {
    fontSize: 14,
    color: colors.primary,
    marginLeft: 12,
    flex: 1,
  },
});