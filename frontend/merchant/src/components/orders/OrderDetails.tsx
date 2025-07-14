import React from 'react';
import {
  Box,
  Typography,
  DialogTitle,
  DialogContent,
  IconButton,
  Divider,
  Chip,
  Grid,
  List,
  ListItem,
  ListItemText,
  Button,
  Paper,
  Timeline,
  TimelineItem,
  TimelineSeparator,
  TimelineConnector,
  TimelineContent,
  TimelineDot,
  TimelineOppositeContent,
} from '@mui/material';
import {
  Close,
  Receipt,
  Person,
  Phone,
  Email,
  LocationOn,
  Payment,
  Schedule,
  CheckCircle,
  LocalShipping,
  Restaurant,
  Print,
} from '@mui/icons-material';
import { format } from 'date-fns';

interface OrderDetailsProps {
  order: any;
  onClose: () => void;
  onStatusUpdate?: () => void;
}

export default function OrderDetails({ order, onClose, onStatusUpdate }: OrderDetailsProps) {
  const getStatusColor = (status: string) => {
    const colors: any = {
      pending: 'warning',
      confirmed: 'info',
      preparing: 'secondary',
      ready: 'success',
      picked_up: 'primary',
      delivered: 'success',
      cancelled: 'error',
    };
    return colors[status] || 'default';
  };

  const getTimelineIcon = (status: string) => {
    const icons: any = {
      pending: <Receipt />,
      confirmed: <CheckCircle />,
      preparing: <Restaurant />,
      ready: <CheckCircle />,
      picked_up: <LocalShipping />,
      delivered: <CheckCircle />,
    };
    return icons[status] || <Schedule />;
  };

  const handlePrint = () => {
    window.print();
  };

  return (
    <>
      <DialogTitle>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <Typography variant="h6">Order #{order.orderNumber}</Typography>
            <Chip
              label={order.status.replace('_', ' ').toUpperCase()}
              color={getStatusColor(order.status)}
              size="small"
            />
          </Box>
          <Box>
            <IconButton onClick={handlePrint} sx={{ mr: 1 }}>
              <Print />
            </IconButton>
            <IconButton onClick={onClose}>
              <Close />
            </IconButton>
          </Box>
        </Box>
      </DialogTitle>
      
      <DialogContent dividers>
        <Grid container spacing={3}>
          {/* Customer Information */}
          <Grid item xs={12} md={6}>
            <Paper sx={{ p: 2 }}>
              <Typography variant="subtitle1" fontWeight="medium" gutterBottom>
                Customer Information
              </Typography>
              <List dense>
                <ListItem>
                  <Person sx={{ mr: 2, color: 'text.secondary' }} />
                  <ListItemText
                    primary="Name"
                    secondary={order.customerName}
                  />
                </ListItem>
                <ListItem>
                  <Phone sx={{ mr: 2, color: 'text.secondary' }} />
                  <ListItemText
                    primary="Phone"
                    secondary={order.customerPhone}
                  />
                </ListItem>
                <ListItem>
                  <Email sx={{ mr: 2, color: 'text.secondary' }} />
                  <ListItemText
                    primary="Email"
                    secondary={order.customerEmail}
                  />
                </ListItem>
              </List>
            </Paper>
          </Grid>

          {/* Delivery Information */}
          <Grid item xs={12} md={6}>
            <Paper sx={{ p: 2 }}>
              <Typography variant="subtitle1" fontWeight="medium" gutterBottom>
                Delivery Information
              </Typography>
              <List dense>
                <ListItem>
                  <LocationOn sx={{ mr: 2, color: 'text.secondary' }} />
                  <ListItemText
                    primary="Address"
                    secondary={order.reskflowAddress}
                  />
                </ListItem>
                {order.reskflowInstructions && (
                  <ListItem>
                    <ListItemText
                      primary="Instructions"
                      secondary={order.reskflowInstructions}
                      sx={{ ml: 5 }}
                    />
                  </ListItem>
                )}
                <ListItem>
                  <Schedule sx={{ mr: 2, color: 'text.secondary' }} />
                  <ListItemText
                    primary="Estimated Delivery"
                    secondary={order.estimatedReadyTime ? 
                      format(new Date(order.estimatedReadyTime), 'MMM dd, HH:mm') : 
                      'Not set'
                    }
                  />
                </ListItem>
              </List>
            </Paper>
          </Grid>

          {/* Order Items */}
          <Grid item xs={12}>
            <Paper sx={{ p: 2 }}>
              <Typography variant="subtitle1" fontWeight="medium" gutterBottom>
                Order Items
              </Typography>
              <List>
                {order.items.map((item: any, index: number) => (
                  <ListItem key={index} divider={index < order.items.length - 1}>
                    <ListItemText
                      primary={`${item.quantity}x ${item.productName}`}
                      secondary={item.specialInstructions}
                    />
                    <Typography variant="body1" fontWeight="medium">
                      ${(item.price * item.quantity).toFixed(2)}
                    </Typography>
                  </ListItem>
                ))}
              </List>
              <Divider sx={{ my: 2 }} />
              <Box sx={{ px: 2 }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
                  <Typography>Subtotal</Typography>
                  <Typography>${order.subtotal.toFixed(2)}</Typography>
                </Box>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
                  <Typography>Tax</Typography>
                  <Typography>${order.tax.toFixed(2)}</Typography>
                </Box>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
                  <Typography>Delivery Fee</Typography>
                  <Typography>${order.reskflowFee.toFixed(2)}</Typography>
                </Box>
                <Divider sx={{ my: 1 }} />
                <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                  <Typography variant="h6">Total</Typography>
                  <Typography variant="h6">${order.total.toFixed(2)}</Typography>
                </Box>
              </Box>
            </Paper>
          </Grid>

          {/* Payment Information */}
          <Grid item xs={12} md={6}>
            <Paper sx={{ p: 2 }}>
              <Typography variant="subtitle1" fontWeight="medium" gutterBottom>
                Payment Information
              </Typography>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Payment sx={{ color: 'text.secondary' }} />
                <Box>
                  <Typography variant="body2">{order.paymentMethod}</Typography>
                  <Chip
                    label={order.paymentStatus}
                    color={order.paymentStatus === 'paid' ? 'success' : 'warning'}
                    size="small"
                    sx={{ mt: 0.5 }}
                  />
                </Box>
              </Box>
            </Paper>
          </Grid>

          {/* Driver Information */}
          {order.driverId && (
            <Grid item xs={12} md={6}>
              <Paper sx={{ p: 2 }}>
                <Typography variant="subtitle1" fontWeight="medium" gutterBottom>
                  Driver Information
                </Typography>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <LocalShipping sx={{ color: 'text.secondary' }} />
                  <Typography variant="body2">{order.driverName || 'Assigned'}</Typography>
                </Box>
              </Paper>
            </Grid>
          )}

          {/* Order Timeline */}
          <Grid item xs={12}>
            <Paper sx={{ p: 2 }}>
              <Typography variant="subtitle1" fontWeight="medium" gutterBottom>
                Order Timeline
              </Typography>
              <Timeline position="alternate">
                {order.statuses?.map((status: any, index: number) => (
                  <TimelineItem key={index}>
                    <TimelineOppositeContent color="text.secondary">
                      {format(new Date(status.timestamp), 'MMM dd, HH:mm')}
                    </TimelineOppositeContent>
                    <TimelineSeparator>
                      <TimelineDot
                        color={status.completed ? getStatusColor(status.status) : 'grey'}
                      >
                        {getTimelineIcon(status.status)}
                      </TimelineDot>
                      {index < order.statuses.length - 1 && <TimelineConnector />}
                    </TimelineSeparator>
                    <TimelineContent>
                      <Typography variant="body1" fontWeight={status.completed ? 'medium' : 'normal'}>
                        {status.status.replace('_', ' ').charAt(0).toUpperCase() + 
                         status.status.replace('_', ' ').slice(1)}
                      </Typography>
                    </TimelineContent>
                  </TimelineItem>
                ))}
              </Timeline>
            </Paper>
          </Grid>
        </Grid>
      </DialogContent>
    </>
  );
}