import React, { useState } from 'react';
import { useRouter } from 'next/router';
import {
  Box,
  Drawer,
  AppBar,
  Toolbar,
  List,
  Typography,
  Divider,
  IconButton,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Avatar,
  Menu,
  MenuItem,
  Badge,
  Chip,
  useTheme,
  useMediaQuery,
} from '@mui/material';
import {
  Menu as MenuIcon,
  Dashboard,
  People,
  Store,
  Receipt,
  DirectionsCar,
  Assessment,
  Settings,
  Logout,
  AccountCircle,
  Notifications,
  Security,
  AccountBalance,
} from '@mui/icons-material';
import { useAuthStore } from '../../stores/authStore';

const drawerWidth = 260;

interface AdminLayoutProps {
  children: React.ReactNode;
}

const menuItems = [
  { title: 'Dashboard', icon: <Dashboard />, path: '/dashboard' },
  { title: 'Users', icon: <People />, path: '/users' },
  { title: 'Merchants', icon: <Store />, path: '/merchants' },
  { title: 'Drivers', icon: <DirectionsCar />, path: '/drivers' },
  { title: 'Orders', icon: <Receipt />, path: '/orders' },
  { title: 'Analytics', icon: <Assessment />, path: '/analytics' },
  { title: 'Blockchain', icon: <AccountBalance />, path: '/blockchain' },
  { title: 'Settings', icon: <Settings />, path: '/settings' },
];

