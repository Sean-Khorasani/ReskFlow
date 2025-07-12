import DataLoader from 'dataloader';
import { prisma } from '@reskflow/shared';
import { User, Address, Delivery } from '@prisma/client';

type UserWithProfile = User & { profile?: any };
type DeliveryWithRelations = Delivery & {
  sender?: User;
  recipient?: User;
  driver?: User;
  pickupAddress?: Address;
  deliveryAddress?: Address;
  trackingEvents?: any[];
};

export const getUserLoader = () => new DataLoader<string, UserWithProfile | null>(
  async (userIds) => {
    const users = await prisma.user.findMany({
      where: { id: { in: [...userIds] } },
      include: { profile: true },
    });
    
    const userMap = new Map(users.map(user => [user.id, user]));
    return userIds.map(id => userMap.get(id) || null);
  }
);

export const getAddressLoader = () => new DataLoader<string, Address | null>(
  async (addressIds) => {
    const addresses = await prisma.address.findMany({
      where: { id: { in: [...addressIds] } },
    });
    
    const addressMap = new Map(addresses.map(addr => [addr.id, addr]));
    return addressIds.map(id => addressMap.get(id) || null);
  }
);

export const getDeliveryLoader = () => new DataLoader<string, DeliveryWithRelations | null>(
  async (deliveryIds) => {
    const deliveries = await prisma.delivery.findMany({
      where: { id: { in: [...deliveryIds] } },
      include: {
        sender: true,
        recipient: true,
        driver: true,
        pickupAddress: true,
        deliveryAddress: true,
        trackingEvents: {
          orderBy: { createdAt: 'desc' },
          take: 10,
        },
      },
    });
    
    const deliveryMap = new Map(deliveries.map(del => [del.id, del]));
    return deliveryIds.map(id => deliveryMap.get(id) || null);
  }
);