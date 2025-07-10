import { Box, List, ListItem, ListItemButton, Typography, Chip, Avatar } from '@mui/material';
import { motion } from 'framer-motion';
import { format } from 'date-fns';
import { AccessTime, Person, AttachMoney } from '@mui/icons-material';

interface Order {
  id: string;
  orderNumber: string;
  customer: {
    name: string;
    avatar?: string;
  };
  status: string;
  type: string;
  total: number;
  itemCount: number;
  createdAt: string;
  estimatedReadyTime?: string;
  isScheduled: boolean;
  scheduledFor?: string;
}

interface OrdersListProps {
  orders: Order[];
  selectedOrderId: string | null;
  onSelectOrder: (orderId: string) => void;
  emptyMessage?: string;
}

export default function OrdersList({
  orders,
  selectedOrderId,
  onSelectOrder,
  emptyMessage = 'No orders',
}: OrdersListProps) {
  const getStatusColor = (status: string) => {
    switch (status) {
      case 'PENDING':
        return 'error';
      case 'ACCEPTED':
      case 'PREPARING':
        return 'warning';
      case 'READY_FOR_PICKUP':
        return 'success';
      case 'PICKED_UP':
      case 'DELIVERED':
        return 'default';
      default:
        return 'default';
    }
  };

  const getOrderAge = (createdAt: string) => {
    const now = new Date();
    const orderTime = new Date(createdAt);
    const diffInMinutes = Math.floor((now.getTime() - orderTime.getTime()) / 60000);

    if (diffInMinutes < 1) return 'Just now';
    if (diffInMinutes < 60) return `${diffInMinutes}m ago`;
    return format(orderTime, 'h:mm a');
  };

  if (orders.length === 0) {
    return (
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          color: 'text.secondary',
        }}
      >
        <Typography variant="h6">{emptyMessage}</Typography>
      </Box>
    );
  }

  return (
    <List sx={{ p: 0 }}>
      {orders.map((order, index) => (
        <motion.div
          key={order.id}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: index * 0.05 }}
        >
          <ListItem disablePadding>
            <ListItemButton
              selected={selectedOrderId === order.id}
              onClick={() => onSelectOrder(order.id)}
              sx={{
                py: 2,
                px: 2,
                borderBottom: '1px solid',
                borderColor: 'divider',
                '&.Mui-selected': {
                  bgcolor: 'primary.light',
                  '&:hover': {
                    bgcolor: 'primary.light',
                  },
                },
              }}
            >
              <Box sx={{ width: '100%' }}>
                {/* Header Row */}
                <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
                  <Typography variant="h6" sx={{ fontWeight: 600, mr: 2 }}>
                    #{order.orderNumber}
                  </Typography>
                  <Chip
                    label={order.status.replace(/_/g, ' ')}
                    size="small"
                    color={getStatusColor(order.status) as any}
                    sx={{ mr: 1 }}
                  />
                  <Chip
                    label={order.type}
                    size="small"
                    variant="outlined"
                    sx={{ mr: 'auto' }}
                  />
                  <Typography variant="body2" color="text.secondary">
                    {getOrderAge(order.createdAt)}
                  </Typography>
                </Box>

                {/* Customer Info */}
                <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
                  <Avatar
                    src={order.customer.avatar}
                    sx={{ width: 24, height: 24, mr: 1 }}
                  >
                    <Person fontSize="small" />
                  </Avatar>
                  <Typography variant="body2" sx={{ fontWeight: 500 }}>
                    {order.customer.name}
                  </Typography>
                </Box>

                {/* Order Details */}
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center' }}>
                    <AttachMoney fontSize="small" sx={{ mr: 0.5 }} />
                    <Typography variant="body1" sx={{ fontWeight: 600 }}>
                      ${order.total.toFixed(2)}
                    </Typography>
                  </Box>
                  <Typography variant="body2" color="text.secondary">
                    {order.itemCount} {order.itemCount === 1 ? 'item' : 'items'}
                  </Typography>
                  {order.isScheduled && (
                    <Box sx={{ display: 'flex', alignItems: 'center' }}>
                      <AccessTime fontSize="small" sx={{ mr: 0.5 }} />
                      <Typography variant="body2" color="warning.main">
                        Scheduled: {format(new Date(order.scheduledFor!), 'h:mm a')}
                      </Typography>
                    </Box>
                  )}
                </Box>

                {/* Urgency Indicator for New Orders */}
                {order.status === 'PENDING' && (
                  <Box sx={{ mt: 1 }}>
                    <motion.div
                      animate={{ opacity: [0.5, 1, 0.5] }}
                      transition={{ duration: 2, repeat: Infinity }}
                    >
                      <Typography
                        variant="body2"
                        sx={{
                          color: 'error.main',
                          fontWeight: 600,
                          textTransform: 'uppercase',
                        }}
                      >
                        Action Required
                      </Typography>
                    </motion.div>
                  </Box>
                )}
              </Box>
            </ListItemButton>
          </ListItem>
        </motion.div>
      ))}
    </List>
  );
}