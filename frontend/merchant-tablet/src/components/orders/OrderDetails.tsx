import { useState } from 'react';
import {
  Box,
  Typography,
  Button,
  Divider,
  List,
  ListItem,
  ListItemText,
  Chip,
  IconButton,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Avatar,
  Paper,
  Stack,
} from '@mui/material';
import {
  Close,
  Phone,
  Message,
  Timer,
  CheckCircle,
  Cancel,
  Restaurant,
  LocalShipping,
  Print,
  Edit,
} from '@mui/icons-material';
import { format } from 'date-fns';
import { motion } from 'framer-motion';
import { useOrder } from '@/hooks/useOrder';
import { useOrderActions } from '@/hooks/useOrderActions';
import { usePrinter } from '@/hooks/usePrinter';
import toast from 'react-hot-toast';

interface OrderDetailsProps {
  orderId: string;
  onClose: () => void;
}

export default function OrderDetails({ orderId, onClose }: OrderDetailsProps) {
  const { order, loading } = useOrder(orderId);
  const { acceptOrder, rejectOrder, markReady, updatePreparationTime } = useOrderActions();
  const { printOrder } = usePrinter();
  const [rejectDialogOpen, setRejectDialogOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [editTimeDialogOpen, setEditTimeDialogOpen] = useState(false);
  const [prepTime, setPrepTime] = useState(30);

  if (loading || !order) {
    return (
      <Box sx={{ p: 2 }}>
        <Typography>Loading order details...</Typography>
      </Box>
    );
  }

  const handleAcceptOrder = async () => {
    try {
      await acceptOrder(orderId, prepTime);
      toast.success('Order accepted!');
    } catch (error) {
      toast.error('Failed to accept order');
    }
  };

  const handleRejectOrder = async () => {
    if (!rejectReason.trim()) {
      toast.error('Please provide a reason');
      return;
    }

    try {
      await rejectOrder(orderId, rejectReason);
      toast.success('Order rejected');
      setRejectDialogOpen(false);
      setRejectReason('');
    } catch (error) {
      toast.error('Failed to reject order');
    }
  };

  const handleMarkReady = async () => {
    try {
      await markReady(orderId);
      toast.success('Order marked as ready!');
    } catch (error) {
      toast.error('Failed to update order');
    }
  };

  const handlePrintOrder = () => {
    printOrder(order);
    toast.success('Order sent to printer');
  };

  const handleUpdateTime = async () => {
    try {
      await updatePreparationTime(orderId, prepTime);
      toast.success('Preparation time updated');
      setEditTimeDialogOpen(false);
    } catch (error) {
      toast.error('Failed to update time');
    }
  };

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
        <Typography variant="h5" sx={{ fontWeight: 600, flexGrow: 1 }}>
          Order #{order.orderNumber}
        </Typography>
        <IconButton onClick={handlePrintOrder} sx={{ mr: 1 }}>
          <Print />
        </IconButton>
        <IconButton onClick={onClose}>
          <Close />
        </IconButton>
      </Box>

      {/* Order Status */}
      <Box sx={{ mb: 3 }}>
        <Chip
          label={order.status.replace(/_/g, ' ')}
          color={order.status === 'PENDING' ? 'error' : 'primary'}
          size="large"
          sx={{ fontWeight: 600 }}
        />
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
          Placed {format(new Date(order.createdAt), 'PPp')}
        </Typography>
      </Box>

      {/* Action Buttons */}
      {order.status === 'PENDING' && (
        <Stack direction="row" spacing={2} sx={{ mb: 3 }}>
          <Button
            variant="contained"
            color="success"
            size="large"
            startIcon={<CheckCircle />}
            onClick={handleAcceptOrder}
            sx={{ flexGrow: 1 }}
          >
            Accept Order
          </Button>
          <Button
            variant="outlined"
            color="error"
            size="large"
            startIcon={<Cancel />}
            onClick={() => setRejectDialogOpen(true)}
          >
            Reject
          </Button>
        </Stack>
      )}

      {order.status === 'PREPARING' && (
        <Stack direction="row" spacing={2} sx={{ mb: 3 }}>
          <Button
            variant="contained"
            color="success"
            size="large"
            startIcon={<Restaurant />}
            onClick={handleMarkReady}
            sx={{ flexGrow: 1 }}
          >
            Mark as Ready
          </Button>
          <IconButton
            onClick={() => setEditTimeDialogOpen(true)}
            sx={{ border: 1, borderColor: 'divider' }}
          >
            <Edit />
          </IconButton>
        </Stack>
      )}

      {/* Customer Info */}
      <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
          <Avatar src={order.customer.avatar} sx={{ mr: 2 }}>
            {order.customer.name[0]}
          </Avatar>
          <Box sx={{ flexGrow: 1 }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
              {order.customer.name}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Customer
            </Typography>
          </Box>
          <IconButton size="small" color="primary">
            <Phone />
          </IconButton>
          <IconButton size="small" color="primary">
            <Message />
          </IconButton>
        </Box>
      </Paper>

      {/* Delivery Info */}
      <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
          <LocalShipping sx={{ mr: 1, color: 'text.secondary' }} />
          <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
            {order.type} • {order.estimatedReadyTime ? `Ready by ${format(new Date(order.estimatedReadyTime), 'h:mm a')}` : 'ASAP'}
          </Typography>
        </Box>
        {order.type === 'DELIVERY' && (
          <Typography variant="body2" color="text.secondary">
            {order.reskflowAddress?.street}, {order.reskflowAddress?.city}
          </Typography>
        )}
        {order.instructions && (
          <Typography variant="body2" sx={{ mt: 1, fontStyle: 'italic' }}>
            "{order.instructions}"
          </Typography>
        )}
      </Paper>

      {/* Order Items */}
      <Box sx={{ flexGrow: 1, overflow: 'auto', mb: 2 }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1 }}>
          Items ({order.items.length})
        </Typography>
        <List dense>
          {order.items.map((item, index) => (
            <motion.div
              key={item.id}
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: index * 0.05 }}
            >
              <ListItem sx={{ px: 0 }}>
                <ListItemText
                  primary={
                    <Box sx={{ display: 'flex', alignItems: 'center' }}>
                      <Typography variant="body1" sx={{ fontWeight: 500 }}>
                        {item.quantity}x {item.menuItem.name}
                      </Typography>
                      <Typography variant="body1" sx={{ ml: 'auto' }}>
                        ${item.totalPrice.toFixed(2)}
                      </Typography>
                    </Box>
                  }
                  secondary={
                    <>
                      {item.modifiers && item.modifiers.length > 0 && (
                        <Typography variant="body2" color="text.secondary">
                          {item.modifiers.map((mod: any) => mod.modifierName).join(', ')}
                        </Typography>
                      )}
                      {item.specialRequest && (
                        <Typography variant="body2" sx={{ fontStyle: 'italic', color: 'warning.main' }}>
                          Note: {item.specialRequest}
                        </Typography>
                      )}
                    </>
                  }
                />
              </ListItem>
              {index < order.items.length - 1 && <Divider />}
            </motion.div>
          ))}
        </List>
      </Box>

      {/* Totals */}
      <Divider sx={{ mb: 2 }} />
      <Box>
        <Stack spacing={1}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
            <Typography variant="body2">Subtotal</Typography>
            <Typography variant="body2">${order.subtotal.toFixed(2)}</Typography>
          </Box>
          <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
            <Typography variant="body2">Tax</Typography>
            <Typography variant="body2">${order.tax.toFixed(2)}</Typography>
          </Box>
          <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
            <Typography variant="body2">Delivery Fee</Typography>
            <Typography variant="body2">${order.reskflowFee.toFixed(2)}</Typography>
          </Box>
          {order.tip > 0 && (
            <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
              <Typography variant="body2">Tip</Typography>
              <Typography variant="body2">${order.tip.toFixed(2)}</Typography>
            </Box>
          )}
          <Divider />
          <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
            <Typography variant="h6" sx={{ fontWeight: 600 }}>
              Total
            </Typography>
            <Typography variant="h6" sx={{ fontWeight: 600 }}>
              ${order.total.toFixed(2)}
            </Typography>
          </Box>
        </Stack>
      </Box>

      {/* Reject Dialog */}
      <Dialog open={rejectDialogOpen} onClose={() => setRejectDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Reject Order</DialogTitle>
        <DialogContent>
          <TextField
            fullWidth
            multiline
            rows={3}
            label="Reason for rejection"
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            placeholder="e.g., Out of stock, Kitchen closed, etc."
            sx={{ mt: 2 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRejectDialogOpen(false)}>Cancel</Button>
          <Button onClick={handleRejectOrder} color="error" variant="contained">
            Reject Order
          </Button>
        </DialogActions>
      </Dialog>

      {/* Edit Time Dialog */}
      <Dialog open={editTimeDialogOpen} onClose={() => setEditTimeDialogOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Update Preparation Time</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 2 }}>
            <TextField
              type="number"
              label="Minutes"
              value={prepTime}
              onChange={(e) => setPrepTime(parseInt(e.target.value) || 0)}
              inputProps={{ min: 5, max: 120, step: 5 }}
              fullWidth
            />
            <Stack direction="row" spacing={1}>
              {[15, 20, 30, 45, 60].map((time) => (
                <Chip
                  key={time}
                  label={`${time}m`}
                  onClick={() => setPrepTime(time)}
                  color={prepTime === time ? 'primary' : 'default'}
                  clickable
                />
              ))}
            </Stack>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditTimeDialogOpen(false)}>Cancel</Button>
          <Button onClick={handleUpdateTime} variant="contained">
            Update
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}