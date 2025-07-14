import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { useDispatch, useSelector } from 'react-redux';
import { useForm } from 'react-hook-form';
import {
  Container,
  Paper,
  TextField,
  Button,
  Typography,
  Box,
  Link,
  Alert,
  CircularProgress,
  Divider,
} from '@mui/material';
import { AppDispatch, RootState } from '@/store';
import { login, clearError } from '@/store/slices/authSlice';

interface LoginFormData {
  email: string;
  password: string;
}

export default function LoginPage() {
  const router = useRouter();
  const dispatch = useDispatch<AppDispatch>();
  const { user, isLoading, error } = useSelector((state: RootState) => state.auth);
  const { redirect } = router.query;
  
  const { register, handleSubmit, formState: { errors } } = useForm<LoginFormData>();
  const [showDemoInfo, setShowDemoInfo] = useState(true);

  useEffect(() => {
    if (user) {
      const redirectUrl = redirect as string || '/';
      router.push(redirectUrl);
    }
  }, [user, redirect, router]);

  useEffect(() => {
    dispatch(clearError());
  }, [dispatch]);

  const onSubmit = async (data: LoginFormData) => {
    await dispatch(login(data));
  };

  const handleDemoLogin = () => {
    dispatch(login({
      email: 'customer@test.com',
      password: 'Customer123!',
    }));
  };

  return (
    <Container maxWidth="sm" sx={{ py: 8 }}>
      <Paper sx={{ p: 4 }}>
        <Typography variant="h4" align="center" gutterBottom>
          Sign In
        </Typography>
        
        <Typography variant="body2" align="center" color="text.secondary" paragraph>
          Welcome back! Please sign in to continue.
        </Typography>

        {showDemoInfo && (
          <Alert severity="info" onClose={() => setShowDemoInfo(false)} sx={{ mb: 3 }}>
            <Typography variant="body2" gutterBottom>
              <strong>Demo Credentials:</strong>
            </Typography>
            <Typography variant="body2">
              Email: customer@test.com<br />
              Password: Customer123!
            </Typography>
          </Alert>
        )}

        {error && (
          <Alert severity="error" sx={{ mb: 3 }}>
            {error}
          </Alert>
        )}

        <form onSubmit={handleSubmit(onSubmit)}>
          <TextField
            fullWidth
            label="Email"
            type="email"
            margin="normal"
            {...register('email', {
              required: 'Email is required',
              pattern: {
                value: /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i,
                message: 'Invalid email address',
              },
            })}
            error={!!errors.email}
            helperText={errors.email?.message}
          />

          <TextField
            fullWidth
            label="Password"
            type="password"
            margin="normal"
            {...register('password', {
              required: 'Password is required',
              minLength: {
                value: 6,
                message: 'Password must be at least 6 characters',
              },
            })}
            error={!!errors.password}
            helperText={errors.password?.message}
          />

          <Button
            fullWidth
            type="submit"
            variant="contained"
            size="large"
            sx={{ mt: 3, mb: 2 }}
            disabled={isLoading}
          >
            {isLoading ? <CircularProgress size={24} /> : 'Sign In'}
          </Button>
        </form>

        <Divider sx={{ my: 3 }}>OR</Divider>

        <Button
          fullWidth
          variant="outlined"
          onClick={handleDemoLogin}
          sx={{ mb: 2 }}
        >
          Continue with Demo Account
        </Button>

        <Box textAlign="center" mt={2}>
          <Typography variant="body2">
            Don't have an account?{' '}
            <Link
              component="button"
              variant="body2"
              onClick={() => router.push('/register')}
            >
              Sign Up
            </Link>
          </Typography>
        </Box>

        <Box textAlign="center" mt={1}>
          <Link
            component="button"
            variant="body2"
            color="text.secondary"
            onClick={() => router.push('/forgot-password')}
          >
            Forgot Password?
          </Link>
        </Box>
      </Paper>
    </Container>
  );
}