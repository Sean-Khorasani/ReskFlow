import mongoose, { Schema, Document } from 'mongoose';
import { WalletTransaction, TransactionType } from '../types';

export interface WalletTransactionDocument extends Document, Omit<WalletTransaction, 'id'> {}

const walletTransactionSchema = new Schema<WalletTransactionDocument>(
  {
    walletId: {
      type: String,
      required: true,
      index: true
    },
    type: {
      type: String,
      enum: Object.values(TransactionType),
      required: true,
      index: true
    },
    amount: {
      type: Number,
      required: true
    },
    currency: {
      type: String,
      required: true,
      default: 'USD'
    },
    balanceBefore: {
      type: Number,
      required: true
    },
    balanceAfter: {
      type: Number,
      required: true
    },
    referenceId: {
      type: String,
      sparse: true,
      index: true
    },
    description: {
      type: String
    },
    metadata: {
      type: Schema.Types.Mixed,
      default: {}
    }
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
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
walletTransactionSchema.index({ walletId: 1, createdAt: -1 });
walletTransactionSchema.index({ type: 1, createdAt: -1 });
walletTransactionSchema.index({ referenceId: 1 });

export const WalletTransactionModel = mongoose.model<WalletTransactionDocument>(
  'WalletTransaction',
  walletTransactionSchema
);