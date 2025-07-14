// Enums
export enum DeliveryStatus {
  PENDING = 'PENDING',
  ASSIGNED = 'ASSIGNED',
  PICKED_UP = 'PICKED_UP',
  IN_TRANSIT = 'IN_TRANSIT',
  DELIVERED = 'DELIVERED',
  CANCELLED = 'CANCELLED',
  FAILED = 'FAILED',
}

export enum DeliveryPriority {
  LOW = 'LOW',
  NORMAL = 'NORMAL',
  HIGH = 'HIGH',
  URGENT = 'URGENT',
}

export enum VehicleType {
  CAR = 'CAR',
  MOTORCYCLE = 'MOTORCYCLE',
  BICYCLE = 'BICYCLE',
  TRUCK = 'TRUCK',
}

export enum DriverStatus {
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
  SUSPENDED = 'SUSPENDED',
}

export enum TrackingEventType {
  DELIVERY_CREATED = 'DELIVERY_CREATED',
  DRIVER_ASSIGNED = 'DRIVER_ASSIGNED',
  PICKUP_STARTED = 'PICKUP_STARTED',
  PICKUP_COMPLETED = 'PICKUP_COMPLETED',
  DELIVERY_STARTED = 'DELIVERY_STARTED',
  DELIVERY_COMPLETED = 'DELIVERY_COMPLETED',
  DELIVERY_CANCELLED = 'DELIVERY_CANCELLED',
  DELIVERY_FAILED = 'DELIVERY_FAILED',
  LOCATION_UPDATE = 'LOCATION_UPDATE',
  STATUS_UPDATE = 'STATUS_UPDATE',
}

// Base interfaces
export interface Coordinates {
  lat: number;
  lng: number;
}

export interface Address {
  street: string;
  city: string;
  state?: string;
  zipCode?: string;
  country: string;
  coordinates?: Coordinates;
  formattedAddress?: string;
}

export interface ContactInfo {
  name: string;
  phone: string;
  email?: string;
}

export interface EmergencyContact {
  name: string;
  phone: string;
  relationship: string;
}

// Delivery interfaces
export interface Delivery {
  id: string;
  reskflowNumber: string;
  orderId: string;
  customerId: string;
  merchantId: string;
  driverId?: string;
  
  // Addresses
  pickupAddress: Address;
  reskflowAddress: Address;
  
  // Contact information
  customerPhone: string;
  customerName?: string;
  merchantPhone?: string;
  merchantName?: string;
  
  // Delivery details
  status: DeliveryStatus;
  priority: DeliveryPriority;
  specialInstructions?: string;
  reskflowFee: number;
  
  // Timing
  estimatedPickupTime: Date;
  estimatedDeliveryTime: Date;
  actualPickupTime?: Date;
  actualDeliveryTime?: Date;
  
  // Completion details
  reskflowProof?: string;
  customerSignature?: string;
  reskflowRating?: number;
  reskflowNotes?: string;
  
  // System fields
  createdAt: Date;
  updatedAt: Date;
  cancelledAt?: Date;
  cancelReason?: string;
  failureReason?: string;
}

export interface CreateDeliveryInput {
  orderId: string;
  customerId: string;
  merchantId: string;
  pickupAddress: Address;
  reskflowAddress: Address;
  customerPhone: string;
  customerName?: string;
  merchantPhone?: string;
  merchantName?: string;
  specialInstructions?: string;
  reskflowFee: number;
  estimatedPickupTime: Date;
  estimatedDeliveryTime: Date;
  priority?: DeliveryPriority;
}

export interface UpdateDeliveryInput {
  status?: DeliveryStatus;
  actualPickupTime?: Date;
  actualDeliveryTime?: Date;
  reskflowProof?: string;
  customerSignature?: string;
  reskflowRating?: number;
  reskflowNotes?: string;
  cancelReason?: string;
  failureReason?: string;
}

export interface DeliveryFilters {
  status?: DeliveryStatus;
  customerId?: string;
  driverId?: string;
  merchantId?: string;
  startDate?: Date;
  endDate?: Date;
  priority?: DeliveryPriority;
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

// Driver interfaces
export interface Driver {
  id: string;
  userId: string;
  driverCode: string;
  
  // Personal information
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  dateOfBirth: Date;
  
  // License and vehicle
  licenseNumber: string;
  licenseExpiry: Date;
  vehicleType: VehicleType;
  vehicleModel: string;
  vehiclePlate: string;
  vehicleColor?: string;
  
  // Status and availability
  status: DriverStatus;
  isAvailable: boolean;
  currentLocation?: Coordinates;
  lastLocationUpdate?: Date;
  
  // Emergency contact
  emergencyContact: EmergencyContact;
  
  // Performance metrics
  totalDeliveries: number;
  completedDeliveries: number;
  cancelledDeliveries: number;
  averageRating: number;
  totalRatings: number;
  
