import React, { useEffect } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import {
  Box,
  Grid,
  Paper,
  Typography,
  Card,
  CardContent,
  IconButton,
  List,
  ListItem,
  ListItemText,
  ListItemAvatar,
  Avatar,
  Chip,
  Button,
  Skeleton,
} from '@mui/material';
import {
  TrendingUp,
  TrendingDown,
  AttachMoney,
  ShoppingCart,
  People,
  Receipt,
  Refresh,
  ArrowForward,
} from '@mui/icons-material';
import { LineChart, Line, AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { AppDispatch, RootState } from '@/store';
import { fetchDashboardStats } from '@/store/slices/analyticsSlice';
import { fetchOrders } from '@/store/slices/ordersSlice';
import MainLayout from '@/components/layouts/MainLayout';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { format } from 'date-fns';

const StatCard = ({ title, value, change, icon, color }: any) => (
  <Card>
    <CardContent>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <Box>
          <Typography color="textSecondary" gutterBottom variant="overline">
            {title}
          </Typography>
          <Typography variant="h4" component="div" fontWeight="bold">
            {value}
          </Typography>
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
              {Math.abs(change)}% from yesterday
            </Typography>
          </Box>
        </Box>
        <Avatar sx={{ bgcolor: color, width: 56, height: 56 }}>
          {icon}
        </Avatar>
      </Box>
    </CardContent>
  </Card>
);

export default function DashboardPage() {
  const dispatch = useDispatch<AppDispatch>();
  const router = useRouter();
  const { dashboardStats, loading } = useSelector((state: RootState) => state.analytics);
  const { orders } = useSelector((state: RootState) => state.orders);

  useEffect(() => {
    dispatch(fetchDashboardStats());
    dispatch(fetchOrders({ status: 'recent' }));
  }, [dispatch]);

  const handleRefresh = () => {
    dispatch(fetchDashboardStats());
    dispatch(fetchOrders({ status: 'recent' }));
  };

  const getStatusColor = (status: string) => {
    const colors: any = {
      pending: 'warning',
      confirmed: 'info',
      preparing: 'secondary',
      ready: 'success',
      cancelled: 'error',
    };
    return colors[status] || 'default';
  };

  return (
    <>
      <Head>
        <title>Dashboard - ReskFlow Merchant</title>
      </Head>
      
      <MainLayout>
        <Box sx={{ flexGrow: 1, p: 3 }}>
          {/* Header */}
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
            <Box>
              <Typography variant="h4" gutterBottom fontWeight="bold">
                Dashboard
              </Typography>
              <Typography variant="body2" color="textSecondary">
                Welcome back! Here's what's happening with your business today.
              </Typography>
            </Box>
            <IconButton onClick={handleRefresh} color="primary">
              <Refresh />
            </IconButton>
          </Box>

          {/* Stats Grid */}
          <Grid container spacing={3} sx={{ mb: 3 }}>
            <Grid item xs={12} sm={6} md={3}>
              {loading ? (
                <Skeleton variant="rectangular" height={140} />
              ) : (
                <StatCard
                  title="Today's Revenue"
                  value={`$${dashboardStats?.todayRevenue.toFixed(2) || '0.00'}`}
                  change={dashboardStats?.revenueChange || 0}
                  icon={<AttachMoney />}
                  color="success.main"
                />
              )}
            </Grid>
            <Grid item xs={12} sm={6} md={3}>
              {loading ? (
                <Skeleton variant="rectangular" height={140} />
              ) : (
                <StatCard
                  title="Orders"
                  value={dashboardStats?.todayOrders || 0}
                  change={dashboardStats?.ordersChange || 0}
                  icon={<ShoppingCart />}
                  color="primary.main"
                />
              )}
            </Grid>
            <Grid item xs={12} sm={6} md={3}>
              {loading ? (
                <Skeleton variant="rectangular" height={140} />
              ) : (
                <StatCard
                  title="Customers"
                  value={dashboardStats?.todayCustomers || 0}
                  change={dashboardStats?.customersChange || 0}
                  icon={<People />}
                  color="warning.main"
                />
              )}
            </Grid>
            <Grid item xs={12} sm={6} md={3}>
              {loading ? (
                <Skeleton variant="rectangular" height={140} />
              ) : (
                <StatCard
                  title="Avg Order Value"
                  value={`$${dashboardStats?.averageOrderValue.toFixed(2) || '0.00'}`}
                  change={dashboardStats?.avgOrderChange || 0}
                  icon={<Receipt />}
                  color="secondary.main"
                />
              )}
            </Grid>
          </Grid>

          {/* Charts and Recent Orders */}
          <Grid container spacing={3}>
            {/* Revenue Chart */}
            <Grid item xs={12} md={8}>
              <Paper sx={{ p: 3 }}>
                <Typography variant="h6" gutterBottom fontWeight="medium">
                  Revenue Overview
                </Typography>
                <Box sx={{ width: '100%', height: 300 }}>
                  <ResponsiveContainer>
                    <AreaChart
                      data={dashboardStats?.revenueChart || []}
                      margin={{ top: 10, right: 30, left: 0, bottom: 0 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="date" />
                      <YAxis />
                      <Tooltip />
                      <Area
                        type="monotone"
                        dataKey="amount"
                        stroke="#007AFF"
                        fill="#007AFF"
                        fillOpacity={0.3}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </Box>
              </Paper>
            </Grid>

            {/* Popular Products */}
            <Grid item xs={12} md={4}>
              <Paper sx={{ p: 3, height: '100%' }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                  <Typography variant="h6" fontWeight="medium">
                    Popular Products
                  </Typography>
                  <Button
                    size="small"
                    endIcon={<ArrowForward />}
                    onClick={() => router.push('/products')}
                  >
                    View All
                  </Button>
                </Box>
                <List>
                  {dashboardStats?.popularProducts.slice(0, 5).map((product, index) => (
                    <ListItem key={product.id} divider={index < 4}>
                      <ListItemAvatar>
                        <Avatar sx={{ bgcolor: 'primary.light' }}>
                          {index + 1}
                        </Avatar>
                      </ListItemAvatar>
                      <ListItemText
                        primary={product.name}
                        secondary={`${product.sales} sold`}
                      />
                      <Typography variant="subtitle1" fontWeight="medium">
                        ${product.revenue.toFixed(2)}
                      </Typography>
                    </ListItem>
                  ))}
                </List>
              </Paper>
            </Grid>

            {/* Recent Orders */}
            <Grid item xs={12}>
              <Paper sx={{ p: 3 }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                  <Typography variant="h6" fontWeight="medium">
                    Recent Orders
                  </Typography>
                  <Button
                    size="small"
                    endIcon={<ArrowForward />}
                    onClick={() => router.push('/orders')}
                  >
                    View All
                  </Button>
                </Box>
                <List>
                  {orders.slice(0, 5).map((order) => (
                    <ListItem
                      key={order.id}
                      sx={{
                        border: 1,
                        borderColor: 'divider',
                        borderRadius: 1,
                        mb: 1,
                        '&:hover': {
                          bgcolor: 'action.hover',
                          cursor: 'pointer',
                        },
                      }}
                      onClick={() => router.push(`/orders/${order.id}`)}
                    >
                      <ListItemText
                        primary={`Order #${order.orderNumber}`}
                        secondary={format(new Date(order.createdAt), 'MMM dd, yyyy HH:mm')}
                      />
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                        <Typography variant="subtitle1" fontWeight="medium">
                          ${order.total.toFixed(2)}
                        </Typography>
                        <Chip
                          label={order.status.replace('_', ' ').toUpperCase()}
                          color={getStatusColor(order.status)}
                          size="small"
                        />
                      </Box>
                    </ListItem>
                  ))}
                </List>
              </Paper>
            </Grid>
          </Grid>
        </Box>
      </MainLayout>
    </>
  );
}