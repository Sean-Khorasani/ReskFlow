import { Server, Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import { config, prisma, redis } from '@reskflow/shared';

interface AuthenticatedSocket extends Socket {
  userId?: string;
  userRole?: string;
}

export const setupWebSocketServer = (io: Server) => {
  // Authentication middleware
  io.use(async (socket: AuthenticatedSocket, next) => {
    try {
      const token = socket.handshake.auth.token;
      if (!token) {
        return next(new Error('Authentication required'));
      }

      const decoded: any = jwt.verify(token, config.jwt.secret);
      const session = await prisma.session.findUnique({
        where: { token },
        include: { user: true },
      });

      if (!session || session.expiresAt < new Date()) {
        return next(new Error('Invalid or expired token'));
      }

      socket.userId = session.user.id;
      socket.userRole = session.user.role;
      next();
    } catch (error) {
      next(new Error('Authentication failed'));
    }
  });

  io.on('connection', (socket: AuthenticatedSocket) => {
    console.log(`User ${socket.userId} connected`);

    // Join user's personal room
    socket.join(`user:${socket.userId}`);

    // Join role-based rooms
    if (socket.userRole === 'DRIVER') {
      socket.join('drivers');
    }

    // Handle location updates from drivers
    socket.on('location:update', async (data) => {
      if (socket.userRole !== 'DRIVER') {
        return socket.emit('error', { message: 'Drivers only' });
      }

      const { latitude, longitude, heading, speed } = data;

      // Store in Redis with TTL
      await redis.setJson(
        `location:driver:${socket.userId}`,
        {
          latitude,
          longitude,
          heading,
          speed,
          timestamp: new Date(),
        },
        300 // 5 minutes TTL
      );

      // Get driver's active deliveries
      const activeDeliveries = await prisma.delivery.findMany({
        where: {
          driverId: socket.userId,
          status: { in: ['ASSIGNED', 'PICKED_UP', 'IN_TRANSIT'] },
        },
        select: { id: true, senderId: true, recipientId: true },
      });

      // Update delivery locations and notify customers
      for (const delivery of activeDeliveries) {
        await redis.setJson(
          `location:delivery:${delivery.id}`,
          {
            latitude,
            longitude,
            timestamp: new Date(),
          },
          300
        );

        // Notify sender and recipient
        io.to(`user:${delivery.senderId}`).emit('delivery:location', {
          deliveryId: delivery.id,
          location: { latitude, longitude, timestamp: new Date() },
        });

        if (delivery.recipientId) {
          io.to(`user:${delivery.recipientId}`).emit('delivery:location', {
            deliveryId: delivery.id,
            location: { latitude, longitude, timestamp: new Date() },
          });
        }
      }
    });

    // Handle delivery tracking subscription
    socket.on('delivery:track', async (deliveryId) => {
      const delivery = await prisma.delivery.findUnique({
        where: { id: deliveryId },
        select: {
          senderId: true,
          recipientId: true,
          driverId: true,
        },
      });

      if (!delivery) {
        return socket.emit('error', { message: 'Delivery not found' });
      }

      // Check if user has access
      if (
        socket.userRole !== 'ADMIN' &&
        socket.userId !== delivery.senderId &&
        socket.userId !== delivery.recipientId &&
        socket.userId !== delivery.driverId
      ) {
        return socket.emit('error', { message: 'Access denied' });
      }

      // Join delivery room
      socket.join(`delivery:${deliveryId}`);

      // Send current location if available
      const currentLocation = await redis.getJson(`location:delivery:${deliveryId}`);
      if (currentLocation) {
        socket.emit('delivery:location', {
          deliveryId,
          location: currentLocation,
        });
      }
    });

    // Handle chat messages
    socket.on('message:send', async (data) => {
      const { deliveryId, message } = data;

      const delivery = await prisma.delivery.findUnique({
        where: { id: deliveryId },
        select: {
          senderId: true,
          recipientId: true,
          driverId: true,
        },
      });

      if (!delivery) {
        return socket.emit('error', { message: 'Delivery not found' });
      }

      // Check if user is part of the delivery
      if (
        socket.userId !== delivery.senderId &&
        socket.userId !== delivery.recipientId &&
        socket.userId !== delivery.driverId
      ) {
        return socket.emit('error', { message: 'Access denied' });
      }

      // Store message (in production, use a proper message storage)
      const chatMessage = {
        id: Date.now().toString(),
        deliveryId,
        senderId: socket.userId!,
        message,
        timestamp: new Date(),
      };

      // Send to all participants
      const participants = [
        delivery.senderId,
        delivery.recipientId,
        delivery.driverId,
      ].filter(Boolean);

      participants.forEach(userId => {
        io.to(`user:${userId}`).emit('message:receive', chatMessage);
      });
    });

    // Handle nearby drivers request
    socket.on('drivers:nearby', async (data) => {
      const { latitude, longitude, radius = 5 } = data; // radius in km

      // Get all online drivers from Redis
      const driverKeys = await redis.client.keys('location:driver:*');
      const nearbyDrivers = [];

      for (const key of driverKeys) {
        const driverLocation = await redis.getJson(key);
        if (!driverLocation) continue;

        // Calculate distance (simplified)
        const distance = Math.sqrt(
          Math.pow(driverLocation.latitude - latitude, 2) +
          Math.pow(driverLocation.longitude - longitude, 2)
        ) * 111; // Rough conversion to km

        if (distance <= radius) {
          const driverId = key.split(':')[2];
          const driver = await prisma.user.findUnique({
            where: { id: driverId },
            select: {
              id: true,
              firstName: true,
              lastName: true,
              profile: {
                select: {
                  vehicleType: true,
                  rating: true,
                },
              },
            },
          });

          if (driver) {
            nearbyDrivers.push({
              ...driver,
              location: driverLocation,
              distance,
            });
          }
        }
      }

      socket.emit('drivers:nearby:response', nearbyDrivers);
    });

    // Handle disconnect
    socket.on('disconnect', () => {
      console.log(`User ${socket.userId} disconnected`);
      
      // Clean up location data if driver
      if (socket.userRole === 'DRIVER') {
        redis.del(`location:driver:${socket.userId}`);
      }
    });
  });

  return io;
};