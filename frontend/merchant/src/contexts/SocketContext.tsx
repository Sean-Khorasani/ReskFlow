import React, { createContext, useContext, useEffect, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { useAuth } from './AuthContext';
import { useDispatch } from 'react-redux';
import { AppDispatch } from '@/store';
import { addNewOrder, updateOrderInList } from '@/store/slices/ordersSlice';
import { useSnackbar } from 'notistack';

interface SocketContextType {
  socket: Socket | null;
  connected: boolean;
}

const SocketContext = createContext<SocketContextType>({
  socket: null,
  connected: false,
});

export const useSocket = () => useContext(SocketContext);

export const SocketProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { isAuthenticated, merchant } = useAuth();
  const dispatch = useDispatch<AppDispatch>();
  const { enqueueSnackbar } = useSnackbar();
  const [socket, setSocket] = useState<Socket | null>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (isAuthenticated && merchant) {
      const socketUrl = process.env.NEXT_PUBLIC_SOCKET_URL || 'http://localhost:3001';
      const newSocket = io(socketUrl, {
        auth: {
          token: localStorage.getItem('merchantToken'),
          merchantId: merchant.id,
        },
      });

      newSocket.on('connect', () => {
        console.log('Socket connected');
        setConnected(true);
      });

      newSocket.on('disconnect', () => {
        console.log('Socket disconnected');
        setConnected(false);
      });

      // Order events
      newSocket.on('newOrder', (order) => {
        dispatch(addNewOrder(order));
        enqueueSnackbar(`New order #${order.orderNumber} received!`, {
          variant: 'info',
          autoHideDuration: 5000,
        });
        // Play sound notification
        const audio = new Audio('/sounds/new-order.mp3');
        audio.play().catch(console.error);
      });

      newSocket.on('orderUpdated', (order) => {
        dispatch(updateOrderInList(order));
      });

      newSocket.on('orderCancelled', (order) => {
        dispatch(updateOrderInList(order));
        enqueueSnackbar(`Order #${order.orderNumber} has been cancelled`, {
          variant: 'warning',
          autoHideDuration: 5000,
        });
      });

      newSocket.on('driverAssigned', (data) => {
        enqueueSnackbar(`Driver assigned to order #${data.orderNumber}`, {
          variant: 'success',
          autoHideDuration: 3000,
        });
      });

      newSocket.on('orderPickedUp', (data) => {
        enqueueSnackbar(`Order #${data.orderNumber} picked up by driver`, {
          variant: 'info',
          autoHideDuration: 3000,
        });
      });

      newSocket.on('orderDelivered', (data) => {
        dispatch(updateOrderInList(data.order));
        enqueueSnackbar(`Order #${data.order.orderNumber} delivered successfully!`, {
          variant: 'success',
          autoHideDuration: 3000,
        });
      });

      setSocket(newSocket);

      return () => {
        newSocket.disconnect();
      };
    } else {
      if (socket) {
        socket.disconnect();
        setSocket(null);
        setConnected(false);
      }
    }
  }, [isAuthenticated, merchant]);

  return (
    <SocketContext.Provider value={{ socket, connected }}>
      {children}
    </SocketContext.Provider>
  );
};