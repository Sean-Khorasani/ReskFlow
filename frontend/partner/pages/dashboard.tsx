import React, { useState, useEffect } from 'react';
import {
  Box,
  Grid,
  Paper,
  Typography,
  Card,
  CardContent,
  Button,
  IconButton,
  LinearProgress,
  Chip,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Avatar,
  useTheme,
} from '@mui/material';
import {
  TrendingUp,
  TrendingDown,
  People,
  DirectionsCar,
  LocalShipping,
  AttachMoney,
  Speed,
  CheckCircle,
  Warning,
  Refresh,
  ArrowForward,
  AccessTime,
  Star,
} from '@mui/icons-material';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  ArcElement,
  Title,
  Tooltip,
  Legend,
  Filler,
} from 'chart.js';
import { Line, Bar, Doughnut } from 'react-chartjs-2';
import PartnerLayout from '../components/layouts/PartnerLayout';
import { dashboardApi } from '../services/api';
import { format } from 'date-fns';
import Head from 'next/head';

// Register ChartJS components
ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  ArcElement,
  Title,
  Tooltip,
  Legend,
  Filler
);

interface DashboardStats {
  totalDrivers: number;
  activeDrivers: number;
  totalVehicles: number;
  activeVehicles: number;
  todayDeliveries: number;
  completedDeliveries: number;
  todayEarnings: number;
  weeklyEarnings: number;
  avgDeliveryTime: number;
  driverUtilization: number;
  onTimeDeliveryRate: number;
  customerSatisfaction: number;
}

interface RecentActivity {
  id: string;
  type: 'driver_joined' | 'vehicle_added' | 'reskflow_completed' | 'maintenance_due';
  message: string;
  timestamp: string;
  driverId?: string;
  vehicleId?: string;
}

interface TopDriver {
  id: string;
  name: string;
  avatar?: string;
  deliveries: number;
  rating: number;
  earnings: number;
  onTimeRate: number;
}

