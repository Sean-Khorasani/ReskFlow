# Order Service

Comprehensive order management service for the ReskFlow reskflow platform.

## Features

- **Order Management**: Create, update, and track orders through their lifecycle
- **Status Tracking**: Real-time order status updates with timeline
- **Payment Integration**: Seamless integration with payment service
- **Delivery Coordination**: Automatic reskflow assignment and tracking
- **Invoice Generation**: PDF invoice creation and management
- **Order Rating**: Customer feedback and rating system
- **Reorder Functionality**: Quick reordering from previous orders
- **Analytics**: Comprehensive order and revenue statistics

## Architecture

### Core Services
- **OrderService**: Main order processing and management
- **OrderTimelineService**: Track order status changes
- **InvoiceService**: Generate and manage PDF invoices
- **OrderRatingService**: Handle customer ratings and feedback
- **OrderStatisticsService**: Analytics and reporting
- **ReorderService**: Handle repeat orders

### External Integrations
- **Cart Service**: Retrieve cart items for order creation
- **Catalog Service**: Validate products and pricing
- **Payment Service**: Process payments and refunds
- **Notification Service**: Send order updates
- **Delivery Service**: Coordinate deliveries

## API Endpoints

### Orders
- `POST /api/v1/orders` - Create new order
- `GET /api/v1/orders/:orderId` - Get order details
- `GET /api/v1/orders` - Get user orders
- `GET /api/v1/orders/merchant/:merchantId` - Get merchant orders
- `PUT /api/v1/orders/:orderId` - Update order
- `PUT /api/v1/orders/:orderId/status` - Update order status
- `POST /api/v1/orders/:orderId/cancel` - Cancel order
- `POST /api/v1/orders/:orderId/rate` - Rate order
- `GET /api/v1/orders/:orderId/tracking` - Get order tracking
- `POST /api/v1/orders/:orderId/invoice` - Generate invoice
- `POST /api/v1/orders/:orderId/reorder` - Reorder items

### Invoices
- `GET /api/v1/invoices/:invoiceId` - Get invoice
- `GET /api/v1/invoices/order/:orderId` - Get invoice by order
- `GET /api/v1/invoices/:invoiceId/download` - Download PDF

### Statistics
- `GET /api/v1/statistics/orders` - Order statistics
- `GET /api/v1/statistics/revenue` - Revenue statistics
- `GET /api/v1/statistics/popular-items` - Popular items

## Order Flow

1. **Order Creation**
   - Cart validation
   - Product availability check
   - Price verification
   - Order number generation

2. **Payment Processing**
   - Payment creation
   - Order confirmation on success
   - Automatic cancellation on failure

3. **Merchant Notification**
   - Real-time WebSocket updates
   - Push notifications
   - Order queue management

4. **Order Preparation**
   - Status updates
   - Timeline tracking
   - Customer notifications

5. **Delivery Assignment**
   - Automatic driver matching
   - Delivery tracking
   - Real-time updates

6. **Order Completion**
   - Customer rating
   - Invoice generation
   - Analytics update

## WebSocket Events

### Client Events
- `subscribe:order` - Subscribe to order updates
- `unsubscribe:order` - Unsubscribe from order
- `subscribe:merchant:orders` - Merchant order list

### Server Events
- `order:updated` - Order status change
- `order:status` - Status update
- `order:new` - New order for merchant

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. Configure environment:
   ```bash
   cp .env.example .env
   ```

3. Run database migrations:
   ```bash
   npm run prisma:migrate
   ```

4. Start service:
   ```bash
   npm run dev
   ```

## Configuration

Key environment variables:
- `DATABASE_URL` - PostgreSQL connection
- `MONGODB_URI` - MongoDB for order documents
- `ORDER_TIMEOUT_MINUTES` - Auto-cancel timeout
- `ORDER_CANCELLATION_WINDOW_MINUTES` - Cancellation period
- Service URLs for integrations

## Security

- JWT authentication required
- Role-based access control
- Order ownership verification
- Rate limiting on order creation
- Input validation and sanitization

## Order Status Flow

```
PENDING → CONFIRMED → PREPARING → READY_FOR_PICKUP → OUT_FOR_DELIVERY → DELIVERED → COMPLETED
    ↓         ↓           ↓              ↓                    ↓              ↓
CANCELLED  CANCELLED  CANCELLED      CANCELLED            FAILED         REFUNDED
```

## Error Handling

- Comprehensive error types
- Detailed logging
- Graceful degradation
- Automatic retry for failed operations