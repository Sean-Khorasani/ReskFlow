import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { useDispatch, useSelector } from 'react-redux';
import {
  Container,
  Stepper,
  Step,
  StepLabel,
  Paper,
  Typography,
  Box,
  Button,
  TextField,
  Radio,
  RadioGroup,
  FormControlLabel,
  FormControl,
  FormLabel,
  Grid,
  Card,
  CardContent,
  Divider,
  Alert,
  CircularProgress,
} from '@mui/material';
import LocationOnIcon from '@mui/icons-material/LocationOn';
import PaymentIcon from '@mui/icons-material/Payment';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import { AppDispatch, RootState } from '@/store';
import { placeOrder } from '@/store/slices/ordersSlice';
import { clearCart } from '@/store/slices/cartSlice';

const steps = ['Delivery Details', 'Payment', 'Confirmation'];

export default function CheckoutPage() {
  const router = useRouter();
  const dispatch = useDispatch<AppDispatch>();
  const { items, merchantId, merchantName, subtotal, tax, reskflowFee, total } = useSelector(
    (state: RootState) => state.cart
  );
  const { user } = useSelector((state: RootState) => state.auth);
  const { isPlacingOrder, error, currentOrder } = useSelector((state: RootState) => state.orders);

  const [activeStep, setActiveStep] = useState(0);
  const [reskflowAddress, setDeliveryAddress] = useState('');
  const [reskflowInstructions, setDeliveryInstructions] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('card');
  const [cardNumber, setCardNumber] = useState('');
  const [cardExpiry, setCardExpiry] = useState('');
  const [cardCVV, setCardCVV] = useState('');

  useEffect(() => {
    if (!user) {
      router.push('/login?redirect=/checkout');
    }
    if (items.length === 0 && activeStep < 2) {
      router.push('/cart');
    }
  }, [user, items, activeStep, router]);

  useEffect(() => {
    if (user?.address) {
      setDeliveryAddress(user.address);
    }
  }, [user]);

  const handleNext = () => {
    if (activeStep === steps.length - 1) {
      router.push('/orders');
    } else {
      setActiveStep((prevActiveStep) => prevActiveStep + 1);
    }
  };

  const handleBack = () => {
    setActiveStep((prevActiveStep) => prevActiveStep - 1);
  };

  const handlePlaceOrder = async () => {
    if (!merchantId) return;

    const orderData = {
      merchantId,
      items: items.map((item) => ({
        productId: item.productId,
        name: item.name,
        quantity: item.quantity,
        price: item.price,
        specialInstructions: item.specialInstructions,
      })),
      reskflowAddress,
      reskflowInstructions,
      paymentMethod,
      subtotal,
      tax,
      reskflowFee,
      total,
    };

    const result = await dispatch(placeOrder(orderData));
    
    if (placeOrder.fulfilled.match(result)) {
      dispatch(clearCart());
      setActiveStep(2);
    }
  };

  const getStepContent = (step: number) => {
    switch (step) {
      case 0:
        return (
          <Box>
            <Typography variant="h6" gutterBottom>
              Delivery Information
            </Typography>
            <Grid container spacing={3}>
              <Grid item xs={12}>
                <TextField
                  fullWidth
                  label="Delivery Address"
                  value={reskflowAddress}
                  onChange={(e) => setDeliveryAddress(e.target.value)}
                  required
                  multiline
                  rows={2}
                  InputProps={{
                    startAdornment: <LocationOnIcon color="action" sx={{ mr: 1 }} />,
                  }}
                />
              </Grid>
              <Grid item xs={12}>
                <TextField
                  fullWidth
                  label="Delivery Instructions (Optional)"
                  value={reskflowInstructions}
                  onChange={(e) => setDeliveryInstructions(e.target.value)}
                  multiline
                  rows={3}
                  placeholder="E.g., Leave at door, ring doorbell, apartment number..."
                />
              </Grid>
            </Grid>
          </Box>
        );
      
      case 1:
        return (
          <Box>
            <Typography variant="h6" gutterBottom>
              Payment Method
            </Typography>
            <FormControl component="fieldset">
              <RadioGroup
                value={paymentMethod}
                onChange={(e) => setPaymentMethod(e.target.value)}
              >
                <FormControlLabel
                  value="card"
                  control={<Radio />}
                  label="Credit/Debit Card"
                />
                <FormControlLabel
                  value="cash"
                  control={<Radio />}
                  label="Cash on Delivery"
                />
              </RadioGroup>
            </FormControl>

            {paymentMethod === 'card' && (
              <Grid container spacing={2} sx={{ mt: 2 }}>
                <Grid item xs={12}>
                  <TextField
                    fullWidth
                    label="Card Number"
                    value={cardNumber}
                    onChange={(e) => setCardNumber(e.target.value)}
                    placeholder="1234 5678 9012 3456"
                    InputProps={{
                      startAdornment: <PaymentIcon color="action" sx={{ mr: 1 }} />,
                    }}
                  />
                </Grid>
                <Grid item xs={6}>
                  <TextField
                    fullWidth
                    label="Expiry Date"
                    value={cardExpiry}
                    onChange={(e) => setCardExpiry(e.target.value)}
                    placeholder="MM/YY"
                  />
                </Grid>
                <Grid item xs={6}>
                  <TextField
                    fullWidth
                    label="CVV"
                    value={cardCVV}
                    onChange={(e) => setCardCVV(e.target.value)}
                    placeholder="123"
                  />
                </Grid>
              </Grid>
            )}

            <Alert severity="info" sx={{ mt: 3 }}>
              This is a demo. No real payment will be processed.
            </Alert>
          </Box>
        );
      
      case 2:
        return (
          <Box textAlign="center" py={4}>
            <CheckCircleIcon sx={{ fontSize: 100, color: 'success.main', mb: 2 }} />
            <Typography variant="h4" gutterBottom>
              Order Placed Successfully!
            </Typography>
            <Typography variant="body1" color="text.secondary" paragraph>
              Your order has been confirmed and is being prepared.
            </Typography>
            {currentOrder && (
              <>
                <Typography variant="h6" gutterBottom>
                  Order #{currentOrder.id.slice(-6).toUpperCase()}
                </Typography>
                <Typography variant="body1" paragraph>
                  Estimated reskflow: {currentOrder.estimatedDeliveryTime}
                </Typography>
                <Button
                  variant="contained"
                  onClick={() => router.push(`/orders/${currentOrder.id}`)}
                  sx={{ mt: 2 }}
                >
                  Track Order
                </Button>
              </>
            )}
          </Box>
        );
      
      default:
        return 'Unknown step';
    }
  };

  const isStepValid = () => {
    switch (activeStep) {
      case 0:
        return reskflowAddress.trim() !== '';
      case 1:
        if (paymentMethod === 'card') {
          return cardNumber && cardExpiry && cardCVV;
        }
        return true;
      default:
        return true;
    }
  };

  return (
    <Container maxWidth="lg" sx={{ py: 4 }}>
      <Grid container spacing={3}>
        <Grid item xs={12} md={8}>
          <Paper sx={{ p: 3 }}>
            <Stepper activeStep={activeStep} sx={{ mb: 4 }}>
              {steps.map((label) => (
                <Step key={label}>
                  <StepLabel>{label}</StepLabel>
                </Step>
              ))}
            </Stepper>

            {error && (
              <Alert severity="error" sx={{ mb: 3 }}>
                {error}
              </Alert>
            )}

            {getStepContent(activeStep)}

            <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 4 }}>
              <Button
                disabled={activeStep === 0 || activeStep === 2}
                onClick={handleBack}
              >
                Back
              </Button>
              
              {activeStep === steps.length - 1 ? (
                <Button variant="contained" onClick={handleNext}>
                  View Orders
                </Button>
              ) : activeStep === 1 ? (
                <Button
                  variant="contained"
                  onClick={handlePlaceOrder}
                  disabled={!isStepValid() || isPlacingOrder}
                  endIcon={isPlacingOrder && <CircularProgress size={20} />}
                >
                  Place Order
                </Button>
              ) : (
                <Button
                  variant="contained"
                  onClick={handleNext}
                  disabled={!isStepValid()}
                >
                  Next
                </Button>
              )}
            </Box>
          </Paper>
        </Grid>

        <Grid item xs={12} md={4}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                Order Summary
              </Typography>
              
              <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                {merchantName}
              </Typography>

              <Divider sx={{ my: 2 }} />

              {items.map((item) => (
                <Box key={item.id} display="flex" justifyContent="space-between" mb={1}>
                  <Typography variant="body2">
                    {item.quantity}x {item.name}
                  </Typography>
                  <Typography variant="body2">
                    ${(item.price * item.quantity).toFixed(2)}
                  </Typography>
                </Box>
              ))}

              <Divider sx={{ my: 2 }} />

              <Box>
                <Box display="flex" justifyContent="space-between" mb={1}>
                  <Typography variant="body2">Subtotal</Typography>
                  <Typography variant="body2">${subtotal.toFixed(2)}</Typography>
                </Box>
                <Box display="flex" justifyContent="space-between" mb={1}>
                  <Typography variant="body2">Tax</Typography>
                  <Typography variant="body2">${tax.toFixed(2)}</Typography>
                </Box>
                <Box display="flex" justifyContent="space-between" mb={1}>
                  <Typography variant="body2">Delivery Fee</Typography>
                  <Typography variant="body2">${reskflowFee.toFixed(2)}</Typography>
                </Box>
              </Box>

              <Divider sx={{ my: 2 }} />

              <Box display="flex" justifyContent="space-between">
                <Typography variant="h6">Total</Typography>
                <Typography variant="h6">${total.toFixed(2)}</Typography>
              </Box>
            </CardContent>
          </Card>
        </Grid>
      </Grid>
    </Container>
  );
}