  // System fields
  createdAt: Date;
  updatedAt: Date;
  lastActiveAt?: Date;
  suspendedAt?: Date;
  suspensionReason?: string;
}

export interface CreateDriverInput {
  userId: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  dateOfBirth: Date;
  licenseNumber: string;
  licenseExpiry: Date;
  vehicleType: VehicleType;
  vehicleModel: string;
  vehiclePlate: string;
  vehicleColor?: string;
  emergencyContact: EmergencyContact;
}

export interface UpdateDriverInput {
  status?: DriverStatus;
  vehicleType?: VehicleType;
  vehicleModel?: string;
  vehiclePlate?: string;
  vehicleColor?: string;
  phone?: string;
  emergencyContact?: EmergencyContact;
  suspensionReason?: string;
}

export interface DriverLocation {
  driverId: string;
  location: Coordinates;
  heading?: number;
  speed?: number;
  accuracy?: number;
  timestamp: Date;
}

export interface DriverAvailability {
  driverId: string;
  available: boolean;
  location?: Coordinates;
  timestamp: Date;
}

export interface NearbyDriver {
  id: string;
  driverId: string;
  location: Coordinates;
  distance: number;
  vehicleType: VehicleType;
  rating: number;
  isAvailable: boolean;
}

// Tracking interfaces
export interface TrackingEvent {
  id: string;
  reskflowId: string;
  eventType: TrackingEventType;
  status?: DeliveryStatus;
  location?: Coordinates;
  timestamp: Date;
  notes?: string;
  metadata?: Record<string, any>;
  createdBy?: string;
}

export interface TrackingInfo {
  reskflowId: string;
  currentStatus: DeliveryStatus;
  currentLocation?: Coordinates;
  estimatedArrival?: Date;
  lastUpdate: Date;
  events: TrackingEvent[];
}

export interface LocationUpdate {
  reskflowId: string;
  driverId: string;
  location: Coordinates;
  heading?: number;
  speed?: number;
  accuracy?: number;
  timestamp: Date;
  status?: DeliveryStatus;
  notes?: string;
}

// Route interfaces
export interface RouteStep {
  instruction: string;
  distance: {
    text: string;
    value: number; // meters
  };
  duration: {
    text: string;
    value: number; // seconds
  };
  startLocation: Coordinates;
  endLocation: Coordinates;
}

export interface RouteInfo {
  distance: {
    text: string;
    value: number; // meters
  };
  duration: {
    text: string;
    value: number; // seconds
  };
  steps: RouteStep[];
  overview_polyline: string;
  bounds: {
    northeast: Coordinates;
    southwest: Coordinates;
  };
}

export interface OptimizedRoute {
  orderedWaypoints: number[];
  routes: RouteInfo[];
  totalDistance: number; // meters
  totalDuration: number; // seconds
}

export interface RouteCalculationRequest {
  origin: Coordinates;
  destination: Coordinates;
  waypoints?: Coordinates[];
  optimizeWaypoints?: boolean;
  vehicleType?: VehicleType;
}

export interface RouteOptimizationRequest {
  depot: Coordinates;
  reskflowPoints: Coordinates[];
  vehicleType?: VehicleType;
  maxDuration?: number; // seconds
  maxDistance?: number; // meters
}

// Analytics interfaces
export interface DeliveryAnalytics {
  totalDeliveries: number;
  completedDeliveries: number;
  cancelledDeliveries: number;
  failedDeliveries: number;
  averageDeliveryTime: number; // minutes
  averageDistance: number; // kilometers
  totalRevenue: number;
  averageRating: number;
  
  // Time-based metrics
  dailyMetrics?: DailyMetrics[];
  weeklyMetrics?: WeeklyMetrics[];
  monthlyMetrics?: MonthlyMetrics[];
}

export interface DailyMetrics {
  date: string;
  totalDeliveries: number;
  completedDeliveries: number;
  revenue: number;
  averageDeliveryTime: number;
}

export interface WeeklyMetrics {
  week: string;
  totalDeliveries: number;
  completedDeliveries: number;
  revenue: number;
  averageDeliveryTime: number;
}

export interface MonthlyMetrics {
  month: string;
  totalDeliveries: number;
  completedDeliveries: number;
  revenue: number;
  averageDeliveryTime: number;
}

export interface DriverPerformance {
  driverId: string;
  totalDeliveries: number;
  completedDeliveries: number;
  completionRate: number;
  averageDeliveryTime: number;
  averageRating: number;
  totalDistance: number;
  totalEarnings: number;
  
