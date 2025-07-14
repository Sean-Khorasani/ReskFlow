import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { useDispatch, useSelector } from 'react-redux';
import {
  Container,
  Paper,
  Typography,
  Box,
  Stepper,
  Step,
  StepLabel,
  StepContent,
  Card,
  CardContent,
  Grid,
  Divider,
  Button,
  Avatar,
  Chip,
  List,
  ListItem,
  ListItemText,
  CircularProgress,
  Alert,
} from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import LocalShippingIcon from '@mui/icons-material/LocalShipping';
import RestaurantIcon from '@mui/icons-material/Restaurant';
import PhoneIcon from '@mui/icons-material/Phone';
import MessageIcon from '@mui/icons-material/Message';
import LocationOnIcon from '@mui/icons-material/LocationOn';
import AccessTimeIcon from '@mui/icons-material/AccessTime';
import { AppDispatch, RootState } from '@/store';
import { fetchOrderById, trackOrder } from '@/store/slices/ordersSlice';
import { useSocket } from '@/hooks/useSocket';
import Map from '@/components/Map';

const orderSteps = [
  { label: 'Order Placed', icon: CheckCircleIcon },
  { label: 'Restaurant Confirmed', icon: RestaurantIcon },
  { label: 'Preparing', icon: RestaurantIcon },
  { label: 'Ready for Pickup', icon: CheckCircleIcon },
  { label: 'Driver Assigned', icon: LocalShippingIcon },
  { label: 'Picked Up', icon: LocalShippingIcon },
  { label: 'On the Way', icon: LocalShippingIcon },
  { label: 'Delivered', icon: CheckCircleIcon },
];

const getActiveStep = (status: string) => {
  const statusMap: { [key: string]: number } = {
    'pending': 0,
    'confirmed': 1,
    'preparing': 2,
    'ready': 3,
    'assigned': 4,
    'picked_up': 5,
    'on_the_way': 6,
    'delivered': 7,
  };
  return statusMap[status] || 0;
};

