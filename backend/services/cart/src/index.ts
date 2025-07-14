import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { config, logger, connectDatabase, prisma, redis } from '@reskflow/shared';
import { CartService } from './services/CartService';
import { GroupOrderService } from './services/GroupOrderService';
import { CartSharingService } from './services/CartSharingService';
import { authenticate } from '@reskflow/shared';

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
});

app.use(express.json());

let cartService: CartService;
let groupOrderService: GroupOrderService;
let cartSharingService: CartSharingService;

async function startService() {
  try {
    await connectDatabase();
    logger.info('Cart service: Database connected');

    // Initialize services
    cartService = new CartService();
    groupOrderService = new GroupOrderService(io);
    cartSharingService = new CartSharingService(io);

    // Health check
    app.get('/health', (req, res) => {
      res.json({ status: 'healthy', service: 'cart' });
    });

    // Cart endpoints
    app.get('/cart/:userId', authenticate, async (req, res) => {
      try {
        const { userId } = req.params;
        
        if (req.user!.id !== userId && req.user!.role !== 'ADMIN') {
          return res.status(403).json({ error: 'Forbidden' });
        }

        const cart = await cartService.getCart(userId);
        res.json(cart);
      } catch (error) {
        logger.error('Failed to get cart', error);
        res.status(500).json({ error: 'Failed to get cart' });
      }
    });

    app.post('/cart/:userId/items', authenticate, async (req, res) => {
      try {
        const { userId } = req.params;
        const { merchantId, itemId, quantity, modifiers, specialInstructions } = req.body;

        if (req.user!.id !== userId) {
          return res.status(403).json({ error: 'Forbidden' });
        }

        const item = await cartService.addItem(userId, {
          merchantId,
          itemId,
          quantity,
          modifiers,
          specialInstructions,
        });

        res.status(201).json(item);
      } catch (error) {
        logger.error('Failed to add item to cart', error);
        res.status(400).json({ error: 'Failed to add item' });
      }
    });

    app.put('/cart/:userId/items/:cartItemId', authenticate, async (req, res) => {
      try {
        const { userId, cartItemId } = req.params;
        const { quantity, modifiers, specialInstructions } = req.body;

        if (req.user!.id !== userId) {
          return res.status(403).json({ error: 'Forbidden' });
        }

        const item = await cartService.updateItem(userId, cartItemId, {
          quantity,
          modifiers,
          specialInstructions,
        });

        res.json(item);
      } catch (error) {
        logger.error('Failed to update cart item', error);
        res.status(400).json({ error: 'Failed to update item' });
      }
    });

    app.delete('/cart/:userId/items/:cartItemId', authenticate, async (req, res) => {
      try {
        const { userId, cartItemId } = req.params;

        if (req.user!.id !== userId) {
          return res.status(403).json({ error: 'Forbidden' });
        }

        await cartService.removeItem(userId, cartItemId);
        res.status(204).send();
      } catch (error) {
        logger.error('Failed to remove cart item', error);
        res.status(400).json({ error: 'Failed to remove item' });
      }
    });

    app.delete('/cart/:userId/clear', authenticate, async (req, res) => {
      try {
        const { userId } = req.params;

        if (req.user!.id !== userId) {
          return res.status(403).json({ error: 'Forbidden' });
        }

        await cartService.clearCart(userId);
        res.status(204).send();
      } catch (error) {
        logger.error('Failed to clear cart', error);
        res.status(500).json({ error: 'Failed to clear cart' });
      }
    });

    app.post('/cart/:userId/validate', authenticate, async (req, res) => {
      try {
        const { userId } = req.params;

        if (req.user!.id !== userId) {
          return res.status(403).json({ error: 'Forbidden' });
        }

        const validation = await cartService.validateCart(userId);
        res.json(validation);
      } catch (error) {
        logger.error('Failed to validate cart', error);
        res.status(500).json({ error: 'Failed to validate cart' });
      }
    });

    // Group ordering endpoints
    app.post('/group-orders', authenticate, async (req, res) => {
      try {
        const { merchantId, reskflowAddress, scheduledFor } = req.body;

        const groupOrder = await groupOrderService.createGroupOrder({
          hostId: req.user!.id,
          merchantId,
          reskflowAddress,
          scheduledFor,
        });

        res.status(201).json(groupOrder);
      } catch (error) {
        logger.error('Failed to create group order', error);
        res.status(400).json({ error: 'Failed to create group order' });
      }
    });

    app.get('/group-orders/:groupOrderId', async (req, res) => {
      try {
        const { groupOrderId } = req.params;

        const groupOrder = await groupOrderService.getGroupOrder(groupOrderId);
        
        if (!groupOrder) {
          return res.status(404).json({ error: 'Group order not found' });
        }

        res.json(groupOrder);
      } catch (error) {
        logger.error('Failed to get group order', error);
        res.status(500).json({ error: 'Failed to get group order' });
      }
    });

    app.post('/group-orders/:groupOrderId/join', authenticate, async (req, res) => {
      try {
        const { groupOrderId } = req.params;

        const participant = await groupOrderService.joinGroupOrder(
          groupOrderId,
          req.user!.id
        );

        res.json(participant);
      } catch (error) {
        logger.error('Failed to join group order', error);
        res.status(400).json({ error: 'Failed to join group order' });
      }
    });

    app.delete('/group-orders/:groupOrderId/leave', authenticate, async (req, res) => {
      try {
        const { groupOrderId } = req.params;

        await groupOrderService.leaveGroupOrder(groupOrderId, req.user!.id);
        res.status(204).send();
      } catch (error) {
        logger.error('Failed to leave group order', error);
        res.status(400).json({ error: 'Failed to leave group order' });
      }
    });

    app.post('/group-orders/:groupOrderId/items', authenticate, async (req, res) => {
      try {
        const { groupOrderId } = req.params;
        const { itemId, quantity, modifiers, specialInstructions } = req.body;

        const item = await groupOrderService.addItemToGroupOrder(
          groupOrderId,
          req.user!.id,
          { itemId, quantity, modifiers, specialInstructions }
        );

        res.status(201).json(item);
      } catch (error) {
        logger.error('Failed to add item to group order', error);
        res.status(400).json({ error: 'Failed to add item' });
      }
    });

    app.put('/group-orders/:groupOrderId/lock', authenticate, async (req, res) => {
      try {
        const { groupOrderId } = req.params;

        const groupOrder = await groupOrderService.lockGroupOrder(
          groupOrderId,
          req.user!.id
        );

        res.json(groupOrder);
      } catch (error) {
        logger.error('Failed to lock group order', error);
        res.status(400).json({ error: 'Failed to lock group order' });
      }
    });

    app.post('/group-orders/:groupOrderId/finalize', authenticate, async (req, res) => {
      try {
        const { groupOrderId } = req.params;
        const { paymentMethod, tip } = req.body;

        const order = await groupOrderService.finalizeGroupOrder(
          groupOrderId,
          req.user!.id,
          { paymentMethod, tip }
        );

        res.json(order);
      } catch (error) {
        logger.error('Failed to finalize group order', error);
        res.status(400).json({ error: 'Failed to finalize group order' });
      }
    });

    // Cart sharing endpoints
    app.post('/cart-share', authenticate, async (req, res) => {
      try {
        const { expiresIn = 3600 } = req.body; // Default 1 hour

        const shareLink = await cartSharingService.createShareLink(
          req.user!.id,
          expiresIn
        );

        res.json(shareLink);
      } catch (error) {
        logger.error('Failed to create share link', error);
        res.status(500).json({ error: 'Failed to create share link' });
      }
    });

    app.get('/cart-share/:shareCode', async (req, res) => {
      try {
        const { shareCode } = req.params;

        const sharedCart = await cartSharingService.getSharedCart(shareCode);
        
        if (!sharedCart) {
          return res.status(404).json({ error: 'Share link not found or expired' });
        }

        res.json(sharedCart);
      } catch (error) {
        logger.error('Failed to get shared cart', error);
        res.status(500).json({ error: 'Failed to get shared cart' });
      }
    });

    app.post('/cart-share/:shareCode/import', authenticate, async (req, res) => {
      try {
        const { shareCode } = req.params;
        const { merge = false } = req.body;

        await cartSharingService.importSharedCart(
          shareCode,
          req.user!.id,
          merge
        );

        res.json({ success: true });
      } catch (error) {
        logger.error('Failed to import shared cart', error);
        res.status(400).json({ error: 'Failed to import shared cart' });
      }
    });

    // WebSocket connections for real-time updates
    io.on('connection', (socket) => {
      logger.info(`Client connected: ${socket.id}`);

      // Join user's cart room
      socket.on('subscribe:cart', (userId: string) => {
        socket.join(`cart:${userId}`);
        logger.info(`Client ${socket.id} subscribed to cart ${userId}`);
      });

      // Join group order room
      socket.on('subscribe:group-order', async (groupOrderId: string) => {
        socket.join(`group-order:${groupOrderId}`);
        logger.info(`Client ${socket.id} subscribed to group order ${groupOrderId}`);

        // Send current state
        const groupOrder = await groupOrderService.getGroupOrder(groupOrderId);
        if (groupOrder) {
          socket.emit('group-order:state', groupOrder);
        }
      });

      // Handle real-time cart updates
      socket.on('cart:update', async (data: any) => {
        try {
          const { userId, action, payload } = data;

          switch (action) {
            case 'add-item':
              await cartService.addItem(userId, payload);
              break;
            case 'update-item':
              await cartService.updateItem(userId, payload.cartItemId, payload);
              break;
            case 'remove-item':
              await cartService.removeItem(userId, payload.cartItemId);
              break;
          }

          // Broadcast update to all clients watching this cart
          io.to(`cart:${userId}`).emit('cart:updated', await cartService.getCart(userId));
        } catch (error) {
          socket.emit('cart:error', { error: 'Update failed' });
        }
      });

      // Handle group order interactions
      socket.on('group-order:add-item', async (data: any) => {
        try {
          const { groupOrderId, userId, item } = data;
          
          await groupOrderService.addItemToGroupOrder(groupOrderId, userId, item);
          
          // Broadcast to all participants
          const groupOrder = await groupOrderService.getGroupOrder(groupOrderId);
          io.to(`group-order:${groupOrderId}`).emit('group-order:updated', groupOrder);
        } catch (error) {
          socket.emit('group-order:error', { error: 'Failed to add item' });
        }
      });

      socket.on('disconnect', () => {
        logger.info(`Client disconnected: ${socket.id}`);
      });
    });

    const PORT = 3011;
    httpServer.listen(PORT, () => {
      logger.info(`🛒 Cart service ready at http://localhost:${PORT}`);
    });

  } catch (error) {
    logger.error('Failed to start cart service', error);
    process.exit(1);
  }
}

startService();