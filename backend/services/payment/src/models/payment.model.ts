import mongoose, { Schema, Document } from 'mongoose';
import { Payment, PaymentStatus, PaymentMethod } from '../types';

export interface PaymentDocument extends Document, Omit<Payment, 'id'> {}

const paymentSchema = new Schema<PaymentDocument>(
  {
    userId: {
      type: String,
      required: true,
      index: true
    },
    orderId: {
      type: String,
      required: true,
      unique: true,
      index: true
    },
    amount: {
      type: Number,
      required: true,
      min: 0
    },
    currency: {
      type: String,
      required: true,
      default: 'USD'
    },
    status: {
      type: String,
      enum: Object.values(PaymentStatus),
      default: PaymentStatus.PENDING,
      index: true
    },
    method: {
      type: String,
      enum: Object.values(PaymentMethod),
      required: true
    },
    walletTransactionId: {
      type: String,
      sparse: true,
      index: true
    },
    cryptoTransactionId: {
      type: String,
      sparse: true,
      index: true
    },
    metadata: {
      type: Schema.Types.Mixed,
      default: {}
    },
    refundedAmount: {
      type: Number,
      default: 0,
      min: 0
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
paymentSchema.index({ userId: 1, createdAt: -1 });
paymentSchema.index({ status: 1, createdAt: -1 });

export const PaymentModel = mongoose.model<PaymentDocument>('Payment', paymentSchema);