export interface SearchRequest {
  query: string;
  filters?: SearchFilters;
  location?: Location;
  pagination?: Pagination;
  sorting?: SortOptions;
  preferences?: UserPreferences;
}

export interface SearchFilters {
  cuisineTypes?: string[];
  dietaryRestrictions?: string[];
  priceRange?: PriceRange;
  ratings?: RatingFilter;
  deliveryTime?: TimeRange;
  merchantTypes?: string[];
  tags?: string[];
  availability?: boolean;
  openNow?: boolean;
  distance?: DistanceFilter;
  categories?: string[];
  allergens?: AllergenFilter;
  nutritionalInfo?: NutritionalFilter;
  promotion?: PromotionFilter;
}

export interface Location {
  latitude: number;
  longitude: number;
  radius?: number; // in kilometers
  address?: string;
  city?: string;
  country?: string;
}

export interface Pagination {
  page: number;
  limit: number;
  offset?: number;
}

export interface SortOptions {
  field: SortField;
  order: SortOrder;
  location?: Location; // for distance-based sorting
}

export interface UserPreferences {
  userId?: string;
  favoriteCategories?: string[];
  dietaryRestrictions?: string[];
  allergens?: string[];
  preferredCuisines?: string[];
  maxDeliveryTime?: number;
  maxDistance?: number;
  pricePreference?: PricePreference;
  ratingThreshold?: number;
  previousOrders?: string[];
  blacklistedMerchants?: string[];
}

export interface SearchResult {
  results: SearchItem[];
  pagination: PaginationResult;
  aggregations?: SearchAggregations;
  suggestions?: string[];
  filters?: AppliedFilters;
  searchTime: number;
  totalResults: number;
}

export interface SearchItem {
  id: string;
  type: ItemType;
  name: string;
  description: string;
  merchant: MerchantInfo;
  location: Location;
  price: PriceInfo;
  rating: RatingInfo;
  availability: AvailabilityInfo;
  cuisineType: string;
  categories: string[];
  tags: string[];
  images: string[];
  nutritionalInfo?: NutritionalInfo;
  allergens?: string[];
  dietaryLabels?: string[];
  deliveryTime: EstimatedTime;
  distance?: number;
  relevanceScore: number;
  isPromoted?: boolean;
  promotions?: Promotion[];
}

export interface MerchantInfo {
  id: string;
  name: string;
  type: MerchantType;
  rating: number;
  reviewCount: number;
  isVerified: boolean;
  deliveryFee: number;
  minimumOrder: number;
  estimatedDeliveryTime: EstimatedTime;
  isOpen: boolean;
  cuisineTypes: string[];
  businessHours: BusinessHours[];
}

export interface PriceInfo {
  amount: number;
  currency: string;
  originalPrice?: number;
  discountPercentage?: number;
  isOnSale?: boolean;
}

export interface RatingInfo {
  average: number;
  count: number;
  breakdown?: RatingBreakdown;
}

export interface AvailabilityInfo {
  isAvailable: boolean;
  stockLevel?: StockLevel;
  estimatedRestockTime?: Date;
  availableUntil?: Date;
}

export interface NutritionalInfo {
  calories: number;
  protein: number;
  carbohydrates: number;
  fat: number;
  fiber?: number;
  sugar?: number;
  sodium?: number;
  cholesterol?: number;
  servingSize: string;
}

export interface EstimatedTime {
  min: number;
  max: number;
  unit: TimeUnit;
}

export interface Promotion {
  id: string;
  type: PromotionType;
  title: string;
  description: string;
  discount: DiscountInfo;
  validUntil: Date;
  conditions?: string[];
}

export interface SearchAggregations {
  cuisineTypes: AggregationBucket[];
  priceRanges: AggregationBucket[];
  ratings: AggregationBucket[];
  dietaryLabels: AggregationBucket[];
  deliveryTimes: AggregationBucket[];
  merchants: AggregationBucket[];
  categories: AggregationBucket[];
  tags: AggregationBucket[];
}

export interface AggregationBucket {
  key: string;
  count: number;
  selected?: boolean;
}

export interface AppliedFilters {
  [key: string]: any;
}

export interface PaginationResult {
  page: number;
  limit: number;
  total: number;
  pages: number;
  hasNext: boolean;
  hasPrev: boolean;
}

export interface SearchSuggestion {
  text: string;
  type: SuggestionType;
  score: number;
  category?: string;
}

export interface SearchAnalytics {
  query: string;
  filters: SearchFilters;
  resultsCount: number;
  searchTime: number;
  userId?: string;
  location?: Location;
  timestamp: Date;
  clickedResults?: string[];
  noResultsFound?: boolean;
}

export interface AutocompleteRequest {
  query: string;
  types?: SuggestionType[];
  location?: Location;
  limit?: number;
}

export interface AutocompleteResult {
  suggestions: SearchSuggestion[];
  categories: CategorySuggestion[];
  merchants: MerchantSuggestion[];
  popular: PopularSuggestion[];
}

export interface CategorySuggestion {
  name: string;
  count: number;
  icon?: string;
}

export interface MerchantSuggestion {
  id: string;
  name: string;
  cuisineType: string;
  rating: number;
  isOpen: boolean;
}

