import React, { useEffect } from 'react';
import {
  Box,
  Grid,
  Paper,
  Typography,
  Card,
  CardContent,
  IconButton,
  Select,
  MenuItem,
  FormControl,
  LinearProgress,
  Chip,
  Avatar,
  List,
  ListItem,
  ListItemAvatar,
  ListItemText,
} from '@mui/material';
import {
  TrendingUp,
  TrendingDown,
  AttachMoney,
  People,
  Store,
  DirectionsCar,
  Receipt,
  Speed,
  Refresh,
  Warning,
  CheckCircle,
} from '@mui/icons-material';
import {
  LineChart,
  Line,
  AreaChart,
  Area,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import AdminLayout from '../components/layouts/AdminLayout';
import { useDashboardStore } from '../stores/dashboardStore';
import { format } from 'date-fns';
import Head from 'next/head';

const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884D8'];

const StatCard = ({ title, value, change, icon, color, prefix = '' }: any) => (
  <Card sx={{ height: '100%' }}>
    <CardContent>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <Box>
          <Typography color="textSecondary" gutterBottom variant="overline">
            {title}
          </Typography>
          <Typography variant="h4" component="div" fontWeight="bold">
            {prefix}{value}
          </Typography>
          {change !== undefined && (
            <Box sx={{ display: 'flex', alignItems: 'center', mt: 1 }}>
              {change > 0 ? (
                <TrendingUp sx={{ color: 'success.main', fontSize: 20, mr: 0.5 }} />
              ) : (
                <TrendingDown sx={{ color: 'error.main', fontSize: 20, mr: 0.5 }} />
              )}
              <Typography
                variant="body2"
                color={change > 0 ? 'success.main' : 'error.main'}
              >
                {Math.abs(change)}% from last period
              </Typography>
            </Box>
          )}
        </Box>
        <Avatar sx={{ bgcolor: color, width: 56, height: 56 }}>
          {icon}
        </Avatar>
      </Box>
    </CardContent>
  </Card>
);

export default function DashboardPage() {
  const {
    stats,
    realtimeMetrics,
    chartData,
    loading,
    period,
    fetchStats,
    fetchRealtimeMetrics,
    fetchChartData,
    setPeriod,
  } = useDashboardStore();

  useEffect(() => {
    fetchStats();
    fetchRealtimeMetrics();
    fetchChartData(period);
    
    // Set up realtime updates
    const interval = setInterval(() => {
      fetchRealtimeMetrics();
    }, 30000); // Update every 30 seconds
    
    return () => clearInterval(interval);
  }, []);

  const handleRefresh = () => {
    fetchStats();
    fetchRealtimeMetrics();
    fetchChartData(period);
  };

  const systemHealth = [
    { name: 'API Server', status: 'operational', uptime: '99.9%' },
    { name: 'Database', status: 'operational', uptime: '99.8%' },
    { name: 'Redis Cache', status: 'operational', uptime: '100%' },
    { name: 'Socket Server', status: 'degraded', uptime: '98.5%' },
    { name: 'Blockchain Node', status: 'operational', uptime: '99.7%' },
  ];

  const recentActivities = [
    { type: 'merchant', action: 'New merchant registered', name: 'Pizza Palace', time: '5 min ago' },
    { type: 'order', action: 'Large order placed', name: 'Order #12345', time: '10 min ago' },
    { type: 'driver', action: 'Driver went offline', name: 'John Doe', time: '15 min ago' },
    { type: 'alert', action: 'High traffic detected', name: 'System Alert', time: '30 min ago' },
    { type: 'user', action: 'New user milestone', name: '10,000 users', time: '1 hour ago' },
  ];

  return (
    <>
      <Head>
        <title>Admin Dashboard - ReskFlow</title>
      </Head>
      
      <AdminLayout>
        <Box sx={{ flexGrow: 1 }}>
          {/* Header */}
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
            <Box>
              <Typography variant="h4" gutterBottom fontWeight="bold">
                System Dashboard
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Last updated: {format(new Date(), 'MMM dd, yyyy HH:mm')}
              </Typography>
            </Box>
            <Box sx={{ display: 'flex', gap: 2 }}>
              <FormControl size="small">
                <Select
                  value={period}
                  onChange={(e) => setPeriod(e.target.value)}
                >
                  <MenuItem value="24hours">Last 24 Hours</MenuItem>
                  <MenuItem value="7days">Last 7 Days</MenuItem>
                  <MenuItem value="30days">Last 30 Days</MenuItem>
                  <MenuItem value="90days">Last 90 Days</MenuItem>
                </Select>
              </FormControl>
              <IconButton onClick={handleRefresh} color="primary">
                <Refresh />
              </IconButton>
            </Box>
          </Box>

          {loading && <LinearProgress sx={{ mb: 2 }} />}

          {/* Real-time Metrics */}
          <Paper sx={{ p: 2, mb: 3, bgcolor: 'primary.light', color: 'primary.contrastText' }}>
            <Grid container spacing={2} alignItems="center">
              <Grid item xs={12} sm={3}>
                <Box sx={{ display: 'flex', alignItems: 'center' }}>
                  <Speed sx={{ mr: 1 }} />
                  <Box>
                    <Typography variant="caption">Active Orders</Typography>
                    <Typography variant="h5" fontWeight="bold">
                      {realtimeMetrics?.activeOrders || 0}
                    </Typography>
                  </Box>
                </Box>
              </Grid>
              <Grid item xs={12} sm={3}>
                <Box sx={{ display: 'flex', alignItems: 'center' }}>
                  <DirectionsCar sx={{ mr: 1 }} />
                  <Box>
                    <Typography variant="caption">Online Drivers</Typography>
                    <Typography variant="h5" fontWeight="bold">
                      {realtimeMetrics?.onlineDrivers || 0}
                    </Typography>
                  </Box>
                </Box>
              </Grid>
              <Grid item xs={12} sm={3}>
                <Box sx={{ display: 'flex', alignItems: 'center' }}>
                  <People sx={{ mr: 1 }} />
                  <Box>
                    <Typography variant="caption">Active Users</Typography>
                    <Typography variant="h5" fontWeight="bold">
                      {realtimeMetrics?.onlineUsers || 0}
                    </Typography>
                  </Box>
                </Box>
              </Grid>
              <Grid item xs={12} sm={3}>
                <Box sx={{ display: 'flex', alignItems: 'center' }}>
                  <Receipt sx={{ mr: 1 }} />
                  <Box>
                    <Typography variant="caption">Orders/Minute</Typography>
                    <Typography variant="h5" fontWeight="bold">
                      {realtimeMetrics?.ordersPerMinute || 0}
                    </Typography>
                  </Box>
                </Box>
              </Grid>
            </Grid>
          </Paper>

          {/* Stats Grid */}
          <Grid container spacing={3} sx={{ mb: 3 }}>
            <Grid item xs={12} sm={6} md={2}>
              <StatCard
                title="Total Revenue"
                value={stats?.totalRevenue.toLocaleString() || '0'}
                change={stats?.revenueChange}
                icon={<AttachMoney />}
                color="success.main"
                prefix="$"
              />
            </Grid>
            <Grid item xs={12} sm={6} md={2}>
              <StatCard
                title="Total Orders"
                value={stats?.totalOrders.toLocaleString() || '0'}
                change={stats?.ordersChange}
                icon={<Receipt />}
                color="primary.main"
              />
            </Grid>
            <Grid item xs={12} sm={6} md={2}>
              <StatCard
                title="Total Users"
                value={stats?.totalUsers.toLocaleString() || '0'}
                change={stats?.usersChange}
                icon={<People />}
                color="warning.main"
              />
            </Grid>
            <Grid item xs={12} sm={6} md={2}>
              <StatCard
                title="Merchants"
                value={stats?.totalMerchants || '0'}
                change={stats?.merchantsChange}
                icon={<Store />}
                color="secondary.main"
              />
            </Grid>
            <Grid item xs={12} sm={6} md={2}>
              <StatCard
                title="Active Drivers"
                value={stats?.activeDrivers || '0'}
                change={stats?.driversChange}
                icon={<DirectionsCar />}
                color="info.main"
              />
            </Grid>
            <Grid item xs={12} sm={6} md={2}>
              <StatCard
                title="Avg Delivery"
                value={`${stats?.avgDeliveryTime || 0}m`}
                change={stats?.reskflowTimeChange}
                icon={<Speed />}
                color="error.main"
              />
            </Grid>
          </Grid>

          {/* Charts Row */}
          <Grid container spacing={3} sx={{ mb: 3 }}>
            {/* Revenue Chart */}
            <Grid item xs={12} md={8}>
              <Paper sx={{ p: 3 }}>
                <Typography variant="h6" gutterBottom fontWeight="medium">
                  Revenue Trend
                </Typography>
                <Box sx={{ width: '100%', height: 300 }}>
                  <ResponsiveContainer>
                    <AreaChart data={chartData?.revenue || []}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="date" />
                      <YAxis />
                      <Tooltip />
                      <Area
                        type="monotone"
                        dataKey="amount"
                        stroke="#8884d8"
                        fill="#8884d8"
                        fillOpacity={0.6}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </Box>
              </Paper>
            </Grid>

            {/* Order Status Distribution */}
            <Grid item xs={12} md={4}>
              <Paper sx={{ p: 3 }}>
                <Typography variant="h6" gutterBottom fontWeight="medium">
                  Order Status Distribution
                </Typography>
                <Box sx={{ width: '100%', height: 300 }}>
                  <ResponsiveContainer>
                    <PieChart>
                      <Pie
                        data={chartData?.ordersByStatus || []}
                        cx="50%"
                        cy="50%"
                        labelLine={false}
                        label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                        outerRadius={80}
                        fill="#8884d8"
                        dataKey="count"
                      >
                        {chartData?.ordersByStatus.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip />
                    </PieChart>
                  </ResponsiveContainer>
                </Box>
              </Paper>
            </Grid>
          </Grid>

          <Grid container spacing={3}>
            {/* System Health */}
            <Grid item xs={12} md={6}>
              <Paper sx={{ p: 3 }}>
                <Typography variant="h6" gutterBottom fontWeight="medium">
                  System Health
                </Typography>
                <List>
                  {systemHealth.map((system, index) => (
                    <ListItem key={index} divider={index < systemHealth.length - 1}>
                      <ListItemAvatar>
                        <Avatar sx={{ 
                          bgcolor: system.status === 'operational' ? 'success.light' : 'warning.light',
                          width: 32,
                          height: 32,
                        }}>
                          {system.status === 'operational' ? 
                            <CheckCircle sx={{ color: 'success.main', fontSize: 20 }} /> : 
                            <Warning sx={{ color: 'warning.main', fontSize: 20 }} />
                          }
                        </Avatar>
                      </ListItemAvatar>
                      <ListItemText
                        primary={system.name}
                        secondary={`Uptime: ${system.uptime}`}
                      />
                      <Chip
                        label={system.status}
                        color={system.status === 'operational' ? 'success' : 'warning'}
                        size="small"
                      />
                    </ListItem>
                  ))}
                </List>
              </Paper>
            </Grid>

            {/* Recent Activities */}
            <Grid item xs={12} md={6}>
              <Paper sx={{ p: 3 }}>
                <Typography variant="h6" gutterBottom fontWeight="medium">
                  Recent Activities
                </Typography>
                <List>
                  {recentActivities.map((activity, index) => (
                    <ListItem key={index} divider={index < recentActivities.length - 1}>
                      <ListItemAvatar>
                        <Avatar sx={{ bgcolor: 'grey.200' }}>
                          {activity.type === 'merchant' && <Store />}
                          {activity.type === 'order' && <Receipt />}
                          {activity.type === 'driver' && <DirectionsCar />}
                          {activity.type === 'alert' && <Warning />}
                          {activity.type === 'user' && <People />}
                        </Avatar>
                      </ListItemAvatar>
                      <ListItemText
                        primary={activity.action}
                        secondary={activity.name}
                      />
                      <Typography variant="caption" color="text.secondary">
                        {activity.time}
                      </Typography>
                    </ListItem>
                  ))}
                </List>
              </Paper>
            </Grid>

            {/* Orders Chart */}
            <Grid item xs={12}>
              <Paper sx={{ p: 3 }}>
                <Typography variant="h6" gutterBottom fontWeight="medium">
                  Orders Trend
                </Typography>
                <Box sx={{ width: '100%', height: 300 }}>
                  <ResponsiveContainer>
                    <LineChart data={chartData?.orders || []}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="date" />
                      <YAxis />
                      <Tooltip />
                      <Line type="monotone" dataKey="count" stroke="#82ca9d" strokeWidth={2} />
                    </LineChart>
                  </ResponsiveContainer>
                </Box>
              </Paper>
            </Grid>
          </Grid>
        </Box>
      </AdminLayout>
    </>
  );
}