import { createContext, useContext, useState, ReactNode, useEffect } from 'react';
import { Snackbar, Alert, AlertColor } from '@mui/material';
import { useSocket } from './SocketContext';

interface Notification {
  id: string;
  message: string;
  severity: AlertColor;
}

interface NotificationContextType {
  showNotification: (message: string, severity?: AlertColor) => void;
}

const NotificationContext = createContext<NotificationContextType>({
  showNotification: () => {},
});

export const useNotification = () => useContext(NotificationContext);

interface NotificationProviderProps {
  children: ReactNode;
}

export function NotificationProvider({ children }: NotificationProviderProps) {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const socket = useSocket();

  useEffect(() => {
    if (socket) {
      socket.on('notification', (data) => {
        showNotification(data.message, data.severity || 'info');
      });

      return () => {
        socket.off('notification');
      };
    }
  }, [socket]);

  const showNotification = (message: string, severity: AlertColor = 'info') => {
    const notification: Notification = {
      id: Date.now().toString(),
      message,
      severity,
    };
    setNotifications((prev) => [...prev, notification]);
  };

  const handleClose = (id: string) => {
    setNotifications((prev) => prev.filter((n) => n.id !== id));
  };

  return (
    <NotificationContext.Provider value={{ showNotification }}>
      {children}
      {notifications.map((notification) => (
        <Snackbar
          key={notification.id}
          open={true}
          autoHideDuration={6000}
          onClose={() => handleClose(notification.id)}
          anchorOrigin={{ vertical: 'top', horizontal: 'right' }}
        >
          <Alert
            onClose={() => handleClose(notification.id)}
            severity={notification.severity}
            sx={{ width: '100%' }}
          >
            {notification.message}
          </Alert>
        </Snackbar>
      ))}
    </NotificationContext.Provider>
  );
}