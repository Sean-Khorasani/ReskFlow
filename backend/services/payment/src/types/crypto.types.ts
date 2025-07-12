export enum CryptoCurrency {
  BTC = 'BTC',
  ETH = 'ETH',
  USDT = 'USDT',
  USDC = 'USDC',
  MATIC = 'MATIC'
}

export enum CryptoTransactionStatus {
  PENDING = 'PENDING',
  CONFIRMING = 'CONFIRMING',
  CONFIRMED = 'CONFIRMED',
  FAILED = 'FAILED',
  EXPIRED = 'EXPIRED'
}

export enum BlockchainNetwork {
  BITCOIN = 'BITCOIN',
  ETHEREUM = 'ETHEREUM',
  POLYGON = 'POLYGON',
  BSC = 'BSC'
}

export interface CryptoTransaction {
  id: string;
  userId: string;
  walletId: string;
  cryptocurrency: CryptoCurrency;
  network: BlockchainNetwork;
  amount: number;
  amountInUSD: number;
  exchangeRate: number;
  status: CryptoTransactionStatus;
  depositAddress: string;
  transactionHash?: string;
  fromAddress?: string;
  confirmations: number;
  requiredConfirmations: number;
  blockNumber?: number;
  fee?: number;
  metadata?: Record<string, any>;
  expiresAt?: Date;
  confirmedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface CryptoDepositAddress {
  id: string;
  userId: string;
  cryptocurrency: CryptoCurrency;
  network: BlockchainNetwork;
  address: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateCryptoDepositDto {
  userId: string;
  walletId: string;
  cryptocurrency: CryptoCurrency;
  network: BlockchainNetwork;
  amount?: number; // optional, user can send any amount
}

export interface CryptoDepositWebhookDto {
  transactionHash: string;
  fromAddress: string;
  toAddress: string;
  amount: number;
  cryptocurrency: CryptoCurrency;
  network: BlockchainNetwork;
  confirmations: number;
  blockNumber: number;
}

export interface ExchangeRate {
  from: CryptoCurrency;
  to: string; // USD, EUR, etc.
  rate: number;
  timestamp: Date;
}