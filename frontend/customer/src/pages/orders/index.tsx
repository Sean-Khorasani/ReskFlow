import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { useDispatch, useSelector } from 'react-redux';
import {
  Container,
  Typography,
  Box,
  Tabs,
  Tab,
  Card,
  CardContent,
  CardActionArea,
  Grid,
  Chip,
  Button,
  Skeleton,
  Alert,
} from '@mui/material';
import AccessTimeIcon from '@mui/icons-material/AccessTime';
import ReceiptIcon from '@mui/icons-material/Receipt';
import RestaurantIcon from '@mui/icons-material/Restaurant';
import { AppDispatch, RootState } from '@/store';
import { fetchOrders } from '@/store/slices/ordersSlice';

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
      id={`orders-tabpanel-${index}`}
      aria-labelledby={`orders-tab-${index}`}
      {...other}
    >
      {value === index && <Box sx={{ py: 3 }}>{children}</Box>}
    </div>
  );
}

const getStatusColor = (status: string) => {
  switch (status) {
    case 'delivered':
      return 'success';
    case 'cancelled':
      return 'error';
    case 'preparing':
    case 'ready':
    case 'picked_up':
      return 'warning';
    default:
      return 'primary';
  }
};

export default function OrdersPage() {
  const router = useRouter();
  const dispatch = useDispatch<AppDispatch>();
  const { orders, isLoading, error } = useSelector((state: RootState) => state.orders);
  const { user } = useSelector((state: RootState) => state.auth);
  
  const [tabValue, setTabValue] = useState(0);

  useEffect(() => {
    if (!user) {
      router.push('/login?redirect=/orders');
    } else {
      dispatch(fetchOrders());
    }
  }, [dispatch, user, router]);

  const handleTabChange = (event: React.SyntheticEvent, newValue: number) => {
    setTabValue(newValue);
  };

  const handleOrderClick = (orderId: string) => {
    router.push(`/orders/${orderId}`);
  };

  const activeOrders = orders.filter(
    (order) => !['delivered', 'cancelled'].includes(order.status)
  );
  
  const pastOrders = orders.filter(
    (order) => ['delivered', 'cancelled'].includes(order.status)
  );

  const renderOrderCard = (order: any) => (
    <Card key={order.id} sx={{ mb: 2 }}>
      <CardActionArea onClick={() => handleOrderClick(order.id)}>
        <CardContent>
          <Box display="flex" justifyContent="space-between" alignItems="flex-start" mb={2}>
            <Box>
              <Typography variant="h6" gutterBottom>
                {order.merchantName}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Order #{order.id.slice(-6).toUpperCase()}
              </Typography>
            </Box>
            <Chip
              label={order.status.replace('_', ' ').toUpperCase()}
              color={getStatusColor(order.status) as any}
              size="small"
            />
          </Box>

          <Box display="flex" alignItems="center" gap={2} mb={2}>
            <Box display="flex" alignItems="center" gap={0.5}>
              <AccessTimeIcon fontSize="small" color="action" />
              <Typography variant="body2" color="text.secondary">
                {new Date(order.createdAt).toLocaleDateString()}
              </Typography>
            </Box>
            <Box display="flex" alignItems="center" gap={0.5}>
              <ReceiptIcon fontSize="small" color="action" />
              <Typography variant="body2" color="text.secondary">
                {order.items.length} items
              </Typography>
            </Box>
          </Box>

          <Box display="flex" justifyContent="space-between" alignItems="center">
            <Typography variant="body2" color="text.secondary">
              {order.items.map((item: any) => `${item.quantity}x ${item.name}`).join(', ')}
            </Typography>
            <Typography variant="h6">
              ${order.total.toFixed(2)}
            </Typography>
          </Box>

          {order.status === 'delivered' && (
            <Box mt={2}>
              <Button variant="outlined" size="small" fullWidth>
                Order Again
              </Button>
            </Box>
          )}
        </CardContent>
      </CardActionArea>
    </Card>
  );

  if (error) {
    return (
      <Container maxWidth="md" sx={{ py: 4 }}>
        <Alert severity="error">{error}</Alert>
      </Container>
    );
  }

  return (
    <Container maxWidth="md" sx={{ py: 4 }}>
      <Typography variant="h4" gutterBottom>
        Your Orders
      </Typography>

      <Box sx={{ borderBottom: 1, borderColor: 'divider' }}>
        <Tabs value={tabValue} onChange={handleTabChange} aria-label="orders tabs">
          <Tab label={`Active (${activeOrders.length})`} />
          <Tab label={`Past (${pastOrders.length})`} />
        </Tabs>
      </Box>

      <TabPanel value={tabValue} index={0}>
        {isLoading ? (
          <Box>
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} variant="rectangular" height={150} sx={{ mb: 2 }} />
            ))}
          </Box>
        ) : activeOrders.length === 0 ? (
          <Box textAlign="center" py={8}>
            <RestaurantIcon sx={{ fontSize: 100, color: 'text.secondary', mb: 2 }} />
            <Typography variant="h6" gutterBottom>
              No active orders
            </Typography>
            <Typography variant="body2" color="text.secondary" paragraph>
              When you place an order, it will appear here
            </Typography>
            <Button
              variant="contained"
              onClick={() => router.push('/')}
            >
              Browse Restaurants
            </Button>
          </Box>
        ) : (
          activeOrders.map(renderOrderCard)
        )}
      </TabPanel>

      <TabPanel value={tabValue} index={1}>
        {isLoading ? (
          <Box>
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} variant="rectangular" height={150} sx={{ mb: 2 }} />
            ))}
          </Box>
        ) : pastOrders.length === 0 ? (
          <Box textAlign="center" py={8}>
            <Typography variant="h6" gutterBottom>
              No past orders
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Your completed orders will appear here
            </Typography>
          </Box>
        ) : (
          pastOrders.map(renderOrderCard)
        )}
      </TabPanel>
    </Container>
  );
}