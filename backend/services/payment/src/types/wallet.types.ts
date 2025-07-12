export enum WalletStatus {
  ACTIVE = 'ACTIVE',
  SUSPENDED = 'SUSPENDED',
  FROZEN = 'FROZEN'
}

export enum TransactionType {
  DEPOSIT = 'DEPOSIT',
  PAYMENT = 'PAYMENT',
  REFUND = 'REFUND',
  CRYPTO_DEPOSIT = 'CRYPTO_DEPOSIT'
}

export interface Wallet {
  id: string;
  userId: string;
  balance: number;
  currency: string;
  status: WalletStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface WalletTransaction {
  id: string;
  walletId: string;
  type: TransactionType;
  amount: number;
  currency: string;
  balanceBefore: number;
  balanceAfter: number;
  referenceId?: string; // payment id, crypto transaction id, etc.
  description?: string;
  metadata?: Record<string, any>;
  createdAt: Date;
}

export interface CreateWalletDto {
  userId: string;
  currency: string;
  initialBalance?: number;
}

export interface DepositDto {
  walletId: string;
  amount: number;
  currency: string;
  referenceId?: string;
  description?: string;
  metadata?: Record<string, any>;
}

export interface ChargeWalletDto {
  walletId: string;
  amount: number;
  paymentId: string;
  description?: string;
}