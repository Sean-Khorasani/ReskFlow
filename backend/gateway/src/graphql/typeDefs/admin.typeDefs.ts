/**
 * Admin-related GraphQL Type Definitions
 */

import { gql } from 'apollo-server-express';

export const adminTypeDefs = gql`
  # Fraud Detection Types
  type FraudRule {
    id: ID!
    name: String!
    description: String!
    category: FraudCategory!
    type: FraudRuleType!
    status: RuleStatus!
    conditions: [RuleCondition!]!
    actions: [RuleAction!]!
    riskScore: Int!
    priority: Priority!
    stats: RuleStats
  }

  enum FraudCategory {
    PAYMENT
    ACCOUNT
    ORDER
    PROMO
    DELIVERY
    REVIEW
  }

  enum FraudRuleType {
    THRESHOLD
    PATTERN
    ANOMALY
    VELOCITY
    GEOLOCATION
  }

  enum RuleStatus {
    ACTIVE
    INACTIVE
    TESTING
  }

  type RuleCondition {
    field: String!
    operator: ConditionOperator!
    value: String!
    timeWindow: Int
    aggregation: AggregationType
  }

  enum ConditionOperator {
    EQUALS
    NOT_EQUALS
    GREATER_THAN
    LESS_THAN
    CONTAINS
    IN
    NOT_IN
    MATCHES_PATTERN
  }

  enum AggregationType {
    COUNT
    SUM
    AVG
    MAX
    MIN
  }

  type RuleAction {
    type: ActionType!
    target: ActionTarget!
    parameters: String
  }

  enum ActionType {
    FLAG
    BLOCK
    REVIEW
    NOTIFY
    LIMIT
    CHALLENGE
    SUSPEND
  }

  enum ActionTarget {
    TRANSACTION
    USER
    MERCHANT
    DRIVER
    ORDER
  }

  type RuleStats {
    totalTriggers: Int!
    falsePositiveRate: Float!
    truePositiveRate: Float!
    lastTriggered: DateTime
  }

  type FraudIncident {
    id: ID!
    type: FraudCategory!
    severity: Severity!
    status: IncidentStatus!
    entityType: EntityType!
    entityId: ID!
    ruleIds: [ID!]!
    riskScore: Int!
    evidence: [Evidence!]!
    timeline: [TimelineEvent!]!
    assignedTo: User
    resolution: Resolution
    detectedAt: DateTime!
  }

  enum Severity {
    LOW
    MEDIUM
    HIGH
    CRITICAL
  }

  enum IncidentStatus {
    DETECTED
    INVESTIGATING
    CONFIRMED
    FALSE_POSITIVE
    RESOLVED
  }

  enum EntityType {
    CUSTOMER
    MERCHANT
    DRIVER
    ORDER
    TRANSACTION
  }

  type Evidence {
    type: String!
    description: String!
    data: String!
    timestamp: DateTime!
    source: String!
  }

  type TimelineEvent {
    timestamp: DateTime!
    type: String!
    description: String!
    performedBy: String
    metadata: String
  }

  type Resolution {
    type: ResolutionType!
    amount: Float
    description: String!
    approvedBy: User!
    implementedAt: DateTime
    followUpRequired: Boolean!
    customerSatisfied: Boolean
  }

  enum ResolutionType {
    REFUND_FULL
    REFUND_PARTIAL
    CREDIT
    REPLACEMENT
    APOLOGY
    NO_ACTION
    COMPENSATION
  }

  # Automated Reporting Types
  type ReportDefinition {
    id: ID!
    name: String!
    description: String!
    type: ReportType!
    format: ReportFormat!
    schedule: ReportSchedule!
    recipients: [ReportRecipient!]!
    filters: [ReportFilter!]!
    sections: [ReportSection!]!
    status: ReportStatus!
    lastGenerated: DateTime
    nextScheduled: DateTime
    createdBy: User!
  }

  enum ReportType {
    OPERATIONAL
    FINANCIAL
    PERFORMANCE
    COMPLIANCE
    CUSTOM
  }

  enum ReportFormat {
    PDF
    EXCEL
    CSV
    JSON
  }

  type ReportSchedule {
    frequency: ScheduleFrequency!
    time: String!
    dayOfWeek: Int
    dayOfMonth: Int
    customCron: String
    timezone: String!
  }

  enum ScheduleFrequency {
    DAILY
    WEEKLY
    MONTHLY
    QUARTERLY
    YEARLY
    CUSTOM
  }

  type ReportRecipient {
    id: ID!
    type: RecipientType!
    destination: String!
    role: String
    includeAttachment: Boolean!
    includeLink: Boolean!
  }

  enum RecipientType {
    EMAIL
    WEBHOOK
    DASHBOARD
    S3
  }

  type ReportFilter {
    field: String!
    operator: FilterOperator!
    value: String!
    dynamic: Boolean!
  }

  enum FilterOperator {
    EQUALS
    CONTAINS
    BETWEEN
    IN
    GREATER_THAN
    LESS_THAN
  }

  type ReportSection {
    id: ID!
    title: String!
    type: SectionType!
    dataSource: String!
    query: String
    visualization: VisualizationConfig
    order: Int!
  }

  enum SectionType {
    SUMMARY
    TABLE
    CHART
    TEXT
    METRIC
  }

  type VisualizationConfig {
    chartType: ChartType!
    xAxis: String
    yAxis: String
    series: [String!]
    colors: [String!]
    showLegend: Boolean!
    showGrid: Boolean!
  }

  enum ChartType {
    BAR
    LINE
    PIE
    AREA
    SCATTER
  }

  type GeneratedReport {
    id: ID!
    definition: ReportDefinition!
    generatedAt: DateTime!
    generatedBy: String!
    fileUrl: String
    fileName: String!
    fileSize: Int!
    format: ReportFormat!
    status: GenerationStatus!
    error: String
    metrics: ReportMetrics!
    reskflowStatus: [DeliveryStatus!]!
  }

  enum GenerationStatus {
    GENERATING
    COMPLETED
    FAILED
    DELIVERED
  }

  type ReportMetrics {
    generationTime: Int!
    dataPoints: Int!
    recipients: Int!
  }

  type DeliveryStatus {
    recipient: ReportRecipient!
    status: DeliveryResult!
    deliveredAt: DateTime
    error: String
  }

  enum DeliveryResult {
    PENDING
    SENT
    FAILED
    BOUNCED
  }

  # Dispute Resolution Types
  type Dispute {
    id: ID!
    type: DisputeType!
    status: DisputeStatus!
    priority: Priority!
    order: Order
    customer: User!
    merchant: Merchant
    driver: Driver
    amount: Float
    description: String!
    evidence: [DisputeEvidence!]!
    timeline: [DisputeEvent!]!
    resolution: DisputeResolution
    assignedTo: User
    escalatedTo: User
    tags: [String!]!
    createdAt: DateTime!
    dueDate: DateTime!
  }

  enum DisputeType {
    ORDER_ISSUE
    PAYMENT_DISPUTE
    SERVICE_COMPLAINT
    DELIVERY_PROBLEM
    QUALITY_ISSUE
    FRAUD_CLAIM
  }

  enum DisputeStatus {
    OPEN
    INVESTIGATING
    PENDING_RESPONSE
    RESOLVED
    ESCALATED
    CLOSED
  }

  enum Priority {
    LOW
    MEDIUM
    HIGH
    URGENT
  }

  type DisputeEvidence {
    id: ID!
    type: EvidenceType!
    description: String!
    url: String
    uploadedBy: User!
    uploadedAt: DateTime!
    verified: Boolean!
  }

  enum EvidenceType {
    TEXT
    IMAGE
    VIDEO
    DOCUMENT
    SCREENSHOT
    RECEIPT
  }

  type DisputeEvent {
    id: ID!
    timestamp: DateTime!
    type: EventType!
    description: String!
    performedBy: User
    metadata: String
  }

  enum EventType {
    CREATED
    UPDATED
    MESSAGE
    EVIDENCE_ADDED
    STATUS_CHANGED
    ASSIGNED
    ESCALATED
    RESOLVED
  }

  type DisputeResolution {
    type: ResolutionType!
    amount: Float
    description: String!
    approvedBy: User!
    implementedAt: DateTime
    followUpRequired: Boolean!
    customerSatisfied: Boolean
  }

  # Platform Health Types
  type HealthCheck {
    id: ID!
    name: String!
    type: HealthCheckType!
    endpoint: String
    interval: Int!
    timeout: Int!
    retries: Int!
    status: HealthStatus!
    lastCheck: DateTime!
    lastSuccess: DateTime
    lastFailure: DateTime
    responseTime: Int
    errorMessage: String
  }

  enum HealthCheckType {
    DATABASE
    CACHE
    API
    SERVICE
    EXTERNAL
    INFRASTRUCTURE
  }

  enum HealthStatus {
    HEALTHY
    DEGRADED
    UNHEALTHY
    UNKNOWN
  }

  type SystemMetrics {
    timestamp: DateTime!
    cpu: CPUMetrics!
    memory: MemoryMetrics!
    disk: DiskMetrics!
    network: NetworkMetrics!
    process: ProcessMetrics!
  }

  type CPUMetrics {
    usage: Float!
    loadAverage: [Float!]!
    cores: Int!
  }

  type MemoryMetrics {
    total: Int!
    used: Int!
    free: Int!
    percentage: Float!
  }

  type DiskMetrics {
    total: Int!
    used: Int!
    free: Int!
    percentage: Float!
  }

  type NetworkMetrics {
    rx: Int!
    tx: Int!
    connections: Int!
  }

  type ProcessMetrics {
    uptime: Int!
    pid: Int!
    memoryUsage: Int!
    handles: Int!
  }

  type ServiceHealth {
    service: String!
    status: ServiceStatus!
    uptime: Float!
    avgResponseTime: Int!
    errorRate: Float!
    throughput: Float!
    activeConnections: Int!
    queueSize: Int
    lastError: ServiceError
  }

  enum ServiceStatus {
    OPERATIONAL
    DEGRADED
    DOWN
  }

  type ServiceError {
    message: String!
    timestamp: DateTime!
    count: Int!
  }

  type PlatformIncident {
    id: ID!
    title: String!
    type: IncidentType!
    severity: Severity!
    status: PlatformIncidentStatus!
    affectedServices: [String!]!
    impact: String!
    startedAt: DateTime!
    identifiedAt: DateTime
    resolvedAt: DateTime
    updates: [IncidentUpdate!]!
    postmortem: String
  }

  enum IncidentType {
    OUTAGE
    DEGRADATION
    MAINTENANCE
    SECURITY
  }

  enum PlatformIncidentStatus {
    INVESTIGATING
    IDENTIFIED
    MONITORING
    RESOLVED
  }

  type IncidentUpdate {
    timestamp: DateTime!
    status: PlatformIncidentStatus!
    message: String!
    updatedBy: User!
  }

  # Dynamic Pricing Types
  type PricingRule {
    id: ID!
    name: String!
    description: String!
    type: PricingRuleType!
    status: RuleStatus!
    priority: Int!
    conditions: [PricingCondition!]!
    actions: [PricingAction!]!
    scope: PricingScope!
    schedule: PricingSchedule
    limits: PricingLimits!
    performance: PricingPerformance!
  }

  enum PricingRuleType {
    SURGE
    DEMAND
    TIME_BASED
    DISTANCE_BASED
    WEATHER
    EVENT
    LOYALTY
    COMPETITIVE
  }

  type PricingCondition {
    type: ConditionType!
    operator: ConditionOperator!
    value: String!
    weight: Float
  }

  enum ConditionType {
    DEMAND
    SUPPLY
    TIME
    WEATHER
    LOCATION
    EVENT
    INVENTORY
    COMPETITION
  }

  type PricingAction {
    type: PricingActionType!
    target: PricingTarget!
    value: Float!
    cap: Float
  }

  enum PricingActionType {
    MULTIPLY
    ADD
    SUBTRACT
    SET
    PERCENTAGE
  }

  enum PricingTarget {
    DELIVERY_FEE
    SERVICE_FEE
    ITEM_PRICE
    TOTAL
  }

  type PricingScope {
    zones: [String!]
    merchants: [String!]
    categories: [String!]
    items: [String!]
    customerSegments: [String!]
  }

  type PricingSchedule {
    startDate: DateTime!
    endDate: DateTime
    recurringPattern: RecurringPattern
  }

  type RecurringPattern {
    frequency: RecurrenceFrequency!
    daysOfWeek: [Int!]
    timeRanges: [TimeRange!]
  }

  type PricingLimits {
    maxMultiplier: Float
    minMultiplier: Float
    maxDailyApplications: Int
    maxCustomerApplications: Int
  }

  type PricingPerformance {
    totalApplications: Int!
    revenueImpact: Float!
    conversionRate: Float!
    customerSatisfaction: Float
  }

  type PriceCalculation {
    basePrice: Float!
    appliedRules: [AppliedRule!]!
    finalPrice: Float!
    savings: Float
    multiplier: Float!
    breakdown: PriceBreakdown!
  }

  type AppliedRule {
    ruleId: ID!
    ruleName: String!
    adjustment: Float!
    reason: String!
  }

  type PriceBreakdown {
    itemsTotal: Float!
    reskflowFee: Float!
    serviceFee: Float!
    tax: Float!
    discount: Float
  }

  # Queries
  extend type Query {
    # Fraud Detection
    getFraudRules(category: FraudCategory, status: RuleStatus): [FraudRule!]!
    getFraudIncidents(status: IncidentStatus, severity: Severity): [FraudIncident!]!
    getRiskProfile(entityType: EntityType!, entityId: ID!): RiskProfile!
    
    # Reporting
    getReportDefinitions(type: ReportType): [ReportDefinition!]!
    getGeneratedReports(definitionId: ID, status: GenerationStatus): [GeneratedReport!]!
    getReportTemplates: [ReportTemplate!]!
    
    # Disputes
    getDisputes(status: DisputeStatus, priority: Priority): [Dispute!]!
    getDispute(id: ID!): Dispute
    getDisputeTemplates(type: DisputeType): [DisputeTemplate!]!
    
    # Platform Health
    getHealthChecks: [HealthCheck!]!
    getSystemMetrics(period: DateRangeInput!): [SystemMetrics!]!
    getServiceHealth(service: String!): ServiceHealth!
    getIncidents(status: PlatformIncidentStatus): [PlatformIncident!]!
    
    # Dynamic Pricing
    getPricingRules(type: PricingRuleType, status: RuleStatus): [PricingRule!]!
    calculatePrice(input: PriceCalculationInput!): PriceCalculation!
    getPricingExperiments: [PricingExperiment!]!
  }

  # Mutations
  extend type Mutation {
    # Fraud Detection
    createFraudRule(input: CreateFraudRuleInput!): FraudRule!
    updateFraudRule(id: ID!, input: UpdateFraudRuleInput!): FraudRule!
    toggleFraudRule(id: ID!, active: Boolean!): FraudRule!
    reviewIncident(id: ID!, decision: ReviewDecision!): FraudIncident!
    
    # Reporting
    createReportDefinition(input: CreateReportInput!): ReportDefinition!
    updateReportDefinition(id: ID!, input: UpdateReportInput!): ReportDefinition!
    generateReport(definitionId: ID!): GeneratedReport!
    scheduleReport(definitionId: ID!, schedule: ReportScheduleInput!): ReportDefinition!
    
    # Disputes
    createDispute(input: CreateDisputeInput!): Dispute!
    updateDispute(id: ID!, input: UpdateDisputeInput!): Dispute!
    assignDispute(id: ID!, userId: ID!): Dispute!
    escalateDispute(id: ID!, reason: String!): Dispute!
    resolveDispute(id: ID!, resolution: ResolutionInput!): Dispute!
    
    # Platform Health
    createHealthCheck(input: CreateHealthCheckInput!): HealthCheck!
    updateHealthCheck(id: ID!, input: UpdateHealthCheckInput!): HealthCheck!
    runHealthCheck(id: ID!): HealthCheck!
    createIncident(input: CreateIncidentInput!): PlatformIncident!
    updateIncident(id: ID!, update: IncidentUpdateInput!): PlatformIncident!
    
    # Dynamic Pricing
    createPricingRule(input: CreatePricingRuleInput!): PricingRule!
    updatePricingRule(id: ID!, input: UpdatePricingRuleInput!): PricingRule!
    activatePricingRule(id: ID!): PricingRule!
    deactivatePricingRule(id: ID!): PricingRule!
    createPricingExperiment(input: CreateExperimentInput!): PricingExperiment!
  }

  # Subscriptions
  extend type Subscription {
    # Fraud Detection
    fraudIncidentDetected: FraudIncident!
    riskScoreUpdated(entityType: EntityType!, entityId: ID!): RiskProfile!
    
    # Reporting
    reportGenerated(definitionId: ID!): GeneratedReport!
    
    # Disputes
    disputeUpdated(id: ID!): Dispute!
    disputeAssigned(userId: ID!): Dispute!
    
    # Platform Health
    healthStatusChanged: HealthCheck!
    systemAlert: SystemAlert!
    incidentUpdate(incidentId: ID!): PlatformIncident!
    
    # Dynamic Pricing
    pricingRuleTriggered: PricingEvent!
  }

  # Supporting Types
  type RiskProfile {
    entityType: EntityType!
    entityId: ID!
    overallRisk: Int!
    factors: [RiskFactor!]!
    history: RiskHistory!
    restrictions: [String!]!
    lastCalculated: DateTime!
  }

  type RiskFactor {
    name: String!
    score: Int!
    weight: Float!
  }

  type RiskHistory {
    totalTransactions: Int!
    flaggedTransactions: Int!
    confirmedFraud: Int!
    falsePositives: Int!
    lastIncident: DateTime
  }

  type ReportTemplate {
    id: ID!
    name: String!
    description: String!
    type: ReportType!
    sections: [ReportSection!]!
    defaultFilters: [ReportFilter!]!
  }

  type DisputeTemplate {
    id: ID!
    name: String!
    type: DisputeType!
    category: String!
    suggestedResolution: Resolution
    requiredEvidence: [String!]!
    automationRules: [AutomationRule!]
    avgResolutionTime: Int!
    satisfactionRate: Float!
  }

  type AutomationRule {
    condition: RuleCondition!
    action: AutomationAction!
  }

  type AutomationAction {
    type: String!
    parameters: String!
  }

  type SystemAlert {
    id: ID!
    type: AlertType!
    severity: Severity!
    message: String!
    affectedServices: [String!]!
    timestamp: DateTime!
  }

  type PricingExperiment {
    id: ID!
    name: String!
    status: ExperimentStatus!
    control: PricingRule!
    variants: [ExperimentVariant!]!
    metrics: ExperimentMetrics!
    startDate: DateTime!
    endDate: DateTime
  }

  type ExperimentVariant {
    id: ID!
    name: String!
    rule: PricingRule!
    trafficPercentage: Int!
  }

  type ExperimentMetrics {
    conversionRate: Float!
    avgOrderValue: Float!
    revenue: Float!
    statisticalSignificance: Float!
  }

  enum ExperimentStatus {
    DRAFT
    RUNNING
    PAUSED
    COMPLETED
    CANCELLED
  }

  type PricingEvent {
    ruleId: ID!
    ruleName: String!
    customerId: ID!
    orderId: ID!
    adjustment: Float!
    timestamp: DateTime!
  }

  # Input Types
  input CreateFraudRuleInput {
    name: String!
    description: String!
    category: FraudCategory!
    type: FraudRuleType!
    conditions: [RuleConditionInput!]!
    actions: [RuleActionInput!]!
    riskScore: Int!
    priority: Priority!
  }

  input UpdateFraudRuleInput {
    name: String
    description: String
    conditions: [RuleConditionInput!]
    actions: [RuleActionInput!]
    riskScore: Int
    priority: Priority
  }

  input RuleConditionInput {
    field: String!
    operator: ConditionOperator!
    value: String!
    timeWindow: Int
    aggregation: AggregationType
  }

  input RuleActionInput {
    type: ActionType!
    target: ActionTarget!
    parameters: String
  }

  input CreateReportInput {
    name: String!
    description: String!
    type: ReportType!
    format: ReportFormat!
    recipients: [ReportRecipientInput!]!
    filters: [ReportFilterInput!]!
    sections: [ReportSectionInput!]!
  }

  input UpdateReportInput {
    name: String
    description: String
    recipients: [ReportRecipientInput!]
    filters: [ReportFilterInput!]
    sections: [ReportSectionInput!]
  }

  input ReportRecipientInput {
    type: RecipientType!
    destination: String!
    role: String
    includeAttachment: Boolean!
    includeLink: Boolean!
  }

  input ReportFilterInput {
    field: String!
    operator: FilterOperator!
    value: String!
    dynamic: Boolean!
  }

  input ReportSectionInput {
    title: String!
    type: SectionType!
    dataSource: String!
    query: String
    visualization: VisualizationConfigInput
    order: Int!
  }

  input VisualizationConfigInput {
    chartType: ChartType!
    xAxis: String
    yAxis: String
    series: [String!]
    colors: [String!]
    showLegend: Boolean!
    showGrid: Boolean!
  }

  input ReportScheduleInput {
    frequency: ScheduleFrequency!
    time: String!
    dayOfWeek: Int
    dayOfMonth: Int
    customCron: String
    timezone: String!
  }

  input CreateDisputeInput {
    type: DisputeType!
    orderId: ID
    customerId: ID!
    merchantId: ID
    driverId: ID
    amount: Float
    description: String!
    priority: Priority!
    tags: [String!]
  }

  input UpdateDisputeInput {
    status: DisputeStatus
    priority: Priority
    description: String
    tags: [String!]
    assignedTo: ID
  }

  input ResolutionInput {
    type: ResolutionType!
    amount: Float
    description: String!
    followUpRequired: Boolean!
  }

  input CreateHealthCheckInput {
    name: String!
    type: HealthCheckType!
    endpoint: String
    interval: Int!
    timeout: Int!
    retries: Int!
  }

  input UpdateHealthCheckInput {
    name: String
    endpoint: String
    interval: Int
    timeout: Int
    retries: Int
  }

  input CreateIncidentInput {
    title: String!
    type: IncidentType!
    severity: Severity!
    affectedServices: [String!]!
    impact: String!
  }

  input IncidentUpdateInput {
    status: PlatformIncidentStatus!
    message: String!
  }

  input CreatePricingRuleInput {
    name: String!
    description: String!
    type: PricingRuleType!
    priority: Int!
    conditions: [PricingConditionInput!]!
    actions: [PricingActionInput!]!
    scope: PricingScopeInput!
    schedule: PricingScheduleInput
    limits: PricingLimitsInput!
  }

  input UpdatePricingRuleInput {
    name: String
    description: String
    priority: Int
    conditions: [PricingConditionInput!]
    actions: [PricingActionInput!]
    scope: PricingScopeInput
    schedule: PricingScheduleInput
    limits: PricingLimitsInput
  }

  input PricingConditionInput {
    type: ConditionType!
    operator: ConditionOperator!
    value: String!
    weight: Float
  }

  input PricingActionInput {
    type: PricingActionType!
    target: PricingTarget!
    value: Float!
    cap: Float
  }

  input PricingScopeInput {
    zones: [String!]
    merchants: [String!]
    categories: [String!]
    items: [String!]
    customerSegments: [String!]
  }

  input PricingScheduleInput {
    startDate: DateTime!
    endDate: DateTime
    recurringPattern: RecurringPatternInput
  }

  input RecurringPatternInput {
    frequency: RecurrenceFrequency!
    daysOfWeek: [Int!]
    timeRanges: [TimeRangeInput!]
  }

  input PricingLimitsInput {
    maxMultiplier: Float
    minMultiplier: Float
    maxDailyApplications: Int
    maxCustomerApplications: Int
  }

  input PriceCalculationInput {
    customerId: ID!
    merchantId: ID!
    items: [OrderItemInput!]!
    reskflowLocation: LocationInput!
    reskflowDistance: Float!
    orderTime: DateTime
  }

  input OrderItemInput {
    id: ID!
    quantity: Int!
    basePrice: Float!
  }

  input CreateExperimentInput {
    name: String!
    controlRuleId: ID!
    variants: [ExperimentVariantInput!]!
    startDate: DateTime!
    endDate: DateTime!
  }

  input ExperimentVariantInput {
    name: String!
    ruleId: ID!
    trafficPercentage: Int!
  }

  enum ReviewDecision {
    CONFIRM_FRAUD
    FALSE_POSITIVE
    NEEDS_INVESTIGATION
  }

  # Common Input Types
  input DateRangeInput {
    start: DateTime!
    end: DateTime!
  }

  input LocationInput {
    lat: Float!
    lng: Float!
  }
`;