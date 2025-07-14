import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import {
  Box,
  Paper,
  TextField,
  Button,
  Typography,
  Container,
  Alert,
  InputAdornment,
  IconButton,
  CircularProgress,
  Divider,
} from '@mui/material';
import {
  Visibility,
  VisibilityOff,
  Email,
  Lock,
  Security,
  AdminPanelSettings,
} from '@mui/icons-material';
import { useAuthStore } from '../stores/authStore';
import Head from 'next/head';

export default function LoginPage() {
  const router = useRouter();
  const { login, isAuthenticated, loading, error, clearError } = useAuthStore();
  
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [formError, setFormError] = useState('');

  useEffect(() => {
    if (isAuthenticated) {
      router.push('/dashboard');
    }
  }, [isAuthenticated, router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');
    clearError();

    if (!email || !password) {
      setFormError('Please fill in all fields');
      return;
    }

    if (!email.includes('@')) {
      setFormError('Please enter a valid email address');
      return;
    }

    try {
      await login(email, password);
      router.push('/dashboard');
    } catch (err) {
      // Error is handled by the store
    }
  };

  const handleDemoLogin = () => {
    setEmail('admin@reskflow.com');
    setPassword('Admin123!');
  };

  return (
    <>
      <Head>
        <title>Admin Login - ReskFlow</title>
      </Head>
      
      <Box
        sx={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
        }}
      >
        <Container component="main" maxWidth="xs">
          <Paper
            elevation={10}
            sx={{
              padding: 4,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              borderRadius: 2,
            }}
          >
            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                mb: 3,
              }}
            >
              <Security sx={{ fontSize: 40, color: 'error.main', mr: 2 }} />
              <Box>
                <Typography component="h1" variant="h5" fontWeight="bold">
                  Admin Portal
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  System Administration Access
                </Typography>
              </Box>
            </Box>

            <Box sx={{ 
              width: '100%', 
              p: 2, 
              bgcolor: 'warning.light', 
              borderRadius: 1,
              mb: 3,
              display: 'flex',
              alignItems: 'center',
              gap: 1,
            }}>
              <AdminPanelSettings sx={{ color: 'warning.dark' }} />
              <Typography variant="body2" color="warning.dark">
                Authorized personnel only. All access is monitored and logged.
              </Typography>
            </Box>

            {(error || formError) && (
              <Alert severity="error" sx={{ width: '100%', mb: 2 }}>
                {error || formError}
              </Alert>
            )}

            <Box component="form" onSubmit={handleSubmit} sx={{ width: '100%' }}>
              <TextField
                margin="normal"
                required
                fullWidth
                id="email"
                label="Admin Email"
                name="email"
                autoComplete="email"
                autoFocus
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                InputProps={{
                  startAdornment: (
                    <InputAdornment position="start">
                      <Email />
                    </InputAdornment>
                  ),
                }}
              />
              
              <TextField
                margin="normal"
                required
                fullWidth
                name="password"
                label="Password"
                type={showPassword ? 'text' : 'password'}
                id="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                InputProps={{
                  startAdornment: (
                    <InputAdornment position="start">
                      <Lock />
                    </InputAdornment>
                  ),
                  endAdornment: (
                    <InputAdornment position="end">
                      <IconButton
                        onClick={() => setShowPassword(!showPassword)}
                        edge="end"
                      >
                        {showPassword ? <VisibilityOff /> : <Visibility />}
                      </IconButton>
                    </InputAdornment>
                  ),
                }}
              />

              <Button
                type="submit"
                fullWidth
                variant="contained"
                color="error"
                sx={{ mt: 3, mb: 2, py: 1.5 }}
                disabled={loading}
              >
                {loading ? <CircularProgress size={24} /> : 'Sign In'}
              </Button>

              <Divider sx={{ my: 2 }}>OR</Divider>

              <Button
                fullWidth
                variant="outlined"
                sx={{ py: 1.5 }}
                onClick={handleDemoLogin}
                disabled={loading}
              >
                Use Demo Admin Account
              </Button>
            </Box>

            <Box sx={{ mt: 4, textAlign: 'center' }}>
              <Typography variant="caption" color="text.secondary">
                Security Notice: This system contains confidential information.
                Unauthorized access is prohibited and will be prosecuted.
              </Typography>
            </Box>
          </Paper>

          <Typography
            variant="body2"
            color="white"
            align="center"
            sx={{ mt: 4, textShadow: '1px 1px 2px rgba(0,0,0,0.5)' }}
          >
            © 2025 ReskFlow. All rights reserved.
          </Typography>
        </Container>
      </Box>
    </>
  );
}