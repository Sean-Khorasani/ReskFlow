import { Context } from '../context';
import { GraphQLError } from 'graphql';
// import { v4 as uuidv4 } from 'uuid';

interface DeliveryArgs {
  id: string;
}

interface DeliveryByTrackingArgs {
  trackingNumber: string;
}

interface DeliveriesArgs {
  status?: string;
  driverId?: string;
  senderId?: string;
  first?: number;
  after?: string;
}

interface DeliveryStatsArgs {
  startDate?: string;
  endDate?: string;
}

interface OptimizeRouteInput {
  reskflowIds: string[];
  startLocation: {
    latitude: number;
    longitude: number;
  };
}

interface OptimizeRouteArgs {
  input: OptimizeRouteInput;
}

interface CreateDeliveryInput {
  recipientId: string;
  pickupAddressId: string;
  reskflowAddressId: string;
  packageDetails: {
    weight?: number;
    dimensions?: { length: number; width: number; height: number };
    value?: number;
  };
  scheduledPickup?: Date;
  scheduledDelivery?: Date;
  priority?: number;
  insuranceAmount?: number;
}

interface CreateDeliveryArgs {
  input: CreateDeliveryInput;
}

interface UpdateDeliveryStatusInput {
  reskflowId: string;
  status: string;
  location?: any;
  description?: string;
  proof?: string;
}

interface UpdateDeliveryStatusArgs {
  input: UpdateDeliveryStatusInput;
}

