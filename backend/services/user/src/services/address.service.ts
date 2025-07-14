import { Address, AddressType, Prisma } from '@prisma/client';
import { prisma } from '../utils/prisma';
import { AppError } from '../middleware/error.middleware';
import { logger } from '../utils/logger';

interface CreateAddressData {
  type: AddressType;
  label?: string;
  street: string;
  apartment?: string;
  city: string;
  state: string;
  zipCode: string;
  country: string;
  latitude: number;
  longitude: number;
  instructions?: string;
  isDefault?: boolean;
}

export class AddressService {
  async getUserAddresses(userId: string): Promise<Address[]> {
    return prisma.address.findMany({
      where: { userId },
      orderBy: [
        { isDefault: 'desc' },
        { createdAt: 'desc' }
      ]
    });
  }

  async getAddress(addressId: string, userId: string): Promise<Address> {
    const address = await prisma.address.findFirst({
      where: {
        id: addressId,
        userId
      }
    });

    if (!address) {
      throw new AppError(404, 'Address not found');
    }

    return address;
  }

  async createAddress(userId: string, data: CreateAddressData): Promise<Address> {
    // If this is set as default, unset other default addresses
    if (data.isDefault) {
      await prisma.address.updateMany({
        where: { userId, isDefault: true },
        data: { isDefault: false }
      });
    }

    // Check if this is the first address
    const addressCount = await prisma.address.count({
      where: { userId }
    });

    const address = await prisma.address.create({
      data: {
        ...data,
        userId,
        isDefault: data.isDefault || addressCount === 0
      }
    });

    logger.info(`Address created for user: ${userId}`);

    return address;
  }

  async updateAddress(
    addressId: string,
    userId: string,
    data: Partial<CreateAddressData>
  ): Promise<Address> {
    // Verify ownership
    const existing = await this.getAddress(addressId, userId);

    const address = await prisma.address.update({
      where: { id: addressId },
      data
    });

    logger.info(`Address updated: ${addressId} for user: ${userId}`);

    return address;
  }

  async deleteAddress(addressId: string, userId: string): Promise<void> {
    // Verify ownership
    const address = await this.getAddress(addressId, userId);

    // If deleting default address, set another as default
    if (address.isDefault) {
      const otherAddress = await prisma.address.findFirst({
        where: {
          userId,
          id: { not: addressId }
        },
        orderBy: { createdAt: 'desc' }
      });

      if (otherAddress) {
        await prisma.address.update({
          where: { id: otherAddress.id },
          data: { isDefault: true }
        });
      }
    }

    await prisma.address.delete({
      where: { id: addressId }
    });

    logger.info(`Address deleted: ${addressId} for user: ${userId}`);
  }

  async setDefaultAddress(addressId: string, userId: string): Promise<void> {
    // Verify ownership
    await this.getAddress(addressId, userId);

    // Unset current default
    await prisma.address.updateMany({
      where: { userId, isDefault: true },
      data: { isDefault: false }
    });

    // Set new default
    await prisma.address.update({
      where: { id: addressId },
      data: { isDefault: true }
    });

    logger.info(`Default address set: ${addressId} for user: ${userId}`);
  }
}