export default function DashboardPage() {
  const theme = useTheme();
  const [loading, setLoading] = useState(false);
  const [stats, setStats] = useState<DashboardStats>({
    totalDrivers: 45,
    activeDrivers: 38,
    totalVehicles: 52,
    activeVehicles: 46,
    todayDeliveries: 234,
    completedDeliveries: 198,
    todayEarnings: 4567.89,
    weeklyEarnings: 28934.56,
    avgDeliveryTime: 32.5,
    driverUtilization: 84.4,
    onTimeDeliveryRate: 91.2,
    customerSatisfaction: 4.6,
  });
  const [recentActivity, setRecentActivity] = useState<RecentActivity[]>([]);
  const [topDrivers, setTopDrivers] = useState<TopDriver[]>([]);

  useEffect(() => {
    fetchDashboardData();
    // Set up real-time updates
    const interval = setInterval(fetchDashboardData, 30000); // Update every 30 seconds
    return () => clearInterval(interval);
  }, []);

  const fetchDashboardData = async () => {
    setLoading(true);
    try {
      // Fetch dashboard data
      // const response = await dashboardApi.getStats();
      // setStats(response.data);
      
      // Mock data for now
      setRecentActivity([
        {
          id: '1',
          type: 'driver_joined',
          message: 'New driver John Smith joined the fleet',
          timestamp: new Date().toISOString(),
        },
        {
          id: '2',
          type: 'reskflow_completed',
          message: 'Driver Mike completed 10 deliveries today',
          timestamp: new Date().toISOString(),
          driverId: 'driver123',
        },
        {
          id: '3',
          type: 'maintenance_due',
          message: 'Vehicle #VH-2341 scheduled for maintenance',
          timestamp: new Date().toISOString(),
          vehicleId: 'vehicle123',
        },
      ]);

      setTopDrivers([
        {
          id: '1',
          name: 'Michael Johnson',
          deliveries: 156,
          rating: 4.9,
          earnings: 2845.50,
          onTimeRate: 96.5,
        },
        {
          id: '2',
          name: 'Sarah Williams',
          deliveries: 142,
          rating: 4.8,
          earnings: 2567.30,
          onTimeRate: 94.2,
        },
        {
          id: '3',
          name: 'David Brown',
          deliveries: 138,
          rating: 4.7,
          earnings: 2423.75,
          onTimeRate: 92.8,
        },
      ]);
    } catch (error) {
      console.error('Failed to fetch dashboard data:', error);
    } finally {
      setLoading(false);
    }
  };

  // Chart data
  const earningsChartData = {
    labels: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
    datasets: [
      {
        label: 'Earnings',
        data: [3200, 3800, 3500, 4200, 4800, 5200, 4567],
        borderColor: theme.palette.primary.main,
        backgroundColor: `${theme.palette.primary.main}20`,
        tension: 0.4,
        fill: true,
      },
    ],
  };

  const deliveriesChartData = {
    labels: ['6AM', '9AM', '12PM', '3PM', '6PM', '9PM'],
    datasets: [
      {
        label: 'Deliveries',
        data: [12, 45, 67, 54, 78, 42],
        backgroundColor: theme.palette.secondary.main,
      },
    ],
  };

  const fleetStatusData = {
    labels: ['Active', 'Idle', 'Maintenance'],
    datasets: [
      {
        data: [46, 4, 2],
        backgroundColor: [
          theme.palette.success.main,
          theme.palette.warning.main,
          theme.palette.error.main,
        ],
      },
    ],
  };

  const getActivityIcon = (type: RecentActivity['type']) => {
    switch (type) {
      case 'driver_joined':
        return <People color="primary" />;
      case 'vehicle_added':
        return <DirectionsCar color="secondary" />;
      case 'reskflow_completed':
        return <CheckCircle color="success" />;
      case 'maintenance_due':
        return <Warning color="warning" />;
      default:
        return <AccessTime />;
    }
  };

  return (
    <>
      <Head>
        <title>Dashboard - ReskFlow Partner Portal</title>
      </Head>
      
      <PartnerLayout>
        <Box sx={{ flexGrow: 1 }}>
          {/* Header */}
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
            <Box>
              <Typography variant="h4" fontWeight="bold">
                Partner Dashboard
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Welcome back! Here's what's happening with your fleet today.
              </Typography>
            </Box>
            <Button
              variant="outlined"
              startIcon={<Refresh />}
              onClick={fetchDashboardData}
              disabled={loading}
            >
              Refresh
            </Button>
          </Box>

          {loading && <LinearProgress sx={{ mb: 2 }} />}

          {/* Stats Cards */}
          <Grid container spacing={3} sx={{ mb: 3 }}>
            <Grid item xs={12} sm={6} lg={3}>
              <Card>
                <CardContent>
                  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <Box>
                      <Typography color="textSecondary" gutterBottom>
                        Active Drivers
                      </Typography>
                      <Typography variant="h4">
                        {stats.activeDrivers}/{stats.totalDrivers}
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        {((stats.activeDrivers / stats.totalDrivers) * 100).toFixed(1)}% online
                      </Typography>
                    </Box>
                    <People sx={{ fontSize: 40, color: 'primary.main' }} />
                  </Box>
                </CardContent>
              </Card>
            </Grid>

            <Grid item xs={12} sm={6} lg={3}>
              <Card>
                <CardContent>
                  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <Box>
                      <Typography color="textSecondary" gutterBottom>
                        Active Vehicles
                      </Typography>
                      <Typography variant="h4">
                        {stats.activeVehicles}/{stats.totalVehicles}
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        {stats.totalVehicles - stats.activeVehicles} idle
                      </Typography>
                    </Box>
                    <DirectionsCar sx={{ fontSize: 40, color: 'secondary.main' }} />
                  </Box>
                </CardContent>
              </Card>
            </Grid>

            <Grid item xs={12} sm={6} lg={3}>
              <Card>
                <CardContent>
                  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <Box>
                      <Typography color="textSecondary" gutterBottom>
                        Today's Deliveries
                      </Typography>
                      <Typography variant="h4">
                        {stats.completedDeliveries}
                      </Typography>
                      <Box sx={{ display: 'flex', alignItems: 'center' }}>
                        <TrendingUp sx={{ color: 'success.main', mr: 0.5 }} />
                        <Typography variant="body2" color="success.main">
                          +12.5%
                        </Typography>
                      </Box>
                    </Box>
                    <LocalShipping sx={{ fontSize: 40, color: 'success.main' }} />
                  </Box>
                </CardContent>
              </Card>
            </Grid>

            <Grid item xs={12} sm={6} lg={3}>
              <Card>
                <CardContent>
                  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <Box>
                      <Typography color="textSecondary" gutterBottom>
                        Today's Earnings
                      </Typography>
                      <Typography variant="h4">
                        ${stats.todayEarnings.toLocaleString()}
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        This week: ${stats.weeklyEarnings.toLocaleString()}
                      </Typography>
                    </Box>
                    <AttachMoney sx={{ fontSize: 40, color: 'success.main' }} />
                  </Box>
                </CardContent>
              </Card>
            </Grid>
          </Grid>

          {/* Performance Metrics */}
          <Grid container spacing={3} sx={{ mb: 3 }}>
            <Grid item xs={12} md={3}>
              <Paper sx={{ p: 2 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
                  <Typography variant="subtitle2">Avg Delivery Time</Typography>
                  <Speed color="action" />
                </Box>
                <Typography variant="h5">{stats.avgDeliveryTime} min</Typography>
                <LinearProgress
                  variant="determinate"
                  value={Math.min((45 - stats.avgDeliveryTime) / 45 * 100, 100)}
                  sx={{ mt: 1 }}
                  color={stats.avgDeliveryTime < 35 ? 'success' : 'warning'}
                />
              </Paper>
            </Grid>

            <Grid item xs={12} md={3}>
              <Paper sx={{ p: 2 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
                  <Typography variant="subtitle2">Driver Utilization</Typography>
                  <People color="action" />
                </Box>
                <Typography variant="h5">{stats.driverUtilization}%</Typography>
                <LinearProgress
                  variant="determinate"
                  value={stats.driverUtilization}
                  sx={{ mt: 1 }}
                  color={stats.driverUtilization > 80 ? 'success' : 'warning'}
                />
              </Paper>
            </Grid>

            <Grid item xs={12} md={3}>
              <Paper sx={{ p: 2 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
                  <Typography variant="subtitle2">On-Time Rate</Typography>
                  <CheckCircle color="action" />
                </Box>
                <Typography variant="h5">{stats.onTimeDeliveryRate}%</Typography>
                <LinearProgress
                  variant="determinate"
                  value={stats.onTimeDeliveryRate}
                  sx={{ mt: 1 }}
                  color={stats.onTimeDeliveryRate > 90 ? 'success' : 'warning'}
                />
              </Paper>
            </Grid>

            <Grid item xs={12} md={3}>
              <Paper sx={{ p: 2 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
                  <Typography variant="subtitle2">Customer Rating</Typography>
                  <Star color="action" />
                </Box>
                <Typography variant="h5">{stats.customerSatisfaction}/5.0</Typography>
                <LinearProgress
                  variant="determinate"
                  value={stats.customerSatisfaction * 20}
                  sx={{ mt: 1 }}
                  color={stats.customerSatisfaction > 4.5 ? 'success' : 'warning'}
                />
              </Paper>
            </Grid>
          </Grid>

          {/* Charts Row */}
          <Grid container spacing={3} sx={{ mb: 3 }}>
            <Grid item xs={12} md={8}>
              <Paper sx={{ p: 3 }}>
                <Typography variant="h6" gutterBottom>
                  Weekly Earnings
                </Typography>
                <Box sx={{ height: 300 }}>
                  <Line
                    data={earningsChartData}
                    options={{
                      responsive: true,
                      maintainAspectRatio: false,
                      plugins: {
                        legend: {
                          display: false,
                        },
                      },
                      scales: {
                        y: {
                          ticks: {
                            callback: function(value) {
                              return '$' + value.toLocaleString();
                            },
                          },
                        },
                      },
                    }}
                  />
                </Box>
              </Paper>
            </Grid>

            <Grid item xs={12} md={4}>
              <Paper sx={{ p: 3 }}>
                <Typography variant="h6" gutterBottom>
                  Fleet Status
                </Typography>
                <Box sx={{ height: 300, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Doughnut
                    data={fleetStatusData}
                    options={{
                      responsive: true,
                      maintainAspectRatio: false,
                      plugins: {
                        legend: {
                          position: 'bottom',
                        },
                      },
                    }}
                  />
                </Box>
              </Paper>
            </Grid>
          </Grid>

          {/* Bottom Row */}
          <Grid container spacing={3}>
            {/* Top Drivers */}
            <Grid item xs={12} md={6}>
              <Paper sx={{ p: 3 }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                  <Typography variant="h6">Top Performing Drivers</Typography>
                  <Button size="small" endIcon={<ArrowForward />}>
                    View All
                  </Button>
                </Box>
                <TableContainer>
                  <Table>
                    <TableHead>
                      <TableRow>
                        <TableCell>Driver</TableCell>
                        <TableCell align="center">Deliveries</TableCell>
                        <TableCell align="center">Rating</TableCell>
                        <TableCell align="right">Earnings</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {topDrivers.map((driver) => (
                        <TableRow key={driver.id}>
                          <TableCell>
                            <Box sx={{ display: 'flex', alignItems: 'center' }}>
                              <Avatar sx={{ width: 32, height: 32, mr: 1 }}>
                                {driver.name.split(' ').map(n => n[0]).join('')}
                              </Avatar>
                              {driver.name}
                            </Box>
                          </TableCell>
                          <TableCell align="center">{driver.deliveries}</TableCell>
                          <TableCell align="center">
                            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                              <Star sx={{ color: 'warning.main', fontSize: 16, mr: 0.5 }} />
                              {driver.rating}
                            </Box>
                          </TableCell>
                          <TableCell align="right">${driver.earnings.toFixed(2)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              </Paper>
            </Grid>

            {/* Recent Activity */}
            <Grid item xs={12} md={6}>
              <Paper sx={{ p: 3 }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                  <Typography variant="h6">Recent Activity</Typography>
                  <Button size="small" endIcon={<ArrowForward />}>
                    View All
                  </Button>
                </Box>
                <Box>
                  {recentActivity.map((activity) => (
                    <Box
                      key={activity.id}
                      sx={{
                        display: 'flex',
                        alignItems: 'center',
                        p: 2,
                        borderBottom: 1,
                        borderColor: 'divider',
                        '&:last-child': { borderBottom: 0 },
                      }}
                    >
                      <Box sx={{ mr: 2 }}>
                        {getActivityIcon(activity.type)}
                      </Box>
                      <Box sx={{ flexGrow: 1 }}>
                        <Typography variant="body2">{activity.message}</Typography>
                        <Typography variant="caption" color="text.secondary">
                          {format(new Date(activity.timestamp), 'MMM dd, HH:mm')}
                        </Typography>
                      </Box>
                    </Box>
                  ))}
                </Box>
              </Paper>
            </Grid>
          </Grid>
        </Box>
      </PartnerLayout>
    </>
  );
}