export const reskflowResolvers = {
  Query: {
    reskflow: async (_: any, { id }: any, { user, loaders }: Context) => {
      if (!user) throw new GraphQLError('Not authenticated');
      
      const reskflow = await loaders.reskflow.load(id);
      
      if (!reskflow) {
        throw new GraphQLError('Delivery not found');
      }

      // Check access permissions
      if (
        user.role !== 'ADMIN' &&
        reskflow.senderId !== user.id &&
        reskflow.recipientId !== user.id &&
        reskflow.driverId !== user.id
      ) {
        throw new GraphQLError('Access denied');
      }

      return reskflow;
    },

    reskflowByTracking: async (_: any, { trackingNumber }: any, { prisma }: Context) => {
      const reskflow = await prisma.reskflow.findUnique({
        where: { trackingNumber },
        include: {
          sender: true,
          recipient: true,
          driver: true,
          pickupAddress: true,
          reskflowAddress: true,
          trackingEvents: {
            orderBy: { createdAt: 'desc' },
          },
        },
      });

      if (!reskflow) {
        throw new GraphQLError('Delivery not found');
      }

      return reskflow;
    },

    deliveries: async (
      _: any,
      { status, driverId, senderId, first = 10, after }: any,
      { user, prisma }: Context
    ) => {
      if (!user) throw new GraphQLError('Not authenticated');

      const where: Record<string, any> = {};

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

      const deliveries = await prisma.reskflow.findMany({
        where,
        take: first + 1,
        cursor: after ? { id: after } : undefined,
        orderBy: { createdAt: 'desc' },
        include: {
          sender: true,
          recipient: true,
          driver: true,
          pickupAddress: true,
          reskflowAddress: true,
        },
      });

      const hasNextPage = deliveries.length > first;
      const edges = deliveries.slice(0, first).map(reskflow => ({
        node: reskflow,
        cursor: reskflow.id,
      }));

      return {
        edges,
        pageInfo: {
          hasNextPage,
          hasPreviousPage: !!after,
          startCursor: edges[0]?.cursor,
          endCursor: edges[edges.length - 1]?.cursor,
        },
        totalCount: await prisma.reskflow.count({ where }),
      };
    },

    reskflowStats: async (_: any, { startDate, endDate }: any, { user, prisma }: Context) => {
      if (!user || user.role !== 'ADMIN') {
        throw new GraphQLError('Admin access required');
      }

      const where: Record<string, any> = {};
      if (startDate || endDate) {
        where.createdAt = {};
        if (startDate) where.createdAt.gte = new Date(startDate);
        if (endDate) where.createdAt.lte = new Date(endDate);
      }

      const [totalDeliveries, completedDeliveries, reskflowTimes, revenue, activeDrivers] = await Promise.all([
        prisma.reskflow.count({ where }),
        prisma.reskflow.count({ where: { ...where, status: 'DELIVERED' } }),
        prisma.reskflow.findMany({
          where: { ...where, status: 'DELIVERED', actualDelivery: { not: null } },
          select: {
            createdAt: true,
            actualDelivery: true,
          },
        }),
        prisma.reskflow.aggregate({
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

      const avgDeliveryTime = reskflowTimes.length > 0
        ? reskflowTimes.reduce((sum, d) => {
            const time = d.actualDelivery!.getTime() - d.createdAt.getTime();
            return sum + time;
          }, 0) / reskflowTimes.length / (1000 * 60) // Convert to minutes
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
      const deliveries = await prisma.reskflow.findMany({
        where: {
          id: { in: input.reskflowIds },
          status: { in: ['ASSIGNED', 'PICKED_UP'] },
        },
        include: {
          pickupAddress: true,
          reskflowAddress: true,
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

        remaining.forEach((reskflow, idx) => {
          const targetLat = reskflow.status === 'ASSIGNED' 
            ? reskflow.pickupAddress.latitude 
            : reskflow.reskflowAddress.latitude;
          const targetLon = reskflow.status === 'ASSIGNED'
            ? reskflow.pickupAddress.longitude
            : reskflow.reskflowAddress.longitude;

          const distance = calculateDistance(currentLat, currentLon, targetLat, targetLon);
          if (distance < nearestDistance) {
            nearestDistance = distance;
            nearestIdx = idx;
          }
        });

        const nearest = remaining.splice(nearestIdx, 1)[0];
        const targetAddress = nearest.status === 'ASSIGNED' 
          ? nearest.pickupAddress 
          : nearest.reskflowAddress;

        totalDistance += nearestDistance;

        optimizedRoute.push({
          reskflowId: nearest.id,
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
      const reskflowAddress = await prisma.address.findUnique({
        where: { id: input.reskflowAddressId },
      });

      if (!pickupAddress || !reskflowAddress) {
        throw new GraphQLError('Invalid addresses');
      }

      const distance = Math.sqrt(
        Math.pow(reskflowAddress.latitude - pickupAddress.latitude, 2) +
        Math.pow(reskflowAddress.longitude - pickupAddress.longitude, 2)
      ) * 111; // Rough conversion to km

      const basePrice = 5; // $5 base fee
      const distancePrice = distance * 0.5; // $0.50/km
      const weightPrice = (input.packageDetails.weight || 1) * 0.1; // $0.10/kg
      const price = basePrice + distancePrice + weightPrice;

      // Create reskflow in database
      const reskflow = await prisma.reskflow.create({
        data: {
          trackingNumber,
          senderId: user.id,
          recipientId: input.recipientId,
          pickupAddressId: input.pickupAddressId,
          reskflowAddressId: input.reskflowAddressId,
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
          reskflowAddress: true,
        },
      });

      // Create on blockchain
      try {
        const ipfsHash = await blockchain.hashDeliveryData({
          id: reskflow.id,
          trackingNumber: reskflow.trackingNumber,
          packageDetails: input.packageDetails,
        });

        const tx = await blockchain.createDeliveryOnChain(
          reskflow.id,
          reskflow.recipientId || '0x0000000000000000000000000000000000000000',
          ipfsHash,
          BigInt(Math.floor(price * 1e18)) // Convert to wei
        );

        await prisma.reskflow.update({
          where: { id: reskflow.id },
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
      pubsub.publish('DELIVERY_CREATED', { reskflowCreated: reskflow });

      return reskflow;
    },

    updateDeliveryStatus: async (_: any, { input }: any, { user, prisma, blockchain, pubsub }: Context) => {
      if (!user) throw new GraphQLError('Not authenticated');

      const reskflow = await prisma.reskflow.findUnique({
        where: { id: input.reskflowId },
        include: {
          sender: true,
          recipient: true,
          driver: true,
        },
      });

      if (!reskflow) {
        throw new GraphQLError('Delivery not found');
      }

      // Check permissions
      if (
        user.role !== 'ADMIN' &&
        (user.role !== 'DRIVER' || reskflow.driverId !== user.id)
      ) {
        throw new GraphQLError('Access denied');
      }

      // Create tracking event
      await prisma.trackingEvent.create({
        data: {
          reskflowId: input.reskflowId,
          status: input.status,
          location: input.location || {},
          description: input.description,
          proof: input.proof,
        },
      });

      // Update reskflow status
      const updatedDelivery = await prisma.reskflow.update({
        where: { id: input.reskflowId },
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
          reskflowAddress: true,
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
          reskflow.id,
          statusMap[input.status],
          JSON.stringify(input.location || {}),
          input.proof || ''
        );
      } catch (error) {
        console.error('Blockchain error:', error);
      }

      // Publish update
      pubsub.publish(`DELIVERY_UPDATED_${input.reskflowId}`, {
        reskflowUpdated: updatedDelivery,
      });

      return updatedDelivery;
    },
  },

  Delivery: {
    currentLocation: async (reskflow: any, _: any, { redis }: Context) => {
      const location = await redis.getJson(`location:reskflow:${reskflow.id}`);
      return location;
    },

    estimatedArrival: async (reskflow: any) => {
      if (reskflow.status === 'DELIVERED') return reskflow.actualDelivery;
      if (reskflow.scheduledDelivery) return reskflow.scheduledDelivery;
      
      // Simple estimation based on distance and status
      const timePerKm = 2; // minutes
      const statusTimes: any = {
        'CREATED': reskflow.distance * timePerKm + 60,
        'ASSIGNED': reskflow.distance * timePerKm + 30,
        'PICKED_UP': reskflow.distance * timePerKm,
        'IN_TRANSIT': reskflow.distance * timePerKm * 0.5,
      };

      const estimatedMinutes = statusTimes[reskflow.status] || 120;
      return new Date(Date.now() + estimatedMinutes * 60 * 1000);
    },
  },
};