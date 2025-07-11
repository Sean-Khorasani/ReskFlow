import React, { useState } from 'react';
import {
  Box,
  Drawer,
  AppBar,
  Toolbar,
  Typography,
  IconButton,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  ListItemButton,
  Avatar,
  Menu,
  MenuItem,
  Divider,
  Badge,
  useTheme,
  useMediaQuery,
  Collapse,
} from '@mui/material';
import {
  Menu as MenuIcon,
  Dashboard,
  People,
  DirectionsCar,
  LocalShipping,
  AttachMoney,
  Analytics,
  Settings,
  Support,
  Logout,
  Notifications,
  Person,
  ExpandLess,
  ExpandMore,
  Assignment,
  Build,
} from '@mui/icons-material';
import { useRouter } from 'next/router';
import Link from 'next/link';
import { useAuthStore } from '../../stores/authStore';

const drawerWidth = 280;

interface PartnerLayoutProps {
  children: React.ReactNode;
}

export default function PartnerLayout({ children }: PartnerLayoutProps) {
  const theme = useTheme();
  const router = useRouter();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const { partner, logout } = useAuthStore();

  const [mobileOpen, setMobileOpen] = useState(false);
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const [vehicleMenuOpen, setVehicleMenuOpen] = useState(false);

  const handleDrawerToggle = () => {
    setMobileOpen(!mobileOpen);
  };

  const handleProfileMenuOpen = (event: React.MouseEvent<HTMLElement>) => {
    setAnchorEl(event.currentTarget);
  };

  const handleProfileMenuClose = () => {
    setAnchorEl(null);
  };

  const handleLogout = async () => {
    await logout();
    router.push('/login');
  };

  const menuItems = [
    { title: 'Dashboard', icon: <Dashboard />, path: '/dashboard' },
    { title: 'Drivers', icon: <People />, path: '/drivers' },
    {
      title: 'Vehicles',
      icon: <DirectionsCar />,
      path: '/vehicles',
      subItems: [
        { title: 'Fleet Overview', path: '/vehicles' },
        { title: 'Maintenance', icon: <Build />, path: '/vehicles/maintenance' },
      ],
    },
    { title: 'Deliveries', icon: <LocalShipping />, path: '/deliveries' },
    { title: 'Earnings', icon: <AttachMoney />, path: '/earnings' },
    { title: 'Analytics', icon: <Analytics />, path: '/analytics' },
    { title: 'Settings', icon: <Settings />, path: '/settings' },
    { title: 'Support', icon: <Support />, path: '/support' },
  ];

  const drawer = (
    <Box>
      <Box sx={{ p: 2, display: 'flex', alignItems: 'center' }}>
        <Typography variant="h6" fontWeight="bold" color="primary">
          ReskFlow Partner
        </Typography>
      </Box>
      <Divider />
      <List>
        {menuItems.map((item) => (
          <React.Fragment key={item.title}>
            <ListItemButton
              component={item.subItems ? 'div' : Link}
              href={item.subItems ? undefined : item.path}
              selected={!item.subItems && router.pathname === item.path}
              onClick={item.subItems ? () => setVehicleMenuOpen(!vehicleMenuOpen) : undefined}
              sx={{
                borderRadius: 1,
                mx: 1,
                mb: 0.5,
                '&.Mui-selected': {
                  backgroundColor: 'primary.light',
                  color: 'white',
                  '& .MuiListItemIcon-root': {
                    color: 'white',
                  },
                },
              }}
            >
              <ListItemIcon>{item.icon}</ListItemIcon>
              <ListItemText primary={item.title} />
              {item.subItems && (vehicleMenuOpen ? <ExpandLess /> : <ExpandMore />)}
            </ListItemButton>
            {item.subItems && (
              <Collapse in={vehicleMenuOpen} timeout="auto" unmountOnExit>
                <List component="div" disablePadding>
                  {item.subItems.map((subItem) => (
                    <ListItemButton
                      key={subItem.title}
                      component={Link}
                      href={subItem.path}
                      selected={router.pathname === subItem.path}
                      sx={{
                        pl: 4,
                        borderRadius: 1,
                        mx: 1,
                        mb: 0.5,
                      }}
                    >
                      <ListItemIcon>{subItem.icon || <Assignment />}</ListItemIcon>
                      <ListItemText primary={subItem.title} />
                    </ListItemButton>
                  ))}
                </List>
              </Collapse>
            )}
          </React.Fragment>
        ))}
      </List>
    </Box>
  );

  return (
    <Box sx={{ display: 'flex' }}>
      <AppBar
        position="fixed"
        sx={{
          width: { md: `calc(100% - ${drawerWidth}px)` },
          ml: { md: `${drawerWidth}px` },
          backgroundColor: 'background.paper',
          color: 'text.primary',
          boxShadow: 1,
        }}
      >
        <Toolbar>
          <IconButton
            color="inherit"
            edge="start"
            onClick={handleDrawerToggle}
            sx={{ mr: 2, display: { md: 'none' } }}
          >
            <MenuIcon />
          </IconButton>
          
          <Typography variant="h6" noWrap component="div" sx={{ flexGrow: 1 }}>
            {partner?.companyName || 'Partner Portal'}
          </Typography>

          <IconButton color="inherit" sx={{ mr: 2 }}>
            <Badge badgeContent={4} color="error">
              <Notifications />
            </Badge>
          </IconButton>

          <IconButton onClick={handleProfileMenuOpen} sx={{ p: 0 }}>
            <Avatar sx={{ bgcolor: 'primary.main' }}>
              {partner?.companyName?.[0] || 'P'}
            </Avatar>
          </IconButton>

          <Menu
            anchorEl={anchorEl}
            open={Boolean(anchorEl)}
            onClose={handleProfileMenuClose}
          >
            <MenuItem onClick={() => {
              handleProfileMenuClose();
              router.push('/profile');
            }}>
              <ListItemIcon>
                <Person fontSize="small" />
              </ListItemIcon>
              Profile
            </MenuItem>
            <MenuItem onClick={() => {
              handleProfileMenuClose();
              router.push('/settings');
            }}>
              <ListItemIcon>
                <Settings fontSize="small" />
              </ListItemIcon>
              Settings
            </MenuItem>
            <Divider />
            <MenuItem onClick={handleLogout}>
              <ListItemIcon>
                <Logout fontSize="small" />
              </ListItemIcon>
              Logout
            </MenuItem>
          </Menu>
        </Toolbar>
      </AppBar>

      <Box
        component="nav"
        sx={{ width: { md: drawerWidth }, flexShrink: { md: 0 } }}
      >
        <Drawer
          variant={isMobile ? 'temporary' : 'permanent'}
          open={isMobile ? mobileOpen : true}
          onClose={handleDrawerToggle}
          ModalProps={{
            keepMounted: true, // Better open performance on mobile.
          }}
          sx={{
            '& .MuiDrawer-paper': {
              boxSizing: 'border-box',
              width: drawerWidth,
            },
          }}
        >
          {drawer}
        </Drawer>
      </Box>

      <Box
        component="main"
        sx={{
          flexGrow: 1,
          p: 3,
          width: { md: `calc(100% - ${drawerWidth}px)` },
          mt: 8,
          backgroundColor: 'background.default',
          minHeight: '100vh',
        }}
      >
        {children}
      </Box>
    </Box>
  );
}