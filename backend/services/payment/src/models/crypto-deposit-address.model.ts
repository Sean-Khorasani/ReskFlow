import mongoose, { Schema, Document } from 'mongoose';
import { CryptoDepositAddress, CryptoCurrency, BlockchainNetwork } from '../types';

export interface CryptoDepositAddressDocument extends Document, Omit<CryptoDepositAddress, 'id'> {}

const cryptoDepositAddressSchema = new Schema<CryptoDepositAddressDocument>(
  {
    userId: {
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
    address: {
      type: String,
      required: true,
      unique: true,
      index: true
    },
    isActive: {
      type: Boolean,
      default: true,
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

// Compound index for finding active addresses
cryptoDepositAddressSchema.index({ userId: 1, cryptocurrency: 1, network: 1, isActive: 1 });

export const CryptoDepositAddressModel = mongoose.model<CryptoDepositAddressDocument>(
  'CryptoDepositAddress',
  cryptoDepositAddressSchema
);