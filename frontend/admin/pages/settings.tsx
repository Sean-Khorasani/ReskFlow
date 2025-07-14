import React, { useState, useEffect } from 'react';
import {
  Box,
  Paper,
  Typography,
  TextField,
  Button,
  Switch,
  FormControlLabel,
  Grid,
  Card,
  CardContent,
  Divider,
  Alert,
  Tab,
  Tabs,
  IconButton,
  InputAdornment,
  Slider,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Chip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  List,
  ListItem,
  ListItemText,
  ListItemSecondaryAction,
  Snackbar,
} from '@mui/material';
import {
  Save,
  Security,
  Notifications,
  Payment,
  LocalShipping,
  Store,
  Email,
  Sms,
  CurrencyExchange,
  Schedule,
  Language,
  Visibility,
  VisibilityOff,
  Add,
  Delete,
  Edit,
  ContentCopy,
  Check,
  Warning,
  Info,
} from '@mui/icons-material';
import AdminLayout from '../components/layouts/AdminLayout';
import { settingsApi } from '../services/api';
import Head from 'next/head';

interface SystemSettings {
  platform: {
    name: string;
    url: string;
    supportEmail: string;
    supportPhone: string;
    timezone: string;
    currency: string;
    language: string;
    maintenanceMode: boolean;
    maintenanceMessage: string;
  };
  commission: {
    defaultRate: number;
    minRate: number;
    maxRate: number;
    processingFee: number;
    taxRate: number;
  };
  reskflow: {
    baseDeliveryFee: number;
    pricePerKm: number;
    minDeliveryFee: number;
    maxDeliveryFee: number;
    freeDeliveryThreshold: number;
    maxDeliveryDistance: number;
    estimatedPrepTime: number;
    estimatedDeliveryTime: number;
  };
  payment: {
    stripeEnabled: boolean;
    stripePublicKey: string;
    stripeSecretKey: string;
    paypalEnabled: boolean;
    paypalClientId: string;
    paypalSecretKey: string;
    cashEnabled: boolean;
    walletEnabled: boolean;
    blockchainEnabled: boolean;
    blockchainNetwork: string;
    blockchainRpcUrl: string;
    minOrderAmount: number;
    maxOrderAmount: number;
  };
  notifications: {
    emailEnabled: boolean;
    smsEnabled: boolean;
    pushEnabled: boolean;
    orderConfirmation: boolean;
    orderStatusUpdates: boolean;
    promotionalEmails: boolean;
    twilioAccountSid: string;
    twilioAuthToken: string;
    twilioPhoneNumber: string;
    sendgridApiKey: string;
    fcmServerKey: string;
  };
  security: {
    twoFactorEnabled: boolean;
    sessionTimeout: number;
    maxLoginAttempts: number;
    passwordMinLength: number;
    passwordRequireSpecial: boolean;
    passwordRequireNumbers: boolean;
    ipWhitelist: string[];
    apiRateLimit: number;
    recaptchaEnabled: boolean;
    recaptchaSiteKey: string;
    recaptchaSecretKey: string;
  };
  integrations: {
    googleMapsApiKey: string;
    googleAnalyticsId: string;
    facebookPixelId: string;
    sentryDsn: string;
    logLevel: string;
    elasticsearchUrl: string;
    redisUrl: string;
  };
}

