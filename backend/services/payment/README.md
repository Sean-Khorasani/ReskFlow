# Payment Service

A comprehensive payment service with cryptocurrency wallet support for internal application transactions.

## Features

- **Wallet Management**: Users have internal wallets for storing funds
- **Cryptocurrency Support**: Accept deposits in BTC, ETH, USDT, USDC, and MATIC
- **No Withdrawals**: Money can only be used within the application
- **Refund System**: Refunds credit back to user wallets
- **Exchange Rate Conversion**: Real-time crypto to fiat conversion
- **Transaction Confirmations**: Blockchain confirmation tracking
- **Webhook Support**: Handle incoming crypto deposit notifications

## Architecture

### Services
- **WalletService**: Manages user wallets and transactions
- **CryptoService**: Handles cryptocurrency deposits and tracking
- **PaymentService**: Processes payments and refunds
- **ExchangeRateService**: Provides crypto to fiat conversion rates
- **BlockchainService**: Interacts with blockchain networks

### Key Components
- **Models**: MongoDB schemas for payments, wallets, transactions
- **Controllers**: REST API endpoints
- **Middleware**: Authentication, validation, rate limiting
- **Utils**: Logging, error handling, crypto utilities

## API Endpoints

### Payments
- `POST /api/v1/payments` - Create payment
- `POST /api/v1/payments/:paymentId/process` - Process payment
- `POST /api/v1/payments/:paymentId/refund` - Refund payment
- `GET /api/v1/payments/:paymentId` - Get payment details
- `GET /api/v1/payments/order/:orderId` - Get payment by order
- `GET /api/v1/payments/user/:userId` - Get user payments

### Wallets
- `POST /api/v1/wallets` - Create wallet
- `GET /api/v1/wallets/user/:userId` - Get user wallet
- `GET /api/v1/wallets/:walletId` - Get wallet by ID
- `POST /api/v1/wallets/:walletId/deposit` - Deposit to wallet
- `GET /api/v1/wallets/:walletId/transactions` - Transaction history

### Crypto
- `POST /api/v1/crypto/deposit-address` - Generate deposit address
- `GET /api/v1/crypto/transactions/:transactionId` - Get crypto transaction
- `GET /api/v1/crypto/transactions/user/:userId` - Get user crypto transactions
- `GET /api/v1/crypto/rates/:cryptocurrency` - Get exchange rate
- `GET /api/v1/crypto/rates` - Get all exchange rates
- `GET /api/v1/crypto/convert` - Convert amounts

### Webhooks
- `POST /api/v1/webhooks/crypto/deposit` - Crypto deposit webhook
- `POST /api/v1/webhooks/payment` - Payment webhook

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. Configure environment variables:
   ```bash
   cp .env.example .env
   ```

3. Start MongoDB and Redis

4. Run the service:
   ```bash
   npm run dev
   ```

## Environment Variables

See `.env.example` for all required configuration options.

## Security Features

- JWT authentication
- Request validation
- Rate limiting
- Webhook signature verification
- MongoDB injection protection
- CORS and Helmet.js protection

## Transaction Flow

### Crypto Deposit Flow
1. User requests deposit address
2. System generates unique address for cryptocurrency
3. User sends crypto to address
4. Webhook receives transaction notification
5. System tracks confirmations
6. Once confirmed, wallet is credited in USD

### Payment Flow
1. Payment created with pending status
2. User chooses payment method (wallet/crypto)
3. For wallet: funds deducted immediately
4. For crypto: payment linked to crypto transaction
5. Payment marked as completed

### Refund Flow
1. Refund requested for completed payment
2. Amount credited back to user wallet
3. No external refunds - all funds stay in system