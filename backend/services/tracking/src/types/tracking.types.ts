export interface Location {
  latitude: number;
  longitude: number;
  accuracy?: number;
  altitude?: number;
  speed?: number;
  heading?: number;
  address?: string;
  city?: string;
  country?: string;
  timestamp?: Date;
}

export interface TrackingSessionData {
  id?: string;
  orderId: string;
  driverId: string;
  customerId: string;
  merchantId: string;
  sessionType: TrackingType;
  status: TrackingStatus;
  startLocation?: Location;
  currentLocation?: Location;
  endLocation?: Location;
  plannedRoute?: Waypoint[];
  actualRoute?: LocationPoint[];
  estimatedArrival?: Date;
  actualArrival?: Date;
  startedAt?: Date;
  completedAt?: Date;
  metadata?: Record<string, any>;
}

export interface LocationPoint {
  latitude: number;
  longitude: number;
  timestamp: Date;
  accuracy?: number;
  speed?: number;
  heading?: number;
}

export interface Waypoint {
  id: string;
  latitude: number;
  longitude: number;
  address: string;
  type: WaypointType;
  estimatedArrival?: Date;
  actualArrival?: Date;
  completed: boolean;
  metadata?: Record<string, any>;
}

export interface TrackingEventData {
  sessionId: string;
  eventType: EventType;
  eventData: Record<string, any>;
  location?: Location;
  source: EventSource;
  metadata?: Record<string, any>;
}

export interface GeofenceZoneData {
  name: string;
  description?: string;
  zoneType: ZoneType;
  coordinates: any; // Polygon coordinates or center point
  radius?: number;
  isActive: boolean;
  triggerEvents: GeofenceEventType[];
  merchantId?: string;
  areaId?: string;
  metadata?: Record<string, any>;
}

export interface RouteOptimizationRequest {
  driverId: string;
  waypoints: Waypoint[];
  optimizationType: OptimizationType;
  plannedStartTime: Date;
  constraints?: RouteConstraints;
  preferences?: RoutePreferences;
}

export interface RouteConstraints {
  maxDistance?: number;
  maxTime?: number;
  vehicleType?: VehicleType;
  trafficRestrictions?: TrafficRestriction[];
  timeWindows?: TimeWindow[];
}

export interface RoutePreferences {
  avoidTolls?: boolean;
  avoidHighways?: boolean;
  preferFastest?: boolean;
  considerTraffic?: boolean;
  prioritizeDeliveries?: boolean;
}

export interface TimeWindow {
  waypointId: string;
  startTime: Date;
  endTime: Date;
  priority: WindowPriority;
}

export interface TrafficRestriction {
  zoneId: string;
  vehicleTypes: VehicleType[];
  timeRanges: TimeRange[];
}

export interface TimeRange {
  startTime: string; // HH:MM format
  endTime: string;
  days: DayOfWeek[];
}

export interface OptimizedRoute {
  waypoints: Waypoint[];
  totalDistance: number;
  estimatedTime: number;
  fuelEstimate?: number;
  routeInstructions: RouteInstruction[];
  alternativeRoutes?: AlternativeRoute[];
}

export interface RouteInstruction {
  stepNumber: number;
  instruction: string;
  distance: number;
  duration: number;
  location: Location;
  maneuver: ManeuverType;
}

export interface AlternativeRoute {
  name: string;
  totalDistance: number;
  estimatedTime: number;
  savings: RouteSavings;
  waypoints: Waypoint[];
}

export interface RouteSavings {
  timeSaved: number; // in minutes
  distanceSaved: number; // in km
  fuelSaved?: number;
  costSaved?: number;
}

export interface TrackingMetricsData {
  sessionId?: string;
  driverId?: string;
  totalDistance: number;
  totalTime: number;
  averageSpeed: number;
  maxSpeed: number;
  routeEfficiency?: number;
  timeEfficiency?: number;
  gpsAccuracy?: number;
  dataCompleteness?: number;
  startDate: Date;
  endDate: Date;
  metadata?: Record<string, any>;
}

export interface RealTimeUpdate {
  sessionId: string;
  type: UpdateType;
  data: any;
  timestamp: Date;
  recipients: string[]; // User IDs to notify
}

export interface LocationUpdateRequest {
  sessionId: string;
  location: Location;
  batteryLevel?: number;
  networkType?: string;
}

export interface TrackingSubscription {
  userId: string;
  sessionId: string;
  subscriptionType: SubscriptionType;
  filters?: SubscriptionFilter[];
  webhookUrl?: string;
  isActive: boolean;
}

export interface SubscriptionFilter {
  eventType: EventType;
  conditions?: Record<string, any>;
}

export interface GeofenceEventData {
  zoneId: string;
  sessionId?: string;
  driverId: string;
  eventType: GeofenceEventType;
  location: Location;
  enteredAt?: Date;
  exitedAt?: Date;
  dwellTime?: number;
  metadata?: Record<string, any>;
}

export interface TrackingAnalytics {
  periodStart: Date;
  periodEnd: Date;
  totalSessions: number;
  completedSessions: number;
  avgDeliveryTime: number;
  avgDistance: number;
  routeEfficiency: number;
  customerSatisfaction?: number;
  incidents: IncidentSummary[];
  hotspots: LocationHotspot[];
}

export interface IncidentSummary {
  type: IncidentType;
  count: number;
  avgResolutionTime?: number;
  locations: Location[];
}

export interface LocationHotspot {
  location: Location;
  frequency: number;
  avgDwellTime: number;
  issueCount: number;
}

// Enums
export enum TrackingType {
  DELIVERY = 'DELIVERY',
  PICKUP = 'PICKUP',
  ROUND_TRIP = 'ROUND_TRIP',
  MULTI_STOP = 'MULTI_STOP'
}

