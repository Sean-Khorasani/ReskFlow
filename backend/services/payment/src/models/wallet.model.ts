import mongoose, { Schema, Document } from 'mongoose';
import { Wallet, WalletStatus } from '../types';

export interface WalletDocument extends Document, Omit<Wallet, 'id'> {}

const walletSchema = new Schema<WalletDocument>(
  {
    userId: {
      type: String,
      required: true,
      unique: true,
      index: true
    },
    balance: {
      type: Number,
      required: true,
      default: 0,
      min: 0
    },
    currency: {
      type: String,
      required: true,
      default: 'USD'
    },
    status: {
      type: String,
      enum: Object.values(WalletStatus),
      default: WalletStatus.ACTIVE,
      index: true
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

// Add a method to check if wallet can be charged
walletSchema.methods.canBeCharged = function(amount: number): boolean {
  return this.status === WalletStatus.ACTIVE && amount > 0;
};

// Add a method to check if wallet has sufficient balance
walletSchema.methods.hasSufficientBalance = function(amount: number): boolean {
  return this.balance >= amount;
};

export const WalletModel = mongoose.model<WalletDocument>('Wallet', walletSchema);