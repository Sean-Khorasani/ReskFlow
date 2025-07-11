import React, { useEffect, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import {
  Box,
  Tabs,
  Tab,
  Card,
  CardContent,
  Typography,
  Chip,
  Button,
  TextField,
  InputAdornment,
  Grid,
  IconButton,
  List,
  ListItem,
  ListItemText,
  Divider,
  Badge,
  Skeleton,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
} from '@mui/material';
import {
  Search,
  FilterList,
  CheckCircle,
  Cancel,
  Timer,
  LocalShipping,
  Print,
  Refresh,
} from '@mui/icons-material';
import { AppDispatch, RootState } from '@/store';
import {
  fetchOrders,
  acceptOrder,
  rejectOrder,
  markOrderAsReady,
  updateOrderStatus,
} from '@/store/slices/ordersSlice';
import MainLayout from '@/components/layouts/MainLayout';
import OrderDetails from '@/components/orders/OrderDetails';
import Head from 'next/head';
import { useSnackbar } from 'notistack';
import { format } from 'date-fns';

interface TabPanelProps {
  children?: React.ReactNode;
  index: number;
  value: number;
}

function TabPanel(props: TabPanelProps) {
  const { children, value, index, ...other } = props;
  return (
    <div
      role="tabpanel"
      hidden={value !== index}
      id={`order-tabpanel-${index}`}
      aria-labelledby={`order-tab-${index}`}
      {...other}
    >
      {value === index && <Box sx={{ py: 3 }}>{children}</Box>}
    </div>
  );
}

export default function OrdersPage() {
  const dispatch = useDispatch<AppDispatch>();
  const { enqueueSnackbar } = useSnackbar();
  const { orders, loading, stats } = useSelector((state: RootState) => state.orders);
  
  const [currentTab, setCurrentTab] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedOrder, setSelectedOrder] = useState<any>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [rejectDialog, setRejectDialog] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [orderToReject, setOrderToReject] = useState<any>(null);

  useEffect(() => {
    dispatch(fetchOrders());
  }, [dispatch]);

  const handleTabChange = (event: React.SyntheticEvent, newValue: number) => {
    setCurrentTab(newValue);
  };

  const handleAcceptOrder = async (orderId: string) => {
    try {
      await dispatch(acceptOrder(orderId)).unwrap();
      enqueueSnackbar('Order accepted successfully', { variant: 'success' });
    } catch (error) {
      enqueueSnackbar('Failed to accept order', { variant: 'error' });
    }
  };

  const handleRejectOrder = (order: any) => {
    setOrderToReject(order);
    setRejectDialog(true);
  };

  const confirmRejectOrder = async () => {
    if (!rejectReason.trim()) {
      enqueueSnackbar('Please provide a reason', { variant: 'warning' });
      return;
    }
    
    try {
      await dispatch(rejectOrder({ id: orderToReject.id, reason: rejectReason })).unwrap();
      enqueueSnackbar('Order rejected', { variant: 'info' });
      setRejectDialog(false);
      setRejectReason('');
      setOrderToReject(null);
    } catch (error) {
      enqueueSnackbar('Failed to reject order', { variant: 'error' });
    }
  };

  const handleMarkAsReady = async (orderId: string) => {
    try {
      await dispatch(markOrderAsReady(orderId)).unwrap();
      enqueueSnackbar('Order marked as ready', { variant: 'success' });
    } catch (error) {
      enqueueSnackbar('Failed to update order', { variant: 'error' });
    }
  };

  const handleRefresh = () => {
    dispatch(fetchOrders());
  };

  const handleViewDetails = (order: any) => {
    setSelectedOrder(order);
    setDetailsOpen(true);
  };

  const getStatusColor = (status: string): any => {
    const colors = {
      pending: 'warning',
      confirmed: 'info',
      preparing: 'secondary',
      ready: 'success',
      picked_up: 'primary',
      delivered: 'success',
      cancelled: 'error',
    };
    return colors[status as keyof typeof colors] || 'default';
  };

  const getStatusIcon = (status: string) => {
    const icons = {
      pending: <Timer />,
      confirmed: <CheckCircle />,
      preparing: <Timer />,
      ready: <CheckCircle />,
      picked_up: <LocalShipping />,
      delivered: <CheckCircle />,
      cancelled: <Cancel />,
    };
    return icons[status as keyof typeof icons] || <Timer />;
  };

  const filterOrdersByTab = (orders: any[]) => {
    const filtered = orders.filter(order =>
      order.orderNumber.toLowerCase().includes(searchQuery.toLowerCase()) ||
      order.customerName.toLowerCase().includes(searchQuery.toLowerCase())
    );

    switch (currentTab) {
      case 0: // New
        return filtered.filter(o => o.status === 'pending');
      case 1: // Preparing
        return filtered.filter(o => ['confirmed', 'preparing'].includes(o.status));
      case 2: // Ready
        return filtered.filter(o => o.status === 'ready');
      case 3: // Completed
        return filtered.filter(o => ['picked_up', 'delivered'].includes(o.status));
      case 4: // All
        return filtered;
      default:
        return [];
    }
  };

  const filteredOrders = filterOrdersByTab(orders);

  const OrderCard = ({ order }: { order: any }) => (
    <Card sx={{ mb: 2 }}>
      <CardContent>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <Box sx={{ flex: 1 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
              <Typography variant="h6">
                Order #{order.orderNumber}
              </Typography>
              <Chip
                icon={getStatusIcon(order.status)}
                label={order.status.replace('_', ' ').toUpperCase()}
                color={getStatusColor(order.status)}
                size="small"
              />
            </Box>
            
            <Typography variant="body2" color="text.secondary" gutterBottom>
              {order.customerName} • {format(new Date(order.createdAt), 'MMM dd, HH:mm')}
            </Typography>
            
            <Box sx={{ mt: 2 }}>
              <Typography variant="subtitle2" gutterBottom>
                Items ({order.items.length})
              </Typography>
              {order.items.slice(0, 2).map((item: any, index: number) => (
                <Typography key={index} variant="body2" color="text.secondary">
                  {item.quantity}x {item.productName}
                </Typography>
              ))}
              {order.items.length > 2 && (
                <Typography variant="body2" color="text.secondary">
                  +{order.items.length - 2} more items
                </Typography>
              )}
            </Box>
          </Box>
          
          <Box sx={{ textAlign: 'right' }}>
            <Typography variant="h6" gutterBottom>
              ${order.total.toFixed(2)}
            </Typography>
            <Typography variant="body2" color="text.secondary" gutterBottom>
              {order.paymentMethod}
            </Typography>
          </Box>
        </Box>
        
        <Divider sx={{ my: 2 }} />
        
        <Box sx={{ display: 'flex', gap: 1, justifyContent: 'space-between', alignItems: 'center' }}>
          <Box sx={{ display: 'flex', gap: 1 }}>
            {order.status === 'pending' && (
              <>
                <Button
                  variant="contained"
                  color="success"
                  size="small"
                  startIcon={<CheckCircle />}
                  onClick={() => handleAcceptOrder(order.id)}
                >
                  Accept
                </Button>
                <Button
                  variant="outlined"
                  color="error"
                  size="small"
                  startIcon={<Cancel />}
                  onClick={() => handleRejectOrder(order)}
                >
                  Reject
                </Button>
              </>
            )}
            {['confirmed', 'preparing'].includes(order.status) && (
              <Button
                variant="contained"
                color="primary"
                size="small"
                onClick={() => handleMarkAsReady(order.id)}
              >
                Mark as Ready
              </Button>
            )}
          </Box>
          
          <Box sx={{ display: 'flex', gap: 1 }}>
            <IconButton size="small" onClick={() => window.print()}>
              <Print />
            </IconButton>
            <Button
              variant="outlined"
              size="small"
              onClick={() => handleViewDetails(order)}
            >
              View Details
            </Button>
          </Box>
        </Box>
      </CardContent>
    </Card>
  );

  return (
    <>
      <Head>
        <title>Orders - ReskFlow Merchant</title>
      </Head>
      
      <MainLayout>
        <Box sx={{ flexGrow: 1 }}>
          {/* Header */}
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
            <Typography variant="h4" fontWeight="bold">
              Orders
            </Typography>
            <IconButton onClick={handleRefresh} color="primary">
              <Refresh />
            </IconButton>
          </Box>

          {/* Search and Filters */}
          <Box sx={{ display: 'flex', gap: 2, mb: 3 }}>
            <TextField
              placeholder="Search by order number or customer..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              sx={{ flex: 1 }}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <Search />
                  </InputAdornment>
                ),
              }}
            />
            <Button
              variant="outlined"
              startIcon={<FilterList />}
            >
              Filters
            </Button>
          </Box>

          {/* Tabs */}
          <Box sx={{ borderBottom: 1, borderColor: 'divider' }}>
            <Tabs value={currentTab} onChange={handleTabChange}>
              <Tab 
                label={
                  <Badge badgeContent={stats.pending} color="error">
                    New
                  </Badge>
                } 
              />
              <Tab 
                label={
                  <Badge badgeContent={stats.preparing} color="warning">
                    Preparing
                  </Badge>
                } 
              />
              <Tab 
                label={
                  <Badge badgeContent={stats.ready} color="success">
                    Ready
                  </Badge>
                } 
              />
              <Tab label="Completed" />
              <Tab label="All Orders" />
            </Tabs>
          </Box>

          {/* Order Lists */}
          {loading ? (
            <Box sx={{ py: 3 }}>
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} variant="rectangular" height={200} sx={{ mb: 2 }} />
              ))}
            </Box>
          ) : (
            <>
              {[0, 1, 2, 3, 4].map((index) => (
                <TabPanel key={index} value={currentTab} index={index}>
                  {filteredOrders.length > 0 ? (
                    filteredOrders.map((order) => (
                      <OrderCard key={order.id} order={order} />
                    ))
                  ) : (
                    <Box sx={{ textAlign: 'center', py: 8 }}>
                      <Typography variant="h6" color="text.secondary" gutterBottom>
                        No orders found
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        {searchQuery ? 'Try adjusting your search' : 'Orders will appear here'}
                      </Typography>
                    </Box>
                  )}
                </TabPanel>
              ))}
            </>
          )}
        </Box>

        {/* Order Details Dialog */}
        <Dialog
          open={detailsOpen}
          onClose={() => setDetailsOpen(false)}
          maxWidth="md"
          fullWidth
        >
          {selectedOrder && (
            <OrderDetails
              order={selectedOrder}
              onClose={() => setDetailsOpen(false)}
              onStatusUpdate={() => {
                dispatch(fetchOrders());
                setDetailsOpen(false);
              }}
            />
          )}
        </Dialog>

        {/* Reject Order Dialog */}
        <Dialog
          open={rejectDialog}
          onClose={() => setRejectDialog(false)}
          maxWidth="sm"
          fullWidth
        >
          <DialogTitle>Reject Order</DialogTitle>
          <DialogContent>
            <Typography variant="body2" color="text.secondary" gutterBottom>
              Please provide a reason for rejecting order #{orderToReject?.orderNumber}
            </Typography>
            <FormControl fullWidth sx={{ mt: 2 }}>
              <InputLabel>Reason</InputLabel>
              <Select
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                label="Reason"
              >
                <MenuItem value="Out of stock">Out of stock</MenuItem>
                <MenuItem value="Kitchen too busy">Kitchen too busy</MenuItem>
                <MenuItem value="Closing soon">Closing soon</MenuItem>
                <MenuItem value="Cannot deliver to area">Cannot deliver to area</MenuItem>
                <MenuItem value="Other">Other</MenuItem>
              </Select>
            </FormControl>
            {rejectReason === 'Other' && (
              <TextField
                fullWidth
                multiline
                rows={2}
                placeholder="Please specify..."
                sx={{ mt: 2 }}
                onChange={(e) => setRejectReason(e.target.value)}
              />
            )}
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setRejectDialog(false)}>Cancel</Button>
            <Button
              variant="contained"
              color="error"
              onClick={confirmRejectOrder}
              disabled={!rejectReason}
            >
              Reject Order
            </Button>
          </DialogActions>
        </Dialog>
      </MainLayout>
    </>
  );
}