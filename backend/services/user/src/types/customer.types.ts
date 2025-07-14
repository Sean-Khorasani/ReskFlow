// Customer Core Types
export interface Customer {
  id: string;
  email: string;
  phone: string;
  firstName: string;
  lastName: string;
  dateOfBirth?: Date;
  avatar?: string;
  status: CustomerStatus;
  role: 'CUSTOMER';
  emailVerified: boolean;
  phoneVerified: boolean;
  marketingOptIn: boolean;
  referralCode: string;
  createdAt: Date;
  updatedAt: Date;
}

export enum CustomerStatus {
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
  SUSPENDED = 'SUSPENDED',
  PENDING_VERIFICATION = 'PENDING_VERIFICATION',
  DELETED = 'DELETED'
}

// Customer Profile and Analytics
export interface CustomerProfile {
  userId: string;
  totalOrders: number;
  totalSpent: number;
  avgOrderValue: number;
  loyaltyPoints: number;
  lifetimeValue: number;
  riskScore: number;
  satisfactionScore: number;
  preferredCommunication: CommunicationChannel;
  accountStatus: AccountStatus;
  dietaryRestrictions?: string[];
  allergens?: string[];
  favoriteCategories?: string[];
  favoriteMerchants?: string[];
  joinedAt: Date;
  lastOrderAt?: Date;
  lastActiveAt?: Date;
}

export enum CommunicationChannel {
  EMAIL = 'EMAIL',
  SMS = 'SMS',
  PUSH = 'PUSH',
  IN_APP = 'IN_APP'
}

export enum AccountStatus {
  ACTIVE = 'ACTIVE',
  SUSPENDED = 'SUSPENDED',
  UNDER_REVIEW = 'UNDER_REVIEW',
  RESTRICTED = 'RESTRICTED'
}

// Customer Preferences
export interface CustomerPreferences {
  customerId: string;
  notifications: NotificationPreferences;
  delivery: DeliveryPreferences;
  dietary: DietaryPreferences;
  communication: CommunicationPreferences;
  privacy: PrivacyPreferences;
  accessibility: AccessibilityPreferences;
  payment: PaymentPreferences;
  ordering: OrderingPreferences;
}

export interface NotificationPreferences {
  orderUpdates: boolean;
  promotions: boolean;
  loyaltyUpdates: boolean;
  newsletter: boolean;
  driverUpdates: boolean;
  merchantUpdates: boolean;
  securityAlerts: boolean;
  marketingEmails: boolean;
  smsNotifications: boolean;
  pushNotifications: boolean;
  emailFrequency: 'REAL_TIME' | 'DAILY' | 'WEEKLY' | 'MONTHLY';
  quietHours: {
    enabled: boolean;
    start: string; // HH:mm format
    end: string;   // HH:mm format
  };
}

export interface DeliveryPreferences {
  defaultTip: number;
  contactlessPreferred: boolean;
  leaveAtDoor: boolean;
  ringDoorbell: boolean;
  callOnArrival: boolean;
  preferredDeliveryTime: string;
  deliveryInstructions: string;
  photoConfirmation: boolean;
  signatureRequired: boolean;
}

export interface DietaryPreferences {
  restrictions: string[];
  allergens: string[];
  preferences: string[];
  healthGoals: string[];
  caloricLimit?: number;
  excludeIngredients: string[];
  preferredCuisines: string[];
  spiceLevel: 'MILD' | 'MEDIUM' | 'HOT' | 'EXTRA_HOT';
}

export interface CommunicationPreferences {
  preferredChannel: CommunicationChannel;
  language: string;
  timezone: string;
  marketingOptIn: boolean;
  surveyParticipation: boolean;
  feedbackRequests: boolean;
}

export interface PrivacyPreferences {
  profileVisibility: 'PUBLIC' | 'FRIENDS' | 'PRIVATE';
  locationSharing: boolean;
  dataUsageConsent: boolean;
  analyticsOptOut: boolean;
  thirdPartySharing: boolean;
  advertisingPersonalization: boolean;
}