  // Time-based performance
  dailyPerformance?: DailyPerformance[];
  weeklyPerformance?: WeeklyPerformance[];
  monthlyPerformance?: MonthlyPerformance[];
}

export interface DailyPerformance {
  date: string;
  deliveries: number;
  completionRate: number;
  averageRating: number;
  earnings: number;
}

export interface WeeklyPerformance {
  week: string;
  deliveries: number;
  completionRate: number;
  averageRating: number;
  earnings: number;
}

export interface MonthlyPerformance {
  month: string;
  deliveries: number;
  completionRate: number;
  averageRating: number;
  earnings: number;
}

// WebSocket interfaces
export interface WebSocketMessage {
  type: string;
  data: any;
  timestamp: Date;
  userId?: string;
  reskflowId?: string;
}

export interface LocationUpdateMessage extends WebSocketMessage {
  type: 'LOCATION_UPDATE';
  data: {
    reskflowId: string;
    location: Coordinates;
    heading?: number;
    speed?: number;
    timestamp: Date;
  };
}

export interface StatusUpdateMessage extends WebSocketMessage {
  type: 'STATUS_UPDATE';
  data: {
    reskflowId: string;
    status: DeliveryStatus;
    timestamp: Date;
    notes?: string;
  };
}

export interface DeliveryAssignedMessage extends WebSocketMessage {
  type: 'DELIVERY_ASSIGNED';
  data: {
    reskflowId: string;
    driverId: string;
    timestamp: Date;
  };
}

export interface NotificationMessage extends WebSocketMessage {
  type: 'NOTIFICATION';
  data: {
    title: string;
    message: string;
    priority: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
    timestamp: Date;
  };
}

// Pagination interfaces
export interface PaginationOptions {
  page: number;
  limit: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

export interface PaginatedResult<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasNext: boolean;
    hasPrev: boolean;
  };
}

// API Response interfaces
export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: {
    message: string;
    code?: string;
    details?: any;
  };
  timestamp: string;
  requestId?: string;
}

export interface HealthCheckResponse {
  status: 'healthy' | 'unhealthy';
  service: string;
  timestamp: string;
  checks: {
    database: 'healthy' | 'unhealthy';
    redis: 'healthy' | 'unhealthy';
    rabbitmq: 'healthy' | 'unhealthy';
    googleMaps: 'healthy' | 'unhealthy';
  };
}

// Service interfaces
export interface ExternalServiceConfig {
  baseUrl: string;
  timeout: number;
  retries: number;
  apiKey?: string;
}

export interface NotificationRequest {
  userId: string;
  type: 'SMS' | 'EMAIL' | 'PUSH';
  template: string;
  data: Record<string, any>;
  priority?: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
}

export interface OrderInfo {
  id: string;
  customerId: string;
  merchantId: string;
  items: OrderItem[];
  totalAmount: number;
  status: string;
  createdAt: Date;
}

export interface OrderItem {
  id: string;
  name: string;
  quantity: number;
  price: number;
  specialInstructions?: string;
}

// Configuration interfaces
export interface DeliveryConfig {
  defaultRadius: number; // km
  maxDeliveryTime: number; // minutes
  assignmentTimeout: number; // minutes
  trackingInterval: number; // seconds
  maxRetries: number;
  
  // Pricing
  baseFee: number;
  perKmRate: number;
  priorityMultiplier: {
    LOW: number;
    NORMAL: number;
    HIGH: number;
    URGENT: number;
  };
  
  // Business hours
  businessHours: {
    start: string; // HH:mm
    end: string; // HH:mm
  };
  
  // Service areas
  serviceAreas: ServiceArea[];
}

export interface ServiceArea {
  id: string;
  name: string;
  center: Coordinates;
  radius: number; // km
  isActive: boolean;
}

// Queue message interfaces
export interface QueueMessage {
  id: string;
  type: string;
  data: any;
  timestamp: Date;
  retryCount: number;
  maxRetries: number;
}

export interface DeliveryQueueMessage extends QueueMessage {
  type: 'DELIVERY_CREATED' | 'DELIVERY_ASSIGNED' | 'DELIVERY_UPDATED';
  data: {
    reskflowId: string;
    orderId: string;
    customerId: string;
    merchantId: string;
    driverId?: string;
    status?: DeliveryStatus;
    [key: string]: any;
  };
}

export interface DriverQueueMessage extends QueueMessage {
  type: 'DRIVER_AVAILABLE' | 'DRIVER_UNAVAILABLE' | 'DRIVER_LOCATION_UPDATE';
  data: {
    driverId: string;
    userId: string;
    location?: Coordinates;
    available?: boolean;
    [key: string]: any;
  };
}

// Error interfaces
export interface ServiceError {
  code: string;
  message: string;
  statusCode: number;
  details?: any;
  stack?: string;
}

export interface ValidationErrorDetail {
  field: string;
  message: string;
  value: any;
}

// Rate limiting interfaces
export interface RateLimitInfo {
  limit: number;
  remaining: number;
  reset: Date;
  windowMs: number;
}

// File upload interfaces
export interface UploadedFile {
  fieldname: string;
  originalname: string;
  encoding: string;
  mimetype: string;
  destination: string;
  filename: string;
  path: string;
  size: number;
}

export interface DeliveryProof {
  reskflowId: string;
  type: 'PHOTO' | 'SIGNATURE' | 'VIDEO';
  url: string;
  uploadedBy: string;
  uploadedAt: Date;
  metadata?: Record<string, any>;
}