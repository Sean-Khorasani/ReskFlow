'use client';

import React from 'react';
import { Grid, Paper, Typography, Box } from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import {
  LocalShipping,
  People,
  AttachMoney,
  TrendingUp,
  Assignment,
  Speed,
  CheckCircle,
  Cancel,
} from '@mui/icons-material';
import { StatsCard } from '@/components/StatsCard';
import { RevenueChart } from '@/components/charts/RevenueChart';
import { DeliveryStatusChart } from '@/components/charts/DeliveryStatusChart';
import { DriverPerformanceChart } from '@/components/charts/DriverPerformanceChart';
import { RecentDeliveriesTable } from '@/components/tables/RecentDeliveriesTable';
import { ActiveDriversMap } from '@/components/maps/ActiveDriversMap';
import { api } from '@/services/api';

export default function DashboardPage() {
  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ['dashboardStats'],
    queryFn: api.getDashboardStats,
    refetchInterval: 30000, // Refresh every 30 seconds
  });

  const { data: realtimeData } = useQuery({
    queryKey: ['realtimeData'],
    queryFn: api.getRealtimeData,
    refetchInterval: 5000, // Refresh every 5 seconds
  });

  return (
    <Box sx={{ flexGrow: 1, p: 3 }}>
      <Typography variant="h4" gutterBottom>
        Dashboard
      </Typography>

      {/* Stats Cards */}
      <Grid container spacing={3} sx={{ mb: 3 }}>
        <Grid item xs={12} sm={6} md={3}>
          <StatsCard
            title="Total Deliveries"
            value={stats?.totalDeliveries || 0}
            icon={<LocalShipping />}
            color="primary"
            change={stats?.deliveriesChange}
            loading={statsLoading}
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <StatsCard
            title="Active Drivers"
            value={stats?.activeDrivers || 0}
            icon={<People />}
            color="success"
            change={stats?.driversChange}
            loading={statsLoading}
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <StatsCard
            title="Revenue Today"
            value={`$${stats?.todayRevenue?.toFixed(2) || '0.00'}`}
            icon={<AttachMoney />}
            color="warning"
            change={stats?.revenueChange}
            loading={statsLoading}
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <StatsCard
            title="Avg Delivery Time"
            value={`${stats?.avgDeliveryTime || 0} min`}
            icon={<Speed />}
            color="info"
            change={stats?.reskflowTimeChange}
            loading={statsLoading}
          />
        </Grid>
      </Grid>

      {/* Charts Row 1 */}
      <Grid container spacing={3} sx={{ mb: 3 }}>
        <Grid item xs={12} md={8}>
          <Paper sx={{ p: 2, height: 400 }}>
            <Typography variant="h6" gutterBottom>
              Revenue Overview
            </Typography>
            <RevenueChart data={stats?.revenueData} />
          </Paper>
        </Grid>
        <Grid item xs={12} md={4}>
          <Paper sx={{ p: 2, height: 400 }}>
            <Typography variant="h6" gutterBottom>
              Delivery Status Distribution
            </Typography>
            <DeliveryStatusChart data={stats?.statusDistribution} />
          </Paper>
        </Grid>
      </Grid>

      {/* Live Map and Performance */}
      <Grid container spacing={3} sx={{ mb: 3 }}>
        <Grid item xs={12} md={6}>
          <Paper sx={{ p: 2, height: 500 }}>
            <Typography variant="h6" gutterBottom>
              Active Drivers & Deliveries
            </Typography>
            <ActiveDriversMap 
              drivers={realtimeData?.drivers}
              deliveries={realtimeData?.activeDeliveries}
            />
          </Paper>
        </Grid>
        <Grid item xs={12} md={6}>
          <Paper sx={{ p: 2, height: 500 }}>
            <Typography variant="h6" gutterBottom>
              Driver Performance
            </Typography>
            <DriverPerformanceChart data={stats?.driverPerformance} />
          </Paper>
        </Grid>
      </Grid>

      {/* Recent Deliveries */}
      <Paper sx={{ p: 2 }}>
        <Typography variant="h6" gutterBottom>
          Recent Deliveries
        </Typography>
        <RecentDeliveriesTable />
      </Paper>

      {/* Real-time Metrics */}
      <Grid container spacing={3} sx={{ mt: 3 }}>
        <Grid item xs={12} md={4}>
          <Paper sx={{ p: 2 }}>
            <Typography variant="h6" gutterBottom>
              Live Metrics
            </Typography>
            <Box sx={{ mt: 2 }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
                <Typography>Deliveries in Progress</Typography>
                <Typography fontWeight="bold">
                  {realtimeData?.inProgressCount || 0}
                </Typography>
              </Box>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
                <Typography>Pending Pickups</Typography>
                <Typography fontWeight="bold">
                  {realtimeData?.pendingPickups || 0}
                </Typography>
              </Box>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
                <Typography>Completed (Last Hour)</Typography>
                <Typography fontWeight="bold" color="success.main">
                  {realtimeData?.completedLastHour || 0}
                </Typography>
              </Box>
              <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                <Typography>Failed (Last Hour)</Typography>
                <Typography fontWeight="bold" color="error.main">
                  {realtimeData?.failedLastHour || 0}
                </Typography>
              </Box>
            </Box>
          </Paper>
        </Grid>
        <Grid item xs={12} md={4}>
          <Paper sx={{ p: 2 }}>
            <Typography variant="h6" gutterBottom>
              Platform Health
            </Typography>
            <Box sx={{ mt: 2 }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
                <Typography>API Response Time</Typography>
                <Typography fontWeight="bold" color="success.main">
                  {realtimeData?.apiResponseTime || 0}ms
                </Typography>
              </Box>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
                <Typography>Blockchain Sync</Typography>
                <Typography fontWeight="bold" color="success.main">
                  <CheckCircle fontSize="small" /> Synced
                </Typography>
              </Box>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
                <Typography>Active WebSockets</Typography>
                <Typography fontWeight="bold">
                  {realtimeData?.activeWebsockets || 0}
                </Typography>
              </Box>
              <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                <Typography>Queue Backlog</Typography>
                <Typography fontWeight="bold">
                  {realtimeData?.queueBacklog || 0}
                </Typography>
              </Box>
            </Box>
          </Paper>
        </Grid>
        <Grid item xs={12} md={4}>
          <Paper sx={{ p: 2 }}>
            <Typography variant="h6" gutterBottom>
              Financial Summary
            </Typography>
            <Box sx={{ mt: 2 }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
                <Typography>Pending Payments</Typography>
                <Typography fontWeight="bold">
                  ${realtimeData?.pendingPayments?.toFixed(2) || '0.00'}
                </Typography>
              </Box>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
                <Typography>In Escrow</Typography>
                <Typography fontWeight="bold">
                  ${realtimeData?.inEscrow?.toFixed(2) || '0.00'}
                </Typography>
              </Box>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
                <Typography>Driver Payouts Due</Typography>
                <Typography fontWeight="bold">
                  ${realtimeData?.driverPayoutsDue?.toFixed(2) || '0.00'}
                </Typography>
              </Box>
              <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                <Typography>Platform Fees (Today)</Typography>
                <Typography fontWeight="bold" color="primary.main">
                  ${realtimeData?.platformFeesToday?.toFixed(2) || '0.00'}
                </Typography>
              </Box>
            </Box>
          </Paper>
        </Grid>
      </Grid>
    </Box>
  );
}