export interface AccessibilityPreferences {
  fontSize: 'SMALL' | 'MEDIUM' | 'LARGE' | 'EXTRA_LARGE';
  highContrast: boolean;
  screenReader: boolean;
  voiceEnabled: boolean;
  colorBlindSupport: boolean;
  rightToLeftLayout: boolean;
}

export interface PaymentPreferences {
  defaultPaymentMethod: string;
  autoReloadWallet: boolean;
  reloadAmount: number;
  reloadThreshold: number;
  preferredCurrency: string;
  splitBillDefault: boolean;
  tipCalculation: 'PERCENTAGE' | 'FIXED' | 'CUSTOM';
}

export interface OrderingPreferences {
  defaultAddress: string;
  favoriteReorder: boolean;
  groupOrderDefault: boolean;
  scheduleOrderDefault: boolean;
  customizationSave: boolean;
  repeatLastOrder: boolean;
  bulkOrderEnabled: boolean;
}

// Customer Addresses
export interface DeliveryAddress {
  id?: string;
  customerId?: string;
  type: AddressType;
  label: string;
  street: string;
  apartment?: string;
  city: string;
  state: string;
  zipCode: string;
  country: string;
  latitude: number;
  longitude: number;
  isDefault: boolean;
  isActive: boolean;
  deliveryInstructions?: string;
  businessHours?: BusinessHours;
  accessCode?: string;
  floorNumber?: string;
  buildingName?: string;
  landmarks?: string;
}

export enum AddressType {
  HOME = 'HOME',
  WORK = 'WORK',
  OTHER = 'OTHER',
  BUSINESS = 'BUSINESS',
  HOTEL = 'HOTEL',
  SCHOOL = 'SCHOOL'
}

export interface BusinessHours {
  dayOfWeek: number; // 0-6 (Sunday-Saturday)
  openTime: string;  // HH:mm
  closeTime: string; // HH:mm
  isOpen: boolean;
}

// Payment Methods
export interface PaymentMethod {
  id: string;
  customerId: string;
  type: PaymentType;
  provider: PaymentProvider;
  isDefault: boolean;
  isActive: boolean;
  lastFour?: string;
  expiryMonth?: number;
  expiryYear?: number;
  cardType?: CardType;
  billingAddress?: DeliveryAddress;
  nickName?: string;
  walletBalance?: number;
  currency?: string;
}

export enum PaymentType {
  CREDIT_CARD = 'CREDIT_CARD',
  DEBIT_CARD = 'DEBIT_CARD',
  WALLET = 'WALLET',
  CRYPTO = 'CRYPTO',
  BANK_TRANSFER = 'BANK_TRANSFER',
  CASH = 'CASH',
  GIFT_CARD = 'GIFT_CARD'
}

export enum PaymentProvider {
  STRIPE = 'STRIPE',
  PAYPAL = 'PAYPAL',
  APPLE_PAY = 'APPLE_PAY',
  GOOGLE_PAY = 'GOOGLE_PAY',
  RESKFLOW_WALLET = 'RESKFLOW_WALLET',
  BITCOIN = 'BITCOIN',
  ETHEREUM = 'ETHEREUM'
}

export enum CardType {
  VISA = 'VISA',
  MASTERCARD = 'MASTERCARD',
  AMEX = 'AMEX',
  DISCOVER = 'DISCOVER'
}

// Loyalty and Rewards
export interface LoyaltyAccount {
  customerId: string;
  points: number;
  tier: LoyaltyTier;
  totalEarned: number;
  totalRedeemed: number;
  expiringPoints: number;
  expiringDate?: Date;
  nextTierPoints: number;
  tierBenefits: string[];
  streakDays: number;
  lastEarnedAt?: Date;
  lastRedeemedAt?: Date;
}

export enum LoyaltyTier {
  BRONZE = 'BRONZE',
  SILVER = 'SILVER',
  GOLD = 'GOLD',
  PLATINUM = 'PLATINUM',
  DIAMOND = 'DIAMOND'
}

