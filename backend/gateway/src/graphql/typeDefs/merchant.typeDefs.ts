/**
 * Merchant-related GraphQL Type Definitions
 */

import { gql } from 'apollo-server-express';

export const merchantTypeDefs = gql`
  # Inventory Management Types
  type InventoryItem {
    id: ID!
    merchantId: ID!
    name: String!
    sku: String!
    category: String!
    currentStock: Int!
    minStock: Int!
    maxStock: Int!
    unit: String!
    cost: Float!
    supplier: Supplier
    status: StockStatus!
    lastRestocked: DateTime
    expiryDate: DateTime
  }

  type Supplier {
    id: ID!
    name: String!
    contact: String!
    email: String!
    leadTime: Int! # days
  }

  enum StockStatus {
    IN_STOCK
    LOW_STOCK
    OUT_OF_STOCK
    DISCONTINUED
  }

  type PurchaseOrder {
    id: ID!
    merchantId: ID!
    supplier: Supplier!
    items: [PurchaseOrderItem!]!
    totalCost: Float!
    status: POStatus!
    createdAt: DateTime!
    expectedDelivery: DateTime!
    receivedAt: DateTime
  }

  type PurchaseOrderItem {
    item: InventoryItem!
    quantity: Int!
    unitCost: Float!
    totalCost: Float!
  }

  enum POStatus {
    DRAFT
    SUBMITTED
    CONFIRMED
    SHIPPED
    DELIVERED
    CANCELLED
  }

  # Promotional Campaign Types
  type Campaign {
    id: ID!
    merchantId: ID!
    name: String!
    description: String!
    type: CampaignType!
    status: CampaignStatus!
    targetAudience: TargetAudience!
    conditions: CampaignConditions!
    rewards: CampaignRewards!
    schedule: CampaignSchedule!
    budget: CampaignBudget
    performance: CampaignPerformance!
    abTest: ABTestConfig
  }

  enum CampaignType {
    DISCOUNT
    BOGO
    BUNDLE
    FREE_DELIVERY
    LOYALTY_POINTS
    FLASH_SALE
    HAPPY_HOUR
  }

  enum CampaignStatus {
    DRAFT
    SCHEDULED
    ACTIVE
    PAUSED
    COMPLETED
    CANCELLED
  }

  type TargetAudience {
    segments: [String!]!
    minOrderCount: Int
    lastOrderDays: Int
    customerTiers: [String!]
    locations: [String!]
  }

  type CampaignConditions {
    minOrderValue: Float
    validItems: [String!]
    validCategories: [String!]
    maxUsesPerCustomer: Int
    totalMaxUses: Int
  }

  type CampaignRewards {
    discountType: DiscountType!
    discountValue: Float!
    maxDiscount: Float
    freeItems: [String!]
  }

  type CampaignSchedule {
    startDate: DateTime!
    endDate: DateTime!
    activeDays: [Int!]
    activeHours: TimeRange
  }

  type TimeRange {
    start: String! # HH:MM
    end: String!   # HH:MM
  }

  type CampaignBudget {
    total: Float!
    spent: Float!
    remaining: Float!
  }

  type CampaignPerformance {
    impressions: Int!
    clicks: Int!
    conversions: Int!
    revenue: Float!
    roi: Float!
    avgOrderValue: Float!
  }

  type ABTestConfig {
    enabled: Boolean!
    variantA: CampaignRewards!
    variantB: CampaignRewards!
    splitPercentage: Int!
  }

  enum DiscountType {
    PERCENTAGE
    FIXED_AMOUNT
    BUY_X_GET_Y
  }

  # Menu Scheduling Types
  type MenuSchedule {
    id: ID!
    merchantId: ID!
    name: String!
    items: [ScheduledMenuItem!]!
    activePeriods: [SchedulePeriod!]!
    status: ScheduleStatus!
    priority: Int!
  }

  type ScheduledMenuItem {
    itemId: ID!
    item: MenuItem!
    priceOverride: Float
    availabilityOverride: Boolean
  }

  type SchedulePeriod {
    startDate: DateTime!
    endDate: DateTime
    recurrence: MenuRecurrence
    timeSlots: [TimeRange!]!
  }

  type MenuRecurrence {
    frequency: RecurrenceFrequency!
    daysOfWeek: [Int!]
    weeksOfMonth: [Int!]
    monthsOfYear: [Int!]
  }

  enum ScheduleStatus {
    ACTIVE
    INACTIVE
    SCHEDULED
    EXPIRED
  }

  # Ingredient Tracking Types
  type Ingredient {
    id: ID!
    merchantId: ID!
    name: String!
    unit: String!
    currentQuantity: Float!
    minQuantity: Float!
    cost: Float!
    allergens: [String!]
    nutritionInfo: NutritionInfo
    suppliers: [Supplier!]!
  }

  type Recipe {
    id: ID!
    menuItemId: ID!
    merchantId: ID!
    ingredients: [RecipeIngredient!]!
    yield: Int!
    prepTime: Int! # minutes
    instructions: [String!]
  }

  type RecipeIngredient {
    ingredient: Ingredient!
    quantity: Float!
    preparation: String
  }

  type IngredientBatch {
    id: ID!
    ingredientId: ID!
    quantity: Float!
    receivedDate: DateTime!
    expiryDate: DateTime!
    supplier: Supplier!
    remainingQuantity: Float!
    status: BatchStatus!
  }

  enum BatchStatus {
    FRESH
    EXPIRING_SOON
    EXPIRED
    DEPLETED
  }

  # Multi-Location Management Types
  type MerchantBrand {
    id: ID!
    name: String!
    logo: String!
    locations: [MerchantLocation!]!
    sharedMenu: Menu
    policies: BrandPolicies!
  }

  type MerchantLocation {
    id: ID!
    brandId: ID!
    name: String!
    address: Address!
    manager: User!
    menu: Menu!
    hours: [OperatingHours!]!
    performance: LocationPerformance!
    overrides: LocationOverrides
  }

  type BrandPolicies {
    menuSyncEnabled: Boolean!
    pricingSyncEnabled: Boolean!
    promotionSyncEnabled: Boolean!
    inventorySyncEnabled: Boolean!
  }

  type LocationPerformance {
    revenue: Float!
    orderCount: Int!
    avgOrderValue: Float!
    customerRating: Float!
    topItems: [MenuItem!]!
    comparison: PerformanceComparison!
  }

  type PerformanceComparison {
    revenueVsBrand: Float! # percentage
    ordersVsBrand: Float!
    ratingVsBrand: Float!
    rank: Int!
  }

  type LocationOverrides {
    menuItems: [MenuItemOverride!]
    pricing: [PricingOverride!]
    hours: [OperatingHours!]
  }

  type MenuItemOverride {
    itemId: ID!
    available: Boolean!
    price: Float
  }

  type PricingOverride {
    category: String!
    adjustment: Float! # percentage
  }

  # Queries
  extend type Query {
    # Inventory
    getInventory(merchantId: ID!): [InventoryItem!]!
    getLowStockItems(merchantId: ID!): [InventoryItem!]!
    getPurchaseOrders(merchantId: ID!): [PurchaseOrder!]!
    getSuppliers(merchantId: ID!): [Supplier!]!
    
    # Campaigns
    getCampaigns(merchantId: ID!, status: CampaignStatus): [Campaign!]!
    getCampaign(id: ID!): Campaign
    getCampaignPerformance(id: ID!, period: DateRangeInput!): CampaignPerformance!
    
    # Menu Scheduling
    getMenuSchedules(merchantId: ID!): [MenuSchedule!]!
    getActiveMenuItems(merchantId: ID!, time: DateTime!): [MenuItem!]!
    
    # Ingredients
    getIngredients(merchantId: ID!): [Ingredient!]!
    getRecipes(merchantId: ID!): [Recipe!]!
    getExpiringBatches(merchantId: ID!, days: Int!): [IngredientBatch!]!
    
    # Multi-Location
    getBrand(brandId: ID!): MerchantBrand!
    getBrandLocations(brandId: ID!): [MerchantLocation!]!
    getLocationPerformance(locationId: ID!, period: DateRangeInput!): LocationPerformance!
    compareLocations(brandId: ID!, metric: String!): [LocationComparison!]!
  }

  # Mutations
  extend type Mutation {
    # Inventory
    updateStock(itemId: ID!, quantity: Int!, reason: String!): InventoryItem!
    createPurchaseOrder(input: CreatePurchaseOrderInput!): PurchaseOrder!
    receivePurchaseOrder(orderId: ID!, receivedItems: [ReceivedItemInput!]!): PurchaseOrder!
    setReorderPoint(itemId: ID!, minStock: Int!): InventoryItem!
    
    # Campaigns
    createCampaign(input: CreateCampaignInput!): Campaign!
    updateCampaign(id: ID!, input: UpdateCampaignInput!): Campaign!
    activateCampaign(id: ID!): Campaign!
    pauseCampaign(id: ID!): Campaign!
    duplicateCampaign(id: ID!, name: String!): Campaign!
    
    # Menu Scheduling
    createMenuSchedule(input: CreateMenuScheduleInput!): MenuSchedule!
    updateMenuSchedule(id: ID!, input: UpdateMenuScheduleInput!): MenuSchedule!
    activateSchedule(id: ID!): MenuSchedule!
    deactivateSchedule(id: ID!): MenuSchedule!
    
    # Ingredients
    addIngredient(input: AddIngredientInput!): Ingredient!
    updateIngredientQuantity(id: ID!, quantity: Float!, batchId: ID): Ingredient!
    createRecipe(input: CreateRecipeInput!): Recipe!
    updateRecipe(id: ID!, input: UpdateRecipeInput!): Recipe!
    recordWaste(ingredientId: ID!, quantity: Float!, reason: String!): Ingredient!
    
    # Multi-Location
    createBrand(input: CreateBrandInput!): MerchantBrand!
    addLocation(brandId: ID!, input: AddLocationInput!): MerchantLocation!
    syncMenuToLocations(brandId: ID!, locationIds: [ID!]!): [MerchantLocation!]!
    setLocationOverride(locationId: ID!, override: LocationOverrideInput!): MerchantLocation!
  }

  # Subscriptions
  extend type Subscription {
    # Inventory
    inventoryUpdated(merchantId: ID!): InventoryItem!
    lowStockAlert(merchantId: ID!): LowStockAlert!
    
    # Campaigns
    campaignPerformanceUpdate(campaignId: ID!): CampaignPerformance!
    
    # Ingredients
    ingredientAlert(merchantId: ID!): IngredientAlert!
    
    # Multi-Location
    locationPerformanceUpdate(brandId: ID!): LocationPerformance!
  }

  # Input Types
  input CreatePurchaseOrderInput {
    merchantId: ID!
    supplierId: ID!
    items: [PurchaseOrderItemInput!]!
    expectedDelivery: DateTime!
  }

  input PurchaseOrderItemInput {
    itemId: ID!
    quantity: Int!
    unitCost: Float!
  }

  input ReceivedItemInput {
    itemId: ID!
    quantityReceived: Int!
    quantityDamaged: Int
  }

  input CreateCampaignInput {
    merchantId: ID!
    name: String!
    description: String!
    type: CampaignType!
    targetAudience: TargetAudienceInput!
    conditions: CampaignConditionsInput!
    rewards: CampaignRewardsInput!
    schedule: CampaignScheduleInput!
    budget: Float
    abTest: ABTestConfigInput
  }

  input UpdateCampaignInput {
    name: String
    description: String
    targetAudience: TargetAudienceInput
    conditions: CampaignConditionsInput
    rewards: CampaignRewardsInput
    schedule: CampaignScheduleInput
    budget: Float
  }

  input TargetAudienceInput {
    segments: [String!]
    minOrderCount: Int
    lastOrderDays: Int
    customerTiers: [String!]
    locations: [String!]
  }

  input CampaignConditionsInput {
    minOrderValue: Float
    validItems: [String!]
    validCategories: [String!]
    maxUsesPerCustomer: Int
    totalMaxUses: Int
  }

  input CampaignRewardsInput {
    discountType: DiscountType!
    discountValue: Float!
    maxDiscount: Float
    freeItems: [String!]
  }

  input CampaignScheduleInput {
    startDate: DateTime!
    endDate: DateTime!
    activeDays: [Int!]
    activeHours: TimeRangeInput
  }

  input TimeRangeInput {
    start: String!
    end: String!
  }

  input ABTestConfigInput {
    enabled: Boolean!
    variantA: CampaignRewardsInput!
    variantB: CampaignRewardsInput!
    splitPercentage: Int!
  }

  input CreateMenuScheduleInput {
    merchantId: ID!
    name: String!
    items: [ScheduledMenuItemInput!]!
    activePeriods: [SchedulePeriodInput!]!
    priority: Int!
  }

  input UpdateMenuScheduleInput {
    name: String
    items: [ScheduledMenuItemInput!]
    activePeriods: [SchedulePeriodInput!]
    priority: Int
  }

  input ScheduledMenuItemInput {
    itemId: ID!
    priceOverride: Float
    availabilityOverride: Boolean
  }

  input SchedulePeriodInput {
    startDate: DateTime!
    endDate: DateTime
    recurrence: MenuRecurrenceInput
    timeSlots: [TimeRangeInput!]!
  }

  input MenuRecurrenceInput {
    frequency: RecurrenceFrequency!
    daysOfWeek: [Int!]
    weeksOfMonth: [Int!]
    monthsOfYear: [Int!]
  }

  input AddIngredientInput {
    merchantId: ID!
    name: String!
    unit: String!
    currentQuantity: Float!
    minQuantity: Float!
    cost: Float!
    allergens: [String!]
    nutritionInfo: NutritionInfoInput
    supplierIds: [ID!]!
  }

  input CreateRecipeInput {
    menuItemId: ID!
    merchantId: ID!
    ingredients: [RecipeIngredientInput!]!
    yield: Int!
    prepTime: Int!
    instructions: [String!]!
  }

  input UpdateRecipeInput {
    ingredients: [RecipeIngredientInput!]
    yield: Int
    prepTime: Int
    instructions: [String!]
  }

  input RecipeIngredientInput {
    ingredientId: ID!
    quantity: Float!
    preparation: String
  }

  input CreateBrandInput {
    name: String!
    logo: String
    policies: BrandPoliciesInput!
  }

  input BrandPoliciesInput {
    menuSyncEnabled: Boolean!
    pricingSyncEnabled: Boolean!
    promotionSyncEnabled: Boolean!
    inventorySyncEnabled: Boolean!
  }

  input AddLocationInput {
    name: String!
    address: AddressInput!
    managerId: ID!
    hours: [OperatingHoursInput!]!
  }

  input LocationOverrideInput {
    menuItems: [MenuItemOverrideInput!]
    pricing: [PricingOverrideInput!]
    hours: [OperatingHoursInput!]
  }

  input MenuItemOverrideInput {
    itemId: ID!
    available: Boolean!
    price: Float
  }

  input PricingOverrideInput {
    category: String!
    adjustment: Float!
  }

  # Alert Types
  type LowStockAlert {
    item: InventoryItem!
    currentStock: Int!
    minStock: Int!
    estimatedDaysRemaining: Int!
    suggestedOrderQuantity: Int!
  }

  type IngredientAlert {
    type: AlertType!
    ingredient: Ingredient!
    message: String!
    severity: AlertSeverity!
  }

  enum AlertType {
    LOW_STOCK
    EXPIRING_SOON
    EXPIRED
    PRICE_INCREASE
  }

  enum AlertSeverity {
    INFO
    WARNING
    CRITICAL
  }

  type LocationComparison {
    location: MerchantLocation!
    metric: String!
    value: Float!
    rank: Int!
    trend: TrendDirection!
  }

  enum TrendDirection {
    UP
    DOWN
    STABLE
  }
`;