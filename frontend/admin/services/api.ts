import axios from 'axios';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Add auth token to requests
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('adminToken');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Handle auth errors
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('adminToken');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

// Auth APIs
export const authApi = {
  login: (email: string, password: string) =>
    api.post('/auth/admin/login', { email, password }),
  
  getProfile: () =>
    api.get('/auth/admin/profile'),
  
  logout: () =>
    api.post('/auth/admin/logout'),
};

// Dashboard APIs
export const dashboardApi = {
  getStats: () =>
    api.get('/admin/dashboard/stats'),
  
  getRealtimeMetrics: () =>
    api.get('/admin/dashboard/realtime'),
  
  getChartData: (params: { period: string }) =>
    api.get('/admin/dashboard/charts', { params }),
};

// User Management APIs
export const userApi = {
  getUsers: (params?: { role?: string; search?: string; page?: number; limit?: number }) =>
    api.get('/admin/users', { params }),
  
  getUser: (id: string) =>
    api.get(`/admin/users/${id}`),
  
  updateUser: (id: string, data: any) =>
    api.put(`/admin/users/${id}`, data),
  
  suspendUser: (id: string, reason: string) =>
    api.post(`/admin/users/${id}/suspend`, { reason }),
  
  activateUser: (id: string) =>
    api.post(`/admin/users/${id}/activate`),
  
  deleteUser: (id: string) =>
    api.delete(`/admin/users/${id}`),
};

// Merchant Management APIs
export const merchantApi = {
  getMerchants: (params?: { status?: string; search?: string; page?: number; limit?: number }) =>
    api.get('/admin/merchants', { params }),
  
  getMerchant: (id: string) =>
    api.get(`/admin/merchants/${id}`),
  
  approveMerchant: (id: string) =>
    api.post(`/admin/merchants/${id}/approve`),
  
  rejectMerchant: (id: string, reason: string) =>
    api.post(`/admin/merchants/${id}/reject`, { reason }),
  
  suspendMerchant: (id: string, reason: string) =>
    api.post(`/admin/merchants/${id}/suspend`, { reason }),
  
  updateMerchantCommission: (id: string, commission: number) =>
    api.patch(`/admin/merchants/${id}/commission`, { commission }),
};

// Order Management APIs
export const orderApi = {
  getOrders: (params?: { status?: string; search?: string; page?: number; limit?: number }) =>
    api.get('/admin/orders', { params }),
  
  getOrder: (id: string) =>
    api.get(`/admin/orders/${id}`),
  
  resolveDispute: (orderId: string, resolution: string) =>
    api.post(`/admin/orders/${orderId}/resolve-dispute`, { resolution }),
  
  refundOrder: (orderId: string, amount: number, reason: string) =>
    api.post(`/admin/orders/${orderId}/refund`, { amount, reason }),
};

// Driver Management APIs
export const driverApi = {
  getDrivers: (params?: { status?: string; search?: string; page?: number; limit?: number }) =>
    api.get('/admin/drivers', { params }),
  
  getDriver: (id: string) =>
    api.get(`/admin/drivers/${id}`),
  
  approveDriver: (id: string) =>
    api.post(`/admin/drivers/${id}/approve`),
  
  rejectDriver: (id: string, reason: string) =>
    api.post(`/admin/drivers/${id}/reject`, { reason }),
  
  updateDriverCommission: (id: string, commission: number) =>
    api.patch(`/admin/drivers/${id}/commission`, { commission }),
};

// Analytics APIs
export const analyticsApi = {
  getRevenue: (params: { startDate: string; endDate: string; groupBy: string }) =>
    api.get('/admin/analytics/revenue', { params }),
  
  getUserGrowth: (params: { startDate: string; endDate: string }) =>
    api.get('/admin/analytics/user-growth', { params }),
  
  getOrderAnalytics: (params: { startDate: string; endDate: string }) =>
    api.get('/admin/analytics/orders', { params }),
  
  getGeographicData: () =>
    api.get('/admin/analytics/geographic'),
  
  exportReport: (type: string, params: any) =>
    api.post('/admin/analytics/export', { type, params }, { responseType: 'blob' }),
};

// System Settings APIs
export const settingsApi = {
  getSettings: () =>
    api.get('/admin/settings'),
  
  updateSettings: (data: any) =>
    api.put('/admin/settings', data),
  
  getCommissionSettings: () =>
    api.get('/admin/settings/commission'),
  
  updateCommissionSettings: (data: any) =>
    api.put('/admin/settings/commission', data),
  
  getNotificationTemplates: () =>
    api.get('/admin/settings/notifications'),
  
  updateNotificationTemplate: (id: string, data: any) =>
    api.put(`/admin/settings/notifications/${id}`, data),
};

// Blockchain APIs
export const blockchainApi = {
  getTransactions: (params?: { page?: number; limit?: number }) =>
    api.get('/admin/blockchain/transactions', { params }),
  
  getWalletBalance: () =>
    api.get('/admin/blockchain/wallet'),
  
  getSmartContractStatus: () =>
    api.get('/admin/blockchain/contracts'),
};

export default api;