export interface LoyaltyTransaction {
  id: string;
  customerId: string;
  type: 'EARN' | 'REDEEM' | 'EXPIRE' | 'TRANSFER' | 'BONUS';
  points: number;
  orderId?: string;
  rewardId?: string;
  description: string;
  balance: number;
  createdAt: Date;
  expiresAt?: Date;
}

// Customer Support
export interface CustomerSupport {
  ticketId: string;
  customerId: string;
  type: SupportTicketType;
  priority: SupportPriority;
  status: SupportStatus;
  subject: string;
  description: string;
  category?: string;
  orderId?: string;
  assignedAgent?: string;
  resolution?: string;
  satisfactionRating?: number;
  attachments: string[];
  tags: string[];
  createdAt: Date;
  updatedAt: Date;
  resolvedAt?: Date;
  escalatedAt?: Date;
}

export enum SupportTicketType {
  ORDER_ISSUE = 'ORDER_ISSUE',
  PAYMENT_ISSUE = 'PAYMENT_ISSUE',
  DELIVERY_ISSUE = 'DELIVERY_ISSUE',
  ACCOUNT_ISSUE = 'ACCOUNT_ISSUE',
  TECHNICAL_ISSUE = 'TECHNICAL_ISSUE',
  REFUND_REQUEST = 'REFUND_REQUEST',
  COMPLAINT = 'COMPLAINT',
  SUGGESTION = 'SUGGESTION',
  GENERAL = 'GENERAL'
}

export enum SupportPriority {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
  URGENT = 'URGENT',
  CRITICAL = 'CRITICAL'
}

export enum SupportStatus {
  OPEN = 'OPEN',
  IN_PROGRESS = 'IN_PROGRESS',
  WAITING_CUSTOMER = 'WAITING_CUSTOMER',
  ESCALATED = 'ESCALATED',
  RESOLVED = 'RESOLVED',
  CLOSED = 'CLOSED',
  CANCELLED = 'CANCELLED'
}

// Customer Order History
export interface CustomerOrderHistory {
  customerId: string;
  orders: OrderSummary[];
  totalOrders: number;
  totalSpent: number;
  avgOrderValue: number;
  favoriteItems: FavoriteItem[];
  favoriteMerchants: FavoriteMerchant[];
  orderFrequency: OrderFrequency;
  seasonalPatterns: SeasonalPattern[];
}

export interface OrderSummary {
  id: string;
  merchantId: string;
  merchantName: string;
  status: OrderStatus;
  total: number;
  items: OrderItem[];
  deliveryAddress: DeliveryAddress;
  orderDate: Date;
  deliveryDate?: Date;
  rating?: number;
  feedback?: string;
  reordered: boolean;
}

export enum OrderStatus {
  PENDING = 'PENDING',
  CONFIRMED = 'CONFIRMED',
  PREPARING = 'PREPARING',
  READY_FOR_PICKUP = 'READY_FOR_PICKUP',
  OUT_FOR_DELIVERY = 'OUT_FOR_DELIVERY',
  DELIVERED = 'DELIVERED',
  CANCELLED = 'CANCELLED',
  REFUNDED = 'REFUNDED'
}

export interface OrderItem {
  itemId: string;
  name: string;
  quantity: number;
  price: number;
  customizations?: CustomizationOptions;
  specialInstructions?: string;
}

export interface CustomizationOptions {
  size?: string;
  spiceLevel?: string;
  addOns?: string[];
  removals?: string[];
  substitutions?: { [key: string]: string };
  cookingPreference?: string;
  portionSize?: string;
}

export interface FavoriteItem {
  itemId: string;
  name: string;
  merchantId: string;
  merchantName: string;
  orderCount: number;
  lastOrdered: Date;
  avgRating: number;
  customizations?: CustomizationOptions;
}

export interface FavoriteMerchant {
  merchantId: string;
  name: string;
  orderCount: number;
  totalSpent: number;
  lastOrdered: Date;
  avgRating: number;
  favoriteItems: string[];
}

export interface OrderFrequency {
  daily: number;
  weekly: number;
  monthly: number;
  peakHours: number[];
  peakDays: number[];
  averageDaysBetweenOrders: number;
}