export default function AdminLayout({ children }: AdminLayoutProps) {
  const router = useRouter();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const { admin, logout } = useAuthStore();
  
  const [mobileOpen, setMobileOpen] = useState(false);
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const [notificationAnchor, setNotificationAnchor] = useState<null | HTMLElement>(null);

  const handleDrawerToggle = () => {
    setMobileOpen(!mobileOpen);
  };

  const handleProfileMenuOpen = (event: React.MouseEvent<HTMLElement>) => {
    setAnchorEl(event.currentTarget);
  };

  const handleProfileMenuClose = () => {
    setAnchorEl(null);
  };

  const handleNotificationMenuOpen = (event: React.MouseEvent<HTMLElement>) => {
    setNotificationAnchor(event.currentTarget);
  };

  const handleNotificationMenuClose = () => {
    setNotificationAnchor(null);
  };

  const handleLogout = () => {
    handleProfileMenuClose();
    logout();
    router.push('/login');
  };

  const drawer = (
    <div>
      <Toolbar sx={{ px: 2 }}>
        <Security sx={{ mr: 2, color: 'error.main' }} />
        <Box>
          <Typography variant="h6" noWrap fontWeight="bold">
            ReskFlow Admin
          </Typography>
          <Typography variant="caption" color="text.secondary">
            System Administration
          </Typography>
        </Box>
      </Toolbar>
      <Divider />
      <List>
        {menuItems.map((item) => (
          <ListItem key={item.path} disablePadding>
            <ListItemButton
              selected={router.pathname === item.path}
              onClick={() => {
                router.push(item.path);
                if (isMobile) {
                  setMobileOpen(false);
                }
              }}
              sx={{
                '&.Mui-selected': {
                  backgroundColor: 'error.light',
                  '&:hover': {
                    backgroundColor: 'error.light',
                  },
                },
              }}
            >
              <ListItemIcon
                sx={{
                  color: router.pathname === item.path ? 'error.main' : 'inherit',
                }}
              >
                {item.icon}
              </ListItemIcon>
              <ListItemText
                primary={item.title}
                primaryTypographyProps={{
                  fontWeight: router.pathname === item.path ? 600 : 400,
                }}
              />
            </ListItemButton>
          </ListItem>
        ))}
      </List>
      <Divider />
      <Box sx={{ p: 2 }}>
        <Box sx={{ 
          p: 2, 
          bgcolor: 'grey.100', 
          borderRadius: 2,
          border: '1px solid',
          borderColor: 'grey.300'
        }}>
          <Typography variant="caption" color="text.secondary" display="block">
            Admin Access Level
          </Typography>
          <Chip
            label={admin?.role || 'Super Admin'}
            color="error"
            size="small"
            sx={{ mt: 1 }}
          />
        </Box>
      </Box>
    </div>
  );

  return (
    <Box sx={{ display: 'flex' }}>
      <AppBar
        position="fixed"
        sx={{
          width: { sm: `calc(100% - ${drawerWidth}px)` },
          ml: { sm: `${drawerWidth}px` },
          bgcolor: 'background.paper',
          color: 'text.primary',
          boxShadow: 1,
        }}
      >
        <Toolbar>
          <IconButton
            color="inherit"
            aria-label="open drawer"
            edge="start"
            onClick={handleDrawerToggle}
            sx={{ mr: 2, display: { sm: 'none' } }}
          >
            <MenuIcon />
          </IconButton>
          
          <Typography variant="h6" noWrap component="div" sx={{ flexGrow: 1 }}>
            {menuItems.find(item => item.path === router.pathname)?.title || 'Admin Portal'}
          </Typography>
          
          <IconButton color="inherit" onClick={handleNotificationMenuOpen}>
            <Badge badgeContent={5} color="error">
              <Notifications />
            </Badge>
          </IconButton>
          
          <IconButton onClick={handleProfileMenuOpen} sx={{ ml: 2 }}>
            <Avatar sx={{ width: 32, height: 32, bgcolor: 'error.main' }}>
              {admin?.name?.[0] || 'A'}
            </Avatar>
          </IconButton>
        </Toolbar>
      </AppBar>
      
      <Box
        component="nav"
        sx={{ width: { sm: drawerWidth }, flexShrink: { sm: 0 } }}
      >
        <Drawer
          variant="temporary"
          open={mobileOpen}
          onClose={handleDrawerToggle}
          ModalProps={{
            keepMounted: true,
          }}
          sx={{
            display: { xs: 'block', sm: 'none' },
            '& .MuiDrawer-paper': { boxSizing: 'border-box', width: drawerWidth },
          }}
        >
          {drawer}
        </Drawer>
        <Drawer
          variant="permanent"
          sx={{
            display: { xs: 'none', sm: 'block' },
            '& .MuiDrawer-paper': { boxSizing: 'border-box', width: drawerWidth },
          }}
          open
        >
          {drawer}
        </Drawer>
      </Box>
      
      <Box
        component="main"
        sx={{
          flexGrow: 1,
          p: 3,
          width: { sm: `calc(100% - ${drawerWidth}px)` },
          mt: 8,
          bgcolor: '#f5f5f5',
          minHeight: '100vh',
        }}
      >
        {children}
      </Box>
      
      {/* Profile Menu */}
      <Menu
        anchorEl={anchorEl}
        open={Boolean(anchorEl)}
        onClose={handleProfileMenuClose}
      >
        <Box sx={{ px: 2, py: 1 }}>
          <Typography variant="subtitle2">{admin?.name}</Typography>
          <Typography variant="caption" color="text.secondary">{admin?.email}</Typography>
        </Box>
        <Divider />
        <MenuItem onClick={() => { handleProfileMenuClose(); router.push('/profile'); }}>
          <ListItemIcon>
            <AccountCircle fontSize="small" />
          </ListItemIcon>
          Profile
        </MenuItem>
        <MenuItem onClick={handleLogout}>
          <ListItemIcon>
            <Logout fontSize="small" />
          </ListItemIcon>
          Logout
        </MenuItem>
      </Menu>
      
      {/* Notification Menu */}
      <Menu
        anchorEl={notificationAnchor}
        open={Boolean(notificationAnchor)}
        onClose={handleNotificationMenuClose}
        PaperProps={{
          sx: { width: 360, maxHeight: 400 },
        }}
      >
        <Box sx={{ p: 2 }}>
          <Typography variant="h6" gutterBottom>
            System Notifications
          </Typography>
        </Box>
        <Divider />
        <MenuItem onClick={handleNotificationMenuClose}>
          <Box>
            <Typography variant="body2" fontWeight="medium">
              New merchant registration
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Pizza Palace requires approval - 5 minutes ago
            </Typography>
          </Box>
        </MenuItem>
        <MenuItem onClick={handleNotificationMenuClose}>
          <Box>
            <Typography variant="body2" fontWeight="medium">
              High order volume detected
            </Typography>
            <Typography variant="caption" color="text.secondary">
              150% increase in orders - 1 hour ago
            </Typography>
          </Box>
        </MenuItem>
        <MenuItem onClick={handleNotificationMenuClose}>
          <Box>
            <Typography variant="body2" fontWeight="medium">
              System update available
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Version 2.1.0 ready to install - 3 hours ago
            </Typography>
          </Box>
        </MenuItem>
        <MenuItem onClick={handleNotificationMenuClose}>
          <Box>
            <Typography variant="body2" fontWeight="medium">
              Driver verification pending
            </Typography>
            <Typography variant="caption" color="text.secondary">
              5 new drivers awaiting verification - 5 hours ago
            </Typography>
          </Box>
        </MenuItem>
        <MenuItem onClick={handleNotificationMenuClose}>
          <Box>
            <Typography variant="body2" fontWeight="medium">
              Security alert
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Multiple failed login attempts detected - 1 day ago
            </Typography>
          </Box>
        </MenuItem>
      </Menu>
    </Box>
  );
}