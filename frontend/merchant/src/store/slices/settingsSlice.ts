import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import { settingsApi } from '../../services/api';

interface BusinessHours {
  monday: { open: string; close: string; closed: boolean };
  tuesday: { open: string; close: string; closed: boolean };
  wednesday: { open: string; close: string; closed: boolean };
  thursday: { open: string; close: string; closed: boolean };
  friday: { open: string; close: string; closed: boolean };
  saturday: { open: string; close: string; closed: boolean };
  sunday: { open: string; close: string; closed: boolean };
}

interface DeliverySettings {
  reskflowRadius: number;
  minimumOrderAmount: number;
  reskflowFee: number;
  freeDeliveryThreshold: number;
  estimatedDeliveryTime: number;
  acceptsPickup: boolean;
  pickupDiscount: number;
}

interface NotificationSettings {
  emailNotifications: boolean;
  smsNotifications: boolean;
  pushNotifications: boolean;
  orderAlerts: boolean;
  lowStockAlerts: boolean;
  marketingEmails: boolean;
}

interface Settings {
  businessHours: BusinessHours;
  reskflowSettings: DeliverySettings;
  notificationSettings: NotificationSettings;
  taxRate: number;
  currency: string;
  timezone: string;
  autoAcceptOrders: boolean;
  preparationTimeBuffer: number;
}

interface SettingsState {
  settings: Settings | null;
  loading: boolean;
  error: string | null;
  saving: boolean;
}

const initialState: SettingsState = {
  settings: null,
  loading: false,
  error: null,
  saving: false,
};

export const fetchSettings = createAsyncThunk(
  'settings/fetchSettings',
  async () => {
    const response = await settingsApi.getSettings();
    return response.data;
  }
);

export const updateSettings = createAsyncThunk(
  'settings/updateSettings',
  async (data: Partial<Settings>) => {
    const response = await settingsApi.updateSettings(data);
    return response.data;
  }
);

export const updateBusinessHours = createAsyncThunk(
  'settings/updateBusinessHours',
  async (hours: BusinessHours) => {
    const response = await settingsApi.updateBusinessHours(hours);
    return response.data;
  }
);

export const updateDeliverySettings = createAsyncThunk(
  'settings/updateDeliverySettings',
  async (settings: DeliverySettings) => {
    const response = await settingsApi.updateDeliverySettings(settings);
    return response.data;
  }
);

const settingsSlice = createSlice({
  name: 'settings',
  initialState,
  reducers: {
    clearError: (state) => {
      state.error = null;
    },
  },
  extraReducers: (builder) => {
    // Fetch Settings
    builder
      .addCase(fetchSettings.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchSettings.fulfilled, (state, action) => {
        state.loading = false;
        state.settings = action.payload;
      })
      .addCase(fetchSettings.rejected, (state, action) => {
        state.loading = false;
        state.error = action.error.message || 'Failed to fetch settings';
      });
    
    // Update Settings
    builder
      .addCase(updateSettings.pending, (state) => {
        state.saving = true;
        state.error = null;
      })
      .addCase(updateSettings.fulfilled, (state, action) => {
        state.saving = false;
        state.settings = action.payload;
      })
      .addCase(updateSettings.rejected, (state, action) => {
        state.saving = false;
        state.error = action.error.message || 'Failed to update settings';
      });
    
    // Update Business Hours
    builder
      .addCase(updateBusinessHours.pending, (state) => {
        state.saving = true;
        state.error = null;
      })
      .addCase(updateBusinessHours.fulfilled, (state, action) => {
        state.saving = false;
        if (state.settings) {
          state.settings.businessHours = action.payload.businessHours;
        }
      })
      .addCase(updateBusinessHours.rejected, (state, action) => {
        state.saving = false;
        state.error = action.error.message || 'Failed to update business hours';
      });
    
    // Update Delivery Settings
    builder
      .addCase(updateDeliverySettings.pending, (state) => {
        state.saving = true;
        state.error = null;
      })
      .addCase(updateDeliverySettings.fulfilled, (state, action) => {
        state.saving = false;
        if (state.settings) {
          state.settings.reskflowSettings = action.payload.reskflowSettings;
        }
      })
      .addCase(updateDeliverySettings.rejected, (state, action) => {
        state.saving = false;
        state.error = action.error.message || 'Failed to update reskflow settings';
      });
  },
});

export const { clearError } = settingsSlice.actions;
export default settingsSlice.reducer;