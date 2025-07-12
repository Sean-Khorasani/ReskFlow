import dotenv from 'dotenv';

dotenv.config();

export const config = {
  app: {
    port: process.env.PORT || 3003,
    env: process.env.NODE_ENV || 'development',
    name: 'payment-service'
  },
  database: {
    uri: process.env.DATABASE_URI || 'mongodb://localhost:27017/payment-service',
    options: {
      useNewUrlParser: true,
      useUnifiedTopology: true
    }
  },
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379'),
    password: process.env.REDIS_PASSWORD
  },
  crypto: {
    bitcoin: {
      rpcUrl: process.env.BITCOIN_RPC_URL,
      rpcUser: process.env.BITCOIN_RPC_USER,
      rpcPassword: process.env.BITCOIN_RPC_PASSWORD,
      network: process.env.BITCOIN_NETWORK || 'testnet',
      confirmations: parseInt(process.env.BITCOIN_CONFIRMATIONS || '3')
    },
    ethereum: {
      rpcUrl: process.env.ETHEREUM_RPC_URL,
      network: process.env.ETHEREUM_NETWORK || 'goerli',
      confirmations: parseInt(process.env.ETHEREUM_CONFIRMATIONS || '12')
    },
    polygon: {
      rpcUrl: process.env.POLYGON_RPC_URL,
      network: process.env.POLYGON_NETWORK || 'mumbai',
      confirmations: parseInt(process.env.POLYGON_CONFIRMATIONS || '20')
    },
    exchangeRateApi: {
      url: process.env.EXCHANGE_RATE_API_URL || 'https://api.coingecko.com/api/v3',
      apiKey: process.env.EXCHANGE_RATE_API_KEY
    }
  },
  webhook: {
    secret: process.env.WEBHOOK_SECRET || 'webhook-secret-key',
    timeout: parseInt(process.env.WEBHOOK_TIMEOUT || '30000')
  },
  jwt: {
    secret: process.env.JWT_SECRET || 'payment-service-secret',
    expiresIn: process.env.JWT_EXPIRES_IN || '7d'
  },
  queue: {
    concurrency: parseInt(process.env.QUEUE_CONCURRENCY || '5'),
    retryAttempts: parseInt(process.env.QUEUE_RETRY_ATTEMPTS || '3'),
    retryDelay: parseInt(process.env.QUEUE_RETRY_DELAY || '5000')
  },
  limits: {
    maxDepositAmount: parseFloat(process.env.MAX_DEPOSIT_AMOUNT || '10000'),
    minDepositAmount: parseFloat(process.env.MIN_DEPOSIT_AMOUNT || '1'),
    maxWalletBalance: parseFloat(process.env.MAX_WALLET_BALANCE || '100000'),
    transactionExpiry: parseInt(process.env.TRANSACTION_EXPIRY || '3600000') // 1 hour
  }
};