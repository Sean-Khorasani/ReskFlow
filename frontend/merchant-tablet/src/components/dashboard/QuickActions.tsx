import { Box, Button, Stack, Switch, FormControlLabel, Paper, Typography } from '@mui/material';
import {
  PowerSettingsNew,
  Pause,
  Schedule,
  MenuBook,
  Inventory,
  LocalOffer,
  Settings,
  NotificationsActive,
} from '@mui/icons-material';
import { useState } from 'react';
import { useStore } from '@/store/useStore';
import toast from 'react-hot-toast';

export default function QuickActions() {
  const { merchant, updateMerchantStatus } = useStore();
  const [isOpen, setIsOpen] = useState(merchant?.isOpen || false);
  const [autoAccept, setAutoAccept] = useState(merchant?.autoAcceptOrders || false);
  const [isPaused, setIsPaused] = useState(false);

  const handleToggleOpen = async () => {
    try {
      const newStatus = !isOpen;
      await updateMerchantStatus({ isOpen: newStatus });
      setIsOpen(newStatus);
      toast.success(newStatus ? 'Store is now OPEN' : 'Store is now CLOSED');
    } catch (error) {
      toast.error('Failed to update store status');
    }
  };

  const handleToggleAutoAccept = async () => {
    try {
      const newStatus = !autoAccept;
      await updateMerchantStatus({ autoAcceptOrders: newStatus });
      setAutoAccept(newStatus);
      toast.success(newStatus ? 'Auto-accept enabled' : 'Auto-accept disabled');
    } catch (error) {
      toast.error('Failed to update auto-accept');
    }
  };

  const handlePauseOrders = () => {
    setIsPaused(!isPaused);
    toast.success(isPaused ? 'Orders resumed' : 'Orders paused for 30 minutes');
  };

  return (
    <Paper sx={{ p: 2 }}>
      <Stack direction="row" spacing={2} alignItems="center">
        {/* Store Status */}
        <Box sx={{ minWidth: 200 }}>
          <Button
            variant="contained"
            size="large"
            fullWidth
            color={isOpen ? 'success' : 'error'}
            startIcon={<PowerSettingsNew />}
            onClick={handleToggleOpen}
            sx={{
              height: 56,
              fontSize: '1.125rem',
              fontWeight: 600,
            }}
          >
            Store is {isOpen ? 'OPEN' : 'CLOSED'}
          </Button>
        </Box>

        {/* Auto Accept */}
        <Paper variant="outlined" sx={{ px: 2, py: 1 }}>
          <FormControlLabel
            control={
              <Switch
                checked={autoAccept}
                onChange={handleToggleAutoAccept}
                color="primary"
              />
            }
            label={
              <Box>
                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                  Auto-Accept
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  Automatically accept orders
                </Typography>
              </Box>
            }
          />
        </Paper>

        {/* Pause Orders */}
        <Button
          variant="outlined"
          size="large"
          startIcon={<Pause />}
          onClick={handlePauseOrders}
          color={isPaused ? 'error' : 'inherit'}
          sx={{ height: 56 }}
        >
          {isPaused ? 'Resume' : 'Pause'} Orders
        </Button>

        {/* Quick Actions */}
        <Box sx={{ ml: 'auto', display: 'flex', gap: 1 }}>
          <Button
            variant="outlined"
            startIcon={<Schedule />}
            sx={{ height: 56 }}
          >
            Hours
          </Button>
          <Button
            variant="outlined"
            startIcon={<MenuBook />}
            sx={{ height: 56 }}
          >
            Menu
          </Button>
          <Button
            variant="outlined"
            startIcon={<Inventory />}
            sx={{ height: 56 }}
          >
            Inventory
          </Button>
          <Button
            variant="outlined"
            startIcon={<LocalOffer />}
            sx={{ height: 56 }}
          >
            Promos
          </Button>
          <Button
            variant="outlined"
            startIcon={<Settings />}
            sx={{ height: 56 }}
          >
            Settings
          </Button>
        </Box>

        {/* Alert Bell */}
        <Box sx={{ position: 'relative' }}>
          <NotificationsActive 
            sx={{ 
              fontSize: 32,
              color: 'primary.main',
              cursor: 'pointer',
            }}
          />
          <Box
            sx={{
              position: 'absolute',
              top: -4,
              right: -4,
              width: 16,
              height: 16,
              bgcolor: 'error.main',
              borderRadius: '50%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Typography variant="caption" sx={{ color: 'white', fontSize: 10, fontWeight: 700 }}>
              3
            </Typography>
          </Box>
        </Box>
      </Stack>
    </Paper>
  );
}