import { gql } from 'apollo-server-express';
import { customerTypeDefs } from './typeDefs/customer.typeDefs';
import { driverTypeDefs } from './typeDefs/driver.typeDefs';
import { merchantTypeDefs } from './typeDefs/merchant.typeDefs';
import { adminTypeDefs } from './typeDefs/admin.typeDefs';

const baseTypeDefs = gql`
  scalar DateTime
  scalar JSON
  scalar Upload

  enum UserRole {
    CUSTOMER
    DRIVER
    ADMIN
    PARTNER
    MERCHANT
  }

  enum DeliveryStatus {
    CREATED
    ASSIGNED
    PICKED_UP
    IN_TRANSIT
    DELIVERED
    CANCELLED
    FAILED
  }

  enum VehicleType {
    BICYCLE
    MOTORCYCLE
    CAR
    VAN
    TRUCK
  }

  enum PaymentStatus {
    PENDING
    PROCESSING
    COMPLETED
    FAILED
    REFUNDED
  }

  type User {
    id: ID!
    email: String!
    phone: String
    firstName: String!
    lastName: String!
    role: UserRole!
    walletAddress: String
    emailVerified: Boolean!
    phoneVerified: Boolean!
    isActive: Boolean!
    profile: UserProfile
    addresses: [Address!]!
    createdAt: DateTime!
    updatedAt: DateTime!
  }

  type UserProfile {
    id: ID!
    avatar: String
    dateOfBirth: DateTime
    vehicleType: VehicleType
    vehicleNumber: String
    rating: Float!
    completedDeliveries: Int!
    totalEarnings: Float!
    isVerified: Boolean!
  }

  type Address {
    id: ID!
    label: String!
    street: String!
    city: String!
    state: String!
    country: String!
    postalCode: String!
    latitude: Float!
    longitude: Float!
    isDefault: Boolean!
  }

  type Delivery {
    id: ID!
    trackingNumber: String!
    blockchainId: String
    sender: User!
    recipient: User
    driver: User
    pickupAddress: Address!
    reskflowAddress: Address!
    packageDetails: JSON!
    status: DeliveryStatus!
    scheduledPickup: DateTime
    scheduledDelivery: DateTime
    actualPickup: DateTime
    actualDelivery: DateTime
    distance: Float
    duration: Int
    price: Float!
    driverEarnings: Float
    platformFee: Float
    insuranceAmount: Float
    signature: String
    photos: [String!]!
    trackingEvents: [TrackingEvent!]!
    currentLocation: Location
    estimatedArrival: DateTime
    createdAt: DateTime!
    updatedAt: DateTime!
  }

  type TrackingEvent {
    id: ID!
    status: DeliveryStatus!
    location: JSON!
    description: String
    proof: String
    createdAt: DateTime!
  }

  type Location {
    latitude: Float!
    longitude: Float!
    address: String
    timestamp: DateTime!
  }

  type Payment {
    id: ID!
    reskflow: Delivery!
    amount: Float!
    currency: String!
    method: String!
    status: PaymentStatus!
    transactionId: String
    blockchainTxHash: String
    processedAt: DateTime
    createdAt: DateTime!
  }

  type AuthPayload {
    token: String!
    refreshToken: String!
    user: User!
  }

  type DeliveryConnection {
    edges: [DeliveryEdge!]!
    pageInfo: PageInfo!
    totalCount: Int!
  }

  type DeliveryEdge {
    node: Delivery!
    cursor: String!
  }

  type PageInfo {
    hasNextPage: Boolean!
    hasPreviousPage: Boolean!
    startCursor: String
    endCursor: String
  }

  # Base types for new features
  type Order {
    id: ID!
    customerId: ID!
    customer: User!
    merchantId: ID!
    merchant: Merchant!
    items: [OrderItem!]!
    totalAmount: Float!
    status: String!
    createdAt: DateTime!
  }

  type OrderItem {
    id: ID!
    menuItemId: ID!
    name: String!
    quantity: Int!
    price: Float!
  }

  type Merchant {
    id: ID!
    name: String!
    description: String
    logo: String
    address: Address!
    rating: Float!
    isActive: Boolean!
  }

  type Driver {
    id: ID!
    user: User!
    vehicle: Vehicle!
    isOnline: Boolean!
    currentLocation: Location
  }

  type Vehicle {
    id: ID!
    type: VehicleType!
    make: String!
    model: String!
    year: Int!
    licensePlate: String!
  }

  type MenuItem {
    id: ID!
    merchantId: ID!
    name: String!
    description: String
    price: Float!
    category: String!
    isAvailable: Boolean!
  }

  type Menu {
    id: ID!
    merchantId: ID!
    name: String!
    items: [MenuItem!]!
  }

  type CartItem {
    menuItem: MenuItem!
    quantity: Int!
    customizations: [String!]
  }

  input CartItemInput {
    menuItemId: ID!
    quantity: Int!
    customizations: [String!]
  }

  input AddressInput {
    label: String!
    street: String!
    city: String!
    state: String!
    country: String!
    postalCode: String!
    latitude: Float!
    longitude: Float!
  }

  type OperatingHours {
    dayOfWeek: Int!
    openTime: String!
    closeTime: String!
  }

  input OperatingHoursInput {
    dayOfWeek: Int!
    openTime: String!
    closeTime: String!
  }

  input NutritionInfoInput {
    calories: Int
    protein: Float
    carbs: Float
    fat: Float
    sodium: Float
    sugar: Float
    fiber: Float
  }

  type DeliveryStats {
    totalDeliveries: Int!
    completedDeliveries: Int!
    averageDeliveryTime: Float!
    totalRevenue: Float!
    activeDrivers: Int!
  }

  type RouteOptimization {
    optimizedRoute: [RouteStep!]!
    totalDistance: Float!
    totalDuration: Int!
    estimatedCost: Float!
  }

  type RouteStep {
    reskflowId: ID!
    sequence: Int!
    estimatedArrival: DateTime!
    distance: Float!
    duration: Int!
  }

  input CreateUserInput {
    email: String!
    phone: String
    password: String!
    firstName: String!
    lastName: String!
    role: UserRole!
    walletAddress: String
  }

  input UpdateUserInput {
    firstName: String
    lastName: String
    phone: String
    walletAddress: String
  }

  input CreateAddressInput {
    label: String!
    street: String!
    city: String!
    state: String!
    country: String!
    postalCode: String!
    latitude: Float!
    longitude: Float!
    isDefault: Boolean
  }

  input CreateDeliveryInput {
    recipientEmail: String
    recipientPhone: String
    pickupAddressId: ID!
    reskflowAddressId: ID!
    packageDetails: JSON!
    scheduledPickup: DateTime
    scheduledDelivery: DateTime
    priority: Int
    insuranceAmount: Float
  }

  input UpdateDeliveryStatusInput {
    reskflowId: ID!
    status: DeliveryStatus!
    location: JSON
    proof: String
  }

  input RouteOptimizationInput {
    driverId: ID!
    reskflowIds: [ID!]!
    startLocation: JSON!
    endLocation: JSON
  }

  type Query {
    # User queries
    me: User
    user(id: ID!): User
    users(role: UserRole, page: Int, limit: Int): [User!]!

    # Delivery queries
    reskflow(id: ID!): Delivery
    reskflowByTracking(trackingNumber: String!): Delivery
    deliveries(
      status: DeliveryStatus
      driverId: ID
      senderId: ID
      first: Int
      after: String
      last: Int
      before: String
    ): DeliveryConnection!
    
    # Stats queries
    reskflowStats(startDate: DateTime, endDate: DateTime): DeliveryStats!
    driverStats(driverId: ID!): JSON!
    
    # Route optimization
    optimizeRoute(input: RouteOptimizationInput!): RouteOptimization!
    
    # Address queries
    myAddresses: [Address!]!
    nearbyDrivers(latitude: Float!, longitude: Float!, radius: Float!): [User!]!
  }

  type Mutation {
    # Auth mutations
    signup(input: CreateUserInput!): AuthPayload!
    login(email: String!, password: String!): AuthPayload!
    refreshToken(refreshToken: String!): AuthPayload!
    logout: Boolean!
    
    # User mutations
    updateProfile(input: UpdateUserInput!): User!
    verifyEmail(token: String!): Boolean!
    verifyPhone(code: String!): Boolean!
    
    # Address mutations
    createAddress(input: CreateAddressInput!): Address!
    updateAddress(id: ID!, input: CreateAddressInput!): Address!
    deleteAddress(id: ID!): Boolean!
    
    # Delivery mutations
    createDelivery(input: CreateDeliveryInput!): Delivery!
    assignDriver(reskflowId: ID!, driverId: ID!): Delivery!
    updateDeliveryStatus(input: UpdateDeliveryStatusInput!): Delivery!
    cancelDelivery(id: ID!, reason: String!): Delivery!
    
    # Payment mutations
    createPayment(reskflowId: ID!, amount: Float!, method: String!): Payment!
    confirmPayment(paymentId: ID!, transactionId: String!): Payment!
    
    # Rating mutations
    rateDelivery(reskflowId: ID!, rating: Int!, comment: String): Boolean!
  }

  type Subscription {
    # Delivery tracking
    reskflowUpdated(reskflowId: ID!): Delivery!
    locationUpdated(reskflowId: ID!): Location!
    
    # Driver tracking
    driverLocation(driverId: ID!): Location!
    
    # Notifications
    notification(userId: ID!): JSON!
  }
`;

// Combine all type definitions
export const typeDefs = [
  baseTypeDefs,
  customerTypeDefs,
  driverTypeDefs,
  merchantTypeDefs,
  adminTypeDefs
];