export interface SeasonalPattern {
  season: string;
  orderCount: number;
  avgOrderValue: number;
  popularCategories: string[];
  popularMerchants: string[];
}

// Customer Feedback and Reviews
export interface OrderFeedback {
  id: string;
  customerId: string;
  orderId?: string;
  merchantId?: string;
  driverId?: string;
  type: FeedbackType;
  rating: number;
  review?: string;
  categories: string[];
  tags: string[];
  photos: string[];
  isAnonymous: boolean;
  status: FeedbackStatus;
  isVerified: boolean;
  helpfulCount: number;
  reportCount: number;
  response?: MerchantResponse;
  createdAt: Date;
  updatedAt: Date;
}

export enum FeedbackType {
  ORDER = 'ORDER',
  DELIVERY = 'DELIVERY',
  MERCHANT = 'MERCHANT',
  DRIVER = 'DRIVER',
  APP = 'APP',
  GENERAL = 'GENERAL'
}

export enum FeedbackStatus {
  DRAFT = 'DRAFT',
  SUBMITTED = 'SUBMITTED',
  PUBLISHED = 'PUBLISHED',
  HIDDEN = 'HIDDEN',
  REMOVED = 'REMOVED'
}

export interface MerchantResponse {
  merchantId: string;
  response: string;
  respondedAt: Date;
  isOfficial: boolean;
}

// Customer KYC (Know Your Customer)
export interface CustomerKYC {
  customerId: string;
  level: KYCLevel;
  status: KYCStatus;
  documents: KYCDocument[];
  verificationDate?: Date;
  expiryDate?: Date;
  riskRating: RiskRating;
  complianceFlags: string[];
  lastUpdated: Date;
}

export enum KYCLevel {
  BASIC = 'BASIC',
  ENHANCED = 'ENHANCED',
  PREMIUM = 'PREMIUM'
}

export enum KYCStatus {
  NOT_STARTED = 'NOT_STARTED',
  IN_PROGRESS = 'IN_PROGRESS',
  SUBMITTED = 'SUBMITTED',
  VERIFIED = 'VERIFIED',
  REJECTED = 'REJECTED',
  EXPIRED = 'EXPIRED'
}

export interface KYCDocument {
  type: DocumentType;
  url: string;
  status: DocumentStatus;
  uploadedAt: Date;
  verifiedAt?: Date;
  rejectedReason?: string;
}

export enum DocumentType {
  GOVERNMENT_ID = 'GOVERNMENT_ID',
  DRIVERS_LICENSE = 'DRIVERS_LICENSE',
  PASSPORT = 'PASSPORT',
  PROOF_OF_ADDRESS = 'PROOF_OF_ADDRESS',
  SELFIE = 'SELFIE',
  PRESCRIPTION = 'PRESCRIPTION'
}

export enum DocumentStatus {
  PENDING = 'PENDING',
  VERIFIED = 'VERIFIED',
  REJECTED = 'REJECTED',
  EXPIRED = 'EXPIRED'
}

export enum RiskRating {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
  VERY_HIGH = 'VERY_HIGH'
}

// Customer Analytics
export interface CustomerAnalytics {
  customerId: string;
  period: AnalyticsPeriod;
  startDate: Date;
  endDate: Date;
  orderMetrics: OrderMetrics;
  spendingMetrics: SpendingMetrics;
  behaviorMetrics: BehaviorMetrics;
  engagementMetrics: EngagementMetrics;
  satisfactionMetrics: SatisfactionMetrics;
  loyaltyMetrics: LoyaltyMetrics;
  generatedAt: Date;
}

export enum AnalyticsPeriod {
  DAILY = 'DAILY',
  WEEKLY = 'WEEKLY',
  MONTHLY = 'MONTHLY',
  QUARTERLY = 'QUARTERLY',
  YEARLY = 'YEARLY',
  CUSTOM = 'CUSTOM'
}

