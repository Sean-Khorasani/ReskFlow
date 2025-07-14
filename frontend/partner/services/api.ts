import axios from 'axios';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api';

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor for auth
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('partner_token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Response interceptor for error handling
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('partner_token');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

export const authApi = {
  login: (email: string, password: string) =>
    api.post('/partners/login', { email, password }),
  
  logout: () => api.post('/partners/logout'),
  
  getProfile: () => api.get('/partners/profile'),
  
  updateProfile: (data: any) => api.put('/partners/profile', data),
  
  changePassword: (oldPassword: string, newPassword: string) =>
    api.post('/partners/change-password', { oldPassword, newPassword }),
};

export const dashboardApi = {
  getStats: () => api.get('/partners/dashboard/stats'),
  
  getRecentActivity: () => api.get('/partners/dashboard/activity'),
  
  getPerformanceMetrics: (period: string) =>
    api.get(`/partners/dashboard/metrics?period=${period}`),
};

export const driverApi = {
  getDrivers: (params?: any) => api.get('/partners/drivers', { params }),
  
  getDriver: (id: string) => api.get(`/partners/drivers/${id}`),
  
  inviteDriver: (data: any) => api.post('/partners/drivers/invite', data),
  
  updateDriver: (id: string, data: any) => api.put(`/partners/drivers/${id}`, data),
  
  suspendDriver: (id: string, reason: string) =>
    api.post(`/partners/drivers/${id}/suspend`, { reason }),
  
  activateDriver: (id: string) => api.post(`/partners/drivers/${id}/activate`),
  
  getDriverPerformance: (id: string, period: string) =>
    api.get(`/partners/drivers/${id}/performance?period=${period}`),
  
  getDriverEarnings: (id: string, period: string) =>
    api.get(`/partners/drivers/${id}/earnings?period=${period}`),
};

export const vehicleApi = {
  getVehicles: (params?: any) => api.get('/partners/vehicles', { params }),
  
  getVehicle: (id: string) => api.get(`/partners/vehicles/${id}`),
  
  addVehicle: (data: any) => api.post('/partners/vehicles', data),
  
  updateVehicle: (id: string, data: any) => api.put(`/partners/vehicles/${id}`, data),
  
  deleteVehicle: (id: string) => api.delete(`/partners/vehicles/${id}`),
  
  assignVehicle: (vehicleId: string, driverId: string) =>
    api.post(`/partners/vehicles/${vehicleId}/assign`, { driverId }),
  
  unassignVehicle: (vehicleId: string) =>
    api.post(`/partners/vehicles/${vehicleId}/unassign`),
  
  getVehicleMaintenance: (id: string) =>
    api.get(`/partners/vehicles/${id}/maintenance`),
  
  addMaintenanceRecord: (vehicleId: string, data: any) =>
    api.post(`/partners/vehicles/${vehicleId}/maintenance`, data),
};

export const reskflowApi = {
  getDeliveries: (params?: any) => api.get('/partners/deliveries', { params }),
  
  getDelivery: (id: string) => api.get(`/partners/deliveries/${id}`),
  
  getDeliveryTracking: (id: string) => api.get(`/partners/deliveries/${id}/tracking`),
  
  assignDelivery: (reskflowId: string, driverId: string) =>
    api.post(`/partners/deliveries/${reskflowId}/assign`, { driverId }),
  
  reassignDelivery: (reskflowId: string, driverId: string) =>
    api.post(`/partners/deliveries/${reskflowId}/reassign`, { driverId }),
};

export const earningsApi = {
  getEarnings: (period: string) => api.get(`/partners/earnings?period=${period}`),
  
  getPayouts: (params?: any) => api.get('/partners/payouts', { params }),
  
  requestPayout: (amount: number, method: string) =>
    api.post('/partners/payouts/request', { amount, method }),
  
  getInvoices: (params?: any) => api.get('/partners/invoices', { params }),
  
  downloadInvoice: (id: string) => api.get(`/partners/invoices/${id}/download`),
};

export const analyticsApi = {
  getOverview: (period: string) => api.get(`/partners/analytics/overview?period=${period}`),
  
  getDriverAnalytics: (params?: any) => api.get('/partners/analytics/drivers', { params }),
  
  getDeliveryAnalytics: (params?: any) => api.get('/partners/analytics/deliveries', { params }),
  
  getRevenueAnalytics: (params?: any) => api.get('/partners/analytics/revenue', { params }),
  
  getZoneAnalytics: () => api.get('/partners/analytics/zones'),
  
  exportReport: (type: string, params?: any) =>
    api.post('/partners/analytics/export', { type, ...params }),
};

export const notificationApi = {
  getNotifications: (params?: any) => api.get('/partners/notifications', { params }),
  
  markAsRead: (id: string) => api.put(`/partners/notifications/${id}/read`),
  
  markAllAsRead: () => api.put('/partners/notifications/read-all'),
  
  updatePreferences: (preferences: any) =>
    api.put('/partners/notifications/preferences', preferences),
};

export const supportApi = {
  getTickets: (params?: any) => api.get('/partners/support/tickets', { params }),
  
  getTicket: (id: string) => api.get(`/partners/support/tickets/${id}`),
  
  createTicket: (data: any) => api.post('/partners/support/tickets', data),
  
  replyToTicket: (id: string, message: string) =>
    api.post(`/partners/support/tickets/${id}/reply`, { message }),
  
  closeTicket: (id: string) => api.put(`/partners/support/tickets/${id}/close`),
};

export default api;