export enum TrackingStatus {
  PENDING = 'PENDING',
  ACTIVE = 'ACTIVE',
  PAUSED = 'PAUSED',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
  FAILED = 'FAILED'
}

export enum EventType {
  SESSION_STARTED = 'SESSION_STARTED',
  SESSION_PAUSED = 'SESSION_PAUSED',
  SESSION_RESUMED = 'SESSION_RESUMED',
  SESSION_COMPLETED = 'SESSION_COMPLETED',
  LOCATION_UPDATED = 'LOCATION_UPDATED',
  ROUTE_DEVIATED = 'ROUTE_DEVIATED',
  GEOFENCE_ENTERED = 'GEOFENCE_ENTERED',
  GEOFENCE_EXITED = 'GEOFENCE_EXITED',
  DELIVERY_STARTED = 'DELIVERY_STARTED',
  DELIVERY_COMPLETED = 'DELIVERY_COMPLETED',
  PICKUP_STARTED = 'PICKUP_STARTED',
  PICKUP_COMPLETED = 'PICKUP_COMPLETED',
  EMERGENCY_TRIGGERED = 'EMERGENCY_TRIGGERED',
  BREAK_STARTED = 'BREAK_STARTED',
  BREAK_ENDED = 'BREAK_ENDED',
  TRAFFIC_DELAY = 'TRAFFIC_DELAY',
  VEHICLE_BREAKDOWN = 'VEHICLE_BREAKDOWN',
  CUSTOMER_CONTACT = 'CUSTOMER_CONTACT'
}

export enum EventSource {
  MOBILE_APP = 'MOBILE_APP',
  WEB_APP = 'WEB_APP',
  SYSTEM = 'SYSTEM',
  DRIVER_APP = 'DRIVER_APP',
  IOT_DEVICE = 'IOT_DEVICE',
  API = 'API'
}

export enum WaypointType {
  PICKUP = 'PICKUP',
  DELIVERY = 'DELIVERY',
  WAYPOINT = 'WAYPOINT',
  BREAK = 'BREAK',
  FUEL_STOP = 'FUEL_STOP'
}

export enum ZoneType {
  CIRCULAR = 'CIRCULAR',
  POLYGON = 'POLYGON',
  RECTANGLE = 'RECTANGLE',
  MERCHANT_LOCATION = 'MERCHANT_LOCATION',
  DELIVERY_AREA = 'DELIVERY_AREA',
  RESTRICTED_ZONE = 'RESTRICTED_ZONE',
  PARKING_AREA = 'PARKING_AREA'
}

export enum GeofenceEventType {
  ENTERED = 'ENTERED',
  EXITED = 'EXITED',
  DWELLING = 'DWELLING'
}

export enum OptimizationType {
  SHORTEST_DISTANCE = 'SHORTEST_DISTANCE',
  FASTEST_TIME = 'FASTEST_TIME',
  FUEL_EFFICIENT = 'FUEL_EFFICIENT',
  TRAFFIC_AWARE = 'TRAFFIC_AWARE',
  MULTI_OBJECTIVE = 'MULTI_OBJECTIVE'
}

export enum RouteStatus {
  PLANNING = 'PLANNING',
  OPTIMIZED = 'OPTIMIZED',
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED'
}

export enum VehicleType {
  CAR = 'CAR',
  MOTORCYCLE = 'MOTORCYCLE',
  BICYCLE = 'BICYCLE',
  TRUCK = 'TRUCK',
  VAN = 'VAN',
  SCOOTER = 'SCOOTER'
}

export enum WindowPriority {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
  CRITICAL = 'CRITICAL'
}

export enum DayOfWeek {
  MONDAY = 'MONDAY',
  TUESDAY = 'TUESDAY',
  WEDNESDAY = 'WEDNESDAY',
  THURSDAY = 'THURSDAY',
  FRIDAY = 'FRIDAY',
  SATURDAY = 'SATURDAY',
  SUNDAY = 'SUNDAY'
}

export enum ManeuverType {
  STRAIGHT = 'STRAIGHT',
  SLIGHT_LEFT = 'SLIGHT_LEFT',
  LEFT = 'LEFT',
  SHARP_LEFT = 'SHARP_LEFT',
  SLIGHT_RIGHT = 'SLIGHT_RIGHT',
  RIGHT = 'RIGHT',
  SHARP_RIGHT = 'SHARP_RIGHT',
  U_TURN = 'U_TURN',
  ROUNDABOUT = 'ROUNDABOUT',
  EXIT_ROUNDABOUT = 'EXIT_ROUNDABOUT'
}

export enum UpdateType {
  LOCATION_UPDATE = 'LOCATION_UPDATE',
  STATUS_CHANGE = 'STATUS_CHANGE',
  EVENT_TRIGGERED = 'EVENT_TRIGGERED',
  ROUTE_UPDATE = 'ROUTE_UPDATE',
  ETA_UPDATE = 'ETA_UPDATE'
}

export enum SubscriptionType {
  ALL_EVENTS = 'ALL_EVENTS',
  LOCATION_ONLY = 'LOCATION_ONLY',
  STATUS_ONLY = 'STATUS_ONLY',
  EMERGENCY_ONLY = 'EMERGENCY_ONLY',
  CUSTOM = 'CUSTOM'
}

export enum IncidentType {
  ROUTE_DEVIATION = 'ROUTE_DEVIATION',
  TRAFFIC_DELAY = 'TRAFFIC_DELAY',
  VEHICLE_BREAKDOWN = 'VEHICLE_BREAKDOWN',
  EMERGENCY = 'EMERGENCY',
  CUSTOMER_COMPLAINT = 'CUSTOMER_COMPLAINT',
  GPS_LOSS = 'GPS_LOSS'
}