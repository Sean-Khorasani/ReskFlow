import React, { useEffect, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import {
  Box,
  Tabs,
  Tab,
  Paper,
  Typography,
  TextField,
  Button,
  Switch,
  FormControlLabel,
  Grid,
  Divider,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  InputAdornment,
  Alert,
  CircularProgress,
} from '@mui/material';
import {
  Store,
  Schedule,
  LocalShipping,
  Notifications,
  Save,
} from '@mui/icons-material';
import { AppDispatch, RootState } from '@/store';
import {
  fetchSettings,
  updateSettings,
  updateBusinessHours,
  updateDeliverySettings,
} from '@/store/slices/settingsSlice';
import MainLayout from '@/components/layouts/MainLayout';
import Head from 'next/head';
import { useSnackbar } from 'notistack';
import { useForm, Controller } from 'react-hook-form';

interface TabPanelProps {
  children?: React.ReactNode;
  index: number;
  value: number;
}

function TabPanel(props: TabPanelProps) {
  const { children, value, index, ...other } = props;
  return (
    <div
      role="tabpanel"
      hidden={value !== index}
      id={`settings-tabpanel-${index}`}
      aria-labelledby={`settings-tab-${index}`}
      {...other}
    >
      {value === index && <Box sx={{ py: 3 }}>{children}</Box>}
    </div>
  );
}

const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

export default function SettingsPage() {
  const dispatch = useDispatch<AppDispatch>();
  const { enqueueSnackbar } = useSnackbar();
  const { settings, loading, saving } = useSelector((state: RootState) => state.settings);
  const { merchant } = useSelector((state: RootState) => state.auth);
  
  const [currentTab, setCurrentTab] = useState(0);
  
  const { control: generalControl, handleSubmit: handleGeneralSubmit } = useForm();
  const { control: hoursControl, handleSubmit: handleHoursSubmit } = useForm();
  const { control: reskflowControl, handleSubmit: handleDeliverySubmit } = useForm();
  const { control: notificationControl, handleSubmit: handleNotificationSubmit } = useForm();

  useEffect(() => {
    dispatch(fetchSettings());
  }, [dispatch]);

  const handleTabChange = (event: React.SyntheticEvent, newValue: number) => {
    setCurrentTab(newValue);
  };

  const onGeneralSubmit = async (data: any) => {
    try {
      await dispatch(updateSettings(data)).unwrap();
      enqueueSnackbar('General settings updated successfully', { variant: 'success' });
    } catch (error) {
      enqueueSnackbar('Failed to update settings', { variant: 'error' });
    }
  };

  const onHoursSubmit = async (data: any) => {
    try {
      await dispatch(updateBusinessHours(data)).unwrap();
      enqueueSnackbar('Business hours updated successfully', { variant: 'success' });
    } catch (error) {
      enqueueSnackbar('Failed to update business hours', { variant: 'error' });
    }
  };

  const onDeliverySubmit = async (data: any) => {
    try {
      await dispatch(updateDeliverySettings(data)).unwrap();
      enqueueSnackbar('Delivery settings updated successfully', { variant: 'success' });
    } catch (error) {
      enqueueSnackbar('Failed to update reskflow settings', { variant: 'error' });
    }
  };

  const onNotificationSubmit = async (data: any) => {
    try {
      await dispatch(updateSettings({ notificationSettings: data })).unwrap();
      enqueueSnackbar('Notification settings updated successfully', { variant: 'success' });
    } catch (error) {
      enqueueSnackbar('Failed to update notification settings', { variant: 'error' });
    }
  };

  if (loading) {
    return (
      <MainLayout>
        <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
          <CircularProgress />
        </Box>
      </MainLayout>
    );
  }

  return (
    <>
      <Head>
        <title>Settings - ReskFlow Merchant</title>
      </Head>
      
      <MainLayout>
        <Box sx={{ flexGrow: 1 }}>
          {/* Header */}
          <Box sx={{ mb: 3 }}>
            <Typography variant="h4" fontWeight="bold">
              Settings
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Manage your business settings and preferences
            </Typography>
          </Box>

          {/* Tabs */}
          <Paper sx={{ width: '100%' }}>
            <Tabs value={currentTab} onChange={handleTabChange}>
              <Tab icon={<Store />} label="General" />
              <Tab icon={<Schedule />} label="Business Hours" />
              <Tab icon={<LocalShipping />} label="Delivery" />
              <Tab icon={<Notifications />} label="Notifications" />
            </Tabs>

            {/* General Settings */}
            <TabPanel value={currentTab} index={0}>
              <form onSubmit={handleGeneralSubmit(onGeneralSubmit)}>
                <Grid container spacing={3}>
                  <Grid item xs={12}>
                    <Typography variant="h6" gutterBottom>
                      Business Information
                    </Typography>
                  </Grid>
                  
                  <Grid item xs={12} md={6}>
                    <TextField
                      fullWidth
                      label="Business Name"
                      defaultValue={merchant?.businessName}
                      disabled
                    />
                  </Grid>
                  
                  <Grid item xs={12} md={6}>
                    <TextField
                      fullWidth
                      label="Business Type"
                      defaultValue={merchant?.businessType}
                      disabled
                    />
                  </Grid>
                  
                  <Grid item xs={12} md={6}>
                    <Controller
                      name="taxRate"
                      control={generalControl}
                      defaultValue={settings?.taxRate || 0}
                      render={({ field }) => (
                        <TextField
                          {...field}
                          fullWidth
                          label="Tax Rate"
                          type="number"
                          InputProps={{
                            endAdornment: <InputAdornment position="end">%</InputAdornment>,
                          }}
                        />
                      )}
                    />
                  </Grid>
                  
                  <Grid item xs={12} md={6}>
                    <Controller
                      name="currency"
                      control={generalControl}
                      defaultValue={settings?.currency || 'USD'}
                      render={({ field }) => (
                        <FormControl fullWidth>
                          <InputLabel>Currency</InputLabel>
                          <Select {...field} label="Currency">
                            <MenuItem value="USD">USD</MenuItem>
                            <MenuItem value="EUR">EUR</MenuItem>
                            <MenuItem value="GBP">GBP</MenuItem>
                            <MenuItem value="CAD">CAD</MenuItem>
                          </Select>
                        </FormControl>
                      )}
                    />
                  </Grid>
                  
                  <Grid item xs={12}>
                    <Controller
                      name="autoAcceptOrders"
                      control={generalControl}
                      defaultValue={settings?.autoAcceptOrders || false}
                      render={({ field }) => (
                        <FormControlLabel
                          control={<Switch {...field} checked={field.value} />}
                          label="Auto-accept orders"
                        />
                      )}
                    />
                  </Grid>
                  
                  <Grid item xs={12}>
                    <Button
                      type="submit"
                      variant="contained"
                      startIcon={saving ? <CircularProgress size={20} /> : <Save />}
                      disabled={saving}
                    >
                      Save Changes
                    </Button>
                  </Grid>
                </Grid>
              </form>
            </TabPanel>

            {/* Business Hours */}
            <TabPanel value={currentTab} index={1}>
              <form onSubmit={handleHoursSubmit(onHoursSubmit)}>
                <Grid container spacing={3}>
                  <Grid item xs={12}>
                    <Typography variant="h6" gutterBottom>
                      Business Hours
                    </Typography>
                    <Typography variant="body2" color="text.secondary" gutterBottom>
                      Set your operating hours for each day of the week
                    </Typography>
                  </Grid>
                  
                  {DAYS.map((day) => (
                    <Grid item xs={12} key={day}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                        <Typography sx={{ width: 100, textTransform: 'capitalize' }}>
                          {day}
                        </Typography>
                        <Controller
                          name={`${day}.closed`}
                          control={hoursControl}
                          defaultValue={settings?.businessHours?.[day]?.closed || false}
                          render={({ field }) => (
                            <FormControlLabel
                              control={<Switch {...field} checked={field.value} />}
                              label="Closed"
                            />
                          )}
                        />
                        <Controller
                          name={`${day}.open`}
                          control={hoursControl}
                          defaultValue={settings?.businessHours?.[day]?.open || '09:00'}
                          render={({ field }) => (
                            <TextField
                              {...field}
                              type="time"
                              label="Open"
                              InputLabelProps={{ shrink: true }}
                              disabled={hoursControl._getWatch(`${day}.closed`)}
                            />
                          )}
                        />
                        <Controller
                          name={`${day}.close`}
                          control={hoursControl}
                          defaultValue={settings?.businessHours?.[day]?.close || '21:00'}
                          render={({ field }) => (
                            <TextField
                              {...field}
                              type="time"
                              label="Close"
                              InputLabelProps={{ shrink: true }}
                              disabled={hoursControl._getWatch(`${day}.closed`)}
                            />
                          )}
                        />
                      </Box>
                      <Divider sx={{ my: 1 }} />
                    </Grid>
                  ))}
                  
                  <Grid item xs={12}>
                    <Button
                      type="submit"
                      variant="contained"
                      startIcon={saving ? <CircularProgress size={20} /> : <Save />}
                      disabled={saving}
                    >
                      Save Business Hours
                    </Button>
                  </Grid>
                </Grid>
              </form>
            </TabPanel>

            {/* Delivery Settings */}
            <TabPanel value={currentTab} index={2}>
              <form onSubmit={handleDeliverySubmit(onDeliverySubmit)}>
                <Grid container spacing={3}>
                  <Grid item xs={12}>
                    <Typography variant="h6" gutterBottom>
                      Delivery Settings
                    </Typography>
                  </Grid>
                  
                  <Grid item xs={12} md={6}>
                    <Controller
                      name="reskflowRadius"
                      control={reskflowControl}
                      defaultValue={settings?.reskflowSettings?.reskflowRadius || 5}
                      render={({ field }) => (
                        <TextField
                          {...field}
                          fullWidth
                          label="Delivery Radius"
                          type="number"
                          InputProps={{
                            endAdornment: <InputAdornment position="end">km</InputAdornment>,
                          }}
                        />
                      )}
                    />
                  </Grid>
                  
                  <Grid item xs={12} md={6}>
                    <Controller
                      name="minimumOrderAmount"
                      control={reskflowControl}
                      defaultValue={settings?.reskflowSettings?.minimumOrderAmount || 0}
                      render={({ field }) => (
                        <TextField
                          {...field}
                          fullWidth
                          label="Minimum Order Amount"
                          type="number"
                          InputProps={{
                            startAdornment: <InputAdornment position="start">$</InputAdornment>,
                          }}
                        />
                      )}
                    />
                  </Grid>
                  
                  <Grid item xs={12} md={6}>
                    <Controller
                      name="reskflowFee"
                      control={reskflowControl}
                      defaultValue={settings?.reskflowSettings?.reskflowFee || 0}
                      render={({ field }) => (
                        <TextField
                          {...field}
                          fullWidth
                          label="Delivery Fee"
                          type="number"
                          InputProps={{
                            startAdornment: <InputAdornment position="start">$</InputAdornment>,
                          }}
                        />
                      )}
                    />
                  </Grid>
                  
                  <Grid item xs={12} md={6}>
                    <Controller
                      name="freeDeliveryThreshold"
                      control={reskflowControl}
                      defaultValue={settings?.reskflowSettings?.freeDeliveryThreshold || 0}
                      render={({ field }) => (
                        <TextField
                          {...field}
                          fullWidth
                          label="Free Delivery Threshold"
                          type="number"
                          InputProps={{
                            startAdornment: <InputAdornment position="start">$</InputAdornment>,
                          }}
                          helperText="Orders above this amount get free reskflow"
                        />
                      )}
                    />
                  </Grid>
                  
                  <Grid item xs={12} md={6}>
                    <Controller
                      name="estimatedDeliveryTime"
                      control={reskflowControl}
                      defaultValue={settings?.reskflowSettings?.estimatedDeliveryTime || 30}
                      render={({ field }) => (
                        <TextField
                          {...field}
                          fullWidth
                          label="Estimated Delivery Time"
                          type="number"
                          InputProps={{
                            endAdornment: <InputAdornment position="end">minutes</InputAdornment>,
                          }}
                        />
                      )}
                    />
                  </Grid>
                  
                  <Grid item xs={12} md={6}>
                    <Controller
                      name="preparationTimeBuffer"
                      control={reskflowControl}
                      defaultValue={settings?.preparationTimeBuffer || 15}
                      render={({ field }) => (
                        <TextField
                          {...field}
                          fullWidth
                          label="Preparation Time Buffer"
                          type="number"
                          InputProps={{
                            endAdornment: <InputAdornment position="end">minutes</InputAdornment>,
                          }}
                        />
                      )}
                    />
                  </Grid>
                  
                  <Grid item xs={12}>
                    <Controller
                      name="acceptsPickup"
                      control={reskflowControl}
                      defaultValue={settings?.reskflowSettings?.acceptsPickup || false}
                      render={({ field }) => (
                        <FormControlLabel
                          control={<Switch {...field} checked={field.value} />}
                          label="Accept pickup orders"
                        />
                      )}
                    />
                  </Grid>
                  
                  <Grid item xs={12}>
                    <Button
                      type="submit"
                      variant="contained"
                      startIcon={saving ? <CircularProgress size={20} /> : <Save />}
                      disabled={saving}
                    >
                      Save Delivery Settings
                    </Button>
                  </Grid>
                </Grid>
              </form>
            </TabPanel>

            {/* Notification Settings */}
            <TabPanel value={currentTab} index={3}>
              <form onSubmit={handleNotificationSubmit(onNotificationSubmit)}>
                <Grid container spacing={3}>
                  <Grid item xs={12}>
                    <Typography variant="h6" gutterBottom>
                      Notification Preferences
                    </Typography>
                  </Grid>
                  
                  <Grid item xs={12}>
                    <Controller
                      name="emailNotifications"
                      control={notificationControl}
                      defaultValue={settings?.notificationSettings?.emailNotifications || true}
                      render={({ field }) => (
                        <FormControlLabel
                          control={<Switch {...field} checked={field.value} />}
                          label="Email notifications"
                        />
                      )}
                    />
                  </Grid>
                  
                  <Grid item xs={12}>
                    <Controller
                      name="smsNotifications"
                      control={notificationControl}
                      defaultValue={settings?.notificationSettings?.smsNotifications || false}
                      render={({ field }) => (
                        <FormControlLabel
                          control={<Switch {...field} checked={field.value} />}
                          label="SMS notifications"
                        />
                      )}
                    />
                  </Grid>
                  
                  <Grid item xs={12}>
                    <Controller
                      name="pushNotifications"
                      control={notificationControl}
                      defaultValue={settings?.notificationSettings?.pushNotifications || true}
                      render={({ field }) => (
                        <FormControlLabel
                          control={<Switch {...field} checked={field.value} />}
                          label="Push notifications"
                        />
                      )}
                    />
                  </Grid>
                  
                  <Grid item xs={12}>
                    <Divider sx={{ my: 2 }} />
                    <Typography variant="subtitle1" gutterBottom>
                      Notification Types
                    </Typography>
                  </Grid>
                  
                  <Grid item xs={12}>
                    <Controller
                      name="orderAlerts"
                      control={notificationControl}
                      defaultValue={settings?.notificationSettings?.orderAlerts || true}
                      render={({ field }) => (
                        <FormControlLabel
                          control={<Switch {...field} checked={field.value} />}
                          label="New order alerts"
                        />
                      )}
                    />
                  </Grid>
                  
                  <Grid item xs={12}>
                    <Controller
                      name="lowStockAlerts"
                      control={notificationControl}
                      defaultValue={settings?.notificationSettings?.lowStockAlerts || true}
                      render={({ field }) => (
                        <FormControlLabel
                          control={<Switch {...field} checked={field.value} />}
                          label="Low stock alerts"
                        />
                      )}
                    />
                  </Grid>
                  
                  <Grid item xs={12}>
                    <Controller
                      name="marketingEmails"
                      control={notificationControl}
                      defaultValue={settings?.notificationSettings?.marketingEmails || false}
                      render={({ field }) => (
                        <FormControlLabel
                          control={<Switch {...field} checked={field.value} />}
                          label="Marketing and promotional emails"
                        />
                      )}
                    />
                  </Grid>
                  
                  <Grid item xs={12}>
                    <Alert severity="info">
                      You will always receive important system notifications and order confirmations.
                    </Alert>
                  </Grid>
                  
                  <Grid item xs={12}>
                    <Button
                      type="submit"
                      variant="contained"
                      startIcon={saving ? <CircularProgress size={20} /> : <Save />}
                      disabled={saving}
                    >
                      Save Notification Settings
                    </Button>
                  </Grid>
                </Grid>
              </form>
            </TabPanel>
          </Paper>
        </Box>
      </MainLayout>
    </>
  );
}