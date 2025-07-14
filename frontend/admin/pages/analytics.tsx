import React, { useState, useEffect } from 'react';
import {
  Box,
  Paper,
  Typography,
  Grid,
  Card,
  CardContent,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Button,
  ToggleButton,
  ToggleButtonGroup,
  Chip,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  IconButton,
  Tooltip,
  LinearProgress,
  Tab,
  Tabs,
  TextField,
  Autocomplete,
} from '@mui/material';
import {
  TrendingUp,
  TrendingDown,
  AttachMoney,
  ShoppingCart,
  LocalShipping,
  People,
  Store,
  DateRange,
  Download,
  Print,
  FilterList,
  ArrowUpward,
  ArrowDownward,
  AccessTime,
  LocationOn,
  Star,
} from '@mui/icons-material';
import { DateRangePicker } from '@mui/x-date-pickers-pro/DateRangePicker';
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import { AdapterDateFns } from '@mui/x-date-pickers/AdapterDateFns';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  ArcElement,
  Title,
  Tooltip as ChartTooltip,
  Legend,
  Filler,
} from 'chart.js';
import { Line, Bar, Doughnut, Pie } from 'react-chartjs-2';
import AdminLayout from '../components/layouts/AdminLayout';
import { analyticsApi } from '../services/api';
import { format, subDays, startOfDay, endOfDay } from 'date-fns';
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
  ChartTooltip,
  Legend,
  Filler
);

interface AnalyticsData {
  revenue: {
    current: number;
    previous: number;
    change: number;
    chartData: number[];
    chartLabels: string[];
  };
  orders: {
    total: number;
    completed: number;
    cancelled: number;
    avgValue: number;
    change: number;
    chartData: number[];
    chartLabels: string[];
  };
  customers: {
    total: number;
    new: number;
    returning: number;
    avgLifetimeValue: number;
    change: number;
  };
  merchants: {
    total: number;
    active: number;
    topPerformers: {
      id: string;
      name: string;
      revenue: number;
      orders: number;
      rating: number;
    }[];
  };
  drivers: {
    total: number;
    active: number;
    avgRating: number;
    avgDeliveryTime: number;
    topPerformers: {
      id: string;
      name: string;
      deliveries: number;
      rating: number;
      earnings: number;
    }[];
  };
  products: {
    topSelling: {
      id: string;
      name: string;
      merchant: string;
      orders: number;
      revenue: number;
    }[];
    categories: {
      name: string;
      orders: number;
      revenue: number;
    }[];
  };
  geography: {
    topAreas: {
      area: string;
      orders: number;
      revenue: number;
    }[];
    heatmapData: any;
  };
}

