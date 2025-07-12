import mongoose, { Schema, Document } from 'mongoose';
import { CryptoTransaction, CryptoCurrency, CryptoTransactionStatus, BlockchainNetwork } from '../types';

export interface CryptoTransactionDocument extends Document, Omit<CryptoTransaction, 'id'> {}

const cryptoTransactionSchema = new Schema<CryptoTransactionDocument>(
  {
    userId: {
      type: String,
      required: true,
      index: true
    },
    walletId: {
      type: String,
      required: true,
      index: true
    },
    cryptocurrency: {
      type: String,
      enum: Object.values(CryptoCurrency),
      required: true,
      index: true
    },
    network: {
      type: String,
      enum: Object.values(BlockchainNetwork),
      required: true
    },
    amount: {
      type: Number,
      required: true,
      min: 0
    },
    amountInUSD: {
      type: Number,
      required: true,
      min: 0
    },
    exchangeRate: {
      type: Number,
      required: true,
      min: 0
    },
    status: {
      type: String,
      enum: Object.values(CryptoTransactionStatus),
      default: CryptoTransactionStatus.PENDING,
      index: true
    },
    depositAddress: {
      type: String,
      required: true,
      index: true
    },
    transactionHash: {
      type: String,
      sparse: true,
      index: true
    },
    fromAddress: {
      type: String,
      sparse: true
    },
    confirmations: {
      type: Number,
      default: 0,
      min: 0
    },
    requiredConfirmations: {
      type: Number,
      required: true,
      min: 1
    },
    blockNumber: {
      type: Number,
      sparse: true
    },
    fee: {
      type: Number,
      min: 0
    },
    metadata: {
      type: Schema.Types.Mixed,
      default: {}
    },
    expiresAt: {
      type: Date,
      index: true
    },
    confirmedAt: {
      type: Date
    }
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform: (doc, ret) => {
        ret.id = ret._id;
        delete ret._id;
        delete ret.__v;
        return ret;
      }
    }
  }
);

// Indexes
cryptoTransactionSchema.index({ userId: 1, createdAt: -1 });
cryptoTransactionSchema.index({ status: 1, createdAt: -1 });
cryptoTransactionSchema.index({ transactionHash: 1 });
cryptoTransactionSchema.index({ depositAddress: 1, status: 1 });

export const CryptoTransactionModel = mongoose.model<CryptoTransactionDocument>(
  'CryptoTransaction',
  cryptoTransactionSchema
);