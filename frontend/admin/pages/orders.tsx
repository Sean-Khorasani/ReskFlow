import React, { useState, useEffect } from 'react';
import {
  Box,
  Paper,
  Typography,
  TextField,
  Button,
  Chip,
  IconButton,
  Menu,
  MenuItem,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  InputAdornment,
  Avatar,
  Tab,
  Tabs,
  FormControl,
  InputLabel,
  Select,
  Grid,
  Card,
  CardContent,
  Timeline,
  TimelineItem,
  TimelineSeparator,
  TimelineDot,
  TimelineConnector,
  TimelineContent,
} from '@mui/material';
import { DataGrid, GridColDef, GridRenderCellParams } from '@mui/x-data-grid';
import {
  Search,
  FilterList,
  MoreVert,
  Visibility,
  Cancel,
  CheckCircle,
  LocalShipping,
  Restaurant,
  Person,
  Phone,
  LocationOn,
  AttachMoney,
  Refresh,
  Download,
  TwoWheeler,
  DirectionsCar,
  Timer,
  TrendingUp,
} from '@mui/icons-material';
import AdminLayout from '../components/layouts/AdminLayout';
import { orderApi } from '../services/api';
import { format, formatDistanceToNow } from 'date-fns';
import Head from 'next/head';

interface Order {
  id: string;
  orderNumber: string;
  customer: {
    id: string;
    name: string;
    phone: string;
    email: string;
  };
  merchant: {
    id: string;
    name: string;
    phone: string;
  };
  driver: {
    id: string;
    name: string;
    phone: string;
    vehicle: string;
    rating: number;
  } | null;
  items: {
    id: string;
    name: string;
    quantity: number;
    price: number;
    modifiers?: string[];
  }[];
  reskflowAddress: string;
  status: 'pending' | 'confirmed' | 'preparing' | 'ready' | 'picked_up' | 'delivered' | 'cancelled';
  paymentMethod: 'cash' | 'card' | 'wallet' | 'blockchain';
  paymentStatus: 'pending' | 'paid' | 'failed' | 'refunded';
  subtotal: number;
  reskflowFee: number;
  taxes: number;
  total: number;
  commission: number;
  estimatedDeliveryTime: string;
  createdAt: string;
  updatedAt: string;
  timeline: {
    status: string;
    timestamp: string;
    message?: string;
  }[];
  distance: number;
  duration: number;
  refundReason?: string;
  cancellationReason?: string;
  blockchain?: {
    txHash: string;
    escrowAddress: string;
    status: string;
  };
}

