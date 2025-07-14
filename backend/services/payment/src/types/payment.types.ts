export enum PaymentStatus {
  PENDING = 'PENDING',
  PROCESSING = 'PROCESSING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  REFUNDED = 'REFUNDED',
  PARTIALLY_REFUNDED = 'PARTIALLY_REFUNDED'
}

export enum PaymentMethod {
  WALLET = 'WALLET',
  CRYPTO = 'CRYPTO'
}

export interface Payment {
  id: string;
  userId: string;
  orderId: string;
  amount: number;
  currency: string;
  status: PaymentStatus;
  method: PaymentMethod;
  walletTransactionId?: string;
  cryptoTransactionId?: string;
  metadata?: Record<string, any>;
  refundedAmount?: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreatePaymentDto {
  userId: string;
  orderId: string;
  amount: number;
  currency: string;
  method: PaymentMethod;
  metadata?: Record<string, any>;
}

export interface ProcessPaymentDto {
  paymentId: string;
  walletId?: string;
  cryptoPaymentData?: {
    cryptocurrency: string;
    transactionHash: string;
    fromAddress: string;
  };
}

export interface RefundPaymentDto {
  paymentId: string;
  amount: number;
  reason?: string;
}