export default function OrderTrackingPage() {
  const router = useRouter();
  const { id } = router.query;
  const dispatch = useDispatch<AppDispatch>();
  const socket = useSocket();
  
  const { currentOrder, isLoading, error } = useSelector((state: RootState) => state.orders);
  const [driverLocation, setDriverLocation] = useState<{ lat: number; lng: number } | null>(null);

  useEffect(() => {
    if (id) {
      dispatch(fetchOrderById(id as string));
      // Start tracking
      const interval = setInterval(() => {
        dispatch(trackOrder(id as string));
      }, 10000); // Update every 10 seconds
      
      return () => clearInterval(interval);
    }
  }, [dispatch, id]);

  useEffect(() => {
    if (socket && currentOrder) {
      // Subscribe to order updates
      socket.emit('track-order', { orderId: currentOrder.id });
      
      socket.on('order-status-update', (data) => {
        if (data.orderId === currentOrder.id) {
          dispatch(fetchOrderById(currentOrder.id));
        }
      });

      socket.on('driver-location-update', (data) => {
        if (data.orderId === currentOrder.id) {
          setDriverLocation({ lat: data.latitude, lng: data.longitude });
        }
      });

      return () => {
        socket.off('order-status-update');
        socket.off('driver-location-update');
      };
    }
  }, [socket, currentOrder, dispatch]);

  if (isLoading || !currentOrder) {
    return (
      <Container maxWidth="lg" sx={{ py: 4, textAlign: 'center' }}>
        <CircularProgress />
      </Container>
    );
  }

  if (error) {
    return (
      <Container maxWidth="lg" sx={{ py: 4 }}>
        <Alert severity="error">{error}</Alert>
      </Container>
    );
  }

  const activeStep = getActiveStep(currentOrder.status);

  return (
    <Container maxWidth="lg" sx={{ py: 4 }}>
      <Grid container spacing={3}>
        <Grid item xs={12} md={8}>
          <Paper sx={{ p: 3, mb: 3 }}>
            <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
              <Box>
                <Typography variant="h5" gutterBottom>
                  Order #{currentOrder.id.slice(-6).toUpperCase()}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {new Date(currentOrder.createdAt).toLocaleString()}
                </Typography>
              </Box>
              <Chip
                label={currentOrder.status.replace('_', ' ').toUpperCase()}
                color={currentOrder.status === 'delivered' ? 'success' : 'primary'}
              />
            </Box>

            <Stepper activeStep={activeStep} orientation="vertical">
              {orderSteps.map((step, index) => {
                const StepIcon = step.icon;
                return (
                  <Step key={step.label} completed={index < activeStep}>
                    <StepLabel
                      StepIconComponent={() => (
                        <Avatar
                          sx={{
                            bgcolor: index <= activeStep ? 'primary.main' : 'grey.300',
                            width: 32,
                            height: 32,
                          }}
                        >
                          <StepIcon fontSize="small" />
                        </Avatar>
                      )}
                    >
                      {step.label}
                    </StepLabel>
                    <StepContent>
                      <Typography variant="body2" color="text.secondary">
                        {index === activeStep && 'In progress...'}
                      </Typography>
                    </StepContent>
                  </Step>
                );
              })}
            </Stepper>
          </Paper>

          {/* Map for tracking */}
          {currentOrder.status !== 'delivered' && currentOrder.status !== 'cancelled' && (
            <Paper sx={{ p: 2, mb: 3, height: 400 }}>
              <Map
                center={driverLocation || { lat: 0, lng: 0 }}
                markers={[
                  {
                    position: { lat: 0, lng: 0 }, // Restaurant location
                    type: 'restaurant',
                  },
                  {
                    position: { lat: 0, lng: 0 }, // Delivery location
                    type: 'destination',
                  },
                  ...(driverLocation
                    ? [{ position: driverLocation, type: 'driver' as const }]
                    : []),
                ]}
              />
            </Paper>
          )}

          {/* Order Items */}
          <Paper sx={{ p: 3 }}>
            <Typography variant="h6" gutterBottom>
              Order Details
            </Typography>
            <Typography variant="subtitle2" color="text.secondary" gutterBottom>
              {currentOrder.merchantName}
            </Typography>
            
            <List>
              {currentOrder.items.map((item, index) => (
                <ListItem key={index} disableGutters>
                  <ListItemText
                    primary={`${item.quantity}x ${item.name}`}
                    secondary={item.specialInstructions}
                  />
                  <Typography variant="body1">
                    ${(item.price * item.quantity).toFixed(2)}
                  </Typography>
                </ListItem>
              ))}
            </List>

            <Divider sx={{ my: 2 }} />

            <Box>
              <Box display="flex" justifyContent="space-between" mb={1}>
                <Typography variant="body2">Subtotal</Typography>
                <Typography variant="body2">${currentOrder.subtotal.toFixed(2)}</Typography>
              </Box>
              <Box display="flex" justifyContent="space-between" mb={1}>
                <Typography variant="body2">Tax</Typography>
                <Typography variant="body2">${currentOrder.tax.toFixed(2)}</Typography>
              </Box>
              <Box display="flex" justifyContent="space-between" mb={1}>
                <Typography variant="body2">Delivery Fee</Typography>
                <Typography variant="body2">${currentOrder.reskflowFee.toFixed(2)}</Typography>
              </Box>
              <Divider sx={{ my: 1 }} />
              <Box display="flex" justifyContent="space-between">
                <Typography variant="h6">Total</Typography>
                <Typography variant="h6">${currentOrder.total.toFixed(2)}</Typography>
              </Box>
            </Box>
          </Paper>
        </Grid>

        <Grid item xs={12} md={4}>
          {/* Delivery Info */}
          <Card sx={{ mb: 3 }}>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                Delivery Information
              </Typography>
              
              <Box display="flex" alignItems="flex-start" mb={2}>
                <LocationOnIcon color="action" sx={{ mr: 1, mt: 0.5 }} />
                <Box>
                  <Typography variant="body2">{currentOrder.reskflowAddress}</Typography>
                  {currentOrder.reskflowInstructions && (
                    <Typography variant="caption" color="text.secondary">
                      {currentOrder.reskflowInstructions}
                    </Typography>
                  )}
                </Box>
              </Box>

              <Box display="flex" alignItems="center">
                <AccessTimeIcon color="action" sx={{ mr: 1 }} />
                <Typography variant="body2">
                  Estimated reskflow: {currentOrder.estimatedDeliveryTime}
                </Typography>
              </Box>
            </CardContent>
          </Card>

          {/* Driver Info */}
          {currentOrder.driverId && (
            <Card>
              <CardContent>
                <Typography variant="h6" gutterBottom>
                  Your Driver
                </Typography>
                
                <Box display="flex" alignItems="center" mb={2}>
                  <Avatar sx={{ mr: 2 }}>
                    {currentOrder.driverName?.[0] || 'D'}
                  </Avatar>
                  <Typography variant="body1">
                    {currentOrder.driverName || 'Driver'}
                  </Typography>
                </Box>

                <Box display="flex" gap={1}>
                  <Button
                    variant="outlined"
                    startIcon={<PhoneIcon />}
                    fullWidth
                    href={`tel:${currentOrder.driverPhone}`}
                  >
                    Call
                  </Button>
                  <Button
                    variant="outlined"
                    startIcon={<MessageIcon />}
                    fullWidth
                  >
                    Message
                  </Button>
                </Box>
              </CardContent>
            </Card>
          )}

          {/* Help */}
          <Card sx={{ mt: 3 }}>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                Need Help?
              </Typography>
              <Button variant="text" fullWidth sx={{ justifyContent: 'flex-start' }}>
                Report an issue
              </Button>
              <Button variant="text" fullWidth sx={{ justifyContent: 'flex-start' }}>
                Contact support
              </Button>
            </CardContent>
          </Card>
        </Grid>
      </Grid>
    </Container>
  );
}