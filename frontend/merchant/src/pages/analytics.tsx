import React, { useEffect, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import {
  Box,
  Grid,
  Paper,
  Typography,
  Card,
  CardContent,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  Button,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Chip,
  LinearProgress,
  IconButton,
  ToggleButton,
  ToggleButtonGroup,
} from '@mui/material';
import {
  TrendingUp,
  TrendingDown,
  DateRange,
  Download,
  Refresh,
  BarChart as BarChartIcon,
  ShowChart,
  PieChart as PieChartIcon,
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
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import { AdapterDateFns } from '@mui/x-date-pickers/AdapterDateFns';
import { AppDispatch, RootState } from '@/store';
import {
  fetchSalesAnalytics,
  fetchProductAnalytics,
  setDateRange,
} from '@/store/slices/analyticsSlice';
import MainLayout from '@/components/layouts/MainLayout';
import Head from 'next/head';
import { format, subDays, startOfMonth, endOfMonth } from 'date-fns';

const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884D8'];

export default function AnalyticsPage() {
  const dispatch = useDispatch<AppDispatch>();
  const { salesData, productAnalytics, loading, dateRange } = useSelector(
    (state: RootState) => state.analytics
  );
  
  const [chartType, setChartType] = useState<'line' | 'bar' | 'area'>('area');
  const [datePreset, setDatePreset] = useState('7days');
  const [startDate, setStartDate] = useState<Date | null>(new Date(dateRange.startDate));
  const [endDate, setEndDate] = useState<Date | null>(new Date(dateRange.endDate));

  useEffect(() => {
    const start = startDate ? format(startDate, 'yyyy-MM-dd') : dateRange.startDate;
    const end = endDate ? format(endDate, 'yyyy-MM-dd') : dateRange.endDate;
    
    dispatch(setDateRange({ startDate: start, endDate: end }));
    dispatch(fetchSalesAnalytics({ startDate: start, endDate: end }));
    dispatch(fetchProductAnalytics({ startDate: start, endDate: end }));
  }, [dispatch, startDate, endDate]);

  const handleDatePresetChange = (preset: string) => {
    setDatePreset(preset);
    const today = new Date();
    let start: Date;
    let end: Date = today;

    switch (preset) {
      case 'today':
        start = today;
        break;
      case '7days':
        start = subDays(today, 7);
        break;
      case '30days':
        start = subDays(today, 30);
        break;
      case 'thisMonth':
        start = startOfMonth(today);
        end = endOfMonth(today);
        break;
      default:
        return;
    }

    setStartDate(start);
    setEndDate(end);
  };

  const handleRefresh = () => {
    const start = startDate ? format(startDate, 'yyyy-MM-dd') : dateRange.startDate;
    const end = endDate ? format(endDate, 'yyyy-MM-dd') : dateRange.endDate;
    dispatch(fetchSalesAnalytics({ startDate: start, endDate: end }));
    dispatch(fetchProductAnalytics({ startDate: start, endDate: end }));
  };

  const calculateTotalRevenue = () => {
    return salesData?.revenue.reduce((sum, item) => sum + item.amount, 0) || 0;
  };

  const calculateTotalOrders = () => {
    return salesData?.orders.reduce((sum, item) => sum + item.count, 0) || 0;
  };

  const calculateAverageOrderValue = () => {
    const totalRevenue = calculateTotalRevenue();
    const totalOrders = calculateTotalOrders();
    return totalOrders > 0 ? totalRevenue / totalOrders : 0;
  };

  return (
    <>
      <Head>
        <title>Analytics - ReskFlow Merchant</title>
      </Head>
      
      <MainLayout>
        <Box sx={{ flexGrow: 1 }}>
          {/* Header */}
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
            <Typography variant="h4" fontWeight="bold">
              Analytics
            </Typography>
            <Box sx={{ display: 'flex', gap: 2 }}>
              <Button
                variant="outlined"
                startIcon={<Download />}
              >
                Export Report
              </Button>
              <IconButton onClick={handleRefresh} color="primary">
                <Refresh />
              </IconButton>
            </Box>
          </Box>

          {/* Date Range Selector */}
          <Paper sx={{ p: 2, mb: 3 }}>
            <Grid container spacing={2} alignItems="center">
              <Grid item xs={12} md={4}>
                <FormControl fullWidth size="small">
                  <InputLabel>Date Range</InputLabel>
                  <Select
                    value={datePreset}
                    onChange={(e) => handleDatePresetChange(e.target.value)}
                    label="Date Range"
                  >
                    <MenuItem value="today">Today</MenuItem>
                    <MenuItem value="7days">Last 7 Days</MenuItem>
                    <MenuItem value="30days">Last 30 Days</MenuItem>
                    <MenuItem value="thisMonth">This Month</MenuItem>
                    <MenuItem value="custom">Custom Range</MenuItem>
                  </Select>
                </FormControl>
              </Grid>
              <Grid item xs={12} md={4}>
                <LocalizationProvider dateAdapter={AdapterDateFns}>
                  <DatePicker
                    label="Start Date"
                    value={startDate}
                    onChange={setStartDate}
                    disabled={datePreset !== 'custom'}
                    slotProps={{ textField: { size: 'small', fullWidth: true } }}
                  />
                </LocalizationProvider>
              </Grid>
              <Grid item xs={12} md={4}>
                <LocalizationProvider dateAdapter={AdapterDateFns}>
                  <DatePicker
                    label="End Date"
                    value={endDate}
                    onChange={setEndDate}
                    disabled={datePreset !== 'custom'}
                    slotProps={{ textField: { size: 'small', fullWidth: true } }}
                  />
                </LocalizationProvider>
              </Grid>
            </Grid>
          </Paper>

          {loading && <LinearProgress sx={{ mb: 3 }} />}

          {/* Summary Cards */}
          <Grid container spacing={3} sx={{ mb: 3 }}>
            <Grid item xs={12} sm={4}>
              <Card>
                <CardContent>
                  <Typography color="textSecondary" gutterBottom>
                    Total Revenue
                  </Typography>
                  <Typography variant="h4" fontWeight="bold">
                    ${calculateTotalRevenue().toFixed(2)}
                  </Typography>
                  <Box sx={{ display: 'flex', alignItems: 'center', mt: 1 }}>
                    <TrendingUp sx={{ color: 'success.main', fontSize: 20, mr: 0.5 }} />
                    <Typography variant="body2" color="success.main">
                      +12.5% from last period
                    </Typography>
                  </Box>
                </CardContent>
              </Card>
            </Grid>
            <Grid item xs={12} sm={4}>
              <Card>
                <CardContent>
                  <Typography color="textSecondary" gutterBottom>
                    Total Orders
                  </Typography>
                  <Typography variant="h4" fontWeight="bold">
                    {calculateTotalOrders()}
                  </Typography>
                  <Box sx={{ display: 'flex', alignItems: 'center', mt: 1 }}>
                    <TrendingUp sx={{ color: 'success.main', fontSize: 20, mr: 0.5 }} />
                    <Typography variant="body2" color="success.main">
                      +8.3% from last period
                    </Typography>
                  </Box>
                </CardContent>
              </Card>
            </Grid>
            <Grid item xs={12} sm={4}>
              <Card>
                <CardContent>
                  <Typography color="textSecondary" gutterBottom>
                    Average Order Value
                  </Typography>
                  <Typography variant="h4" fontWeight="bold">
                    ${calculateAverageOrderValue().toFixed(2)}
                  </Typography>
                  <Box sx={{ display: 'flex', alignItems: 'center', mt: 1 }}>
                    <TrendingDown sx={{ color: 'error.main', fontSize: 20, mr: 0.5 }} />
                    <Typography variant="body2" color="error.main">
                      -2.1% from last period
                    </Typography>
                  </Box>
                </CardContent>
              </Card>
            </Grid>
          </Grid>

          {/* Revenue Chart */}
          <Paper sx={{ p: 3, mb: 3 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
              <Typography variant="h6" fontWeight="medium">
                Revenue Trend
              </Typography>
              <ToggleButtonGroup
                value={chartType}
                exclusive
                onChange={(e, value) => value && setChartType(value)}
                size="small"
              >
                <ToggleButton value="line">
                  <ShowChart />
                </ToggleButton>
                <ToggleButton value="bar">
                  <BarChartIcon />
                </ToggleButton>
                <ToggleButton value="area">
                  <PieChartIcon />
                </ToggleButton>
              </ToggleButtonGroup>
            </Box>
            <Box sx={{ width: '100%', height: 300 }}>
              <ResponsiveContainer>
                {chartType === 'line' ? (
                  <LineChart data={salesData?.revenue || []}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" />
                    <YAxis />
                    <Tooltip />
                    <Line type="monotone" dataKey="amount" stroke="#8884d8" />
                  </LineChart>
                ) : chartType === 'bar' ? (
                  <BarChart data={salesData?.revenue || []}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" />
                    <YAxis />
                    <Tooltip />
                    <Bar dataKey="amount" fill="#8884d8" />
                  </BarChart>
                ) : (
                  <AreaChart data={salesData?.revenue || []}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" />
                    <YAxis />
                    <Tooltip />
                    <Area type="monotone" dataKey="amount" stroke="#8884d8" fill="#8884d8" />
                  </AreaChart>
                )}
              </ResponsiveContainer>
            </Box>
          </Paper>

          <Grid container spacing={3}>
            {/* Category Performance */}
            <Grid item xs={12} md={6}>
              <Paper sx={{ p: 3 }}>
                <Typography variant="h6" fontWeight="medium" gutterBottom>
                  Sales by Category
                </Typography>
                <Box sx={{ width: '100%', height: 300 }}>
                  <ResponsiveContainer>
                    <PieChart>
                      <Pie
                        data={salesData?.categories || []}
                        cx="50%"
                        cy="50%"
                        labelLine={false}
                        label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                        outerRadius={80}
                        fill="#8884d8"
                        dataKey="revenue"
                      >
                        {salesData?.categories.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip />
                    </PieChart>
                  </ResponsiveContainer>
                </Box>
              </Paper>
            </Grid>

            {/* Top Products */}
            <Grid item xs={12} md={6}>
              <Paper sx={{ p: 3 }}>
                <Typography variant="h6" fontWeight="medium" gutterBottom>
                  Top Products
                </Typography>
                <TableContainer>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>Product</TableCell>
                        <TableCell align="right">Sales</TableCell>
                        <TableCell align="right">Revenue</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {productAnalytics?.topProducts.slice(0, 5).map((product) => (
                        <TableRow key={product.id}>
                          <TableCell>{product.name}</TableCell>
                          <TableCell align="right">{product.salesCount}</TableCell>
                          <TableCell align="right">${product.revenue.toFixed(2)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              </Paper>
            </Grid>

            {/* Hourly Distribution */}
            <Grid item xs={12}>
              <Paper sx={{ p: 3 }}>
                <Typography variant="h6" fontWeight="medium" gutterBottom>
                  Orders by Hour of Day
                </Typography>
                <Box sx={{ width: '100%', height: 300 }}>
                  <ResponsiveContainer>
                    <BarChart data={salesData?.hourlyDistribution || []}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="hour" />
                      <YAxis />
                      <Tooltip />
                      <Bar dataKey="orders" fill="#82ca9d" />
                    </BarChart>
                  </ResponsiveContainer>
                </Box>
              </Paper>
            </Grid>

            {/* Stock Alerts */}
            <Grid item xs={12}>
              <Paper sx={{ p: 3 }}>
                <Typography variant="h6" fontWeight="medium" gutterBottom>
                  Low Stock Alerts
                </Typography>
                {productAnalytics?.stockAlerts.length === 0 ? (
                  <Typography variant="body2" color="text.secondary">
                    All products are well stocked
                  </Typography>
                ) : (
                  <TableContainer>
                    <Table size="small">
                      <TableHead>
                        <TableRow>
                          <TableCell>Product</TableCell>
                          <TableCell align="right">Current Stock</TableCell>
                          <TableCell align="right">Threshold</TableCell>
                          <TableCell>Status</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {productAnalytics?.stockAlerts.map((alert) => (
                          <TableRow key={alert.id}>
                            <TableCell>{alert.name}</TableCell>
                            <TableCell align="right">{alert.currentStock}</TableCell>
                            <TableCell align="right">{alert.threshold}</TableCell>
                            <TableCell>
                              <Chip
                                label={alert.currentStock === 0 ? 'Out of Stock' : 'Low Stock'}
                                color={alert.currentStock === 0 ? 'error' : 'warning'}
                                size="small"
                              />
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                )}
              </Paper>
            </Grid>
          </Grid>
        </Box>
      </MainLayout>
    </>
  );
}