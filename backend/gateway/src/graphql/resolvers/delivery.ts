import { Context } from '../context';
import { GraphQLError } from 'graphql';
import { v4 as uuidv4 } from 'uuid';

export const deliveryResolvers = {
  Query: {
    delivery: async (_: any, { id }: any, { user, loaders }: Context) => {
      if (!user) throw new GraphQLError('Not authenticated');
      
      const delivery = await loaders.delivery.load(id);
      
      if (!delivery) {
        throw new GraphQLError('Delivery not found');
      }

      // Check access permissions
      if (
        user.role !== 'ADMIN' &&
        delivery.senderId !== user.id &&
        delivery.recipientId !== user.id &&
        delivery.driverId !== user.id
      ) {
        throw new GraphQLError('Access denied');
      }

      return delivery;
    },

    deliveryByTracking: async (_: any, { trackingNumber }: any, { prisma }: Context) => {
      const delivery = await prisma.delivery.findUnique({
        where: { trackingNumber },
        include: {
          sender: true,
          recipient: true,
          driver: true,
          pickupAddress: true,
          deliveryAddress: true,
          trackingEvents: {
            orderBy: { createdAt: 'desc' },
          },
        },
      });

      if (!delivery) {
        throw new GraphQLError('Delivery not found');
      }

      return delivery;
    },

    deliveries: async (
      _: any,
      { status, driverId, senderId, first = 10, after }: any,
      { user, prisma }: Context
    ) => {
      if (!user) throw new GraphQLError('Not authenticated');

      const where: any = {};

      if (status) where.status = status;
      if (driverId) where.driverId = driverId;
      if (senderId) where.senderId = senderId;

      // Restrict based on user role
      if (user.role === 'CUSTOMER') {
        where.OR = [
          { senderId: user.id },
          { recipientId: user.id },
        ];
      } else if (user.role === 'DRIVER') {
        where.driverId = user.id;
      }

      const deliveries = await prisma.delivery.findMany({
        where,
        take: first + 1,
        cursor: after ? { id: after } : undefined,
        orderBy: { createdAt: 'desc' },
        include: {
          sender: true,
          recipient: true,
          driver: true,
          pickupAddress: true,
          deliveryAddress: true,
        },
      });

      const hasNextPage = deliveries.length > first;
      const edges = deliveries.slice(0, first).map(delivery => ({
        node: delivery,
        cursor: delivery.id,
      }));

      return {
        edges,
        pageInfo: {
          hasNextPage,
          hasPreviousPage: !!after,
          startCursor: edges[0]?.cursor,
          endCursor: edges[edges.length - 1]?.cursor,
        },
        totalCount: await prisma.delivery.count({ where }),
      };
    },

    deliveryStats: async (_: any, { startDate, endDate }: any, { user, prisma }: Context) => {
      if (!user || user.role !== 'ADMIN') {
        throw new GraphQLError('Admin access required');
      }

      const where: any = {};
      if (startDate || endDate) {
        where.createdAt = {};
        if (startDate) where.createdAt.gte = new Date(startDate);
        if (endDate) where.createdAt.lte = new Date(endDate);
      }

      const [totalDeliveries, completedDeliveries, deliveryTimes, revenue, activeDrivers] = await Promise.all([
        prisma.delivery.count({ where }),
        prisma.delivery.count({ where: { ...where, status: 'DELIVERED' } }),
        prisma.delivery.findMany({
          where: { ...where, status: 'DELIVERED', actualDelivery: { not: null } },
          select: {
            createdAt: true,
            actualDelivery: true,
          },
        }),
        prisma.delivery.aggregate({
          where: { ...where, status: 'DELIVERED' },
          _sum: { platformFee: true },
        }),
        prisma.user.count({
          where: {
            role: 'DRIVER',
            isActive: true,
            driverDeliveries: {
              some: {
                createdAt: where.createdAt,
              },
            },
          },
        }),
      ]);

      const avgDeliveryTime = deliveryTimes.length > 0
        ? deliveryTimes.reduce((sum, d) => {
            const time = d.actualDelivery!.getTime() - d.createdAt.getTime();
            return sum + time;
          }, 0) / deliveryTimes.length / (1000 * 60) // Convert to minutes
        : 0;

      return {
        totalDeliveries,
        completedDeliveries,
        averageDeliveryTime: avgDeliveryTime,
        totalRevenue: revenue._sum.platformFee || 0,
        activeDrivers,
      };
    },

    optimizeRoute: async (_: any, { input }: any, { user, prisma }: Context) => {
      if (!user || (user.role !== 'DRIVER' && user.role !== 'ADMIN')) {
        throw new GraphQLError('Driver or admin access required');
      }

      // This is a simplified version - in production, you'd use a proper routing service
      const deliveries = await prisma.delivery.findMany({
        where: {
          id: { in: input.deliveryIds },
          status: { in: ['ASSIGNED', 'PICKED_UP'] },
        },
        include: {
          pickupAddress: true,
          deliveryAddress: true,
        },
      });

      // Simple distance calculation (Haversine formula)
      const calculateDistance = (lat1: number, lon1: number, lat2: number, lon2: number) => {
        const R = 6371; // Earth's radius in km
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLon = (lon2 - lon1) * Math.PI / 180;
        const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
          Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
          Math.sin(dLon/2) * Math.sin(dLon/2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
        return R * c;
      };

      // Sort deliveries by proximity (nearest neighbor algorithm)
      let currentLat = input.startLocation.latitude;
      let currentLon = input.startLocation.longitude;
      const optimizedRoute = [];
      const remaining = [...deliveries];
      let totalDistance = 0;

      while (remaining.length > 0) {
        let nearestIdx = 0;
        let nearestDistance = Infinity;

        remaining.forEach((delivery, idx) => {
          const targetLat = delivery.status === 'ASSIGNED' 
            ? delivery.pickupAddress.latitude 
            : delivery.deliveryAddress.latitude;
          const targetLon = delivery.status === 'ASSIGNED'
            ? delivery.pickupAddress.longitude
            : delivery.deliveryAddress.longitude;

          const distance = calculateDistance(currentLat, currentLon, targetLat, targetLon);
          if (distance < nearestDistance) {
            nearestDistance = distance;
            nearestIdx = idx;
          }
        });

        const nearest = remaining.splice(nearestIdx, 1)[0];
        const targetAddress = nearest.status === 'ASSIGNED' 
          ? nearest.pickupAddress 
          : nearest.deliveryAddress;

        totalDistance += nearestDistance;

        optimizedRoute.push({
          deliveryId: nearest.id,
          sequence: optimizedRoute.length + 1,
          estimatedArrival: new Date(Date.now() + (totalDistance * 2 * 60 * 1000)), // 2 min/km
          distance: nearestDistance,
          duration: Math.round(nearestDistance * 2), // 2 min/km
        });

        currentLat = targetAddress.latitude;
        currentLon = targetAddress.longitude;
      }

      return {
        optimizedRoute,
        totalDistance,
        totalDuration: Math.round(totalDistance * 2),
        estimatedCost: totalDistance * 0.5, // $0.50/km
      };
    },
  },

  Mutation: {
    createDelivery: async (_: any, { input }: any, { user, prisma, blockchain, pubsub }: Context) => {
      if (!user) throw new GraphQLError('Not authenticated');

      // Generate tracking number
      const trackingNumber = `DLV${Date.now()}${Math.random().toString(36).substr(2, 5)}`.toUpperCase();

      // Calculate price based on distance and package details
      const pickupAddress = await prisma.address.findUnique({
        where: { id: input.pickupAddressId },
      });
      const deliveryAddress = await prisma.address.findUnique({
        where: { id: input.deliveryAddressId },
      });

      if (!pickupAddress || !deliveryAddress) {
        throw new GraphQLError('Invalid addresses');
      }

      const distance = Math.sqrt(
        Math.pow(deliveryAddress.latitude - pickupAddress.latitude, 2) +
        Math.pow(deliveryAddress.longitude - pickupAddress.longitude, 2)
      ) * 111; // Rough conversion to km

      const basePrice = 5; // $5 base fee
      const distancePrice = distance * 0.5; // $0.50/km
      const weightPrice = (input.packageDetails.weight || 1) * 0.1; // $0.10/kg
      const price = basePrice + distancePrice + weightPrice;

      // Create delivery in database
      const delivery = await prisma.delivery.create({
        data: {
          trackingNumber,
          senderId: user.id,
          recipientId: input.recipientId,
          pickupAddressId: input.pickupAddressId,
          deliveryAddressId: input.deliveryAddressId,
          packageDetails: input.packageDetails,
          weight: input.packageDetails.weight || 1,
          dimensions: input.packageDetails.dimensions || { length: 0, width: 0, height: 0 },
          value: input.packageDetails.value || 0,
          scheduledPickup: input.scheduledPickup,
          scheduledDelivery: input.scheduledDelivery,
          priority: input.priority || 0,
          insuranceAmount: input.insuranceAmount,
          distance,
          price,
          platformFee: price * 0.15, // 15% platform fee
          status: 'CREATED',
        },
        include: {
          sender: true,
          recipient: true,
          pickupAddress: true,
          deliveryAddress: true,
        },
      });

      // Create on blockchain
      try {
        const ipfsHash = await blockchain.hashDeliveryData({
          id: delivery.id,
          trackingNumber: delivery.trackingNumber,
          packageDetails: input.packageDetails,
        });

        const tx = await blockchain.createDeliveryOnChain(
          delivery.id,
          delivery.recipientId || '0x0000000000000000000000000000000000000000',
          ipfsHash,
          BigInt(Math.floor(price * 1e18)) // Convert to wei
        );

        await prisma.delivery.update({
          where: { id: delivery.id },
          data: {
            blockchainId: tx.transactionHash,
            ipfsHash,
          },
        });
      } catch (error) {
        console.error('Blockchain error:', error);
        // Continue without blockchain for now
      }

      // Publish event
      pubsub.publish('DELIVERY_CREATED', { deliveryCreated: delivery });

      return delivery;
    },

    updateDeliveryStatus: async (_: any, { input }: any, { user, prisma, blockchain, pubsub }: Context) => {
      if (!user) throw new GraphQLError('Not authenticated');

      const delivery = await prisma.delivery.findUnique({
        where: { id: input.deliveryId },
        include: {
          sender: true,
          recipient: true,
          driver: true,
        },
      });

      if (!delivery) {
        throw new GraphQLError('Delivery not found');
      }

      // Check permissions
      if (
        user.role !== 'ADMIN' &&
        (user.role !== 'DRIVER' || delivery.driverId !== user.id)
      ) {
        throw new GraphQLError('Access denied');
      }

      // Create tracking event
      await prisma.trackingEvent.create({
        data: {
          deliveryId: input.deliveryId,
          status: input.status,
          location: input.location || {},
          description: input.description,
          proof: input.proof,
        },
      });

      // Update delivery status
      const updatedDelivery = await prisma.delivery.update({
        where: { id: input.deliveryId },
        data: {
          status: input.status,
          actualPickup: input.status === 'PICKED_UP' ? new Date() : undefined,
          actualDelivery: input.status === 'DELIVERED' ? new Date() : undefined,
        },
        include: {
          sender: true,
          recipient: true,
          driver: true,
          pickupAddress: true,
          deliveryAddress: true,
          trackingEvents: {
            orderBy: { createdAt: 'desc' },
          },
        },
      });

      // Update on blockchain
      try {
        const statusMap: any = {
          'CREATED': 0,
          'ASSIGNED': 1,
          'PICKED_UP': 2,
          'IN_TRANSIT': 3,
          'DELIVERED': 4,
          'CANCELLED': 5,
          'FAILED': 6,
        };

        await blockchain.updateDeliveryStatus(
          delivery.id,
          statusMap[input.status],
          JSON.stringify(input.location || {}),
          input.proof || ''
        );
      } catch (error) {
        console.error('Blockchain error:', error);
      }

      // Publish update
      pubsub.publish(`DELIVERY_UPDATED_${input.deliveryId}`, {
        deliveryUpdated: updatedDelivery,
      });

      return updatedDelivery;
    },
  },

  Delivery: {
    currentLocation: async (delivery: any, _: any, { redis }: Context) => {
      const location = await redis.getJson(`location:delivery:${delivery.id}`);
      return location;
    },

    estimatedArrival: async (delivery: any) => {
      if (delivery.status === 'DELIVERED') return delivery.actualDelivery;
      if (delivery.scheduledDelivery) return delivery.scheduledDelivery;
      
      // Simple estimation based on distance and status
      const timePerKm = 2; // minutes
      const statusTimes: any = {
        'CREATED': delivery.distance * timePerKm + 60,
        'ASSIGNED': delivery.distance * timePerKm + 30,
        'PICKED_UP': delivery.distance * timePerKm,
        'IN_TRANSIT': delivery.distance * timePerKm * 0.5,
      };

      const estimatedMinutes = statusTimes[delivery.status] || 120;
      return new Date(Date.now() + estimatedMinutes * 60 * 1000);
    },
  },
};