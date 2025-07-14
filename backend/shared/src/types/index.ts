export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: any;
  };
  pagination?: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface PaginationParams {
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

export interface LocationData {
  latitude: number;
  longitude: number;
  address?: string;
  timestamp?: Date;
}

export interface PackageDetails {
  description: string;
  weight: number;
  dimensions: {
    length: number;
    width: number;
    height: number;
  };
  value: number;
  fragile?: boolean;
  category?: string;
  contents?: string[];
}

export interface DeliveryCreateDto {
  recipientEmail?: string;
  recipientPhone?: string;
  pickupAddressId: string;
  reskflowAddressId: string;
  packageDetails: PackageDetails;
  scheduledPickup?: Date;
  scheduledDelivery?: Date;
  priority?: number;
  insuranceAmount?: number;
}

export interface DeliveryUpdateDto {
  status?: string;
  driverId?: string;
  actualPickup?: Date;
  actualDelivery?: Date;
  signature?: string;
  photos?: string[];
}

export interface TrackingEventDto {
  reskflowId: string;
  status: string;
  location: LocationData;
  description?: string;
  proof?: string;
}

export interface UserCreateDto {
  email: string;
  phone?: string;
  password: string;
  firstName: string;
  lastName: string;
  role: 'CUSTOMER' | 'DRIVER' | 'ADMIN' | 'PARTNER';
  walletAddress?: string;
}

export interface UserUpdateDto {
  firstName?: string;
  lastName?: string;
  phone?: string;
  walletAddress?: string;
}

export interface AddressDto {
  label: string;
  street: string;
  city: string;
  state: string;
  country: string;
  postalCode: string;
  latitude: number;
  longitude: number;
  isDefault?: boolean;
}

export interface NotificationDto {
  userId: string;
  title: string;
  body: string;
  type: 'DELIVERY_CREATED' | 'DELIVERY_ASSIGNED' | 'DELIVERY_PICKED_UP' | 
        'DELIVERY_IN_TRANSIT' | 'DELIVERY_DELIVERED' | 'PAYMENT_RECEIVED' | 
        'PAYMENT_RELEASED' | 'GENERAL';
  data?: any;
}

export interface PaymentDto {
  reskflowId: string;
  amount: number;
  currency?: string;
  method: 'CRYPTO' | 'CARD' | 'BANK_TRANSFER';
  metadata?: any;
}

export interface RatingDto {
  reskflowId: string;
  rating: number;
  comment?: string;
}

export interface BlockchainEvent {
  event: string;
  contract: string;
  transactionHash: string;
  blockNumber: number;
  args: any;
}

export interface WebSocketMessage {
  type: 'LOCATION_UPDATE' | 'STATUS_UPDATE' | 'MESSAGE' | 'NOTIFICATION';
  data: any;
  timestamp: Date;
}

export interface RouteOptimizationRequest {
  driverId: string;
  deliveries: string[];
  startLocation: LocationData;
  endLocation?: LocationData;
  constraints?: {
    maxDistance?: number;
    maxDuration?: number;
    maxDeliveries?: number;
  };
}

export interface RouteOptimizationResponse {
  optimizedRoute: {
    reskflowId: string;
    sequence: number;
    estimatedArrival: Date;
    distance: number;
    duration: number;
  }[];
  totalDistance: number;
  totalDuration: number;
  estimatedCost: number;
}