export default function AnalyticsPage() {
  const [analyticsData, setAnalyticsData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(false);
  const [dateRange, setDateRange] = useState({
    start: subDays(new Date(), 30),
    end: new Date(),
  });
  const [timeframe, setTimeframe] = useState('daily');
  const [selectedTab, setSelectedTab] = useState(0);
  const [comparisonMode, setComparisonMode] = useState('previous');
  const [selectedMerchants, setSelectedMerchants] = useState<string[]>([]);
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);

  useEffect(() => {
    fetchAnalytics();
  }, [dateRange, timeframe, selectedMerchants, selectedCategories]);

  const fetchAnalytics = async () => {
    setLoading(true);
    try {
      const params = {
        startDate: startOfDay(dateRange.start).toISOString(),
        endDate: endOfDay(dateRange.end).toISOString(),
        timeframe,
        merchantIds: selectedMerchants,
        categories: selectedCategories,
      };
      
      const response = await analyticsApi.getAnalytics(params);
      setAnalyticsData(response.data);
    } catch (error) {
      console.error('Failed to fetch analytics:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleExport = (format: 'pdf' | 'csv' | 'excel') => {
    // Export analytics data
    console.log(`Exporting as ${format}`);
  };

  const handlePrint = () => {
    window.print();
  };

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(value);
  };

  const formatPercentage = (value: number) => {
    const prefix = value > 0 ? '+' : '';
    return `${prefix}${value.toFixed(1)}%`;
  };

  // Chart configurations
  const revenueChartData = {
    labels: analyticsData?.revenue.chartLabels || [],
    datasets: [
      {
        label: 'Revenue',
        data: analyticsData?.revenue.chartData || [],
        borderColor: 'rgb(75, 192, 192)',
        backgroundColor: 'rgba(75, 192, 192, 0.2)',
        tension: 0.4,
        fill: true,
      },
    ],
  };

  const ordersChartData = {
    labels: analyticsData?.orders.chartLabels || [],
    datasets: [
      {
        label: 'Orders',
        data: analyticsData?.orders.chartData || [],
        backgroundColor: 'rgba(54, 162, 235, 0.8)',
        borderColor: 'rgba(54, 162, 235, 1)',
        borderWidth: 1,
      },
    ],
  };

  const categoryPieData = {
    labels: analyticsData?.products.categories.map(c => c.name) || [],
    datasets: [
      {
        data: analyticsData?.products.categories.map(c => c.revenue) || [],
        backgroundColor: [
          '#FF6384',
          '#36A2EB',
          '#FFCE56',
          '#4BC0C0',
          '#9966FF',
          '#FF9F40',
        ],
      },
    ],
  };

  return (
    <>
      <Head>
        <title>Analytics & Reports - ReskFlow Admin</title>
      </Head>
      
      <AdminLayout>
        <Box sx={{ flexGrow: 1 }}>
          {/* Header */}
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
            <Typography variant="h4" fontWeight="bold">
              Analytics & Reports
            </Typography>
            <Box sx={{ display: 'flex', gap: 2 }}>
              <Button
                variant="outlined"
                startIcon={<Print />}
                onClick={handlePrint}
                className="no-print"
              >
                Print
              </Button>
              <Button
                variant="outlined"
                startIcon={<Download />}
                onClick={() => handleExport('pdf')}
                className="no-print"
              >
                Export PDF
              </Button>
              <Button
                variant="contained"
                startIcon={<Download />}
                onClick={() => handleExport('excel')}
                className="no-print"
              >
                Export Excel
              </Button>
            </Box>
          </Box>

          {/* Filters */}
          <Paper sx={{ p: 2, mb: 3 }} className="no-print">
            <Grid container spacing={2} alignItems="center">
              <Grid item xs={12} md={4}>
                <LocalizationProvider dateAdapter={AdapterDateFns}>
                  <DateRangePicker
                    startText="Start Date"
                    endText="End Date"
                    value={[dateRange.start, dateRange.end]}
                    onChange={(newValue) => {
                      if (newValue[0] && newValue[1]) {
                        setDateRange({ start: newValue[0], end: newValue[1] });
                      }
                    }}
                    renderInput={(startProps, endProps) => (
                      <>
                        <TextField {...startProps} size="small" />
                        <Box sx={{ mx: 2 }}> to </Box>
                        <TextField {...endProps} size="small" />
                      </>
                    )}
                  />
                </LocalizationProvider>
              </Grid>
              <Grid item xs={12} md={2}>
                <ToggleButtonGroup
                  value={timeframe}
                  exclusive
                  onChange={(e, value) => value && setTimeframe(value)}
                  size="small"
                >
                  <ToggleButton value="daily">Daily</ToggleButton>
                  <ToggleButton value="weekly">Weekly</ToggleButton>
                  <ToggleButton value="monthly">Monthly</ToggleButton>
                </ToggleButtonGroup>
              </Grid>
              <Grid item xs={12} md={3}>
                <Autocomplete
                  multiple
                  options={['Restaurant A', 'Restaurant B', 'Restaurant C']} // Would be dynamic
                  value={selectedMerchants}
                  onChange={(e, value) => setSelectedMerchants(value)}
                  renderInput={(params) => (
                    <TextField {...params} label="Filter by Merchants" size="small" />
                  )}
                />
              </Grid>
              <Grid item xs={12} md={3}>
                <Autocomplete
                  multiple
                  options={['Italian', 'Chinese', 'Mexican', 'American']} // Would be dynamic
                  value={selectedCategories}
                  onChange={(e, value) => setSelectedCategories(value)}
                  renderInput={(params) => (
                    <TextField {...params} label="Filter by Categories" size="small" />
                  )}
                />
              </Grid>
            </Grid>
          </Paper>

          {loading && <LinearProgress sx={{ mb: 2 }} />}

          {/* Key Metrics */}
          <Grid container spacing={3} sx={{ mb: 3 }}>
            <Grid item xs={12} sm={6} md={3}>
              <Card>
                <CardContent>
                  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <Box>
                      <Typography color="textSecondary" gutterBottom>
                        Total Revenue
                      </Typography>
                      <Typography variant="h4">
                        {formatCurrency(analyticsData?.revenue.current || 0)}
                      </Typography>
                      <Box sx={{ display: 'flex', alignItems: 'center', mt: 1 }}>
                        {analyticsData?.revenue.change !== undefined && (
                          <>
                            {analyticsData.revenue.change > 0 ? (
                              <TrendingUp sx={{ color: 'success.main', mr: 0.5 }} />
                            ) : (
                              <TrendingDown sx={{ color: 'error.main', mr: 0.5 }} />
                            )}
                            <Typography
                              variant="body2"
                              color={analyticsData.revenue.change > 0 ? 'success.main' : 'error.main'}
                            >
                              {formatPercentage(analyticsData.revenue.change)}
                            </Typography>
                          </>
                        )}
                      </Box>
                    </Box>
                    <AttachMoney sx={{ fontSize: 40, color: 'success.main' }} />
                  </Box>
                </CardContent>
              </Card>
            </Grid>
            <Grid item xs={12} sm={6} md={3}>
              <Card>
                <CardContent>
                  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <Box>
                      <Typography color="textSecondary" gutterBottom>
                        Total Orders
                      </Typography>
                      <Typography variant="h4">
                        {analyticsData?.orders.total || 0}
                      </Typography>
                      <Box sx={{ display: 'flex', alignItems: 'center', mt: 1 }}>
                        <Typography variant="body2" color="text.secondary">
                          Avg: {formatCurrency(analyticsData?.orders.avgValue || 0)}
                        </Typography>
                      </Box>
                    </Box>
                    <ShoppingCart sx={{ fontSize: 40, color: 'primary.main' }} />
                  </Box>
                </CardContent>
              </Card>
            </Grid>
            <Grid item xs={12} sm={6} md={3}>
              <Card>
                <CardContent>
                  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <Box>
                      <Typography color="textSecondary" gutterBottom>
                        Total Customers
                      </Typography>
                      <Typography variant="h4">
                        {analyticsData?.customers.total || 0}
                      </Typography>
                      <Box sx={{ display: 'flex', alignItems: 'center', mt: 1 }}>
                        <Typography variant="body2" color="text.secondary">
                          New: {analyticsData?.customers.new || 0}
                        </Typography>
                      </Box>
                    </Box>
                    <People sx={{ fontSize: 40, color: 'info.main' }} />
                  </Box>
                </CardContent>
              </Card>
            </Grid>
            <Grid item xs={12} sm={6} md={3}>
              <Card>
                <CardContent>
                  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <Box>
                      <Typography color="textSecondary" gutterBottom>
                        Active Drivers
                      </Typography>
                      <Typography variant="h4">
                        {analyticsData?.drivers.active || 0}
                      </Typography>
                      <Box sx={{ display: 'flex', alignItems: 'center', mt: 1 }}>
                        <Star sx={{ color: 'warning.main', fontSize: 16, mr: 0.5 }} />
                        <Typography variant="body2" color="text.secondary">
                          {analyticsData?.drivers.avgRating?.toFixed(1) || 0}
                        </Typography>
                      </Box>
                    </Box>
                    <LocalShipping sx={{ fontSize: 40, color: 'secondary.main' }} />
                  </Box>
                </CardContent>
              </Card>
            </Grid>
          </Grid>

          {/* Tabs */}
          <Paper sx={{ mb: 3 }}>
            <Tabs
              value={selectedTab}
              onChange={(e, value) => setSelectedTab(value)}
              variant="scrollable"
              scrollButtons="auto"
            >
              <Tab label="Revenue & Orders" />
              <Tab label="Merchants" />
              <Tab label="Drivers" />
              <Tab label="Products" />
              <Tab label="Geography" />
              <Tab label="Customer Insights" />
            </Tabs>
          </Paper>

          {/* Tab Content */}
          {selectedTab === 0 && (
            <Grid container spacing={3}>
              {/* Revenue Chart */}
              <Grid item xs={12} md={8}>
                <Paper sx={{ p: 3 }}>
                  <Typography variant="h6" gutterBottom>
                    Revenue Trend
                  </Typography>
                  <Box sx={{ height: 400 }}>
                    <Line
                      data={revenueChartData}
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

              {/* Order Stats */}
              <Grid item xs={12} md={4}>
                <Paper sx={{ p: 3, height: '100%' }}>
                  <Typography variant="h6" gutterBottom>
                    Order Statistics
                  </Typography>
                  <Box sx={{ mt: 3 }}>
                    <Box sx={{ mb: 3 }}>
                      <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
                        <Typography variant="body2">Completed</Typography>
                        <Typography variant="body2" fontWeight="medium">
                          {analyticsData?.orders.completed || 0}
                        </Typography>
                      </Box>
                      <LinearProgress
                        variant="determinate"
                        value={(analyticsData?.orders.completed || 0) / (analyticsData?.orders.total || 1) * 100}
                        sx={{ height: 8, borderRadius: 4 }}
                        color="success"
                      />
                    </Box>
                    <Box sx={{ mb: 3 }}>
                      <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
                        <Typography variant="body2">Cancelled</Typography>
                        <Typography variant="body2" fontWeight="medium">
                          {analyticsData?.orders.cancelled || 0}
                        </Typography>
                      </Box>
                      <LinearProgress
                        variant="determinate"
                        value={(analyticsData?.orders.cancelled || 0) / (analyticsData?.orders.total || 1) * 100}
                        sx={{ height: 8, borderRadius: 4 }}
                        color="error"
                      />
                    </Box>
                  </Box>
                  <Box sx={{ mt: 4 }}>
                    <Doughnut
                      data={{
                        labels: ['Completed', 'Cancelled', 'Other'],
                        datasets: [{
                          data: [
                            analyticsData?.orders.completed || 0,
                            analyticsData?.orders.cancelled || 0,
                            (analyticsData?.orders.total || 0) - (analyticsData?.orders.completed || 0) - (analyticsData?.orders.cancelled || 0),
                          ],
                          backgroundColor: ['#4caf50', '#f44336', '#ff9800'],
                        }],
                      }}
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

              {/* Orders by Hour */}
              <Grid item xs={12}>
                <Paper sx={{ p: 3 }}>
                  <Typography variant="h6" gutterBottom>
                    Orders by Time of Day
                  </Typography>
                  <Box sx={{ height: 300 }}>
                    <Bar
                      data={ordersChartData}
                      options={{
                        responsive: true,
                        maintainAspectRatio: false,
                        plugins: {
                          legend: {
                            display: false,
                          },
                        },
                      }}
                    />
                  </Box>
                </Paper>
              </Grid>
            </Grid>
          )}

          {selectedTab === 1 && (
            <Grid container spacing={3}>
              {/* Top Performing Merchants */}
              <Grid item xs={12}>
                <Paper sx={{ p: 3 }}>
                  <Typography variant="h6" gutterBottom>
                    Top Performing Merchants
                  </Typography>
                  <TableContainer>
                    <Table>
                      <TableHead>
                        <TableRow>
                          <TableCell>Merchant</TableCell>
                          <TableCell align="right">Revenue</TableCell>
                          <TableCell align="right">Orders</TableCell>
                          <TableCell align="right">Avg Order Value</TableCell>
                          <TableCell align="center">Rating</TableCell>
                          <TableCell align="right">Commission</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {analyticsData?.merchants.topPerformers.map((merchant) => (
                          <TableRow key={merchant.id}>
                            <TableCell>
                              <Box sx={{ display: 'flex', alignItems: 'center' }}>
                                <Avatar sx={{ width: 32, height: 32, mr: 1, bgcolor: 'primary.main' }}>
                                  <Store fontSize="small" />
                                </Avatar>
                                {merchant.name}
                              </Box>
                            </TableCell>
                            <TableCell align="right">
                              {formatCurrency(merchant.revenue)}
                            </TableCell>
                            <TableCell align="right">{merchant.orders}</TableCell>
                            <TableCell align="right">
                              {formatCurrency(merchant.revenue / merchant.orders)}
                            </TableCell>
                            <TableCell align="center">
                              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                <Star sx={{ color: 'warning.main', fontSize: 16, mr: 0.5 }} />
                                {merchant.rating.toFixed(1)}
                              </Box>
                            </TableCell>
                            <TableCell align="right">
                              {formatCurrency(merchant.revenue * 0.15)}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                </Paper>
              </Grid>
            </Grid>
          )}

          {selectedTab === 2 && (
            <Grid container spacing={3}>
              {/* Driver Performance */}
              <Grid item xs={12} md={8}>
                <Paper sx={{ p: 3 }}>
                  <Typography variant="h6" gutterBottom>
                    Top Performing Drivers
                  </Typography>
                  <TableContainer>
                    <Table>
                      <TableHead>
                        <TableRow>
                          <TableCell>Driver</TableCell>
                          <TableCell align="right">Deliveries</TableCell>
                          <TableCell align="center">Rating</TableCell>
                          <TableCell align="right">Avg Delivery Time</TableCell>
                          <TableCell align="right">Earnings</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {analyticsData?.drivers.topPerformers.map((driver) => (
                          <TableRow key={driver.id}>
                            <TableCell>{driver.name}</TableCell>
                            <TableCell align="right">{driver.deliveries}</TableCell>
                            <TableCell align="center">
                              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                <Star sx={{ color: 'warning.main', fontSize: 16, mr: 0.5 }} />
                                {driver.rating.toFixed(1)}
                              </Box>
                            </TableCell>
                            <TableCell align="right">28 min</TableCell>
                            <TableCell align="right">
                              {formatCurrency(driver.earnings)}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                </Paper>
              </Grid>

              {/* Driver Stats */}
              <Grid item xs={12} md={4}>
                <Paper sx={{ p: 3 }}>
                  <Typography variant="h6" gutterBottom>
                    Driver Statistics
                  </Typography>
                  <Box sx={{ mt: 3 }}>
                    <Box sx={{ mb: 2 }}>
                      <Typography variant="body2" color="text.secondary">
                        Total Drivers
                      </Typography>
                      <Typography variant="h4">
                        {analyticsData?.drivers.total || 0}
                      </Typography>
                    </Box>
                    <Box sx={{ mb: 2 }}>
                      <Typography variant="body2" color="text.secondary">
                        Currently Active
                      </Typography>
                      <Typography variant="h4" color="success.main">
                        {analyticsData?.drivers.active || 0}
                      </Typography>
                    </Box>
                    <Box sx={{ mb: 2 }}>
                      <Typography variant="body2" color="text.secondary">
                        Average Rating
                      </Typography>
                      <Box sx={{ display: 'flex', alignItems: 'center' }}>
                        <Typography variant="h4">
                          {analyticsData?.drivers.avgRating?.toFixed(1) || 0}
                        </Typography>
                        <Star sx={{ color: 'warning.main', ml: 1 }} />
                      </Box>
                    </Box>
                    <Box>
                      <Typography variant="body2" color="text.secondary">
                        Avg Delivery Time
                      </Typography>
                      <Typography variant="h4">
                        {analyticsData?.drivers.avgDeliveryTime || 0} min
                      </Typography>
                    </Box>
                  </Box>
                </Paper>
              </Grid>
            </Grid>
          )}

          {selectedTab === 3 && (
            <Grid container spacing={3}>
              {/* Top Products */}
              <Grid item xs={12} md={8}>
                <Paper sx={{ p: 3 }}>
                  <Typography variant="h6" gutterBottom>
                    Top Selling Products
                  </Typography>
                  <TableContainer>
                    <Table>
                      <TableHead>
                        <TableRow>
                          <TableCell>Product</TableCell>
                          <TableCell>Merchant</TableCell>
                          <TableCell align="right">Orders</TableCell>
                          <TableCell align="right">Revenue</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {analyticsData?.products.topSelling.map((product) => (
                          <TableRow key={product.id}>
                            <TableCell>{product.name}</TableCell>
                            <TableCell>{product.merchant}</TableCell>
                            <TableCell align="right">{product.orders}</TableCell>
                            <TableCell align="right">
                              {formatCurrency(product.revenue)}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                </Paper>
              </Grid>

              {/* Category Distribution */}
              <Grid item xs={12} md={4}>
                <Paper sx={{ p: 3 }}>
                  <Typography variant="h6" gutterBottom>
                    Revenue by Category
                  </Typography>
                  <Box sx={{ height: 300 }}>
                    <Pie
                      data={categoryPieData}
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
          )}

          {selectedTab === 4 && (
            <Grid container spacing={3}>
              {/* Geographic Distribution */}
              <Grid item xs={12}>
                <Paper sx={{ p: 3 }}>
                  <Typography variant="h6" gutterBottom>
                    Orders by Area
                  </Typography>
                  <TableContainer>
                    <Table>
                      <TableHead>
                        <TableRow>
                          <TableCell>Area</TableCell>
                          <TableCell align="right">Orders</TableCell>
                          <TableCell align="right">Revenue</TableCell>
                          <TableCell align="right">Avg Order Value</TableCell>
                          <TableCell align="right">Growth</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {analyticsData?.geography.topAreas.map((area) => (
                          <TableRow key={area.area}>
                            <TableCell>
                              <Box sx={{ display: 'flex', alignItems: 'center' }}>
                                <LocationOn sx={{ mr: 1, color: 'text.secondary' }} />
                                {area.area}
                              </Box>
                            </TableCell>
                            <TableCell align="right">{area.orders}</TableCell>
                            <TableCell align="right">
                              {formatCurrency(area.revenue)}
                            </TableCell>
                            <TableCell align="right">
                              {formatCurrency(area.revenue / area.orders)}
                            </TableCell>
                            <TableCell align="right">
                              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end' }}>
                                <TrendingUp sx={{ color: 'success.main', mr: 0.5 }} />
                                <Typography color="success.main">+12.5%</Typography>
                              </Box>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                </Paper>
              </Grid>
            </Grid>
          )}

          {selectedTab === 5 && (
            <Grid container spacing={3}>
              {/* Customer Insights */}
              <Grid item xs={12} md={6}>
                <Paper sx={{ p: 3 }}>
                  <Typography variant="h6" gutterBottom>
                    Customer Segments
                  </Typography>
                  <Box sx={{ mt: 3 }}>
                    <Box sx={{ mb: 3 }}>
                      <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
                        <Typography variant="body2">New Customers</Typography>
                        <Typography variant="body2" fontWeight="medium">
                          {analyticsData?.customers.new || 0} ({formatPercentage((analyticsData?.customers.new || 0) / (analyticsData?.customers.total || 1) * 100)})
                        </Typography>
                      </Box>
                      <LinearProgress
                        variant="determinate"
                        value={(analyticsData?.customers.new || 0) / (analyticsData?.customers.total || 1) * 100}
                        sx={{ height: 8, borderRadius: 4 }}
                      />
                    </Box>
                    <Box sx={{ mb: 3 }}>
                      <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
                        <Typography variant="body2">Returning Customers</Typography>
                        <Typography variant="body2" fontWeight="medium">
                          {analyticsData?.customers.returning || 0} ({formatPercentage((analyticsData?.customers.returning || 0) / (analyticsData?.customers.total || 1) * 100)})
                        </Typography>
                      </Box>
                      <LinearProgress
                        variant="determinate"
                        value={(analyticsData?.customers.returning || 0) / (analyticsData?.customers.total || 1) * 100}
                        sx={{ height: 8, borderRadius: 4 }}
                        color="success"
                      />
                    </Box>
                  </Box>
                </Paper>
              </Grid>

              {/* Customer Lifetime Value */}
              <Grid item xs={12} md={6}>
                <Paper sx={{ p: 3 }}>
                  <Typography variant="h6" gutterBottom>
                    Customer Metrics
                  </Typography>
                  <Box sx={{ mt: 3 }}>
                    <Grid container spacing={3}>
                      <Grid item xs={6}>
                        <Typography variant="body2" color="text.secondary" gutterBottom>
                          Avg Lifetime Value
                        </Typography>
                        <Typography variant="h5">
                          {formatCurrency(analyticsData?.customers.avgLifetimeValue || 0)}
                        </Typography>
                      </Grid>
                      <Grid item xs={6}>
                        <Typography variant="body2" color="text.secondary" gutterBottom>
                          Avg Order Frequency
                        </Typography>
                        <Typography variant="h5">
                          3.2 orders/month
                        </Typography>
                      </Grid>
                      <Grid item xs={6}>
                        <Typography variant="body2" color="text.secondary" gutterBottom>
                          Retention Rate
                        </Typography>
                        <Typography variant="h5">
                          78.5%
                        </Typography>
                      </Grid>
                      <Grid item xs={6}>
                        <Typography variant="body2" color="text.secondary" gutterBottom>
                          Churn Rate
                        </Typography>
                        <Typography variant="h5">
                          21.5%
                        </Typography>
                      </Grid>
                    </Grid>
                  </Box>
                </Paper>
              </Grid>
            </Grid>
          )}
        </Box>
      </AdminLayout>
    </>
  );
}