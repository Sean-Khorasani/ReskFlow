# API Documentation

## ReskFlow

### Version 1.0.0
### Last Updated: July 2025

---

## Table of Contents

1. [API Overview](#api-overview)
2. [Authentication](#authentication)
3. [Common Standards](#common-standards)
4. [Core Services APIs](#core-services-apis)
5. [Food Delivery APIs](#food-reskflow-apis)
6. [Analytics & AI APIs](#analytics--ai-apis)
7. [Infrastructure APIs](#infrastructure-apis)
8. [WebSocket APIs](#websocket-apis)
9. [Error Handling](#error-handling)
10. [Rate Limiting](#rate-limiting)

---

## API Overview

### Base URLs

| Environment | Base URL | Description |
|-------------|----------|-------------|
| Production | `https://api.ReskFlow.com` | Production API endpoint |
| Staging | `https://staging-api.ReskFlow.com` | Staging environment |
| Development | `http://localhost:3000` | Local development |

### API Versioning

All APIs are versioned using URL path versioning:
- Current version: `/v1`
- Example: `https://api.ReskFlow.com/v1/users`

### Content Types

- Request: `application/json`
- Response: `application/json`
- File Upload: `multipart/form-data`

---

## Authentication

### JWT Authentication

All protected endpoints require a JWT token in the Authorization header:

```http
Authorization: Bearer <jwt_token>
```

### Obtaining a Token

```http
POST /v1/auth/login
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "secure_password"
}

Response:
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "refreshToken": "refresh_token_here",
  "expiresIn": 3600,
  "user": {
    "id": "user_123",
    "email": "user@example.com",
    "role": "customer"
  }
}
```

### Refreshing Tokens

```http
POST /v1/auth/refresh
Content-Type: application/json

{
  "refreshToken": "refresh_token_here"
}
```

### API Key Authentication

For server-to-server communication:

```http
X-API-Key: your_api_key_here
```

---

## Common Standards

### Request Format

```http
{
  "data": {
    // Request payload
  },
  "metadata": {
    "requestId": "req_123",
    "timestamp": "2025-07-10T10:00:00Z"
  }
}
```

### Response Format

```http
{
  "success": true,
  "data": {
    // Response payload
  },
  "metadata": {
    "requestId": "req_123",
    "timestamp": "2025-07-10T10:00:01Z",
    "version": "1.0.0"
  },
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 100,
    "hasNext": true
  }
}
```

### Pagination

```http
GET /v1/resource?page=1&limit=20&sort=createdAt:desc
```

### Filtering

```http
GET /v1/resource?filter[status]=active&filter[type]=premium
```

---

## Core Services APIs

### User Service (Port 3001)

#### Create User

```http
POST /v1/users
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "SecurePass123!",
  "firstName": "John",
  "lastName": "Doe",
  "phone": "+1234567890",
  "role": "customer"
}

Response: 201 Created
{
  "success": true,
  "data": {
    "id": "user_123",
    "email": "user@example.com",
    "firstName": "John",
    "lastName": "Doe",
    "role": "customer",
    "createdAt": "2025-07-10T10:00:00Z"
  }
}
```

#### Get User Profile

```http
GET /v1/users/profile
Authorization: Bearer <token>

Response: 200 OK
{
  "success": true,
  "data": {
    "id": "user_123",
    "email": "user@example.com",
    "profile": {
      "firstName": "John",
      "lastName": "Doe",
      "phone": "+1234567890",
      "addresses": [...]
    }
  }
}
```

#### Update User

```http
PUT /v1/users/{userId}
Authorization: Bearer <token>
Content-Type: application/json

{
  "firstName": "Jane",
  "preferences": {
    "notifications": true,
    "newsletter": false
  }
}
```

### Payment Service (Port 3002)

#### Create Payment Intent

```http
POST /v1/payments/intent
Authorization: Bearer <token>
Content-Type: application/json

{
  "amount": 2500,
  "currency": "USD",
  "orderId": "order_456",
  "paymentMethod": "card",
  "metadata": {
    "merchantId": "merchant_789"
  }
}

Response: 200 OK
{
  "success": true,
  "data": {
    "intentId": "pi_123",
    "clientSecret": "pi_123_secret",
    "amount": 2500,
    "currency": "USD",
    "status": "requires_payment_method"
  }
}
```

#### Process Payment

```http
POST /v1/payments/process
Authorization: Bearer <token>
Content-Type: application/json

{
  "intentId": "pi_123",
  "paymentMethodId": "pm_456"
}

Response: 200 OK
{
  "success": true,
  "data": {
    "paymentId": "pay_789",
    "status": "succeeded",
    "amount": 2500,
    "chargeId": "ch_123",
    "receipt": "https://receipt.url"
  }
}
```

#### Crypto Payment

```http
POST /v1/payments/crypto
Authorization: Bearer <token>
Content-Type: application/json

{
  "amount": 100,
  "currency": "USDC",
  "network": "polygon",
  "orderId": "order_456"
}

Response: 200 OK
{
  "success": true,
  "data": {
    "paymentAddress": "0x1234...",
    "amount": "100000000",
    "expiresAt": "2025-07-10T11:00:00Z",
    "qrCode": "data:image/png;base64,..."
  }
}
```

### Order Service (Port 3003)

#### Create Order

```http
POST /v1/orders
Authorization: Bearer <token>
Content-Type: application/json

{
  "merchantId": "merchant_123",
  "items": [
    {
      "productId": "prod_456",
      "quantity": 2,
      "price": 1250,
      "modifiers": ["extra_cheese"]
    }
  ],
  "reskflowAddress": {
    "street": "123 Main St",
    "city": "New York",
    "state": "NY",
    "zipCode": "10001",
    "coordinates": {
      "lat": 40.7128,
      "lng": -74.0060
    }
  },
  "reskflowInstructions": "Leave at door"
}

Response: 201 Created
{
  "success": true,
  "data": {
    "orderId": "order_789",
    "status": "pending",
    "total": 2500,
    "estimatedDelivery": "2025-07-10T11:30:00Z",
    "trackingUrl": "https://track.ReskFlow.com/order_789"
  }
}
```

#### Get Order Status

```http
GET /v1/orders/{orderId}
Authorization: Bearer <token>

Response: 200 OK
{
  "success": true,
  "data": {
    "orderId": "order_789",
    "status": "in_reskflow",
    "timeline": [
      {
        "status": "pending",
        "timestamp": "2025-07-10T10:00:00Z"
      },
      {
        "status": "confirmed",
        "timestamp": "2025-07-10T10:05:00Z"
      },
      {
        "status": "preparing",
        "timestamp": "2025-07-10T10:10:00Z"
      },
      {
        "status": "in_reskflow",
        "timestamp": "2025-07-10T10:30:00Z",
        "driver": {
          "name": "John Driver",
          "phone": "+1234567890",
          "photo": "https://..."
        }
      }
    ]
  }
}
```

### Delivery Service (Port 3004)

#### Track Delivery

```http
GET /v1/deliveries/{reskflowId}/track
Authorization: Bearer <token>

Response: 200 OK
{
  "success": true,
  "data": {
    "reskflowId": "del_123",
    "status": "in_transit",
    "driver": {
      "name": "John Driver",
      "phone": "+1234567890",
      "rating": 4.8
    },
    "location": {
      "lat": 40.7128,
      "lng": -74.0060,
      "heading": 45,
      "speed": 25
    },
    "route": {
      "distance": 5.2,
      "duration": 15,
      "polyline": "encoded_polyline_here"
    },
    "estimatedArrival": "2025-07-10T11:30:00Z"
  }
}
```

#### Update Delivery Status

```http
PUT /v1/deliveries/{reskflowId}/status
Authorization: Bearer <token>
Content-Type: application/json

{
  "status": "delivered",
  "proof": {
    "photo": "base64_encoded_photo",
    "signature": "base64_encoded_signature",
    "location": {
      "lat": 40.7128,
      "lng": -74.0060
    }
  }
}
```

---

## Food Delivery APIs

### Cart Service (Port 3005)

#### Get Cart

```http
GET /v1/cart
Authorization: Bearer <token>

Response: 200 OK
{
  "success": true,
  "data": {
    "cartId": "cart_123",
    "items": [
      {
        "itemId": "item_456",
        "productId": "prod_789",
        "name": "Margherita Pizza",
        "quantity": 1,
        "price": 1500,
        "modifiers": ["extra_cheese"],
        "subtotal": 1700
      }
    ],
    "subtotal": 1700,
    "tax": 170,
    "reskflowFee": 300,
    "total": 2170,
    "merchantId": "merchant_123"
  }
}
```

#### Add to Cart

```http
POST /v1/cart/items
Authorization: Bearer <token>
Content-Type: application/json

{
  "productId": "prod_789",
  "quantity": 1,
  "modifiers": ["extra_cheese"],
  "specialInstructions": "No onions please"
}
```

#### Group Cart Operations

```http
POST /v1/cart/group/create
Authorization: Bearer <token>
Content-Type: application/json

{
  "name": "Office Lunch Order",
  "participants": ["user_456", "user_789"]
}

Response: 200 OK
{
  "success": true,
  "data": {
    "groupId": "group_123",
    "shareCode": "LUNCH123",
    "joinUrl": "https://app.ReskFlow.com/join/LUNCH123"
  }
}
```

### Catalog Service (Port 3008)

#### Search Products

```http
POST /v1/catalog/search
Content-Type: application/json

{
  "query": "pizza",
  "filters": {
    "dietary": ["vegetarian", "gluten_free"],
    "priceRange": {
      "min": 1000,
      "max": 3000
    },
    "rating": {
      "min": 4.0
    }
  },
  "location": {
    "lat": 40.7128,
    "lng": -74.0060
  },
  "sort": "popularity:desc",
  "page": 1,
  "limit": 20
}

Response: 200 OK
{
  "success": true,
  "data": {
    "results": [
      {
        "productId": "prod_123",
        "name": "Veggie Supreme Pizza",
        "description": "Fresh vegetables on crispy crust",
        "price": 1800,
        "merchantId": "merchant_456",
        "merchant": {
          "name": "Tony's Pizza",
          "rating": 4.5,
          "reskflowTime": 30
        },
        "dietary": ["vegetarian"],
        "image": "https://..."
      }
    ]
  },
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 45
  }
}
```

#### Get Menu

```http
GET /v1/catalog/merchants/{merchantId}/menu
Content-Type: application/json

Response: 200 OK
{
  "success": true,
  "data": {
    "merchantId": "merchant_456",
    "categories": [
      {
        "categoryId": "cat_123",
        "name": "Pizzas",
        "items": [
          {
            "productId": "prod_789",
            "name": "Margherita",
            "description": "Classic tomato and mozzarella",
            "price": 1500,
            "image": "https://...",
            "modifiers": [
              {
                "id": "mod_123",
                "name": "Size",
                "required": true,
                "options": [
                  {"name": "Small", "price": 0},
                  {"name": "Medium", "price": 300},
                  {"name": "Large", "price": 600}
                ]
              }
            ]
          }
        ]
      }
    ]
  }
}
```

### Merchant Service (Port 3009)

#### Get Merchant Details

```http
GET /v1/merchants/{merchantId}
Content-Type: application/json

Response: 200 OK
{
  "success": true,
  "data": {
    "merchantId": "merchant_456",
    "name": "Tony's Pizza",
    "type": "restaurant",
    "cuisine": ["italian", "pizza"],
    "rating": 4.5,
    "reviewCount": 342,
    "priceRange": 2,
    "hours": {
      "monday": {"open": "11:00", "close": "22:00"},
      "tuesday": {"open": "11:00", "close": "22:00"}
    },
    "location": {
      "address": "123 Pizza St",
      "coordinates": {
        "lat": 40.7128,
        "lng": -74.0060
      }
    },
    "reskflow": {
      "fee": 300,
      "minimum": 1500,
      "estimatedTime": 30
    },
    "features": ["contactless_reskflow", "group_ordering"]
  }
}
```

#### Merchant Analytics

```http
GET /v1/merchants/{merchantId}/analytics
Authorization: Bearer <token>
Query Parameters:
  - startDate: 2025-07-01
  - endDate: 2025-07-10
  - metrics: revenue,orders,ratings

Response: 200 OK
{
  "success": true,
  "data": {
    "period": {
      "start": "2025-07-01",
      "end": "2025-07-10"
    },
    "metrics": {
      "revenue": {
        "total": 125000,
        "daily": [...]
      },
      "orders": {
        "total": 450,
        "completed": 440,
        "cancelled": 10
      },
      "ratings": {
        "average": 4.5,
        "distribution": {
          "5": 300,
          "4": 100,
          "3": 30,
          "2": 10,
          "1": 10
        }
      }
    }
  }
}
```

---

## Analytics & AI APIs

### AI Recommendation Service (Port 3020)

#### Get Personalized Recommendations

```http
GET /v1/recommendations/personalized
Authorization: Bearer <token>
Query Parameters:
  - limit: 10
  - context: lunch

Response: 200 OK
{
  "success": true,
  "data": {
    "recommendations": [
      {
        "productId": "prod_123",
        "merchantId": "merchant_456",
        "score": 0.95,
        "reason": "Based on your order history",
        "product": {
          "name": "Caesar Salad",
          "price": 1200,
          "image": "https://..."
        }
      }
    ],
    "modelVersion": "2.1.0"
  }
}
```

#### Similar Products

```http
GET /v1/recommendations/products/{productId}/similar
Query Parameters:
  - limit: 5

Response: 200 OK
{
  "success": true,
  "data": {
    "products": [
      {
        "productId": "prod_789",
        "similarity": 0.89,
        "name": "Greek Salad",
        "price": 1100
      }
    ]
  }
}
```

### Analytics Service (Port 3021)

#### Customer Analytics

```http
GET /v1/analytics/customers/{customerId}
Authorization: Bearer <token>

Response: 200 OK
{
  "success": true,
  "data": {
    "customerId": "user_123",
    "metrics": {
      "totalOrders": 45,
      "totalSpent": 125000,
      "averageOrderValue": 2778,
      "favoriteCategories": ["pizza", "burgers"],
      "orderFrequency": "weekly",
      "lifetime": {
        "months": 12,
        "firstOrder": "2024-07-10",
        "lastOrder": "2025-07-09"
      }
    }
  }
}
```

#### Platform Analytics

```http
GET /v1/analytics/platform
Authorization: Bearer <token>
Query Parameters:
  - period: daily
  - metrics: orders,revenue,users

Response: 200 OK
{
  "success": true,
  "data": {
    "period": "2025-07-10",
    "metrics": {
      "orders": {
        "total": 15420,
        "completed": 15100,
        "cancelled": 320,
        "hourly": [...]
      },
      "revenue": {
        "gross": 45600000,
        "net": 41040000,
        "fees": 4560000
      },
      "users": {
        "active": 8500,
        "new": 120,
        "returning": 8380
      }
    }
  }
}
```

---

## Infrastructure APIs

### Monitoring Service (Port 3023)

#### Get System Metrics

```http
GET /v1/monitoring/metrics
Authorization: Bearer <token>

Response: 200 OK
{
  "success": true,
  "data": {
    "timestamp": "2025-07-10T10:00:00Z",
    "services": [
      {
        "name": "user-service",
        "status": "healthy",
        "uptime": 99.99,
        "metrics": {
          "cpu": 45.2,
          "memory": 512,
          "requests": 1250,
          "errors": 2,
          "latency": {
            "p50": 45,
            "p95": 120,
            "p99": 250
          }
        }
      }
    ]
  }
}
```

#### Create Alert

```http
POST /v1/monitoring/alerts
Authorization: Bearer <token>
Content-Type: application/json

{
  "name": "High Error Rate",
  "condition": {
    "metric": "error_rate",
    "operator": ">",
    "threshold": 5,
    "duration": "5m"
  },
  "channels": ["email", "slack"],
  "severity": "critical"
}
```

### Orchestration Service (Port 3024)

#### Execute Workflow

```http
POST /v1/workflows/{workflowId}/execute
Authorization: Bearer <token>
Content-Type: application/json

{
  "input": {
    "orderId": "order_123",
    "userId": "user_456"
  },
  "async": true
}

Response: 202 Accepted
{
  "success": true,
  "data": {
    "instanceId": "wf_789",
    "status": "running",
    "startedAt": "2025-07-10T10:00:00Z"
  }
}
```

#### Service Discovery

```http
POST /v1/registry/discover
Authorization: Bearer <token>
Content-Type: application/json

{
  "serviceId": "payment-service",
  "criteria": {
    "region": "us-east-1",
    "version": "~1.0.0"
  }
}

Response: 200 OK
{
  "success": true,
  "data": {
    "instance": {
      "id": "payment-service-abc123",
      "url": "http://10.0.1.5:3002",
      "healthy": true,
      "metadata": {
        "version": "1.0.5",
        "region": "us-east-1"
      }
    }
  }
}
```

---

## WebSocket APIs

### Real-time Order Tracking

```javascript
// Connect to WebSocket
const ws = new WebSocket('wss://api.ReskFlow.com/ws');

// Authenticate
ws.send(JSON.stringify({
  type: 'auth',
  token: 'your_jwt_token'
}));

// Subscribe to order updates
ws.send(JSON.stringify({
  type: 'subscribe',
  channel: 'order:order_123'
}));

// Receive updates
ws.on('message', (data) => {
  const message = JSON.parse(data);
  /*
  {
    "type": "order_update",
    "data": {
      "orderId": "order_123",
      "status": "in_reskflow",
      "driver": {
        "location": {
          "lat": 40.7128,
          "lng": -74.0060
        }
      }
    }
  }
  */
});
```

### Group Cart Real-time

```javascript
// Join group cart
ws.send(JSON.stringify({
  type: 'join_group',
  groupId: 'group_123'
}));

// Add item (broadcasts to all participants)
ws.send(JSON.stringify({
  type: 'add_item',
  groupId: 'group_123',
  item: {
    productId: 'prod_456',
    quantity: 1
  }
}));

// Receive updates from other participants
ws.on('message', (data) => {
  const message = JSON.parse(data);
  /*
  {
    "type": "group_update",
    "action": "item_added",
    "user": "user_789",
    "item": {...}
  }
  */
});
```

### Chat Service

```javascript
// Join chat room
ws.send(JSON.stringify({
  type: 'join_chat',
  roomId: 'order_123_chat'
}));

// Send message
ws.send(JSON.stringify({
  type: 'message',
  roomId: 'order_123_chat',
  content: 'Where should I leave the order?'
}));

// Receive messages
ws.on('message', (data) => {
  const message = JSON.parse(data);
  /*
  {
    "type": "chat_message",
    "roomId": "order_123_chat",
    "sender": {
      "id": "driver_456",
      "name": "John Driver"
    },
    "content": "I'll leave it at your door",
    "timestamp": "2025-07-10T10:00:00Z"
  }
  */
});
```

---

## Error Handling

### Error Response Format

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid input parameters",
    "details": [
      {
        "field": "email",
        "message": "Invalid email format"
      }
    ],
    "requestId": "req_123",
    "timestamp": "2025-07-10T10:00:00Z"
  }
}
```

### Common Error Codes

| Code | HTTP Status | Description |
|------|-------------|-------------|
| `AUTHENTICATION_REQUIRED` | 401 | Missing or invalid authentication |
| `INSUFFICIENT_PERMISSIONS` | 403 | User lacks required permissions |
| `RESOURCE_NOT_FOUND` | 404 | Requested resource doesn't exist |
| `VALIDATION_ERROR` | 400 | Input validation failed |
| `DUPLICATE_RESOURCE` | 409 | Resource already exists |
| `RATE_LIMIT_EXCEEDED` | 429 | Too many requests |
| `INTERNAL_ERROR` | 500 | Server error |
| `SERVICE_UNAVAILABLE` | 503 | Service temporarily unavailable |

### Error Handling Best Practices

1. **Retry Logic**
   ```javascript
   const maxRetries = 3;
   const backoffMs = 1000;
   
   async function apiCallWithRetry(url, options, attempt = 1) {
     try {
       const response = await fetch(url, options);
       if (response.status === 503 && attempt < maxRetries) {
         await new Promise(resolve => 
           setTimeout(resolve, backoffMs * attempt)
         );
         return apiCallWithRetry(url, options, attempt + 1);
       }
       return response;
     } catch (error) {
       if (attempt < maxRetries) {
         await new Promise(resolve => 
           setTimeout(resolve, backoffMs * attempt)
         );
         return apiCallWithRetry(url, options, attempt + 1);
       }
       throw error;
     }
   }
   ```

2. **Circuit Breaker Pattern**
   - Monitor for repeated failures
   - Open circuit after threshold
   - Periodically test recovery

---

## Rate Limiting

### Rate Limit Headers

All API responses include rate limit information:

```http
X-RateLimit-Limit: 1000
X-RateLimit-Remaining: 999
X-RateLimit-Reset: 1625910000
X-RateLimit-Retry-After: 60
```

### Rate Limits by Endpoint

| Endpoint Category | Limit | Window |
|-------------------|-------|---------|
| Authentication | 10 | 1 minute |
| Search | 30 | 1 minute |
| Orders | 100 | 1 minute |
| Analytics | 20 | 1 minute |
| General API | 1000 | 1 hour |

### Handling Rate Limits

```javascript
async function handleRateLimit(response) {
  if (response.status === 429) {
    const retryAfter = response.headers.get('X-RateLimit-Retry-After');
    const resetTime = response.headers.get('X-RateLimit-Reset');
    
    console.log(`Rate limited. Retry after ${retryAfter} seconds`);
    
    // Option 1: Wait and retry
    await new Promise(resolve => 
      setTimeout(resolve, retryAfter * 1000)
    );
    
    // Option 2: Use backoff strategy
    // Option 3: Queue request for later
  }
}
```

---

## SDK Examples

### JavaScript/TypeScript SDK

```typescript
import { DeliveryPlatformClient } from '@ReskFlow/sdk';

const client = new DeliveryPlatformClient({
  apiKey: 'your_api_key',
  environment: 'production'
});

// Create order
const order = await client.orders.create({
  merchantId: 'merchant_123',
  items: [
    {
      productId: 'prod_456',
      quantity: 2
    }
  ],
  reskflowAddress: {
    street: '123 Main St',
    city: 'New York',
    state: 'NY',
    zipCode: '10001'
  }
});

// Track reskflow
const subscription = client.deliveries
  .track(order.reskflowId)
  .subscribe(update => {
    console.log('Delivery update:', update);
  });
```

### Python SDK

```python
from reskflow_platform import Client

client = Client(
    api_key='your_api_key',
    environment='production'
)

# Search restaurants
results = client.catalog.search(
    query='pizza',
    location={'lat': 40.7128, 'lng': -74.0060},
    filters={'rating': {'min': 4.0}}
)

# Place order
order = client.orders.create(
    merchant_id='merchant_123',
    items=[
        {
            'product_id': 'prod_456',
            'quantity': 1,
            'modifiers': ['extra_cheese']
        }
    ],
    reskflow_address={
        'street': '123 Main St',
        'city': 'New York',
        'state': 'NY',
        'zip_code': '10001'
    }
)
```

---

## Testing

### Test Environment

Base URL: `https://sandbox-api.ReskFlow.com`

### Test Credentials

```json
{
  "customer": {
    "email": "test.customer@example.com",
    "password": "TestPass123!"
  },
  "merchant": {
    "email": "test.merchant@example.com",
    "password": "TestPass123!"
  },
  "driver": {
    "email": "test.driver@example.com",
    "password": "TestPass123!"
  }
}
```

### Test Payment Cards

| Card Number | Type | Result |
|-------------|------|---------|
| 4242 4242 4242 4242 | Visa | Success |
| 5555 5555 5555 4444 | Mastercard | Success |
| 4000 0000 0000 0002 | Visa | Decline |
| 4000 0000 0000 9995 | Visa | Insufficient funds |

### Webhook Testing

Use our webhook testing tool:
```bash
curl -X POST https://sandbox-api.ReskFlow.com/test/webhooks \
  -H "X-API-Key: test_api_key" \
  -d '{
    "event": "order.delivered",
    "url": "https://your-webhook-url.com"
  }'
```

---

*For additional support, contact shahin@resket.ca*