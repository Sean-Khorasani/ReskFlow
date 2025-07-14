/**
 * Customer-related GraphQL Type Definitions
 */

import { gql } from 'apollo-server-express';

export const customerTypeDefs = gql`
  # Loyalty Program Types
  type LoyaltyProgram {
    id: ID!
    name: String!
    tiers: [LoyaltyTier!]!
    pointsConfig: PointsConfig!
    rewards: [LoyaltyReward!]!
  }

  type LoyaltyTier {
    id: ID!
    name: String!
    minPoints: Int!
    benefits: [String!]!
    multiplier: Float!
  }

  type PointsConfig {
    earnRate: Float!
    referralBonus: Int!
    reviewBonus: Int!
    firstOrderBonus: Int!
  }

  type LoyaltyReward {
    id: ID!
    name: String!
    description: String!
    pointsCost: Int!
    category: String!
    tier: String!
    validUntil: DateTime
  }

  type UserLoyaltyStatus {
    userId: ID!
    currentPoints: Int!
    lifetimePoints: Int!
    currentTier: LoyaltyTier!
    nextTier: LoyaltyTier
    pointsToNextTier: Int
    memberSince: DateTime!
  }

  # Subscription Types
  type SubscriptionPlan {
    id: ID!
    name: String!
    price: Float!
    interval: SubscriptionInterval!
    features: [String!]!
    maxUsers: Int
    trialDays: Int
  }

  enum SubscriptionInterval {
    MONTHLY
    YEARLY
  }

  type UserSubscription {
    id: ID!
    userId: ID!
    plan: SubscriptionPlan!
    status: SubscriptionStatus!
    startDate: DateTime!
    endDate: DateTime
    cancelledAt: DateTime
    familyMembers: [User!]
  }

  enum SubscriptionStatus {
    ACTIVE
    CANCELLED
    EXPIRED
    TRIALING
  }

  # Group Order Types
  type GroupOrder {
    id: ID!
    name: String!
    hostId: ID!
    restaurantId: ID!
    status: GroupOrderStatus!
    shareableLink: String!
    participants: [GroupOrderParticipant!]!
    deadline: DateTime
    totalAmount: Float!
    createdAt: DateTime!
  }

  type GroupOrderParticipant {
    userId: ID!
    user: User!
    items: [CartItem!]!
    subtotal: Float!
    status: ParticipantStatus!
    joinedAt: DateTime!
  }

  enum GroupOrderStatus {
    OPEN
    CLOSED
    FINALIZED
    CANCELLED
  }

  enum ParticipantStatus {
    ACTIVE
    READY
    LEFT
  }

  # Scheduled Order Types
  type ScheduledOrder {
    id: ID!
    userId: ID!
    name: String!
    restaurantId: ID!
    items: [CartItem!]!
    reskflowAddress: Address!
    scheduledFor: DateTime!
    recurrence: RecurrencePattern
    status: ScheduledOrderStatus!
    nextOccurrence: DateTime
  }

  type RecurrencePattern {
    frequency: RecurrenceFrequency!
    interval: Int!
    daysOfWeek: [Int!]
    endDate: DateTime
  }

  enum RecurrenceFrequency {
    DAILY
    WEEKLY
    MONTHLY
  }

  enum ScheduledOrderStatus {
    ACTIVE
    PAUSED
    CANCELLED
    COMPLETED
  }

  # Dietary Preferences Types
  type DietaryProfile {
    userId: ID!
    restrictions: [DietaryRestriction!]!
    preferences: [DietaryPreference!]!
    allergies: [Allergy!]!
    nutritionGoals: NutritionGoals
    trackingEnabled: Boolean!
  }

  type DietaryRestriction {
    type: String!
    strict: Boolean!
  }

  type DietaryPreference {
    name: String!
    importance: PreferenceImportance!
  }

  type Allergy {
    allergen: String!
    severity: AllergySeverity!
  }

  type NutritionGoals {
    dailyCalories: Int
    maxSodium: Int
    maxSugar: Int
    minProtein: Int
    minFiber: Int
  }

  enum PreferenceImportance {
    LOW
    MEDIUM
    HIGH
  }

  enum AllergySeverity {
    MILD
    MODERATE
    SEVERE
  }

  # Split Payment Types
  type SplitPayment {
    id: ID!
    orderId: ID!
    hostId: ID!
    method: SplitMethod!
    participants: [PaymentParticipant!]!
    totalAmount: Float!
    status: SplitPaymentStatus!
    paymentLink: String
    expiresAt: DateTime!
  }

  type PaymentParticipant {
    userId: ID
    email: String!
    name: String!
    amount: Float!
    status: ParticipantPaymentStatus!
    paidAt: DateTime
  }

  enum SplitMethod {
    EQUAL
    CUSTOM
    ITEM_BASED
  }

  enum SplitPaymentStatus {
    PENDING
    PARTIAL
    COMPLETED
    FAILED
    CANCELLED
  }

  enum ParticipantPaymentStatus {
    PENDING
    PAID
    DECLINED
    REFUNDED
  }

  # Queries
  extend type Query {
    # Loyalty
    getLoyaltyProgram: LoyaltyProgram!
    getUserLoyaltyStatus(userId: ID!): UserLoyaltyStatus!
    getAvailableRewards(tier: String): [LoyaltyReward!]!
    
    # Subscriptions
    getSubscriptionPlans: [SubscriptionPlan!]!
    getUserSubscription(userId: ID!): UserSubscription
    
    # Group Orders
    getGroupOrder(id: ID!): GroupOrder
    getUserGroupOrders(userId: ID!): [GroupOrder!]!
    
    # Scheduled Orders
    getScheduledOrder(id: ID!): ScheduledOrder
    getUserScheduledOrders(userId: ID!): [ScheduledOrder!]!
    
    # Dietary
    getUserDietaryProfile(userId: ID!): DietaryProfile
    analyzeMenuItem(itemId: ID!, userId: ID!): DietaryAnalysis!
    
    # Split Payments
    getSplitPayment(id: ID!): SplitPayment
    getUserSplitPayments(userId: ID!): [SplitPayment!]!
  }

  # Mutations
  extend type Mutation {
    # Loyalty
    awardLoyaltyPoints(userId: ID!, points: Int!, source: String!, description: String!): UserLoyaltyStatus!
    redeemReward(userId: ID!, rewardId: ID!): RedemptionResult!
    
    # Subscriptions
    createSubscription(userId: ID!, planId: ID!, paymentMethodId: String!): UserSubscription!
    cancelSubscription(subscriptionId: ID!, reason: String): UserSubscription!
    addFamilyMember(subscriptionId: ID!, email: String!): UserSubscription!
    
    # Group Orders
    createGroupOrder(input: CreateGroupOrderInput!): GroupOrder!
    joinGroupOrder(shareableLink: String!, userId: ID!): GroupOrder!
    updateGroupOrderItems(orderId: ID!, userId: ID!, items: [CartItemInput!]!): GroupOrder!
    finalizeGroupOrder(orderId: ID!): GroupOrder!
    
    # Scheduled Orders
    createScheduledOrder(input: CreateScheduledOrderInput!): ScheduledOrder!
    updateScheduledOrder(id: ID!, input: UpdateScheduledOrderInput!): ScheduledOrder!
    pauseScheduledOrder(id: ID!): ScheduledOrder!
    cancelScheduledOrder(id: ID!): ScheduledOrder!
    
    # Dietary
    updateDietaryProfile(userId: ID!, input: DietaryProfileInput!): DietaryProfile!
    
    # Split Payments
    createSplitPayment(input: CreateSplitPaymentInput!): SplitPayment!
    updateParticipantAmount(paymentId: ID!, participantEmail: String!, amount: Float!): SplitPayment!
    sendPaymentReminder(paymentId: ID!, participantEmail: String!): Boolean!
  }

  # Subscriptions
  extend type Subscription {
    # Group Orders
    groupOrderUpdated(orderId: ID!): GroupOrder!
    
    # Split Payments
    splitPaymentUpdated(paymentId: ID!): SplitPayment!
    
    # Loyalty
    loyaltyPointsUpdated(userId: ID!): UserLoyaltyStatus!
  }

  # Input Types
  input CreateGroupOrderInput {
    name: String!
    hostId: ID!
    restaurantId: ID!
    deadline: DateTime
  }

  input CreateScheduledOrderInput {
    userId: ID!
    name: String!
    restaurantId: ID!
    items: [CartItemInput!]!
    reskflowAddress: AddressInput!
    scheduledFor: DateTime!
    recurrence: RecurrencePatternInput
  }

  input UpdateScheduledOrderInput {
    name: String
    items: [CartItemInput!]
    reskflowAddress: AddressInput
    scheduledFor: DateTime
    recurrence: RecurrencePatternInput
  }

  input RecurrencePatternInput {
    frequency: RecurrenceFrequency!
    interval: Int!
    daysOfWeek: [Int!]
    endDate: DateTime
  }

  input DietaryProfileInput {
    restrictions: [DietaryRestrictionInput!]
    preferences: [DietaryPreferenceInput!]
    allergies: [AllergyInput!]
    nutritionGoals: NutritionGoalsInput
    trackingEnabled: Boolean
  }

  input DietaryRestrictionInput {
    type: String!
    strict: Boolean!
  }

  input DietaryPreferenceInput {
    name: String!
    importance: PreferenceImportance!
  }

  input AllergyInput {
    allergen: String!
    severity: AllergySeverity!
  }

  input NutritionGoalsInput {
    dailyCalories: Int
    maxSodium: Int
    maxSugar: Int
    minProtein: Int
    minFiber: Int
  }

  input CreateSplitPaymentInput {
    orderId: ID!
    hostId: ID!
    method: SplitMethod!
    participants: [PaymentParticipantInput!]!
  }

  input PaymentParticipantInput {
    email: String!
    name: String!
    amount: Float
  }

  # Result Types
  type RedemptionResult {
    success: Boolean!
    message: String!
    updatedStatus: UserLoyaltyStatus
  }

  type DietaryAnalysis {
    itemId: ID!
    safe: Boolean!
    warnings: [String!]!
    allergens: [String!]!
    nutritionInfo: NutritionInfo
  }

  type NutritionInfo {
    calories: Int
    protein: Float
    carbs: Float
    fat: Float
    sodium: Float
    sugar: Float
    fiber: Float
  }
`;