export default function OrdersPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [paymentFilter, setPaymentFilter] = useState('all');
  const [selectedTab, setSelectedTab] = useState(0);
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [orderDetailsDialog, setOrderDetailsDialog] = useState(false);
  const [refundDialog, setRefundDialog] = useState(false);
  const [refundAmount, setRefundAmount] = useState(0);
  const [refundReason, setRefundReason] = useState('');
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [totalRows, setTotalRows] = useState(0);
  const [dateRange, setDateRange] = useState({
    start: new Date(new Date().setHours(0, 0, 0, 0)),
    end: new Date(new Date().setHours(23, 59, 59, 999)),
  });

  // Real-time order stats
  const [orderStats, setOrderStats] = useState({
    totalOrders: 0,
    activeOrders: 0,
    completedOrders: 0,
    cancelledOrders: 0,
    totalRevenue: 0,
    avgOrderValue: 0,
    avgDeliveryTime: 0,
  });

  useEffect(() => {
    fetchOrders();
    fetchOrderStats();
    
    // Set up real-time updates
    const interval = setInterval(() => {
      fetchOrders();
      fetchOrderStats();
    }, 30000); // Update every 30 seconds

    return () => clearInterval(interval);
  }, [page, pageSize, statusFilter, paymentFilter, dateRange]);

  const fetchOrders = async () => {
    setLoading(true);
    try {
      const params = {
        page: page + 1,
        limit: pageSize,
        ...(statusFilter !== 'all' && { status: statusFilter }),
        ...(paymentFilter !== 'all' && { paymentMethod: paymentFilter }),
        ...(searchQuery && { search: searchQuery }),
        startDate: dateRange.start.toISOString(),
        endDate: dateRange.end.toISOString(),
      };
      
      const response = await orderApi.getOrders(params);
      setOrders(response.data.orders);
      setTotalRows(response.data.total);
    } catch (error) {
      console.error('Failed to fetch orders:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchOrderStats = async () => {
    // Fetch real-time order statistics
    setOrderStats({
      totalOrders: 245,
      activeOrders: 18,
      completedOrders: 220,
      cancelledOrders: 7,
      totalRevenue: 15420.50,
      avgOrderValue: 62.94,
      avgDeliveryTime: 32.5,
    });
  };

  const handleViewDetails = (order: Order) => {
    setSelectedOrder(order);
    setOrderDetailsDialog(true);
  };

  const handleRefund = () => {
    if (selectedOrder) {
      setRefundAmount(selectedOrder.total);
      setRefundDialog(true);
    }
  };

  const confirmRefund = async () => {
    if (!selectedOrder || !refundReason) return;
    
    try {
      await orderApi.refundOrder(selectedOrder.id, {
        amount: refundAmount,
        reason: refundReason,
      });
      fetchOrders();
      setRefundDialog(false);
      setOrderDetailsDialog(false);
      setRefundReason('');
    } catch (error) {
      console.error('Failed to refund order:', error);
    }
  };

  const handleCancelOrder = async (orderId: string, reason: string) => {
    try {
      await orderApi.cancelOrder(orderId, reason);
      fetchOrders();
    } catch (error) {
      console.error('Failed to cancel order:', error);
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'pending': return <Timer color="warning" />;
      case 'confirmed': return <CheckCircle color="info" />;
      case 'preparing': return <Restaurant color="primary" />;
      case 'ready': return <CheckCircle color="success" />;
      case 'picked_up': return <LocalShipping color="primary" />;
      case 'delivered': return <CheckCircle color="success" />;
      case 'cancelled': return <Cancel color="error" />;
      default: return <Timer />;
    }
  };

  const columns: GridColDef[] = [
    {
      field: 'orderNumber',
      headerName: 'Order #',
      width: 120,
      renderCell: (params: GridRenderCellParams) => (
        <Typography variant="body2" fontWeight="medium">
          #{params.value}
        </Typography>
      ),
    },
    {
      field: 'customer',
      headerName: 'Customer',
      width: 200,
      renderCell: (params: GridRenderCellParams) => (
        <Box>
          <Typography variant="body2">{params.value.name}</Typography>
          <Typography variant="caption" color="text.secondary">
            {params.value.phone}
          </Typography>
        </Box>
      ),
    },
    {
      field: 'merchant',
      headerName: 'Merchant',
      width: 200,
      renderCell: (params: GridRenderCellParams) => (
        <Box sx={{ display: 'flex', alignItems: 'center' }}>
          <Avatar sx={{ width: 32, height: 32, mr: 1, bgcolor: 'primary.main' }}>
            <Restaurant fontSize="small" />
          </Avatar>
          <Typography variant="body2">{params.value.name}</Typography>
        </Box>
      ),
    },
    {
      field: 'driver',
      headerName: 'Driver',
      width: 180,
      renderCell: (params: GridRenderCellParams) => {
        if (!params.value) {
          return <Chip label="Not Assigned" size="small" color="warning" />;
        }
        return (
          <Box sx={{ display: 'flex', alignItems: 'center' }}>
            <Avatar sx={{ width: 32, height: 32, mr: 1 }}>
              {params.value.vehicle === 'bike' ? <TwoWheeler /> : <DirectionsCar />}
            </Avatar>
            <Box>
              <Typography variant="body2">{params.value.name}</Typography>
              <Typography variant="caption" color="text.secondary">
                ⭐ {params.value.rating.toFixed(1)}
              </Typography>
            </Box>
          </Box>
        );
      },
    },
    {
      field: 'status',
      headerName: 'Status',
      width: 140,
      renderCell: (params: GridRenderCellParams) => (
        <Chip
          label={params.value.replace('_', ' ')}
          color={
            params.value === 'delivered' ? 'success' :
            params.value === 'cancelled' ? 'error' :
            params.value === 'pending' ? 'warning' : 'primary'
          }
          size="small"
          icon={getStatusIcon(params.value)}
        />
      ),
    },
    {
      field: 'paymentMethod',
      headerName: 'Payment',
      width: 120,
      renderCell: (params: GridRenderCellParams) => (
        <Chip
          label={params.value}
          variant="outlined"
          size="small"
          color={params.value === 'blockchain' ? 'secondary' : 'default'}
        />
      ),
    },
    {
      field: 'total',
      headerName: 'Total',
      width: 100,
      type: 'number',
      renderCell: (params: GridRenderCellParams) => (
        <Typography variant="body2" fontWeight="medium">
          ${params.value.toFixed(2)}
        </Typography>
      ),
    },
    {
      field: 'commission',
      headerName: 'Commission',
      width: 110,
      type: 'number',
      renderCell: (params: GridRenderCellParams) => (
        <Typography variant="body2" color="success.main">
          ${params.value.toFixed(2)}
        </Typography>
      ),
    },
    {
      field: 'estimatedDeliveryTime',
      headerName: 'ETA',
      width: 100,
      renderCell: (params: GridRenderCellParams) => {
        const eta = new Date(params.value);
        const isLate = eta < new Date() && params.row.status !== 'delivered';
        return (
          <Typography 
            variant="body2" 
            color={isLate ? 'error.main' : 'text.secondary'}
          >
            {format(eta, 'HH:mm')}
          </Typography>
        );
      },
    },
    {
      field: 'createdAt',
      headerName: 'Created',
      width: 150,
      renderCell: (params: GridRenderCellParams) => (
        <Box>
          <Typography variant="body2">
            {format(new Date(params.value), 'MMM dd, HH:mm')}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {formatDistanceToNow(new Date(params.value), { addSuffix: true })}
          </Typography>
        </Box>
      ),
    },
    {
      field: 'actions',
      headerName: 'Actions',
      width: 80,
      sortable: false,
      renderCell: (params: GridRenderCellParams) => (
        <IconButton
          size="small"
          onClick={() => handleViewDetails(params.row as Order)}
        >
          <Visibility />
        </IconButton>
      ),
    },
  ];

  const getActiveOrdersCount = () => {
    return orders.filter(o => 
      ['pending', 'confirmed', 'preparing', 'ready', 'picked_up'].includes(o.status)
    ).length;
  };

  return (
    <>
      <Head>
        <title>Order Monitoring - ReskFlow Admin</title>
      </Head>
      
      <AdminLayout>
        <Box sx={{ flexGrow: 1 }}>
          {/* Header */}
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
            <Typography variant="h4" fontWeight="bold">
              Order Monitoring
            </Typography>
            <Box sx={{ display: 'flex', gap: 2 }}>
              <Button
                variant="outlined"
                startIcon={<Refresh />}
                onClick={() => {
                  fetchOrders();
                  fetchOrderStats();
                }}
              >
                Refresh
              </Button>
              <Button
                variant="outlined"
                startIcon={<Download />}
              >
                Export
              </Button>
            </Box>
          </Box>

          {/* Stats Cards */}
          <Grid container spacing={3} sx={{ mb: 3 }}>
            <Grid item xs={12} sm={6} md={3}>
              <Card>
                <CardContent>
                  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <Box>
                      <Typography color="textSecondary" gutterBottom>
                        Total Orders Today
                      </Typography>
                      <Typography variant="h4">
                        {orderStats.totalOrders}
                      </Typography>
                    </Box>
                    <TrendingUp sx={{ fontSize: 40, color: 'primary.main' }} />
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
                        Active Orders
                      </Typography>
                      <Typography variant="h4" color="warning.main">
                        {orderStats.activeOrders}
                      </Typography>
                    </Box>
                    <LocalShipping sx={{ fontSize: 40, color: 'warning.main' }} />
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
                        Today's Revenue
                      </Typography>
                      <Typography variant="h4">
                        ${orderStats.totalRevenue.toLocaleString()}
                      </Typography>
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
                        Avg Delivery Time
                      </Typography>
                      <Typography variant="h4">
                        {orderStats.avgDeliveryTime} min
                      </Typography>
                    </Box>
                    <Timer sx={{ fontSize: 40, color: 'info.main' }} />
                  </Box>
                </CardContent>
              </Card>
            </Grid>
          </Grid>

          {/* Filters */}
          <Paper sx={{ p: 2, mb: 3 }}>
            <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap' }}>
              <TextField
                placeholder="Search orders..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && fetchOrders()}
                sx={{ flex: 1, minWidth: 300 }}
                InputProps={{
                  startAdornment: (
                    <InputAdornment position="start">
                      <Search />
                    </InputAdornment>
                  ),
                }}
              />
              
              <FormControl sx={{ minWidth: 150 }}>
                <InputLabel>Status</InputLabel>
                <Select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  label="Status"
                >
                  <MenuItem value="all">All Status</MenuItem>
                  <MenuItem value="pending">Pending</MenuItem>
                  <MenuItem value="confirmed">Confirmed</MenuItem>
                  <MenuItem value="preparing">Preparing</MenuItem>
                  <MenuItem value="ready">Ready</MenuItem>
                  <MenuItem value="picked_up">Picked Up</MenuItem>
                  <MenuItem value="delivered">Delivered</MenuItem>
                  <MenuItem value="cancelled">Cancelled</MenuItem>
                </Select>
              </FormControl>
              
              <FormControl sx={{ minWidth: 150 }}>
                <InputLabel>Payment</InputLabel>
                <Select
                  value={paymentFilter}
                  onChange={(e) => setPaymentFilter(e.target.value)}
                  label="Payment"
                >
                  <MenuItem value="all">All Payments</MenuItem>
                  <MenuItem value="cash">Cash</MenuItem>
                  <MenuItem value="card">Card</MenuItem>
                  <MenuItem value="wallet">Wallet</MenuItem>
                  <MenuItem value="blockchain">Blockchain</MenuItem>
                </Select>
              </FormControl>
            </Box>
          </Paper>

          {/* Tabs */}
          <Paper sx={{ mb: 3 }}>
            <Tabs
              value={selectedTab}
              onChange={(e, value) => {
                setSelectedTab(value);
                if (value === 1) setStatusFilter('all');
                else if (value === 2) setStatusFilter('delivered');
                else if (value === 3) setStatusFilter('cancelled');
                else setStatusFilter('all');
              }}
              variant="fullWidth"
            >
              <Tab label={`All Orders (${totalRows})`} />
              <Tab label={`Active (${getActiveOrdersCount()})`} />
              <Tab label="Completed" />
              <Tab label="Cancelled" />
            </Tabs>
          </Paper>

          {/* Orders Grid */}
          <Paper sx={{ height: 600 }}>
            <DataGrid
              rows={orders}
              columns={columns}
              loading={loading}
              paginationMode="server"
              rowCount={totalRows}
              pageSizeOptions={[10, 25, 50, 100]}
              paginationModel={{
                page,
                pageSize,
              }}
              onPaginationModelChange={(model) => {
                setPage(model.page);
                setPageSize(model.pageSize);
              }}
              disableRowSelectionOnClick
              getRowClassName={(params) => {
                if (params.row.status === 'cancelled') return 'order-cancelled';
                if (['pending', 'confirmed'].includes(params.row.status)) return 'order-urgent';
                return '';
              }}
              sx={{
                '& .order-urgent': {
                  bgcolor: 'warning.lighter',
                },
                '& .order-cancelled': {
                  bgcolor: 'grey.100',
                  opacity: 0.8,
                },
              }}
            />
          </Paper>
        </Box>

        {/* Order Details Dialog */}
        <Dialog
          open={orderDetailsDialog}
          onClose={() => setOrderDetailsDialog(false)}
          maxWidth="md"
          fullWidth
        >
          <DialogTitle>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <Typography variant="h6">Order #{selectedOrder?.orderNumber}</Typography>
              {selectedOrder && (
                <Chip
                  label={selectedOrder.status.replace('_', ' ')}
                  color={
                    selectedOrder.status === 'delivered' ? 'success' :
                    selectedOrder.status === 'cancelled' ? 'error' : 'primary'
                  }
                />
              )}
            </Box>
          </DialogTitle>
          <DialogContent>
            {selectedOrder && (
              <Box>
                {/* Customer & Merchant Info */}
                <Grid container spacing={3} sx={{ mb: 3 }}>
                  <Grid item xs={12} md={6}>
                    <Paper sx={{ p: 2 }}>
                      <Typography variant="subtitle2" gutterBottom>Customer</Typography>
                      <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
                        <Person sx={{ mr: 1, color: 'text.secondary' }} />
                        <Typography>{selectedOrder.customer.name}</Typography>
                      </Box>
                      <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
                        <Phone sx={{ mr: 1, color: 'text.secondary' }} />
                        <Typography>{selectedOrder.customer.phone}</Typography>
                      </Box>
                      <Box sx={{ display: 'flex', alignItems: 'flex-start' }}>
                        <LocationOn sx={{ mr: 1, color: 'text.secondary' }} />
                        <Typography>{selectedOrder.reskflowAddress}</Typography>
                      </Box>
                    </Paper>
                  </Grid>
                  <Grid item xs={12} md={6}>
                    <Paper sx={{ p: 2 }}>
                      <Typography variant="subtitle2" gutterBottom>Merchant</Typography>
                      <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
                        <Restaurant sx={{ mr: 1, color: 'text.secondary' }} />
                        <Typography>{selectedOrder.merchant.name}</Typography>
                      </Box>
                      <Box sx={{ display: 'flex', alignItems: 'center' }}>
                        <Phone sx={{ mr: 1, color: 'text.secondary' }} />
                        <Typography>{selectedOrder.merchant.phone}</Typography>
                      </Box>
                    </Paper>
                  </Grid>
                </Grid>

                {/* Order Items */}
                <Paper sx={{ p: 2, mb: 3 }}>
                  <Typography variant="subtitle2" gutterBottom>Order Items</Typography>
                  {selectedOrder.items.map((item) => (
                    <Box key={item.id} sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
                      <Box>
                        <Typography>{item.quantity}x {item.name}</Typography>
                        {item.modifiers && item.modifiers.length > 0 && (
                          <Typography variant="caption" color="text.secondary">
                            {item.modifiers.join(', ')}
                          </Typography>
                        )}
                      </Box>
                      <Typography>${(item.quantity * item.price).toFixed(2)}</Typography>
                    </Box>
                  ))}
                  <Box sx={{ borderTop: 1, borderColor: 'divider', pt: 1, mt: 2 }}>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                      <Typography variant="body2">Subtotal</Typography>
                      <Typography variant="body2">${selectedOrder.subtotal.toFixed(2)}</Typography>
                    </Box>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                      <Typography variant="body2">Delivery Fee</Typography>
                      <Typography variant="body2">${selectedOrder.reskflowFee.toFixed(2)}</Typography>
                    </Box>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                      <Typography variant="body2">Taxes</Typography>
                      <Typography variant="body2">${selectedOrder.taxes.toFixed(2)}</Typography>
                    </Box>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', fontWeight: 'bold' }}>
                      <Typography>Total</Typography>
                      <Typography>${selectedOrder.total.toFixed(2)}</Typography>
                    </Box>
                  </Box>
                </Paper>

                {/* Order Timeline */}
                <Paper sx={{ p: 2 }}>
                  <Typography variant="subtitle2" gutterBottom>Order Timeline</Typography>
                  <Timeline position="alternate">
                    {selectedOrder.timeline.map((event, index) => (
                      <TimelineItem key={index}>
                        <TimelineSeparator>
                          <TimelineDot color={index === 0 ? 'primary' : 'grey'} />
                          {index < selectedOrder.timeline.length - 1 && <TimelineConnector />}
                        </TimelineSeparator>
                        <TimelineContent>
                          <Typography variant="body2">{event.status}</Typography>
                          <Typography variant="caption" color="text.secondary">
                            {format(new Date(event.timestamp), 'MMM dd, HH:mm')}
                          </Typography>
                          {event.message && (
                            <Typography variant="caption" display="block">
                              {event.message}
                            </Typography>
                          )}
                        </TimelineContent>
                      </TimelineItem>
                    ))}
                  </Timeline>
                </Paper>

                {/* Blockchain Info */}
                {selectedOrder.blockchain && (
                  <Paper sx={{ p: 2, mt: 2 }}>
                    <Typography variant="subtitle2" gutterBottom>Blockchain Details</Typography>
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                      <Box>
                        <Typography variant="caption" color="text.secondary">Transaction Hash</Typography>
                        <Typography variant="body2" sx={{ wordBreak: 'break-all' }}>
                          {selectedOrder.blockchain.txHash}
                        </Typography>
                      </Box>
                      <Box>
                        <Typography variant="caption" color="text.secondary">Escrow Address</Typography>
                        <Typography variant="body2" sx={{ wordBreak: 'break-all' }}>
                          {selectedOrder.blockchain.escrowAddress}
                        </Typography>
                      </Box>
                      <Chip 
                        label={`Blockchain Status: ${selectedOrder.blockchain.status}`}
                        color={selectedOrder.blockchain.status === 'confirmed' ? 'success' : 'warning'}
                        size="small"
                      />
                    </Box>
                  </Paper>
                )}
              </Box>
            )}
          </DialogContent>
          <DialogActions>
            {selectedOrder?.status === 'delivered' && selectedOrder.paymentStatus === 'paid' && (
              <Button onClick={handleRefund} color="warning">
                Process Refund
              </Button>
            )}
            {selectedOrder && ['pending', 'confirmed'].includes(selectedOrder.status) && (
              <Button 
                onClick={() => handleCancelOrder(selectedOrder.id, 'Admin cancelled')}
                color="error"
              >
                Cancel Order
              </Button>
            )}
            <Button onClick={() => setOrderDetailsDialog(false)}>Close</Button>
          </DialogActions>
        </Dialog>

        {/* Refund Dialog */}
        <Dialog
          open={refundDialog}
          onClose={() => setRefundDialog(false)}
          maxWidth="sm"
          fullWidth
        >
          <DialogTitle>Process Refund</DialogTitle>
          <DialogContent>
            <Typography variant="body2" color="text.secondary" gutterBottom>
              Processing refund for Order #{selectedOrder?.orderNumber}
            </Typography>
            <TextField
              fullWidth
              label="Refund Amount"
              type="number"
              value={refundAmount}
              onChange={(e) => setRefundAmount(parseFloat(e.target.value))}
              InputProps={{
                startAdornment: <InputAdornment position="start">$</InputAdornment>,
              }}
              sx={{ mt: 2, mb: 2 }}
            />
            <TextField
              fullWidth
              multiline
              rows={3}
              label="Refund Reason"
              value={refundReason}
              onChange={(e) => setRefundReason(e.target.value)}
              placeholder="Please provide a reason for the refund..."
            />
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setRefundDialog(false)}>Cancel</Button>
            <Button
              onClick={confirmRefund}
              variant="contained"
              color="warning"
              disabled={!refundReason || refundAmount <= 0}
            >
              Process Refund
            </Button>
          </DialogActions>
        </Dialog>
      </AdminLayout>
    </>
  );
}