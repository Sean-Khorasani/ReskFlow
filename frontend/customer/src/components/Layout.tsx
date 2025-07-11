import { ReactNode } from 'react';
import { useRouter } from 'next/router';
import { useSelector, useDispatch } from 'react-redux';
import {
  AppBar,
  Toolbar,
  Typography,
  Button,
  IconButton,
  Badge,
  Box,
  Avatar,
  Menu,
  MenuItem,
  Container,
} from '@mui/material';
import ShoppingCartIcon from '@mui/icons-material/ShoppingCart';
import AccountCircleIcon from '@mui/icons-material/AccountCircle';
import LocationOnIcon from '@mui/icons-material/LocationOn';
import { RootState, AppDispatch } from '@/store';
import { logout } from '@/store/slices/authSlice';
import { useState } from 'react';

interface LayoutProps {
  children: ReactNode;
}

export default function Layout({ children }: LayoutProps) {
  const router = useRouter();
  const dispatch = useDispatch<AppDispatch>();
  const { user } = useSelector((state: RootState) => state.auth);
  const { items } = useSelector((state: RootState) => state.cart);
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);

  const cartItemCount = items.reduce((sum, item) => sum + item.quantity, 0);

  const handleProfileMenuOpen = (event: React.MouseEvent<HTMLElement>) => {
    setAnchorEl(event.currentTarget);
  };

  const handleMenuClose = () => {
    setAnchorEl(null);
  };

  const handleLogout = async () => {
    await dispatch(logout());
    router.push('/');
    handleMenuClose();
  };

  const handleNavigate = (path: string) => {
    router.push(path);
    handleMenuClose();
  };

  return (
    <>
      <AppBar position="sticky" color="default" elevation={1}>
        <Container maxWidth="lg">
          <Toolbar disableGutters>
            <Typography
              variant="h6"
              component="div"
              sx={{ cursor: 'pointer', fontWeight: 700 }}
              onClick={() => router.push('/')}
            >
              ReskFlow
            </Typography>

            <Box sx={{ flexGrow: 1, ml: 4 }}>
              {user?.address && (
                <Button
                  startIcon={<LocationOnIcon />}
                  color="inherit"
                  size="small"
                >
                  {user.address}
                </Button>
              )}
            </Box>

            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <IconButton
                size="large"
                aria-label="shopping cart"
                color="inherit"
                onClick={() => router.push('/cart')}
              >
                <Badge badgeContent={cartItemCount} color="error">
                  <ShoppingCartIcon />
                </Badge>
              </IconButton>

              {user ? (
                <>
                  <IconButton
                    size="large"
                    edge="end"
                    aria-label="account of current user"
                    aria-controls="profile-menu"
                    aria-haspopup="true"
                    onClick={handleProfileMenuOpen}
                    color="inherit"
                  >
                    <Avatar sx={{ width: 32, height: 32 }}>
                      {user.name?.[0] || user.email[0].toUpperCase()}
                    </Avatar>
                  </IconButton>
                  <Menu
                    id="profile-menu"
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
                    <MenuItem onClick={() => handleNavigate('/profile')}>
                      Profile
                    </MenuItem>
                    <MenuItem onClick={() => handleNavigate('/orders')}>
                      Orders
                    </MenuItem>
                    <MenuItem onClick={() => handleNavigate('/addresses')}>
                      Addresses
                    </MenuItem>
                    <MenuItem onClick={() => handleNavigate('/payments')}>
                      Payment Methods
                    </MenuItem>
                    <MenuItem onClick={handleLogout}>
                      Logout
                    </MenuItem>
                  </Menu>
                </>
              ) : (
                <Button
                  variant="contained"
                  onClick={() => router.push('/login')}
                >
                  Sign In
                </Button>
              )}
            </Box>
          </Toolbar>
        </Container>
      </AppBar>

      <Box component="main" sx={{ minHeight: 'calc(100vh - 64px)' }}>
        {children}
      </Box>

      <Box
        component="footer"
        sx={{
          py: 3,
          px: 2,
          mt: 'auto',
          backgroundColor: (theme) =>
            theme.palette.mode === 'light'
              ? theme.palette.grey[200]
              : theme.palette.grey[800],
        }}
      >
        <Container maxWidth="lg">
          <Typography variant="body2" color="text.secondary" align="center">
            © 2025 ReskFlow. All rights reserved.
          </Typography>
        </Container>
      </Box>
    </>
  );
}