export default function SettingsPage() {
  const [settings, setSettings] = useState<SystemSettings | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [selectedTab, setSelectedTab] = useState(0);
  const [showPassword, setShowPassword] = useState<{ [key: string]: boolean }>({});
  const [saveAlert, setSaveAlert] = useState(false);
  const [testDialog, setTestDialog] = useState<{ open: boolean; type: string }>({
    open: false,
    type: '',
  });
  const [newIpAddress, setNewIpAddress] = useState('');

  useEffect(() => {
    fetchSettings();
  }, []);

  const fetchSettings = async () => {
    setLoading(true);
    try {
      const response = await settingsApi.getSettings();
      setSettings(response.data);
    } catch (error) {
      console.error('Failed to fetch settings:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveSettings = async () => {
    if (!settings) return;
    
    setSaving(true);
    try {
      await settingsApi.updateSettings(settings);
      setSaveAlert(true);
    } catch (error) {
      console.error('Failed to save settings:', error);
    } finally {
      setSaving(false);
    }
  };

  const handleTestIntegration = (type: string) => {
    setTestDialog({ open: true, type });
    // Simulate test
    setTimeout(() => {
      setTestDialog({ open: false, type: '' });
    }, 2000);
  };

  const handleAddIpAddress = () => {
    if (!settings || !newIpAddress) return;
    
    setSettings({
      ...settings,
      security: {
        ...settings.security,
        ipWhitelist: [...settings.security.ipWhitelist, newIpAddress],
      },
    });
    setNewIpAddress('');
  };

  const handleRemoveIpAddress = (ip: string) => {
    if (!settings) return;
    
    setSettings({
      ...settings,
      security: {
        ...settings.security,
        ipWhitelist: settings.security.ipWhitelist.filter(item => item !== ip),
      },
    });
  };

  const togglePasswordVisibility = (field: string) => {
    setShowPassword(prev => ({ ...prev, [field]: !prev[field] }));
  };

  if (!settings) {
    return (
      <AdminLayout>
        <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
          <Typography>Loading settings...</Typography>
        </Box>
      </AdminLayout>
    );
  }

  return (
    <>
      <Head>
        <title>System Settings - ReskFlow Admin</title>
      </Head>
      
      <AdminLayout>
        <Box sx={{ flexGrow: 1 }}>
          {/* Header */}
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
            <Typography variant="h4" fontWeight="bold">
              System Settings
            </Typography>
            <Button
              variant="contained"
              startIcon={<Save />}
              onClick={handleSaveSettings}
              disabled={saving}
            >
              Save Changes
            </Button>
          </Box>

          {/* Tabs */}
          <Paper sx={{ mb: 3 }}>
            <Tabs
              value={selectedTab}
              onChange={(e, value) => setSelectedTab(value)}
              variant="scrollable"
              scrollButtons="auto"
            >
              <Tab label="Platform" />
              <Tab label="Commission & Fees" />
              <Tab label="Delivery" />
              <Tab label="Payment Methods" />
              <Tab label="Notifications" />
              <Tab label="Security" />
              <Tab label="Integrations" />
            </Tabs>
          </Paper>

          {/* Platform Settings */}
          {selectedTab === 0 && (
            <Grid container spacing={3}>
              <Grid item xs={12}>
                <Paper sx={{ p: 3 }}>
                  <Typography variant="h6" gutterBottom>
                    Platform Configuration
                  </Typography>
                  <Grid container spacing={3}>
                    <Grid item xs={12} md={6}>
                      <TextField
                        fullWidth
                        label="Platform Name"
                        value={settings.platform.name}
                        onChange={(e) => setSettings({
                          ...settings,
                          platform: { ...settings.platform, name: e.target.value }
                        })}
                      />
                    </Grid>
                    <Grid item xs={12} md={6}>
                      <TextField
                        fullWidth
                        label="Platform URL"
                        value={settings.platform.url}
                        onChange={(e) => setSettings({
                          ...settings,
                          platform: { ...settings.platform, url: e.target.value }
                        })}
                      />
                    </Grid>
                    <Grid item xs={12} md={6}>
                      <TextField
                        fullWidth
                        label="Support Email"
                        type="email"
                        value={settings.platform.supportEmail}
                        onChange={(e) => setSettings({
                          ...settings,
                          platform: { ...settings.platform, supportEmail: e.target.value }
                        })}
                      />
                    </Grid>
                    <Grid item xs={12} md={6}>
                      <TextField
                        fullWidth
                        label="Support Phone"
                        value={settings.platform.supportPhone}
                        onChange={(e) => setSettings({
                          ...settings,
                          platform: { ...settings.platform, supportPhone: e.target.value }
                        })}
                      />
                    </Grid>
                    <Grid item xs={12} md={4}>
                      <FormControl fullWidth>
                        <InputLabel>Timezone</InputLabel>
                        <Select
                          value={settings.platform.timezone}
                          onChange={(e) => setSettings({
                            ...settings,
                            platform: { ...settings.platform, timezone: e.target.value }
                          })}
                          label="Timezone"
                        >
                          <MenuItem value="UTC">UTC</MenuItem>
                          <MenuItem value="America/New_York">Eastern Time</MenuItem>
                          <MenuItem value="America/Chicago">Central Time</MenuItem>
                          <MenuItem value="America/Denver">Mountain Time</MenuItem>
                          <MenuItem value="America/Los_Angeles">Pacific Time</MenuItem>
                        </Select>
                      </FormControl>
                    </Grid>
                    <Grid item xs={12} md={4}>
                      <FormControl fullWidth>
                        <InputLabel>Currency</InputLabel>
                        <Select
                          value={settings.platform.currency}
                          onChange={(e) => setSettings({
                            ...settings,
                            platform: { ...settings.platform, currency: e.target.value }
                          })}
                          label="Currency"
                        >
                          <MenuItem value="USD">USD ($)</MenuItem>
                          <MenuItem value="EUR">EUR (€)</MenuItem>
                          <MenuItem value="GBP">GBP (£)</MenuItem>
                          <MenuItem value="CAD">CAD ($)</MenuItem>
                        </Select>
                      </FormControl>
                    </Grid>
                    <Grid item xs={12} md={4}>
                      <FormControl fullWidth>
                        <InputLabel>Language</InputLabel>
                        <Select
                          value={settings.platform.language}
                          onChange={(e) => setSettings({
                            ...settings,
                            platform: { ...settings.platform, language: e.target.value }
                          })}
                          label="Language"
                        >
                          <MenuItem value="en">English</MenuItem>
                          <MenuItem value="es">Spanish</MenuItem>
                          <MenuItem value="fr">French</MenuItem>
                          <MenuItem value="de">German</MenuItem>
                        </Select>
                      </FormControl>
                    </Grid>
                    <Grid item xs={12}>
                      <Alert severity="warning" sx={{ mb: 2 }}>
                        <Typography variant="subtitle2" gutterBottom>
                          Maintenance Mode
                        </Typography>
                        <Typography variant="body2" color="text.secondary">
                          When enabled, users will see the maintenance message and won't be able to place orders.
                        </Typography>
                      </Alert>
                      <FormControlLabel
                        control={
                          <Switch
                            checked={settings.platform.maintenanceMode}
                            onChange={(e) => setSettings({
                              ...settings,
                              platform: { ...settings.platform, maintenanceMode: e.target.checked }
                            })}
                          />
                        }
                        label="Enable Maintenance Mode"
                      />
                      {settings.platform.maintenanceMode && (
                        <TextField
                          fullWidth
                          multiline
                          rows={3}
                          label="Maintenance Message"
                          value={settings.platform.maintenanceMessage}
                          onChange={(e) => setSettings({
                            ...settings,
                            platform: { ...settings.platform, maintenanceMessage: e.target.value }
                          })}
                          sx={{ mt: 2 }}
                        />
                      )}
                    </Grid>
                  </Grid>
                </Paper>
              </Grid>
            </Grid>
          )}

          {/* Commission & Fees */}
          {selectedTab === 1 && (
            <Grid container spacing={3}>
              <Grid item xs={12}>
                <Paper sx={{ p: 3 }}>
                  <Typography variant="h6" gutterBottom>
                    Commission Settings
                  </Typography>
                  <Grid container spacing={3}>
                    <Grid item xs={12} md={4}>
                      <Typography gutterBottom>Default Commission Rate: {settings.commission.defaultRate}%</Typography>
                      <Slider
                        value={settings.commission.defaultRate}
                        onChange={(e, value) => setSettings({
                          ...settings,
                          commission: { ...settings.commission, defaultRate: value as number }
                        })}
                        min={settings.commission.minRate}
                        max={settings.commission.maxRate}
                        step={0.5}
                        marks
                        valueLabelDisplay="auto"
                      />
                    </Grid>
                    <Grid item xs={12} md={4}>
                      <TextField
                        fullWidth
                        label="Minimum Rate (%)"
                        type="number"
                        value={settings.commission.minRate}
                        onChange={(e) => setSettings({
                          ...settings,
                          commission: { ...settings.commission, minRate: parseFloat(e.target.value) }
                        })}
                        inputProps={{ step: 0.5, min: 0, max: 50 }}
                      />
                    </Grid>
                    <Grid item xs={12} md={4}>
                      <TextField
                        fullWidth
                        label="Maximum Rate (%)"
                        type="number"
                        value={settings.commission.maxRate}
                        onChange={(e) => setSettings({
                          ...settings,
                          commission: { ...settings.commission, maxRate: parseFloat(e.target.value) }
                        })}
                        inputProps={{ step: 0.5, min: 0, max: 50 }}
                      />
                    </Grid>
                    <Grid item xs={12} md={6}>
                      <TextField
                        fullWidth
                        label="Processing Fee (%)"
                        type="number"
                        value={settings.commission.processingFee}
                        onChange={(e) => setSettings({
                          ...settings,
                          commission: { ...settings.commission, processingFee: parseFloat(e.target.value) }
                        })}
                        inputProps={{ step: 0.1, min: 0, max: 10 }}
                      />
                    </Grid>
                    <Grid item xs={12} md={6}>
                      <TextField
                        fullWidth
                        label="Tax Rate (%)"
                        type="number"
                        value={settings.commission.taxRate}
                        onChange={(e) => setSettings({
                          ...settings,
                          commission: { ...settings.commission, taxRate: parseFloat(e.target.value) }
                        })}
                        inputProps={{ step: 0.1, min: 0, max: 30 }}
                      />
                    </Grid>
                  </Grid>
                </Paper>
              </Grid>
            </Grid>
          )}

          {/* Delivery Settings */}
          {selectedTab === 2 && (
            <Grid container spacing={3}>
              <Grid item xs={12}>
                <Paper sx={{ p: 3 }}>
                  <Typography variant="h6" gutterBottom>
                    Delivery Configuration
                  </Typography>
                  <Grid container spacing={3}>
                    <Grid item xs={12} md={6}>
                      <TextField
                        fullWidth
                        label="Base Delivery Fee"
                        type="number"
                        value={settings.reskflow.baseDeliveryFee}
                        onChange={(e) => setSettings({
                          ...settings,
                          reskflow: { ...settings.reskflow, baseDeliveryFee: parseFloat(e.target.value) }
                        })}
                        InputProps={{
                          startAdornment: <InputAdornment position="start">$</InputAdornment>,
                        }}
                      />
                    </Grid>
                    <Grid item xs={12} md={6}>
                      <TextField
                        fullWidth
                        label="Price per KM"
                        type="number"
                        value={settings.reskflow.pricePerKm}
                        onChange={(e) => setSettings({
                          ...settings,
                          reskflow: { ...settings.reskflow, pricePerKm: parseFloat(e.target.value) }
                        })}
                        InputProps={{
                          startAdornment: <InputAdornment position="start">$</InputAdornment>,
                        }}
                      />
                    </Grid>
                    <Grid item xs={12} md={6}>
                      <TextField
                        fullWidth
                        label="Minimum Delivery Fee"
                        type="number"
                        value={settings.reskflow.minDeliveryFee}
                        onChange={(e) => setSettings({
                          ...settings,
                          reskflow: { ...settings.reskflow, minDeliveryFee: parseFloat(e.target.value) }
                        })}
                        InputProps={{
                          startAdornment: <InputAdornment position="start">$</InputAdornment>,
                        }}
                      />
                    </Grid>
                    <Grid item xs={12} md={6}>
                      <TextField
                        fullWidth
                        label="Maximum Delivery Fee"
                        type="number"
                        value={settings.reskflow.maxDeliveryFee}
                        onChange={(e) => setSettings({
                          ...settings,
                          reskflow: { ...settings.reskflow, maxDeliveryFee: parseFloat(e.target.value) }
                        })}
                        InputProps={{
                          startAdornment: <InputAdornment position="start">$</InputAdornment>,
                        }}
                      />
                    </Grid>
                    <Grid item xs={12} md={6}>
                      <TextField
                        fullWidth
                        label="Free Delivery Threshold"
                        type="number"
                        value={settings.reskflow.freeDeliveryThreshold}
                        onChange={(e) => setSettings({
                          ...settings,
                          reskflow: { ...settings.reskflow, freeDeliveryThreshold: parseFloat(e.target.value) }
                        })}
                        InputProps={{
                          startAdornment: <InputAdornment position="start">$</InputAdornment>,
                        }}
                        helperText="Orders above this amount get free reskflow"
                      />
                    </Grid>
                    <Grid item xs={12} md={6}>
                      <TextField
                        fullWidth
                        label="Maximum Delivery Distance (KM)"
                        type="number"
                        value={settings.reskflow.maxDeliveryDistance}
                        onChange={(e) => setSettings({
                          ...settings,
                          reskflow: { ...settings.reskflow, maxDeliveryDistance: parseFloat(e.target.value) }
                        })}
                      />
                    </Grid>
                    <Grid item xs={12} md={6}>
                      <TextField
                        fullWidth
                        label="Estimated Preparation Time (minutes)"
                        type="number"
                        value={settings.reskflow.estimatedPrepTime}
                        onChange={(e) => setSettings({
                          ...settings,
                          reskflow: { ...settings.reskflow, estimatedPrepTime: parseInt(e.target.value) }
                        })}
                      />
                    </Grid>
                    <Grid item xs={12} md={6}>
                      <TextField
                        fullWidth
                        label="Estimated Delivery Time (minutes)"
                        type="number"
                        value={settings.reskflow.estimatedDeliveryTime}
                        onChange={(e) => setSettings({
                          ...settings,
                          reskflow: { ...settings.reskflow, estimatedDeliveryTime: parseInt(e.target.value) }
                        })}
                      />
                    </Grid>
                  </Grid>
                </Paper>
              </Grid>
            </Grid>
          )}

          {/* Payment Methods */}
          {selectedTab === 3 && (
            <Grid container spacing={3}>
              {/* Stripe */}
              <Grid item xs={12} md={6}>
                <Paper sx={{ p: 3 }}>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                    <Typography variant="h6">Stripe</Typography>
                    <FormControlLabel
                      control={
                        <Switch
                          checked={settings.payment.stripeEnabled}
                          onChange={(e) => setSettings({
                            ...settings,
                            payment: { ...settings.payment, stripeEnabled: e.target.checked }
                          })}
                        />
                      }
                      label="Enabled"
                    />
                  </Box>
                  {settings.payment.stripeEnabled && (
                    <>
                      <TextField
                        fullWidth
                        label="Public Key"
                        value={settings.payment.stripePublicKey}
                        onChange={(e) => setSettings({
                          ...settings,
                          payment: { ...settings.payment, stripePublicKey: e.target.value }
                        })}
                        sx={{ mb: 2 }}
                      />
                      <TextField
                        fullWidth
                        label="Secret Key"
                        type={showPassword.stripeSecret ? 'text' : 'password'}
                        value={settings.payment.stripeSecretKey}
                        onChange={(e) => setSettings({
                          ...settings,
                          payment: { ...settings.payment, stripeSecretKey: e.target.value }
                        })}
                        InputProps={{
                          endAdornment: (
                            <InputAdornment position="end">
                              <IconButton
                                onClick={() => togglePasswordVisibility('stripeSecret')}
                                edge="end"
                              >
                                {showPassword.stripeSecret ? <VisibilityOff /> : <Visibility />}
                              </IconButton>
                            </InputAdornment>
                          ),
                        }}
                        sx={{ mb: 2 }}
                      />
                      <Button
                        variant="outlined"
                        size="small"
                        onClick={() => handleTestIntegration('stripe')}
                      >
                        Test Connection
                      </Button>
                    </>
                  )}
                </Paper>
              </Grid>

              {/* PayPal */}
              <Grid item xs={12} md={6}>
                <Paper sx={{ p: 3 }}>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                    <Typography variant="h6">PayPal</Typography>
                    <FormControlLabel
                      control={
                        <Switch
                          checked={settings.payment.paypalEnabled}
                          onChange={(e) => setSettings({
                            ...settings,
                            payment: { ...settings.payment, paypalEnabled: e.target.checked }
                          })}
                        />
                      }
                      label="Enabled"
                    />
                  </Box>
                  {settings.payment.paypalEnabled && (
                    <>
                      <TextField
                        fullWidth
                        label="Client ID"
                        value={settings.payment.paypalClientId}
                        onChange={(e) => setSettings({
                          ...settings,
                          payment: { ...settings.payment, paypalClientId: e.target.value }
                        })}
                        sx={{ mb: 2 }}
                      />
                      <TextField
                        fullWidth
                        label="Secret Key"
                        type={showPassword.paypalSecret ? 'text' : 'password'}
                        value={settings.payment.paypalSecretKey}
                        onChange={(e) => setSettings({
                          ...settings,
                          payment: { ...settings.payment, paypalSecretKey: e.target.value }
                        })}
                        InputProps={{
                          endAdornment: (
                            <InputAdornment position="end">
                              <IconButton
                                onClick={() => togglePasswordVisibility('paypalSecret')}
                                edge="end"
                              >
                                {showPassword.paypalSecret ? <VisibilityOff /> : <Visibility />}
                              </IconButton>
                            </InputAdornment>
                          ),
                        }}
                        sx={{ mb: 2 }}
                      />
                      <Button
                        variant="outlined"
                        size="small"
                        onClick={() => handleTestIntegration('paypal')}
                      >
                        Test Connection
                      </Button>
                    </>
                  )}
                </Paper>
              </Grid>

              {/* Other Payment Methods */}
              <Grid item xs={12}>
                <Paper sx={{ p: 3 }}>
                  <Typography variant="h6" gutterBottom>Other Payment Methods</Typography>
                  <Grid container spacing={2}>
                    <Grid item xs={12} md={3}>
                      <FormControlLabel
                        control={
                          <Switch
                            checked={settings.payment.cashEnabled}
                            onChange={(e) => setSettings({
                              ...settings,
                              payment: { ...settings.payment, cashEnabled: e.target.checked }
                            })}
                          />
                        }
                        label="Cash on Delivery"
                      />
                    </Grid>
                    <Grid item xs={12} md={3}>
                      <FormControlLabel
                        control={
                          <Switch
                            checked={settings.payment.walletEnabled}
                            onChange={(e) => setSettings({
                              ...settings,
                              payment: { ...settings.payment, walletEnabled: e.target.checked }
                            })}
                          />
                        }
                        label="Wallet"
                      />
                    </Grid>
                    <Grid item xs={12} md={3}>
                      <FormControlLabel
                        control={
                          <Switch
                            checked={settings.payment.blockchainEnabled}
                            onChange={(e) => setSettings({
                              ...settings,
                              payment: { ...settings.payment, blockchainEnabled: e.target.checked }
                            })}
                          />
                        }
                        label="Blockchain"
                      />
                    </Grid>
                  </Grid>

                  {settings.payment.blockchainEnabled && (
                    <Grid container spacing={2} sx={{ mt: 2 }}>
                      <Grid item xs={12} md={6}>
                        <FormControl fullWidth>
                          <InputLabel>Blockchain Network</InputLabel>
                          <Select
                            value={settings.payment.blockchainNetwork}
                            onChange={(e) => setSettings({
                              ...settings,
                              payment: { ...settings.payment, blockchainNetwork: e.target.value }
                            })}
                            label="Blockchain Network"
                          >
                            <MenuItem value="polygon-mumbai">Polygon Mumbai (Testnet)</MenuItem>
                            <MenuItem value="polygon-mainnet">Polygon Mainnet</MenuItem>
                            <MenuItem value="ethereum-goerli">Ethereum Goerli (Testnet)</MenuItem>
                            <MenuItem value="ethereum-mainnet">Ethereum Mainnet</MenuItem>
                          </Select>
                        </FormControl>
                      </Grid>
                      <Grid item xs={12} md={6}>
                        <TextField
                          fullWidth
                          label="RPC URL"
                          value={settings.payment.blockchainRpcUrl}
                          onChange={(e) => setSettings({
                            ...settings,
                            payment: { ...settings.payment, blockchainRpcUrl: e.target.value }
                          })}
                        />
                      </Grid>
                    </Grid>
                  )}

                  <Divider sx={{ my: 3 }} />
                  
                  <Typography variant="h6" gutterBottom>Order Limits</Typography>
                  <Grid container spacing={2}>
                    <Grid item xs={12} md={6}>
                      <TextField
                        fullWidth
                        label="Minimum Order Amount"
                        type="number"
                        value={settings.payment.minOrderAmount}
                        onChange={(e) => setSettings({
                          ...settings,
                          payment: { ...settings.payment, minOrderAmount: parseFloat(e.target.value) }
                        })}
                        InputProps={{
                          startAdornment: <InputAdornment position="start">$</InputAdornment>,
                        }}
                      />
                    </Grid>
                    <Grid item xs={12} md={6}>
                      <TextField
                        fullWidth
                        label="Maximum Order Amount"
                        type="number"
                        value={settings.payment.maxOrderAmount}
                        onChange={(e) => setSettings({
                          ...settings,
                          payment: { ...settings.payment, maxOrderAmount: parseFloat(e.target.value) }
                        })}
                        InputProps={{
                          startAdornment: <InputAdornment position="start">$</InputAdornment>,
                        }}
                      />
                    </Grid>
                  </Grid>
                </Paper>
              </Grid>
            </Grid>
          )}

          {/* Notifications */}
          {selectedTab === 4 && (
            <Grid container spacing={3}>
              <Grid item xs={12}>
                <Paper sx={{ p: 3 }}>
                  <Typography variant="h6" gutterBottom>
                    Notification Channels
                  </Typography>
                  <Grid container spacing={3}>
                    <Grid item xs={12} md={4}>
                      <FormControlLabel
                        control={
                          <Switch
                            checked={settings.notifications.emailEnabled}
                            onChange={(e) => setSettings({
                              ...settings,
                              notifications: { ...settings.notifications, emailEnabled: e.target.checked }
                            })}
                          />
                        }
                        label="Email Notifications"
                      />
                    </Grid>
                    <Grid item xs={12} md={4}>
                      <FormControlLabel
                        control={
                          <Switch
                            checked={settings.notifications.smsEnabled}
                            onChange={(e) => setSettings({
                              ...settings,
                              notifications: { ...settings.notifications, smsEnabled: e.target.checked }
                            })}
                          />
                        }
                        label="SMS Notifications"
                      />
                    </Grid>
                    <Grid item xs={12} md={4}>
                      <FormControlLabel
                        control={
                          <Switch
                            checked={settings.notifications.pushEnabled}
                            onChange={(e) => setSettings({
                              ...settings,
                              notifications: { ...settings.notifications, pushEnabled: e.target.checked }
                            })}
                          />
                        }
                        label="Push Notifications"
                      />
                    </Grid>
                  </Grid>

                  <Divider sx={{ my: 3 }} />

                  <Typography variant="h6" gutterBottom>
                    Notification Types
                  </Typography>
                  <Grid container spacing={2}>
                    <Grid item xs={12} md={4}>
                      <FormControlLabel
                        control={
                          <Switch
                            checked={settings.notifications.orderConfirmation}
                            onChange={(e) => setSettings({
                              ...settings,
                              notifications: { ...settings.notifications, orderConfirmation: e.target.checked }
                            })}
                          />
                        }
                        label="Order Confirmations"
                      />
                    </Grid>
                    <Grid item xs={12} md={4}>
                      <FormControlLabel
                        control={
                          <Switch
                            checked={settings.notifications.orderStatusUpdates}
                            onChange={(e) => setSettings({
                              ...settings,
                              notifications: { ...settings.notifications, orderStatusUpdates: e.target.checked }
                            })}
                          />
                        }
                        label="Order Status Updates"
                      />
                    </Grid>
                    <Grid item xs={12} md={4}>
                      <FormControlLabel
                        control={
                          <Switch
                            checked={settings.notifications.promotionalEmails}
                            onChange={(e) => setSettings({
                              ...settings,
                              notifications: { ...settings.notifications, promotionalEmails: e.target.checked }
                            })}
                          />
                        }
                        label="Promotional Emails"
                      />
                    </Grid>
                  </Grid>
                </Paper>
              </Grid>

              {/* Email Settings */}
              {settings.notifications.emailEnabled && (
                <Grid item xs={12} md={6}>
                  <Paper sx={{ p: 3 }}>
                    <Typography variant="h6" gutterBottom>
                      SendGrid Configuration
                    </Typography>
                    <TextField
                      fullWidth
                      label="API Key"
                      type={showPassword.sendgrid ? 'text' : 'password'}
                      value={settings.notifications.sendgridApiKey}
                      onChange={(e) => setSettings({
                        ...settings,
                        notifications: { ...settings.notifications, sendgridApiKey: e.target.value }
                      })}
                      InputProps={{
                        endAdornment: (
                          <InputAdornment position="end">
                            <IconButton
                              onClick={() => togglePasswordVisibility('sendgrid')}
                              edge="end"
                            >
                              {showPassword.sendgrid ? <VisibilityOff /> : <Visibility />}
                            </IconButton>
                          </InputAdornment>
                        ),
                      }}
                      sx={{ mb: 2 }}
                    />
                    <Button
                      variant="outlined"
                      size="small"
                      onClick={() => handleTestIntegration('sendgrid')}
                    >
                      Test Connection
                    </Button>
                  </Paper>
                </Grid>
              )}

              {/* SMS Settings */}
              {settings.notifications.smsEnabled && (
                <Grid item xs={12} md={6}>
                  <Paper sx={{ p: 3 }}>
                    <Typography variant="h6" gutterBottom>
                      Twilio Configuration
                    </Typography>
                    <TextField
                      fullWidth
                      label="Account SID"
                      value={settings.notifications.twilioAccountSid}
                      onChange={(e) => setSettings({
                        ...settings,
                        notifications: { ...settings.notifications, twilioAccountSid: e.target.value }
                      })}
                      sx={{ mb: 2 }}
                    />
                    <TextField
                      fullWidth
                      label="Auth Token"
                      type={showPassword.twilio ? 'text' : 'password'}
                      value={settings.notifications.twilioAuthToken}
                      onChange={(e) => setSettings({
                        ...settings,
                        notifications: { ...settings.notifications, twilioAuthToken: e.target.value }
                      })}
                      InputProps={{
                        endAdornment: (
                          <InputAdornment position="end">
                            <IconButton
                              onClick={() => togglePasswordVisibility('twilio')}
                              edge="end"
                            >
                              {showPassword.twilio ? <VisibilityOff /> : <Visibility />}
                            </IconButton>
                          </InputAdornment>
                        ),
                      }}
                      sx={{ mb: 2 }}
                    />
                    <TextField
                      fullWidth
                      label="Phone Number"
                      value={settings.notifications.twilioPhoneNumber}
                      onChange={(e) => setSettings({
                        ...settings,
                        notifications: { ...settings.notifications, twilioPhoneNumber: e.target.value }
                      })}
                      sx={{ mb: 2 }}
                    />
                    <Button
                      variant="outlined"
                      size="small"
                      onClick={() => handleTestIntegration('twilio')}
                    >
                      Test Connection
                    </Button>
                  </Paper>
                </Grid>
              )}
            </Grid>
          )}

          {/* Security */}
          {selectedTab === 5 && (
            <Grid container spacing={3}>
              <Grid item xs={12}>
                <Paper sx={{ p: 3 }}>
                  <Typography variant="h6" gutterBottom>
                    Security Settings
                  </Typography>
                  <Grid container spacing={3}>
                    <Grid item xs={12} md={6}>
                      <FormControlLabel
                        control={
                          <Switch
                            checked={settings.security.twoFactorEnabled}
                            onChange={(e) => setSettings({
                              ...settings,
                              security: { ...settings.security, twoFactorEnabled: e.target.checked }
                            })}
                          />
                        }
                        label="Require Two-Factor Authentication for Admins"
                      />
                    </Grid>
                    <Grid item xs={12} md={6}>
                      <TextField
                        fullWidth
                        label="Session Timeout (minutes)"
                        type="number"
                        value={settings.security.sessionTimeout}
                        onChange={(e) => setSettings({
                          ...settings,
                          security: { ...settings.security, sessionTimeout: parseInt(e.target.value) }
                        })}
                      />
                    </Grid>
                    <Grid item xs={12} md={6}>
                      <TextField
                        fullWidth
                        label="Max Login Attempts"
                        type="number"
                        value={settings.security.maxLoginAttempts}
                        onChange={(e) => setSettings({
                          ...settings,
                          security: { ...settings.security, maxLoginAttempts: parseInt(e.target.value) }
                        })}
                      />
                    </Grid>
                    <Grid item xs={12} md={6}>
                      <TextField
                        fullWidth
                        label="API Rate Limit (requests/minute)"
                        type="number"
                        value={settings.security.apiRateLimit}
                        onChange={(e) => setSettings({
                          ...settings,
                          security: { ...settings.security, apiRateLimit: parseInt(e.target.value) }
                        })}
                      />
                    </Grid>
                  </Grid>

                  <Divider sx={{ my: 3 }} />

                  <Typography variant="h6" gutterBottom>
                    Password Requirements
                  </Typography>
                  <Grid container spacing={3}>
                    <Grid item xs={12} md={4}>
                      <TextField
                        fullWidth
                        label="Minimum Length"
                        type="number"
                        value={settings.security.passwordMinLength}
                        onChange={(e) => setSettings({
                          ...settings,
                          security: { ...settings.security, passwordMinLength: parseInt(e.target.value) }
                        })}
                      />
                    </Grid>
                    <Grid item xs={12} md={4}>
                      <FormControlLabel
                        control={
                          <Switch
                            checked={settings.security.passwordRequireSpecial}
                            onChange={(e) => setSettings({
                              ...settings,
                              security: { ...settings.security, passwordRequireSpecial: e.target.checked }
                            })}
                          />
                        }
                        label="Require Special Characters"
                      />
                    </Grid>
                    <Grid item xs={12} md={4}>
                      <FormControlLabel
                        control={
                          <Switch
                            checked={settings.security.passwordRequireNumbers}
                            onChange={(e) => setSettings({
                              ...settings,
                              security: { ...settings.security, passwordRequireNumbers: e.target.checked }
                            })}
                          />
                        }
                        label="Require Numbers"
                      />
                    </Grid>
                  </Grid>

                  <Divider sx={{ my: 3 }} />

                  <Typography variant="h6" gutterBottom>
                    IP Whitelist
                  </Typography>
                  <Box sx={{ mb: 2 }}>
                    <TextField
                      fullWidth
                      label="Add IP Address"
                      value={newIpAddress}
                      onChange={(e) => setNewIpAddress(e.target.value)}
                      onKeyPress={(e) => e.key === 'Enter' && handleAddIpAddress()}
                      InputProps={{
                        endAdornment: (
                          <InputAdornment position="end">
                            <IconButton onClick={handleAddIpAddress}>
                              <Add />
                            </IconButton>
                          </InputAdornment>
                        ),
                      }}
                    />
                  </Box>
                  <List>
                    {settings.security.ipWhitelist.map((ip) => (
                      <ListItem key={ip}>
                        <ListItemText primary={ip} />
                        <ListItemSecondaryAction>
                          <IconButton edge="end" onClick={() => handleRemoveIpAddress(ip)}>
                            <Delete />
                          </IconButton>
                        </ListItemSecondaryAction>
                      </ListItem>
                    ))}
                  </List>

                  <Divider sx={{ my: 3 }} />

                  <Typography variant="h6" gutterBottom>
                    reCAPTCHA
                  </Typography>
                  <FormControlLabel
                    control={
                      <Switch
                        checked={settings.security.recaptchaEnabled}
                        onChange={(e) => setSettings({
                          ...settings,
                          security: { ...settings.security, recaptchaEnabled: e.target.checked }
                        })}
                      />
                    }
                    label="Enable reCAPTCHA"
                  />
                  {settings.security.recaptchaEnabled && (
                    <Grid container spacing={2} sx={{ mt: 1 }}>
                      <Grid item xs={12} md={6}>
                        <TextField
                          fullWidth
                          label="Site Key"
                          value={settings.security.recaptchaSiteKey}
                          onChange={(e) => setSettings({
                            ...settings,
                            security: { ...settings.security, recaptchaSiteKey: e.target.value }
                          })}
                        />
                      </Grid>
                      <Grid item xs={12} md={6}>
                        <TextField
                          fullWidth
                          label="Secret Key"
                          type={showPassword.recaptcha ? 'text' : 'password'}
                          value={settings.security.recaptchaSecretKey}
                          onChange={(e) => setSettings({
                            ...settings,
                            security: { ...settings.security, recaptchaSecretKey: e.target.value }
                          })}
                          InputProps={{
                            endAdornment: (
                              <InputAdornment position="end">
                                <IconButton
                                  onClick={() => togglePasswordVisibility('recaptcha')}
                                  edge="end"
                                >
                                  {showPassword.recaptcha ? <VisibilityOff /> : <Visibility />}
                                </IconButton>
                              </InputAdornment>
                            ),
                          }}
                        />
                      </Grid>
                    </Grid>
                  )}
                </Paper>
              </Grid>
            </Grid>
          )}

          {/* Integrations */}
          {selectedTab === 6 && (
            <Grid container spacing={3}>
              <Grid item xs={12}>
                <Paper sx={{ p: 3 }}>
                  <Typography variant="h6" gutterBottom>
                    Third-Party Integrations
                  </Typography>
                  <Grid container spacing={3}>
                    <Grid item xs={12} md={6}>
                      <TextField
                        fullWidth
                        label="Google Maps API Key"
                        type={showPassword.googleMaps ? 'text' : 'password'}
                        value={settings.integrations.googleMapsApiKey}
                        onChange={(e) => setSettings({
                          ...settings,
                          integrations: { ...settings.integrations, googleMapsApiKey: e.target.value }
                        })}
                        InputProps={{
                          endAdornment: (
                            <InputAdornment position="end">
                              <IconButton
                                onClick={() => togglePasswordVisibility('googleMaps')}
                                edge="end"
                              >
                                {showPassword.googleMaps ? <VisibilityOff /> : <Visibility />}
                              </IconButton>
                            </InputAdornment>
                          ),
                        }}
                      />
                    </Grid>
                    <Grid item xs={12} md={6}>
                      <TextField
                        fullWidth
                        label="Google Analytics ID"
                        value={settings.integrations.googleAnalyticsId}
                        onChange={(e) => setSettings({
                          ...settings,
                          integrations: { ...settings.integrations, googleAnalyticsId: e.target.value }
                        })}
                      />
                    </Grid>
                    <Grid item xs={12} md={6}>
                      <TextField
                        fullWidth
                        label="Facebook Pixel ID"
                        value={settings.integrations.facebookPixelId}
                        onChange={(e) => setSettings({
                          ...settings,
                          integrations: { ...settings.integrations, facebookPixelId: e.target.value }
                        })}
                      />
                    </Grid>
                    <Grid item xs={12} md={6}>
                      <TextField
                        fullWidth
                        label="Sentry DSN"
                        value={settings.integrations.sentryDsn}
                        onChange={(e) => setSettings({
                          ...settings,
                          integrations: { ...settings.integrations, sentryDsn: e.target.value }
                        })}
                      />
                    </Grid>
                  </Grid>

                  <Divider sx={{ my: 3 }} />

                  <Typography variant="h6" gutterBottom>
                    System Configuration
                  </Typography>
                  <Grid container spacing={3}>
                    <Grid item xs={12} md={4}>
                      <FormControl fullWidth>
                        <InputLabel>Log Level</InputLabel>
                        <Select
                          value={settings.integrations.logLevel}
                          onChange={(e) => setSettings({
                            ...settings,
                            integrations: { ...settings.integrations, logLevel: e.target.value }
                          })}
                          label="Log Level"
                        >
                          <MenuItem value="error">Error</MenuItem>
                          <MenuItem value="warn">Warning</MenuItem>
                          <MenuItem value="info">Info</MenuItem>
                          <MenuItem value="debug">Debug</MenuItem>
                        </Select>
                      </FormControl>
                    </Grid>
                    <Grid item xs={12} md={4}>
                      <TextField
                        fullWidth
                        label="Elasticsearch URL"
                        value={settings.integrations.elasticsearchUrl}
                        onChange={(e) => setSettings({
                          ...settings,
                          integrations: { ...settings.integrations, elasticsearchUrl: e.target.value }
                        })}
                      />
                    </Grid>
                    <Grid item xs={12} md={4}>
                      <TextField
                        fullWidth
                        label="Redis URL"
                        value={settings.integrations.redisUrl}
                        onChange={(e) => setSettings({
                          ...settings,
                          integrations: { ...settings.integrations, redisUrl: e.target.value }
                        })}
                      />
                    </Grid>
                  </Grid>
                </Paper>
              </Grid>
            </Grid>
          )}
        </Box>

        {/* Test Connection Dialog */}
        <Dialog
          open={testDialog.open}
          onClose={() => setTestDialog({ open: false, type: '' })}
        >
          <DialogTitle>Testing {testDialog.type} Connection</DialogTitle>
          <DialogContent>
            <Box sx={{ display: 'flex', alignItems: 'center', p: 3 }}>
              <Typography>Testing connection...</Typography>
            </Box>
          </DialogContent>
        </Dialog>

        {/* Save Success Alert */}
        <Snackbar
          open={saveAlert}
          autoHideDuration={3000}
          onClose={() => setSaveAlert(false)}
          anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        >
          <Alert
            onClose={() => setSaveAlert(false)}
            severity="success"
            sx={{ width: '100%' }}
          >
            Settings saved successfully!
          </Alert>
        </Snackbar>
      </AdminLayout>
    </>
  );
}