export interface PopularSuggestion {
  query: string;
  searchCount: number;
  category?: string;
}

export interface ElasticsearchDocument {
  id: string;
  type: ItemType;
  name: string;
  description: string;
  merchant: {
    id: string;
    name: string;
    type: MerchantType;
    rating: number;
    isVerified: boolean;
    location: {
      lat: number;
      lon: number;
    };
    cuisineTypes: string[];
    isOpen: boolean;
  };
  location: {
    lat: number;
    lon: number;
  };
  price: {
    amount: number;
    currency: string;
  };
  rating: {
    average: number;
    count: number;
  };
  availability: {
    isAvailable: boolean;
    stockLevel?: StockLevel;
  };
  cuisineType: string;
  categories: string[];
  tags: string[];
  allergens: string[];
  dietaryLabels: string[];
  nutritionalInfo?: NutritionalInfo;
  deliveryTime: {
    min: number;
    max: number;
  };
  createdAt: Date;
  updatedAt: Date;
  searchKeywords: string[];
  popularity: number;
  isPromoted: boolean;
}

export interface SearchConfiguration {
  indices: {
    items: string;
    merchants: string;
    categories: string;
    analytics: string;
  };
  defaultLimit: number;
  maxLimit: number;
  cacheTimeout: number;
  suggestionLimit: number;
  popularityWeight: number;
  locationWeight: number;
  ratingWeight: number;
  availabilityWeight: number;
}

// Enums
export enum ItemType {
  FOOD = 'food',
  BEVERAGE = 'beverage',
  DESSERT = 'dessert',
  COMBO = 'combo',
  SIDE = 'side',
  APPETIZER = 'appetizer',
  MAIN_COURSE = 'main_course',
  ALCOHOL = 'alcohol'
}

export enum MerchantType {
  RESTAURANT = 'restaurant',
  CAFE = 'cafe',
  BAR = 'bar',
  BAKERY = 'bakery',
  GROCERY = 'grocery',
  CONVENIENCE = 'convenience',
  PHARMACY = 'pharmacy',
  SPECIALTY = 'specialty'
}

export enum SortField {
  RELEVANCE = 'relevance',
  PRICE = 'price',
  RATING = 'rating',
  DISTANCE = 'distance',
  DELIVERY_TIME = 'deliveryTime',
  POPULARITY = 'popularity',
  NEWEST = 'newest',
  ALPHABETICAL = 'alphabetical'
}

export enum SortOrder {
  ASC = 'asc',
  DESC = 'desc'
}

export enum StockLevel {
  IN_STOCK = 'in_stock',
  LOW_STOCK = 'low_stock',
  OUT_OF_STOCK = 'out_of_stock',
  PREORDER = 'preorder'
}

export enum TimeUnit {
  MINUTES = 'minutes',
  HOURS = 'hours',
  DAYS = 'days'
}

export enum PromotionType {
  PERCENTAGE = 'percentage',
  FIXED_AMOUNT = 'fixed_amount',
  BUY_ONE_GET_ONE = 'bogo',
  FREE_DELIVERY = 'free_delivery',
  BUNDLE = 'bundle'
}

export enum SuggestionType {
  QUERY = 'query',
  CATEGORY = 'category',
  CUISINE = 'cuisine',
  MERCHANT = 'merchant',
  ITEM = 'item',
  LOCATION = 'location'
}

export enum PricePreference {
  BUDGET = 'budget',
  MODERATE = 'moderate',
  PREMIUM = 'premium',
  ANY = 'any'
}

// Filter interfaces
export interface PriceRange {
  min?: number;
  max?: number;
  currency?: string;
}

export interface RatingFilter {
  min?: number;
  max?: number;
}

export interface TimeRange {
  min?: number;
  max?: number;
  unit: TimeUnit;
}

export interface DistanceFilter {
  max: number;
  unit: DistanceUnit;
}

export interface AllergenFilter {
  exclude: string[];
  include?: string[];
}

export interface NutritionalFilter {
  maxCalories?: number;
  minProtein?: number;
  maxSodium?: number;
  maxSugar?: number;
  maxFat?: number;
  minFiber?: number;
}

export interface PromotionFilter {
  hasPromotion?: boolean;
  promotionTypes?: PromotionType[];
  minDiscount?: number;
}

export interface BusinessHours {
  dayOfWeek: number; // 0-6 (Sunday-Saturday)
  openTime: string; // HH:mm format
  closeTime: string; // HH:mm format
  isOpen: boolean;
}

export interface RatingBreakdown {
  fiveStars: number;
  fourStars: number;
  threeStars: number;
  twoStars: number;
  oneStar: number;
}

export interface DiscountInfo {
  type: PromotionType;
  value: number;
  maxAmount?: number;
  minOrderAmount?: number;
}

export enum DistanceUnit {
  KILOMETERS = 'km',
  MILES = 'miles',
  METERS = 'meters'
}

export interface SearchError {
  code: string;
  message: string;
  details?: any;
  suggestions?: string[];
}

export interface BulkIndexRequest {
  items: ElasticsearchDocument[];
  index: string;
  refresh?: boolean;
}

export interface BulkIndexResult {
  indexed: number;
  failed: number;
  errors: any[];
  took: number;
}