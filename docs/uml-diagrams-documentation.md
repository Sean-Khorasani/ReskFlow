# UML Diagrams Documentation

## ReskFlow

### Version 1.0.0
### Last Updated: July 2025

---

## Table of Contents

1. [Overview](#overview)
2. [High-Level Architecture Diagrams](#high-level-architecture-diagrams)
3. [Use Case Diagrams](#use-case-diagrams)
4. [Class Diagrams](#class-diagrams)
5. [Sequence Diagrams](#sequence-diagrams)
6. [Activity Diagrams](#activity-diagrams)
7. [State Machine Diagrams](#state-machine-diagrams)
8. [Component Diagrams](#component-diagrams)
9. [Deployment Diagrams](#deployment-diagrams)
10. [Data Flow Diagrams](#data-flow-diagrams)

---

## Overview

This document provides comprehensive UML diagrams for the ReskFlow. Each diagram is accompanied by detailed descriptions to facilitate understanding of the system architecture, behavior, and interactions.

### Diagram Notation

- **UML 2.5** standard notation
- **PlantUML** syntax for reproducibility
- **Mermaid** diagrams for web rendering
- Color coding for different components

---

## High-Level Architecture Diagrams

### System Context Diagram

```mermaid
graph TB
    subgraph "External Users"
        Customer[Customer]
        Merchant[Merchant]
        Driver[Driver]
        Admin[Administrator]
    end
    
    subgraph "Enterprise ReskFlow"
        Platform[ReskFlow System]
    end
    
    subgraph "External Systems"
        Payment[Payment Gateways]
        Blockchain[Blockchain Networks]
        Maps[Mapping Services]
        Comm[Communication Services]
        Analytics[Analytics Platforms]
    end
    
    Customer -->|Places orders| Platform
    Merchant -->|Manages products| Platform
    Driver -->|Delivers orders| Platform
    Admin -->|Manages platform| Platform
    
    Platform -->|Processes payments| Payment
    Platform -->|Records transactions| Blockchain
    Platform -->|Gets routes| Maps
    Platform -->|Sends notifications| Comm
    Platform -->|Tracks metrics| Analytics
    
    style Platform fill:#f9f,stroke:#333,stroke-width:4px
```

**Description**: This context diagram shows the Enterprise ReskFlow as the central system interacting with four types of users (Customer, Merchant, Driver, Admin) and five categories of external systems. It provides a high-level view of system boundaries and external interfaces.

### Microservices Architecture Overview

```mermaid
graph TB
    subgraph "Client Layer"
        Web[Web App]
        Mobile[Mobile Apps]
        Admin[Admin Portal]
    end
    
    subgraph "API Gateway Layer"
        Gateway[API Gateway<br/>Load Balancing, Auth, Rate Limiting]
    end
    
    subgraph "Service Layer"
        subgraph "Core Services"
            UserSvc[User Service]
            AuthSvc[Auth Service]
            OrderSvc[Order Service]
            PaymentSvc[Payment Service]
        end
        
        subgraph "Delivery Services"
            DeliverySvc[Delivery Service]
            TrackingSvc[Tracking Service]
            DriverSvc[Driver Service]
            RouteSvc[Route Service]
        end
        
        subgraph "Business Services"
            MerchantSvc[Merchant Service]
            CatalogSvc[Catalog Service]
            CartSvc[Cart Service]
            PromoSvc[Promotion Service]
        end
        
        subgraph "Support Services"
            NotificationSvc[Notification Service]
            AnalyticsSvc[Analytics Service]
            ChatSvc[Chat Service]
            SearchSvc[Search Service]
        end
    end
    
    subgraph "Data Layer"
        PG[(PostgreSQL)]
        Mongo[(MongoDB)]
        Redis[(Redis)]
        Elastic[(Elasticsearch)]
    end
    
    subgraph "Infrastructure"
        MQ[Message Queue]
        BC[Blockchain]
        Storage[Object Storage]
    end
    
    Web --> Gateway
    Mobile --> Gateway
    Admin --> Gateway
    
    Gateway --> UserSvc
    Gateway --> AuthSvc
    Gateway --> OrderSvc
    Gateway --> PaymentSvc
    Gateway --> DeliverySvc
    Gateway --> TrackingSvc
    Gateway --> DriverSvc
    Gateway --> RouteSvc
    Gateway --> MerchantSvc
    Gateway --> CatalogSvc
    Gateway --> CartSvc
    Gateway --> PromoSvc
    Gateway --> NotificationSvc
    Gateway --> AnalyticsSvc
    Gateway --> ChatSvc
    Gateway --> SearchSvc
    
    UserSvc --> PG
    OrderSvc --> PG
    PaymentSvc --> PG
    DeliverySvc --> Mongo
    TrackingSvc --> Redis
    SearchSvc --> Elastic
    
    NotificationSvc --> MQ
    PaymentSvc --> BC
    CatalogSvc --> Storage
```

**Description**: This diagram illustrates the microservices architecture with four main service categories: Core, Delivery, Business, and Support services. Each service is independently deployable and communicates through the API Gateway. The data layer shows different database technologies used for different purposes.

---

## Use Case Diagrams

### Customer Use Cases

```mermaid
graph LR
    subgraph "Customer Use Cases"
        Customer((Customer))
        
        UC1[Register/Login]
        UC2[Browse Catalog]
        UC3[Search Products]
        UC4[Add to Cart]
        UC5[Place Order]
        UC6[Track Order]
        UC7[Make Payment]
        UC8[Rate Delivery]
        UC9[Contact Support]
        UC10[Manage Profile]
        
        Customer --> UC1
        Customer --> UC2
        Customer --> UC3
        Customer --> UC4
        Customer --> UC5
        Customer --> UC6
        Customer --> UC7
        Customer --> UC8
        Customer --> UC9
        Customer --> UC10
        
        UC4 -.includes.-> UC2
        UC5 -.includes.-> UC7
        UC6 -.extends.-> UC9
    end
```

**Description**: Customer use cases cover the complete customer journey from registration to order completion. The diagram shows includes relationships (e.g., placing order includes making payment) and extends relationships (e.g., tracking order may extend to contacting support).

### Merchant Use Cases

```mermaid
graph LR
    subgraph "Merchant Use Cases"
        Merchant((Merchant))
        
        MUC1[Register Business]
        MUC2[Manage Catalog]
        MUC3[Set Pricing]
        MUC4[Manage Inventory]
        MUC5[Process Orders]
        MUC6[Update Order Status]
        MUC7[View Analytics]
        MUC8[Manage Promotions]
        MUC9[Withdraw Earnings]
        MUC10[Configure Settings]
        
        Merchant --> MUC1
        Merchant --> MUC2
        Merchant --> MUC3
        Merchant --> MUC4
        Merchant --> MUC5
        Merchant --> MUC6
        Merchant --> MUC7
        Merchant --> MUC8
        Merchant --> MUC9
        Merchant --> MUC10
        
        MUC2 -.includes.-> MUC3
        MUC2 -.includes.-> MUC4
        MUC5 -.includes.-> MUC6
    end
```

**Description**: Merchant use cases focus on business management capabilities including catalog management, order processing, and analytics. The relationships show that managing catalog includes setting pricing and managing inventory.

### Driver Use Cases

```mermaid
graph LR
    subgraph "Driver Use Cases"
        Driver((Driver))
        
        DUC1[Register/Verify]
        DUC2[Set Availability]
        DUC3[Accept Delivery]
        DUC4[Navigate to Pickup]
        DUC5[Confirm Pickup]
        DUC6[Navigate to Delivery]
        DUC7[Complete Delivery]
        DUC8[Upload Proof]
        DUC9[View Earnings]
        DUC10[Withdraw Funds]
        
        Driver --> DUC1
        Driver --> DUC2
        Driver --> DUC3
        Driver --> DUC4
        Driver --> DUC5
        Driver --> DUC6
        Driver --> DUC7
        Driver --> DUC8
        Driver --> DUC9
        Driver --> DUC10
        
        DUC7 -.includes.-> DUC8
        DUC3 -.precedes.-> DUC4
        DUC5 -.precedes.-> DUC6
    end
```

**Description**: Driver use cases cover the reskflow workflow from accepting assignments to completing deliveries. The diagram shows the sequential nature of reskflow operations and includes relationships like completing reskflow includes uploading proof.

---

## Class Diagrams

### Core Domain Model

```mermaid
classDiagram
    class User {
        -String id
        -String email
        -String phone
        -String passwordHash
        -UserRole role
        -UserStatus status
        -DateTime createdAt
        +register()
        +login()
        +updateProfile()
        +resetPassword()
    }
    
    class Order {
        -String id
        -String userId
        -String merchantId
        -OrderStatus status
        -Money total
        -DateTime placedAt
        +create()
        +cancel()
        +updateStatus()
        +calculateTotal()
    }
    
    class Payment {
        -String id
        -String orderId
        -PaymentMethod method
        -PaymentStatus status
        -Money amount
        +process()
        +refund()
        +capture()
        +verify()
    }
    
    class Delivery {
        -String id
        -String orderId
        -String driverId
        -DeliveryStatus status
        -GeoPoint currentLocation
        +assign()
        +track()
        +complete()
        +updateLocation()
    }
    
    class Product {
        -String id
        -String merchantId
        -String name
        -Money price
        -Integer stock
        +create()
        +update()
        +checkAvailability()
        +updateStock()
    }
    
    class Merchant {
        -String id
        -String name
        -MerchantStatus status
        -Location location
        +register()
        +updateCatalog()
        +processOrder()
        +viewAnalytics()
    }
    
    User "1" --> "*" Order : places
    Order "1" --> "1" Payment : requires
    Order "1" --> "1" Delivery : has
    Merchant "1" --> "*" Product : sells
    Order "*" --> "*" Product : contains
    User "1" --> "0..1" Merchant : manages
```

**Description**: This class diagram shows the core domain entities and their relationships. It includes the main business objects (User, Order, Payment, Delivery, Product, Merchant) with their key attributes and methods. The relationships show cardinality and ownership.

### Payment System Classes

```mermaid
classDiagram
    class PaymentService {
        <<interface>>
        +processPayment(PaymentRequest)
        +refundPayment(RefundRequest)
        +getPaymentStatus(paymentId)
    }
    
    class StripePaymentService {
        -StripeClient client
        +processPayment(PaymentRequest)
        +refundPayment(RefundRequest)
        +createPaymentIntent()
        +confirmPayment()
    }
    
    class CryptoPaymentService {
        -Web3Provider provider
        -SmartContract escrow
        +processPayment(PaymentRequest)
        +verifyTransaction()
        +releaseEscrow()
    }
    
    class PaymentRequest {
        +String orderId
        +Money amount
        +PaymentMethod method
        +CustomerInfo customer
    }
    
    class PaymentResponse {
        +String paymentId
        +PaymentStatus status
        +String transactionRef
        +DateTime processedAt
    }
    
    class PaymentMethod {
        <<enumeration>>
        CREDIT_CARD
        DEBIT_CARD
        CRYPTO
        WALLET
        CASH_ON_DELIVERY
    }
    
    PaymentService <|.. StripePaymentService
    PaymentService <|.. CryptoPaymentService
    PaymentService --> PaymentRequest
    PaymentService --> PaymentResponse
    PaymentRequest --> PaymentMethod
```

**Description**: This diagram illustrates the payment system design using the Strategy pattern. The PaymentService interface is implemented by different payment providers (Stripe, Crypto). This allows for easy addition of new payment methods without changing the core system.

### Delivery Tracking System

```mermaid
classDiagram
    class TrackingService {
        -LocationProvider locationProvider
        -NotificationService notifier
        +startTracking(reskflowId)
        +updateLocation(location)
        +getDeliveryStatus(reskflowId)
        +estimateArrival()
    }
    
    class LocationProvider {
        <<interface>>
        +getCurrentLocation()
        +watchPosition(callback)
        +calculateRoute(from, to)
    }
    
    class GPSLocationProvider {
        +getCurrentLocation()
        +watchPosition(callback)
        +getAccuracy()
    }
    
    class DeliveryTracker {
        -String reskflowId
        -Queue~Location~ locationHistory
        -RouteCalculator router
        +recordLocation(location)
        +getRoute()
        +getETA()
    }
    
    class Location {
        +Double latitude
        +Double longitude
        +Double accuracy
        +DateTime timestamp
        +Double speed
        +Double heading
    }
    
    class RouteCalculator {
        +calculateRoute(start, end, waypoints)
        +optimizeRoute(deliveries)
        +getTrafficData()
        +recalculateETA()
    }
    
    TrackingService --> LocationProvider
    TrackingService --> DeliveryTracker
    LocationProvider <|.. GPSLocationProvider
    DeliveryTracker --> Location
    DeliveryTracker --> RouteCalculator
```

**Description**: The reskflow tracking system uses location providers to track deliveries in real-time. The system maintains location history, calculates routes, and provides ETA estimates. The design allows for different location providers (GPS, Network, etc.).

---

## Sequence Diagrams

### Order Placement Flow

```mermaid
sequenceDiagram
    participant C as Customer
    participant UI as Mobile App
    participant GW as API Gateway
    participant OS as Order Service
    participant PS as Payment Service
    participant MS as Merchant Service
    participant NS as Notification Service
    
    C->>UI: Select items & checkout
    UI->>GW: POST /orders
    GW->>GW: Authenticate user
    GW->>OS: Create order
    OS->>MS: Validate merchant & items
    MS-->>OS: Validation response
    
    alt Items available
        OS->>PS: Create payment intent
        PS-->>OS: Payment intent created
        OS-->>GW: Order created response
        GW-->>UI: Show payment screen
        
        UI->>GW: POST /payments/confirm
        GW->>PS: Process payment
        PS->>PS: Charge card
        PS-->>GW: Payment successful
        
        GW->>OS: Update order status
        OS->>MS: Notify merchant
        OS->>NS: Send notifications
        
        par Notify Customer
            NS-->>C: Order confirmed (Push/SMS)
        and Notify Merchant
            NS-->>MS: New order alert
        end
        
    else Items unavailable
        MS-->>OS: Items out of stock
        OS-->>GW: Order failed
        GW-->>UI: Show error
    end
```

**Description**: This sequence diagram shows the complete order placement flow from customer selection to merchant notification. It includes payment processing, validation, and parallel notification sending. The alternative flow handles the case when items are unavailable.

### Delivery Assignment Flow

```mermaid
sequenceDiagram
    participant MS as Merchant Service
    participant DS as Delivery Service
    participant DAS as Driver Assignment Service
    participant D1 as Driver 1
    participant D2 as Driver 2
    participant TS as Tracking Service
    
    MS->>DS: Order ready for pickup
    DS->>DAS: Request driver assignment
    
    DAS->>DAS: Find nearby available drivers
    
    par Check Driver 1
        DAS->>D1: Check availability
        D1-->>DAS: Available
    and Check Driver 2
        DAS->>D2: Check availability
        D2-->>DAS: Busy
    end
    
    DAS->>DAS: Calculate optimal assignment
    DAS->>D1: Assign reskflow
    D1->>D1: Accept assignment
    D1-->>DAS: Assignment accepted
    
    DAS-->>DS: Driver assigned
    DS->>TS: Start tracking
    DS->>MS: Driver assigned notification
    DS->>D1: Send pickup details
    
    loop Every 30 seconds
        D1->>TS: Update location
        TS->>TS: Store location
        TS-->>Customer: Location update
    end
```

**Description**: This diagram illustrates the driver assignment process including availability checking, optimal assignment calculation, and real-time tracking initialization. It shows parallel operations and the continuous location update loop.

### Payment Processing with Blockchain

```mermaid
sequenceDiagram
    participant C as Customer
    participant PS as Payment Service
    participant BC as Blockchain Service
    participant SC as Smart Contract
    participant MS as Merchant Service
    participant WS as Wallet Service
    
    C->>PS: Initiate crypto payment
    PS->>BC: Create transaction
    BC->>WS: Get customer wallet
    WS-->>BC: Wallet details
    
    BC->>SC: Call deposit function
    Note over SC: Escrow contract holds funds
    
    SC->>SC: Emit DepositEvent
    BC-->>PS: Transaction hash
    PS-->>C: Show pending status
    
    loop Check confirmation
        BC->>BC: Check block confirmations
        alt Confirmed (6+ blocks)
            BC->>PS: Payment confirmed
            PS->>MS: Notify payment received
        else Not confirmed
            BC->>BC: Wait for next block
        end
    end
    
    Note over SC: After reskflow completion
    MS->>PS: Release payment
    PS->>BC: Call release function
    BC->>SC: Release escrow
    SC->>WS: Transfer to merchant
    SC->>SC: Emit ReleaseEvent
```

**Description**: This sequence shows cryptocurrency payment processing using smart contracts for escrow. It includes wallet interaction, blockchain confirmation waiting, and escrow release after reskflow completion.

---

## Activity Diagrams

### Customer Order Flow

```mermaid
graph TD
    Start([Customer Opens App]) --> Browse[Browse Products]
    Browse --> Search{Search or Browse?}
    
    Search -->|Search| SearchProducts[Enter Search Query]
    SearchProducts --> DisplayResults[Display Search Results]
    DisplayResults --> SelectProduct
    
    Search -->|Browse| SelectCategory[Select Category]
    SelectCategory --> DisplayProducts[Display Products]
    DisplayProducts --> SelectProduct[Select Product]
    
    SelectProduct --> ViewDetails[View Product Details]
    ViewDetails --> AddToCart{Add to Cart?}
    
    AddToCart -->|Yes| UpdateCart[Update Cart]
    UpdateCart --> ContinueShopping{Continue Shopping?}
    
    ContinueShopping -->|Yes| Browse
    ContinueShopping -->|No| ViewCart[View Cart]
    
    AddToCart -->|No| ContinueShopping
    
    ViewCart --> Checkout[Proceed to Checkout]
    Checkout --> SelectAddress[Select Delivery Address]
    SelectAddress --> SelectPayment[Select Payment Method]
    SelectPayment --> ReviewOrder[Review Order]
    ReviewOrder --> PlaceOrder[Place Order]
    
    PlaceOrder --> ProcessPayment{Payment Successful?}
    
    ProcessPayment -->|Yes| OrderConfirmed[Order Confirmed]
    ProcessPayment -->|No| PaymentFailed[Payment Failed]
    
    PaymentFailed --> RetryPayment{Retry?}
    RetryPayment -->|Yes| SelectPayment
    RetryPayment -->|No| End([End])
    
    OrderConfirmed --> TrackOrder[Track Order]
    TrackOrder --> End
```

**Description**: This activity diagram shows the complete customer journey from browsing products to order tracking. It includes decision points for search vs browse, payment retry logic, and the checkout flow.

### Driver Delivery Flow

```mermaid
graph TD
    Start([Driver Goes Online]) --> SetAvailable[Set Status Available]
    SetAvailable --> WaitForOrder[Wait for Order]
    
    WaitForOrder --> ReceiveOrder[Receive Order Request]
    ReceiveOrder --> ReviewOrder{Accept Order?}
    
    ReviewOrder -->|No| DeclineOrder[Decline Order]
    DeclineOrder --> WaitForOrder
    
    ReviewOrder -->|Yes| AcceptOrder[Accept Order]
    AcceptOrder --> NavigateToPickup[Navigate to Pickup]
    NavigateToPickup --> ArriveAtPickup[Arrive at Pickup]
    
    ArriveAtPickup --> NotifyArrival[Notify Arrival]
    NotifyArrival --> WaitForOrder2[Wait for Order]
    WaitForOrder2 --> ReceiveItems[Receive Items]
    
    ReceiveItems --> VerifyOrder{Order Correct?}
    
    VerifyOrder -->|No| ReportIssue[Report Issue]
    ReportIssue --> ResolveIssue[Resolve with Merchant]
    ResolveIssue --> ReceiveItems
    
    VerifyOrder -->|Yes| ConfirmPickup[Confirm Pickup]
    ConfirmPickup --> NavigateToDelivery[Navigate to Delivery]
    NavigateToDelivery --> ArriveAtDelivery[Arrive at Delivery]
    
    ArriveAtDelivery --> ContactCustomer{Customer Available?}
    
    ContactCustomer -->|Yes| DeliverOrder[Deliver Order]
    ContactCustomer -->|No| CallCustomer[Call Customer]
    
    CallCustomer --> CustomerResponds{Customer Responds?}
    CustomerResponds -->|Yes| DeliverOrder
    CustomerResponds -->|No| FollowProtocol[Follow No-Show Protocol]
    
    DeliverOrder --> CaptureProof[Capture Proof of Delivery]
    FollowProtocol --> CaptureProof
    
    CaptureProof --> CompleteDelivery[Complete Delivery]
    CompleteDelivery --> UpdateEarnings[Update Earnings]
    UpdateEarnings --> NextOrder{Accept Next Order?}
    
    NextOrder -->|Yes| WaitForOrder
    NextOrder -->|No| GoOffline[Go Offline]
    GoOffline --> End([End])
```

**Description**: This diagram illustrates the complete driver workflow from going online to completing deliveries. It includes decision points for order acceptance, issue resolution, and customer availability handling.

---

## State Machine Diagrams

### Order State Machine

```mermaid
stateDiagram-v2
    [*] --> Created: Customer places order
    
    Created --> PaymentPending: Await payment
    PaymentPending --> PaymentFailed: Payment fails
    PaymentPending --> Confirmed: Payment succeeds
    
    PaymentFailed --> Cancelled: Auto cancel
    Created --> Cancelled: Customer cancels
    
    Confirmed --> Preparing: Merchant accepts
    Confirmed --> Rejected: Merchant rejects
    
    Rejected --> Refunded: Process refund
    
    Preparing --> Ready: Preparation complete
    Preparing --> Cancelled: Cancel allowed
    
    Ready --> DriverAssigned: Driver assigned
    Ready --> Cancelled: No drivers available
    
    DriverAssigned --> PickedUp: Driver picks up
    DriverAssigned --> Cancelled: Driver cancels
    
    PickedUp --> InTransit: Start reskflow
    
    InTransit --> Delivered: Delivery complete
    InTransit --> Failed: Delivery fails
    
    Failed --> Refunded: Process refund
    
    Delivered --> Completed: Customer confirms
    Delivered --> Disputed: Customer disputes
    
    Disputed --> Resolved: Dispute resolved
    Disputed --> Refunded: Refund issued
    
    Resolved --> Completed: Close order
    
    Cancelled --> Refunded: If paid
    Cancelled --> [*]: If not paid
    
    Refunded --> [*]: End
    Completed --> [*]: End
```

**Description**: This state machine diagram shows all possible states of an order from creation to completion. It includes payment states, cancellation paths, dispute handling, and refund processes. Each transition is triggered by specific events in the system.

### Delivery State Machine

```mermaid
stateDiagram-v2
    [*] --> Unassigned: Order ready
    
    Unassigned --> FindingDriver: Start assignment
    FindingDriver --> DriverAssigned: Driver found
    FindingDriver --> NoDriversAvailable: Timeout
    
    NoDriversAvailable --> FindingDriver: Retry
    NoDriversAvailable --> Cancelled: Give up
    
    DriverAssigned --> Accepted: Driver accepts
    DriverAssigned --> Declined: Driver declines
    
    Declined --> FindingDriver: Find another
    
    Accepted --> EnRoute: Driver traveling
    EnRoute --> ArrivedAtPickup: At merchant
    
    ArrivedAtPickup --> WaitingForPickup: Waiting
    WaitingForPickup --> ItemsPickedUp: Items received
    
    ItemsPickedUp --> EnRouteToCustomer: Delivering
    EnRouteToCustomer --> ArrivedAtDelivery: At destination
    
    ArrivedAtDelivery --> Delivering: Handing over
    Delivering --> Delivered: Success
    Delivering --> DeliveryFailed: Failed
    
    DeliveryFailed --> ReturnToMerchant: Return items
    ReturnToMerchant --> Returned: Items returned
    
    Delivered --> [*]: Complete
    Returned --> [*]: Complete
    Cancelled --> [*]: End
```

**Description**: This state machine represents the reskflow lifecycle from unassigned to completion. It handles driver assignment, pickup, reskflow, and failure scenarios with appropriate state transitions.

---

## Component Diagrams

### System Component Architecture

```mermaid
graph TB
    subgraph "Frontend Components"
        WebApp[Web Application<br/>React/Next.js]
        MobileApp[Mobile Application<br/>React Native]
        AdminPortal[Admin Portal<br/>React Admin]
    end
    
    subgraph "API Layer"
        Gateway[API Gateway<br/>Express Gateway]
        Auth[Auth Service<br/>JWT/OAuth]
        RateLimit[Rate Limiter<br/>Redis]
    end
    
    subgraph "Core Services"
        UserMgmt[User Management<br/>Node.js]
        OrderMgmt[Order Management<br/>Node.js]
        PaymentProc[Payment Processing<br/>Node.js]
        DeliveryMgmt[Delivery Management<br/>Node.js]
    end
    
    subgraph "Business Services"
        Merchant[Merchant Service<br/>Node.js]
        Catalog[Catalog Service<br/>Node.js]
        Pricing[Pricing Engine<br/>Node.js]
        Promotion[Promotion Service<br/>Node.js]
    end
    
    subgraph "Infrastructure Services"
        Notification[Notification Service<br/>Node.js]
        Analytics[Analytics Service<br/>Node.js]
        Search[Search Service<br/>Elasticsearch]
        FileStorage[File Storage<br/>S3]
    end
    
    subgraph "Data Stores"
        PostgreSQL[(PostgreSQL<br/>Transactional)]
        MongoDB[(MongoDB<br/>Catalog)]
        Redis[(Redis<br/>Cache/Queue)]
        Elasticsearch[(Elasticsearch<br/>Search)]
    end
    
    subgraph "External Services"
        Stripe[Stripe API]
        Twilio[Twilio API]
        Maps[Maps API]
        Blockchain[Blockchain RPC]
    end
    
    WebApp --> Gateway
    MobileApp --> Gateway
    AdminPortal --> Gateway
    Gateway --> Auth
    Gateway --> RateLimit
    Auth --> UserMgmt
    Auth --> OrderMgmt
    Auth --> PaymentProc
    Auth --> DeliveryMgmt
    
    UserMgmt --> PostgreSQL
    OrderMgmt --> PostgreSQL
    PaymentProc --> PostgreSQL
    DeliveryMgmt --> MongoDB
    Merchant --> PostgreSQL
    Catalog --> MongoDB
    Analytics --> MongoDB
    Search --> Elasticsearch
    RateLimit --> Redis
    
    PaymentProc --> Stripe
    Notification --> Twilio
    DeliveryMgmt --> Maps
    PaymentProc --> Blockchain
```

**Description**: This component diagram shows the system's modular architecture with clear separation of concerns. Components are grouped by functionality (Frontend, API, Services, Data, External) with defined interfaces and dependencies.

### Microservice Communication

```mermaid
graph LR
    subgraph "Service Mesh"
        subgraph "Service A"
            A_Service[Business Logic]
            A_Sidecar[Envoy Proxy]
        end
        
        subgraph "Service B"
            B_Service[Business Logic]
            B_Sidecar[Envoy Proxy]
        end
        
        subgraph "Service C"
            C_Service[Business Logic]
            C_Sidecar[Envoy Proxy]
        end
    end
    
    subgraph "Infrastructure"
        ServiceRegistry[Service Registry<br/>Consul]
        ConfigServer[Config Server]
        Monitoring[Monitoring<br/>Prometheus]
        Tracing[Tracing<br/>Jaeger]
    end
    
    subgraph "Message Bus"
        EventBus[Event Bus<br/>Kafka]
        Queue[Task Queue<br/>Redis/Bull]
    end
    
    A_Service <--> A_Sidecar
    B_Service <--> B_Sidecar
    C_Service <--> C_Sidecar
    
    A_Sidecar <--> B_Sidecar
    B_Sidecar <--> C_Sidecar
    A_Sidecar <--> C_Sidecar
    
    A_Sidecar --> ServiceRegistry
    B_Sidecar --> ServiceRegistry
    C_Sidecar --> ServiceRegistry
    
    A_Sidecar --> Monitoring
    B_Sidecar --> Monitoring
    C_Sidecar --> Monitoring
    
    A_Service --> EventBus
    B_Service --> EventBus
    C_Service --> EventBus
    
    A_Service --> Queue
    B_Service --> Queue
```

**Description**: This diagram illustrates the service mesh architecture with sidecar proxies (Envoy) handling cross-cutting concerns like service discovery, monitoring, and tracing. Services communicate through the mesh and use event bus for asynchronous communication.

---

## Deployment Diagrams

### Production Deployment Architecture

```mermaid
graph TB
    subgraph "CDN Layer"
        CloudFront[CloudFront CDN]
    end
    
    subgraph "Load Balancer Layer"
        ALB[Application Load Balancer]
        NLB[Network Load Balancer]
    end
    
    subgraph "Kubernetes Cluster - Region 1"
        subgraph "Node Pool 1 - Web Tier"
            Pod1[API Gateway Pods]
            Pod2[Web App Pods]
        end
        
        subgraph "Node Pool 2 - Service Tier"
            Pod3[User Service Pods]
            Pod4[Order Service Pods]
            Pod5[Payment Service Pods]
        end
        
        subgraph "Node Pool 3 - Worker Tier"
            Pod6[Background Workers]
            Pod7[Scheduled Jobs]
        end
    end
    
    subgraph "Data Tier - Multi-AZ"
        subgraph "Primary Databases"
            PG_Primary[(PostgreSQL Primary)]
            Mongo_Primary[(MongoDB Primary)]
        end
        
        subgraph "Replica Databases"
            PG_Replica[(PostgreSQL Replicas)]
            Mongo_Replica[(MongoDB Replicas)]
        end
        
        subgraph "Cache Layer"
            Redis_Cluster[(Redis Cluster)]
        end
    end
    
    subgraph "Storage Tier"
        S3[S3 Buckets]
        EBS[EBS Volumes]
    end
    
    CloudFront --> ALB
    ALB --> Pod1
    ALB --> Pod2
    NLB --> Pod3
    NLB --> Pod4
    NLB --> Pod5
    
    Pod3 --> PG_Primary
    Pod4 --> PG_Primary
    Pod5 --> PG_Primary
    Pod3 --> Mongo_Primary
    Pod4 --> Mongo_Primary
    Pod3 --> Redis_Cluster
    Pod4 --> Redis_Cluster
    Pod5 --> Redis_Cluster
    
    PG_Primary -.replicate.-> PG_Replica
    Mongo_Primary -.replicate.-> Mongo_Replica
    
    Pod6 --> PG_Primary
    Pod6 --> Mongo_Primary
    Pod7 --> PG_Primary
    Pod7 --> Mongo_Primary
    Pod3 --> S3
    Pod4 --> S3
    Pod5 --> S3
```

**Description**: This deployment diagram shows a production-ready architecture with CDN, load balancing, Kubernetes orchestration, and multi-AZ database deployment. It illustrates high availability through replication and separation of concerns through node pools.

### Container Deployment View

```mermaid
graph TB
    subgraph "Docker Registry"
        BaseImage[node:18-alpine]
        ServiceImages[Service Images]
    end
    
    subgraph "Kubernetes Master"
        API[API Server]
        Scheduler[Scheduler]
        Controller[Controller Manager]
        etcd[(etcd)]
    end
    
    subgraph "Kubernetes Nodes"
        subgraph "Node 1"
            Kubelet1[Kubelet]
            Docker1[Docker]
            subgraph "Pods"
                Container1[User Service]
                Container2[Order Service]
            end
        end
        
        subgraph "Node 2"
            Kubelet2[Kubelet]
            Docker2[Docker]
            subgraph "Pods"
                Container3[Payment Service]
                Container4[Notification Service]
            end
        end
        
        subgraph "Node 3"
            Kubelet3[Kubelet]
            Docker3[Docker]
            subgraph "Pods"
                Container5[Analytics Service]
                Container6[Search Service]
            end
        end
    end
    
    BaseImage --> ServiceImages
    ServiceImages --> Docker1
    ServiceImages --> Docker2
    ServiceImages --> Docker3
    
    API --> Kubelet1
    API --> Kubelet2
    API --> Kubelet3
    
    Scheduler --> API
    Controller --> API
    API --> etcd
```

**Description**: This diagram shows the container deployment architecture using Kubernetes. It illustrates how container images are deployed to nodes, managed by Kubernetes components, and orchestrated across the cluster.

---

## Data Flow Diagrams

### Order Processing Data Flow

```mermaid
graph LR
    subgraph "Input"
        Customer[Customer App]
        Merchant[Merchant App]
    end
    
    subgraph "Processing"
        OrderAPI[Order API]
        Validation[Validation Engine]
        Inventory[Inventory Check]
        Pricing[Pricing Engine]
        Payment[Payment Gateway]
        Assignment[Driver Assignment]
    end
    
    subgraph "Storage"
        OrderDB[(Order Database)]
        Cache[(Redis Cache)]
        Queue[(Message Queue)]
    end
    
    subgraph "Output"
        CustomerNotif[Customer Notification]
        MerchantNotif[Merchant Notification]
        DriverNotif[Driver Notification]
        Analytics[Analytics Pipeline]
    end
    
    Customer -->|1. Create Order| OrderAPI
    OrderAPI -->|2. Validate| Validation
    Validation -->|3. Check Stock| Inventory
    Inventory -->|4. Calculate Price| Pricing
    Pricing -->|5. Process Payment| Payment
    
    Payment -->|6. Store Order| OrderDB
    Payment -->|7. Cache Data| Cache
    Payment -->|8. Queue Tasks| Queue
    
    Queue -->|9. Assign Driver| Assignment
    
    Assignment -->|10. Notify| CustomerNotif
    Assignment -->|11. Notify| MerchantNotif
    Assignment -->|12. Notify| DriverNotif
    
    OrderDB -->|13. Stream Events| Analytics
    
    Merchant -->|Update Status| OrderAPI
```

**Description**: This data flow diagram traces the path of order data through the system, from customer input through validation, payment, storage, and notification. Numbers indicate the sequence of operations.

### Real-time Tracking Data Flow

```mermaid
graph TB
    subgraph "Data Sources"
        Driver[Driver App]
        GPS[GPS Module]
        Network[Network Location]
    end
    
    subgraph "Ingestion Layer"
        LocationAPI[Location API]
        StreamProcessor[Stream Processor]
        Validator[Data Validator]
    end
    
    subgraph "Processing Layer"
        RouteEngine[Route Engine]
        ETACalculator[ETA Calculator]
        GeoFence[Geofence Monitor]
        Aggregator[Location Aggregator]
    end
    
    subgraph "Storage Layer"
        TimeSeriesDB[(Time Series DB)]
        LocationCache[(Location Cache)]
        RouteCache[(Route Cache)]
    end
    
    subgraph "Distribution Layer"
        WebSocket[WebSocket Server]
        PushNotification[Push Service]
        Analytics[Analytics Stream]
    end
    
    subgraph "Consumers"
        CustomerApp[Customer Apps]
        MerchantDash[Merchant Dashboard]
        AdminPanel[Admin Panel]
    end
    
    GPS --> Driver
    Network --> Driver
    Driver -->|Location Update| LocationAPI
    
    LocationAPI --> StreamProcessor
    StreamProcessor --> Validator
    
    Validator --> RouteEngine
    Validator --> ETACalculator
    Validator --> GeoFence
    Validator --> Aggregator
    
    RouteEngine --> RouteCache
    ETACalculator --> LocationCache
    Aggregator --> TimeSeriesDB
    
    LocationCache --> WebSocket
    RouteCache --> WebSocket
    
    WebSocket --> CustomerApp
    WebSocket --> MerchantDash
    
    GeoFence --> PushNotification
    PushNotification --> CustomerApp
    
    TimeSeriesDB --> Analytics
    Analytics --> AdminPanel
```

**Description**: This diagram shows how location data flows from drivers through the system to end consumers. It illustrates real-time processing, caching for performance, and multiple distribution channels for different user types.

---

## Appendices

### Diagram Legend

| Symbol | Meaning |
|--------|---------|
| Rectangle | Class/Component |
| Rounded Rectangle | State/Activity |
| Diamond | Decision Point |
| Circle | Start/End Point |
| Cylinder | Database |
| Solid Arrow | Direct Dependency |
| Dashed Arrow | Indirect Dependency |
| Dotted Line | Temporary Relationship |

### Color Coding

- **Blue**: User-facing components
- **Green**: Core business services
- **Yellow**: Infrastructure services
- **Red**: External dependencies
- **Gray**: Data stores

### Tool References

1. **PlantUML**: Text-based UML diagram tool
   - Website: https://plantuml.com
   - Usage: Generate diagrams from text descriptions

2. **Mermaid**: JavaScript based diagramming
   - Website: https://mermaid-js.github.io
   - Usage: Render diagrams in markdown

3. **Draw.io**: Visual diagram editor
   - Website: https://app.diagrams.net
   - Usage: Create and export diagrams

#
*For updates or corrections, please contact shahin@resket.ca*