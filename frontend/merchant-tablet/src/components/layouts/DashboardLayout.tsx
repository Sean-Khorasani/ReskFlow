import { Box, AppBar, Toolbar, Typography, IconButton, Badge, Menu, MenuItem, Avatar } from '@mui/material';
import { Notifications, ExitToApp, AccountCircle, BarChart } from '@mui/icons-material';
import { useState, ReactNode } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useRouter } from 'next/router';
import { format } from 'date-fns';

interface DashboardLayoutProps {
  children: ReactNode;
}

export default function DashboardLayout({ children }: DashboardLayoutProps) {
  const { user, logout } = useAuth();
  const router = useRouter();
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const [notificationAnchor, setNotificationAnchor] = useState<null | HTMLElement>(null);

  const handleProfileMenuOpen = (event: React.MouseEvent<HTMLElement>) => {
    setAnchorEl(event.currentTarget);
  };

  const handleMenuClose = () => {
    setAnchorEl(null);
  };

  const handleNotificationOpen = (event: React.MouseEvent<HTMLElement>) => {
    setNotificationAnchor(event.currentTarget);
  };

  const handleNotificationClose = () => {
    setNotificationAnchor(null);
  };

  const handleLogout = async () => {
    await logout();
    handleMenuClose();
  };

  const handleNavigateToAnalytics = () => {
    router.push('/analytics');
    handleMenuClose();
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <AppBar position="static" elevation={0} sx={{ bgcolor: 'white', color: 'text.primary' }}>
        <Toolbar>
          {/* Logo/Restaurant Name */}
          <Typography variant="h5" sx={{ fontWeight: 700, color: 'primary.main' }}>
            {user?.merchant?.name || 'Merchant Portal'}
          </Typography>

          {/* Current Time */}
          <Typography variant="body1" sx={{ ml: 4, color: 'text.secondary' }}>
            {format(new Date(), 'EEEE, MMMM d, yyyy • h:mm a')}
          </Typography>

          <Box sx={{ flexGrow: 1 }} />

          {/* Notifications */}
          <IconButton
            size="large"
            onClick={handleNotificationOpen}
            color="inherit"
          >
            <Badge badgeContent={3} color="error">
              <Notifications />
            </Badge>
          </IconButton>

          {/* Profile Menu */}
          <IconButton
            size="large"
            edge="end"
            onClick={handleProfileMenuOpen}
            color="inherit"
            sx={{ ml: 2 }}
          >
            <Avatar sx={{ width: 32, height: 32 }}>
              {user?.name?.[0] || 'M'}
            </Avatar>
          </IconButton>
        </Toolbar>
      </AppBar>

      {/* Notification Menu */}
      <Menu
        anchorEl={notificationAnchor}
        open={Boolean(notificationAnchor)}
        onClose={handleNotificationClose}
        anchorOrigin={{
          vertical: 'bottom',
          horizontal: 'right',
        }}
        transformOrigin={{
          vertical: 'top',
          horizontal: 'right',
        }}
      >
        <MenuItem onClick={handleNotificationClose}>
          <Typography variant="body2">Low stock: Chicken Wings</Typography>
        </MenuItem>
        <MenuItem onClick={handleNotificationClose}>
          <Typography variant="body2">New review: 5 stars</Typography>
        </MenuItem>
        <MenuItem onClick={handleNotificationClose}>
          <Typography variant="body2">Driver arrived for pickup</Typography>
        </MenuItem>
      </Menu>

      {/* Profile Menu */}
      <Menu
        anchorEl={anchorEl}
        open={Boolean(anchorEl)}
        onClose={handleMenuClose}
        anchorOrigin={{
          vertical: 'bottom',
          horizontal: 'right',
        }}
        transformOrigin={{
          vertical: 'top',
          horizontal: 'right',
        }}
      >
        <MenuItem onClick={handleMenuClose}>
          <AccountCircle sx={{ mr: 1 }} />
          Profile
        </MenuItem>
        <MenuItem onClick={handleNavigateToAnalytics}>
          <BarChart sx={{ mr: 1 }} />
          Analytics
        </MenuItem>
        <MenuItem onClick={handleLogout}>
          <ExitToApp sx={{ mr: 1 }} />
          Logout
        </MenuItem>
      </Menu>

      {/* Main Content */}
      <Box sx={{ flexGrow: 1, overflow: 'hidden', bgcolor: 'background.default', p: 2 }}>
        {children}
      </Box>
    </Box>
  );
}