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
  const token = localStorage.getItem('merchantToken');
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
      localStorage.removeItem('merchantToken');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

// Auth APIs
export const authApi = {
  login: (email: string, password: string) =>
    api.post('/auth/merchant/login', { email, password }),
  
  register: (data: any) =>
    api.post('/auth/merchant/register', data),
  
  getProfile: () =>
    api.get('/auth/merchant/profile'),
  
  updateProfile: (data: any) =>
    api.put('/auth/merchant/profile', data),
};

// Product APIs
export const productApi = {
  getProducts: () =>
    api.get('/merchant/products'),
  
  getProduct: (id: string) =>
    api.get(`/merchant/products/${id}`),
  
  createProduct: (data: FormData) =>
    api.post('/merchant/products', data, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }),
  
  updateProduct: (id: string, data: FormData) =>
    api.put(`/merchant/products/${id}`, data, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }),
  
  deleteProduct: (id: string) =>
    api.delete(`/merchant/products/${id}`),
  
  toggleAvailability: (id: string, available: boolean) =>
    api.patch(`/merchant/products/${id}/availability`, { available }),
  
  updateStock: (id: string, stock: number) =>
    api.patch(`/merchant/products/${id}/stock`, { stock }),
};

// Category APIs
export const categoryApi = {
  getCategories: () =>
    api.get('/merchant/categories'),
  
  createCategory: (data: { name: string; description?: string }) =>
    api.post('/merchant/categories', data),
  
  updateCategory: (id: string, data: { name: string; description?: string }) =>
    api.put(`/merchant/categories/${id}`, data),
  
  deleteCategory: (id: string) =>
    api.delete(`/merchant/categories/${id}`),
};

// Order APIs
export const orderApi = {
  getOrders: (params?: { status?: string; date?: string }) =>
    api.get('/merchant/orders', { params }),
  
  getOrder: (id: string) =>
    api.get(`/merchant/orders/${id}`),
  
  updateOrderStatus: (id: string, status: string) =>
    api.patch(`/merchant/orders/${id}/status`, { status }),
  
  acceptOrder: (id: string) =>
    api.post(`/merchant/orders/${id}/accept`),
  
  rejectOrder: (id: string, reason: string) =>
    api.post(`/merchant/orders/${id}/reject`, { reason }),
  
  markAsReady: (id: string) =>
    api.post(`/merchant/orders/${id}/ready`),
};

// Analytics APIs
export const analyticsApi = {
  getDashboardStats: () =>
    api.get('/merchant/analytics/dashboard'),
  
  getSalesAnalytics: (params: { startDate: string; endDate: string }) =>
    api.get('/merchant/analytics/sales', { params }),
  
  getProductAnalytics: (params: { startDate: string; endDate: string }) =>
    api.get('/merchant/analytics/products', { params }),
  
  getCustomerAnalytics: (params: { startDate: string; endDate: string }) =>
    api.get('/merchant/analytics/customers', { params }),
};

// Settings APIs
export const settingsApi = {
  getSettings: () =>
    api.get('/merchant/settings'),
  
  updateSettings: (data: any) =>
    api.put('/merchant/settings', data),
  
  updateBusinessHours: (hours: any) =>
    api.put('/merchant/settings/hours', hours),
  
  updateDeliverySettings: (settings: any) =>
    api.put('/merchant/settings/reskflow', settings),
};

export default api;