export interface OrderMetrics {
  totalOrders: number;
  completedOrders: number;
  cancelledOrders: number;
  avgOrderValue: number;
  orderFrequency: number;
  reorderRate: number;
  peakOrderTimes: { hour: number; count: number }[];
  popularCategories: { category: string; count: number }[];
}

export interface SpendingMetrics {
  totalSpent: number;
  avgDailySpend: number;
  avgWeeklySpend: number;
  avgMonthlySpend: number;
  spendingTrend: 'INCREASING' | 'DECREASING' | 'STABLE';
  spendingByCategory: { category: string; amount: number }[];
  discountUsage: number;
  loyaltyRedemptions: number;
}

export interface BehaviorMetrics {
  sessionCount: number;
  avgSessionDuration: number;
  pageViews: number;
  searchQueries: number;
  cartAbandonmentRate: number;
  browserType: string;
  deviceType: string;
  preferredDeliveryTime: string;
  locationPatterns: LocationPattern[];
}

export interface LocationPattern {
  latitude: number;
  longitude: number;
  count: number;
  label?: string;
}

export interface EngagementMetrics {
  appOpens: number;
  notificationClickRate: number;
  emailOpenRate: number;
  socialShares: number;
  referrals: number;
  feedbackSubmissions: number;
  supportTickets: number;
  loyaltyEngagement: number;
}

export interface SatisfactionMetrics {
  avgOrderRating: number;
  avgDeliveryRating: number;
  avgAppRating: number;
  npsScore: number;
  complaintRate: number;
  resolutionTime: number;
  satisfactionTrend: 'IMPROVING' | 'DECLINING' | 'STABLE';
}

export interface LoyaltyMetrics {
  pointsEarned: number;
  pointsRedeemed: number;
  currentBalance: number;
  tierProgressPercentage: number;
  streakDays: number;
  bonusPointsEarned: number;
  expiringPoints: number;
}

// Business Case Result Type
export interface CustomerBusinessCase {
  success: boolean;
  customer?: {
    id: string;
    email?: string;
    firstName?: string;
    lastName?: string;
    status?: string;
    loyaltyPoints?: number;
  };
  businessCase: string;
  metadata?: any;
  error?: string;
  timestamp?: Date;
}

// Search and Discovery
export interface CustomerSearchHistory {
  id: string;
  customerId: string;
  query?: string;
  location: { latitude: number; longitude: number };
  filters: any;
  resultCount: number;
  clickedItems: string[];
  sessionId: string;
  timestamp: Date;
}

// Event Tracking
export interface CustomerEvent {
  id: string;
  customerId: string;
  eventType: string;
  eventData: any;
  timestamp: Date;
  sessionId?: string;
  deviceInfo?: any;
  location?: { latitude: number; longitude: number };
}

// Customer Segmentation
export interface CustomerSegment {
  id: string;
  name: string;
  description: string;
  criteria: SegmentCriteria;
  customerCount: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface SegmentCriteria {
  demographics?: DemographicCriteria;
  behavioral?: BehavioralCriteria;
  transactional?: TransactionalCriteria;
  engagement?: EngagementCriteria;
}

export interface DemographicCriteria {
  ageRange?: { min: number; max: number };
  gender?: string[];
  location?: LocationCriteria;
  occupation?: string[];
}

export interface LocationCriteria {
  countries?: string[];
  states?: string[];
  cities?: string[];
  radius?: { latitude: number; longitude: number; distance: number };
}

export interface BehavioralCriteria {
  orderFrequency?: { min: number; max: number };
  preferredCategories?: string[];
  deviceTypes?: string[];
  timePatterns?: { hours: number[]; days: number[] };
}

export interface TransactionalCriteria {
  totalSpent?: { min: number; max: number };
  avgOrderValue?: { min: number; max: number };
  lastOrderDays?: { min: number; max: number };
  paymentMethods?: string[];
}

export interface EngagementCriteria {
  appUsageFrequency?: { min: number; max: number };
  loyaltyTier?: LoyaltyTier[];
  feedbackRatings?: { min: number; max: number };
  supportTickets?: { min: number; max: number };
}