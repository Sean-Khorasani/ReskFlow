import { Request } from 'express';
import { PubSub } from 'graphql-subscriptions';
import DataLoader from 'dataloader';
import { prisma, redis, blockchain } from '@reskflow/shared';
import { getUserLoader, getAddressLoader, getDeliveryLoader } from './dataloaders';
import { User, Address, Delivery } from '@prisma/client';

type UserWithProfile = User & { profile?: any };
type DeliveryWithRelations = Delivery & {
  sender?: User;
  recipient?: User;
  driver?: User;
  pickupAddress?: Address;
  reskflowAddress?: Address;
  trackingEvents?: any[];
};

export interface Context {
  req: Request;
  prisma: typeof prisma;
  redis: typeof redis;
  blockchain: typeof blockchain;
  pubsub: PubSub;
  user?: {
    id: string;
    email: string;
    role: string;
    walletAddress?: string;
  };
  loaders: {
    user: DataLoader<string, UserWithProfile | null>;
    address: DataLoader<string, Address | null>;
    reskflow: DataLoader<string, DeliveryWithRelations | null>;
  };
}

const pubsub = new PubSub();

export const createContext = ({ req }: { req: Request }): Context => {
  // Extract user from request (set by auth middleware)
  const user = (req as any).user;

  return {
    req,
    prisma,
    redis,
    blockchain,
    pubsub,
    user,
    loaders: {
      user: getUserLoader(),
      address: getAddressLoader(),
      reskflow: getDeliveryLoader(),
    },
  };
};