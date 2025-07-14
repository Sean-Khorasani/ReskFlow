/**
 * Driver-related GraphQL Type Definitions
 */

import { gql } from 'apollo-server-express';

export const driverTypeDefs = gql`
  # Earnings Types
  type DriverEarnings {
    driverId: ID!
    period: EarningsPeriod!
    baseEarnings: Float!
    tips: Float!
    incentives: Float!
    totalEarnings: Float!
    completedDeliveries: Int!
    averagePerDelivery: Float!
    breakdown: [EarningsBreakdown!]!
  }

  type EarningsPeriod {
    start: DateTime!
    end: DateTime!
    type: PeriodType!
  }

  enum PeriodType {
    DAILY
    WEEKLY
    MONTHLY
    CUSTOM
  }

  type EarningsBreakdown {
    date: DateTime!
    deliveries: Int!
    base: Float!
    tips: Float!
    incentives: Float!
    total: Float!
  }

  type DriverIncentive {
    id: ID!
    name: String!
    description: String!
    type: IncentiveType!
    target: Float!
    reward: Float!
    progress: Float!
    status: IncentiveStatus!
    expiresAt: DateTime!
  }

  enum IncentiveType {
    DELIVERY_COUNT
    PEAK_HOURS
    WEATHER_BONUS
    STREAK_BONUS
    REFERRAL
    PERFECT_RATING
  }

  enum IncentiveStatus {
    AVAILABLE
    IN_PROGRESS
    COMPLETED
    EXPIRED
    CLAIMED
  }

  type EarningsGoal {
    id: ID!
    driverId: ID!
    amount: Float!
    period: EarningsPeriod!
    progress: Float!
    projectedEarnings: Float!
    requiredDeliveries: Int!
    status: GoalStatus!
  }

  enum GoalStatus {
    ON_TRACK
    BEHIND
    AHEAD
    COMPLETED
    FAILED
  }

  # Route Optimization Types
  type OptimizedRoute {
    driverId: ID!
    deliveries: [RouteDelivery!]!
    totalDistance: Float!
    estimatedTime: Int!
    algorithm: OptimizationAlgorithm!
    savings: RouteSavings!
    polyline: String!
  }

  type RouteDelivery {
    reskflowId: ID!
    order: Int!
    address: Address!
    estimatedArrival: DateTime!
    estimatedDeparture: DateTime!
    distance: Float!
    priority: DeliveryPriority!
  }

  enum OptimizationAlgorithm {
    BRUTE_FORCE
    GENETIC
    NEAREST_NEIGHBOR
    TWO_OPT
  }

  enum DeliveryPriority {
    LOW
    NORMAL
    HIGH
    URGENT
  }

  type RouteSavings {
    distanceSaved: Float!
    timeSaved: Int!
    fuelSaved: Float!
  }

  type AlternativeRoute {
    id: ID!
    reason: String!
    additionalDistance: Float!
    additionalTime: Int!
    polyline: String!
  }

  # Shift Scheduling Types
  type DriverShift {
    id: ID!
    driverId: ID!
    date: DateTime!
    startTime: DateTime!
    endTime: DateTime!
    zone: String!
    status: ShiftStatus!
    actualStart: DateTime
    actualEnd: DateTime
    breaks: [ShiftBreak!]!
    earnings: Float
  }

  type ShiftBreak {
    startTime: DateTime!
    endTime: DateTime!
    type: BreakType!
  }

  enum ShiftStatus {
    SCHEDULED
    IN_PROGRESS
    COMPLETED
    CANCELLED
    NO_SHOW
  }

  enum BreakType {
    SHORT
    MEAL
    EMERGENCY
  }

  type ShiftSwapRequest {
    id: ID!
    requesterId: ID!
    shiftId: ID!
    reason: String!
    status: SwapStatus!
    responderId: ID
    createdAt: DateTime!
    respondedAt: DateTime
  }

  enum SwapStatus {
    PENDING
    ACCEPTED
    REJECTED
    CANCELLED
    EXPIRED
  }

  # Vehicle Inspection Types
  type VehicleInspection {
    id: ID!
    driverId: ID!
    vehicleId: ID!
    type: InspectionType!
    status: InspectionStatus!
    checklist: [InspectionItem!]!
    issues: [VehicleIssue!]!
    photos: [InspectionPhoto!]!
    completedAt: DateTime
    nextDue: DateTime!
  }

  type InspectionItem {
    category: String!
    item: String!
    status: ItemStatus!
    notes: String
  }

  type VehicleIssue {
    id: ID!
    severity: IssueSeverity!
    description: String!
    reportedAt: DateTime!
    resolvedAt: DateTime
    resolution: String
  }

  type InspectionPhoto {
    id: ID!
    url: String!
    category: String!
    timestamp: DateTime!
  }

  enum InspectionType {
    PRE_TRIP
    POST_TRIP
    WEEKLY
    MONTHLY
  }

  enum InspectionStatus {
    PENDING
    IN_PROGRESS
    COMPLETED
    FAILED
    OVERDUE
  }

  enum ItemStatus {
    PASS
    FAIL
    NOT_APPLICABLE
  }

  enum IssueSeverity {
    MINOR
    MODERATE
    CRITICAL
  }

  # Emergency SOS Types
  type SOSIncident {
    id: ID!
    driverId: ID!
    type: IncidentType!
    location: Location!
    status: IncidentStatus!
    reskflowId: ID
    reportedAt: DateTime!
    resolvedAt: DateTime
    responders: [EmergencyResponder!]!
    updates: [IncidentUpdate!]!
  }

  type EmergencyResponder {
    type: ResponderType!
    name: String!
    eta: Int
    arrivedAt: DateTime
  }

  type IncidentUpdate {
    timestamp: DateTime!
    message: String!
    updatedBy: String!
  }

  enum IncidentType {
    ACCIDENT
    MEDICAL
    THREAT
    VEHICLE_ISSUE
    OTHER
  }

  enum IncidentStatus {
    ACTIVE
    RESPONDING
    RESOLVED
    CANCELLED
  }

  enum ResponderType {
    POLICE
    MEDICAL
    PLATFORM_SUPPORT
    EMERGENCY_CONTACT
  }

  # Queries
  extend type Query {
    # Earnings
    getDriverEarnings(driverId: ID!, period: EarningsPeriodInput!): DriverEarnings!
    getActiveIncentives(driverId: ID!): [DriverIncentive!]!
    getEarningsGoal(driverId: ID!): EarningsGoal
    
    # Routes
    optimizeRoute(driverId: ID!, reskflowIds: [ID!]!): OptimizedRoute!
    getCurrentRoute(driverId: ID!): OptimizedRoute
    getAlternativeRoutes(driverId: ID!): [AlternativeRoute!]!
    
    # Shifts
    getDriverSchedule(driverId: ID!, startDate: DateTime!, endDate: DateTime!): [DriverShift!]!
    getAvailableShifts(zone: String!, date: DateTime!): [DriverShift!]!
    getShiftSwapRequests(driverId: ID!): [ShiftSwapRequest!]!
    
    # Vehicle
    getInspectionChecklists(type: InspectionType!): [InspectionItem!]!
    getVehicleInspections(driverId: ID!): [VehicleInspection!]!
    getPendingInspections(driverId: ID!): [VehicleInspection!]!
    
    # Emergency
    getEmergencyContacts(driverId: ID!): [EmergencyContact!]!
    getActiveIncident(driverId: ID!): SOSIncident
    getIncidentHistory(driverId: ID!): [SOSIncident!]!
  }

  # Mutations
  extend type Mutation {
    # Earnings
    setEarningsGoal(driverId: ID!, amount: Float!, period: EarningsPeriodInput!): EarningsGoal!
    claimIncentive(driverId: ID!, incentiveId: ID!): DriverIncentive!
    
    # Routes
    acceptRoute(driverId: ID!, routeId: ID!): OptimizedRoute!
    updateDeliveryOrder(driverId: ID!, reskflowIds: [ID!]!): OptimizedRoute!
    reportTrafficIssue(driverId: ID!, location: LocationInput!, severity: String!): Boolean!
    
    # Shifts
    requestShift(driverId: ID!, date: DateTime!, startTime: DateTime!, endTime: DateTime!, zone: String!): DriverShift!
    clockIn(shiftId: ID!): DriverShift!
    clockOut(shiftId: ID!): DriverShift!
    startBreak(shiftId: ID!, type: BreakType!): DriverShift!
    endBreak(shiftId: ID!): DriverShift!
    requestShiftSwap(shiftId: ID!, reason: String!): ShiftSwapRequest!
    respondToSwapRequest(requestId: ID!, accept: Boolean!): ShiftSwapRequest!
    
    # Vehicle
    submitInspection(input: VehicleInspectionInput!): VehicleInspection!
    reportVehicleIssue(driverId: ID!, vehicleId: ID!, issue: VehicleIssueInput!): VehicleIssue!
    uploadInspectionPhoto(inspectionId: ID!, photo: Upload!, category: String!): InspectionPhoto!
    
    # Emergency
    triggerSOS(driverId: ID!, type: IncidentType!, location: LocationInput!, description: String): SOSIncident!
    updateSOSStatus(incidentId: ID!, status: IncidentStatus!, message: String!): SOSIncident!
    checkIn(driverId: ID!, location: LocationInput!): Boolean!
    updateEmergencyContacts(driverId: ID!, contacts: [EmergencyContactInput!]!): [EmergencyContact!]!
  }

  # Subscriptions
  extend type Subscription {
    # Earnings
    earningsUpdated(driverId: ID!): DriverEarnings!
    incentiveProgress(driverId: ID!): DriverIncentive!
    
    # Routes
    routeUpdated(driverId: ID!): OptimizedRoute!
    trafficAlert(driverId: ID!): TrafficAlert!
    
    # Shifts
    shiftReminder(driverId: ID!): DriverShift!
    swapRequestReceived(driverId: ID!): ShiftSwapRequest!
    
    # Emergency
    sosIncidentUpdate(incidentId: ID!): SOSIncident!
  }

  # Input Types
  input EarningsPeriodInput {
    start: DateTime!
    end: DateTime!
    type: PeriodType!
  }

  input VehicleInspectionInput {
    driverId: ID!
    vehicleId: ID!
    type: InspectionType!
    checklist: [InspectionItemInput!]!
    issues: [VehicleIssueInput!]
  }

  input InspectionItemInput {
    category: String!
    item: String!
    status: ItemStatus!
    notes: String
  }

  input VehicleIssueInput {
    severity: IssueSeverity!
    description: String!
    photos: [String!]
  }

  input EmergencyContactInput {
    name: String!
    phone: String!
    relationship: String!
    priority: Int!
  }

  # Supporting Types
  type EmergencyContact {
    id: ID!
    name: String!
    phone: String!
    relationship: String!
    priority: Int!
  }

  type TrafficAlert {
    id: ID!
    location: Location!
    severity: String!
    description: String!
    estimatedDelay: Int!
    alternativeRoute: String
  }
`;