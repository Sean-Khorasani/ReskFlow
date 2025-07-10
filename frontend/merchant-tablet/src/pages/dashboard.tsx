import { useState, useEffect } from 'react';
import { Box, Grid, Paper, Typography, Tab, Tabs } from '@mui/material';
import { motion, AnimatePresence } from 'framer-motion';
import DashboardLayout from '@/components/layouts/DashboardLayout';
import OrdersList from '@/components/orders/OrdersList';
import OrderDetails from '@/components/orders/OrderDetails';
import LiveMetrics from '@/components/dashboard/LiveMetrics';
import QuickActions from '@/components/dashboard/QuickActions';
import { useOrders } from '@/hooks/useOrders';
import { useSocket } from '@/hooks/useSocket';
import { useSoundAlerts } from '@/hooks/useSoundAlerts';

interface TabPanelProps {
  children?: React.ReactNode;
  index: number;
  value: number;
}

function TabPanel(props: TabPanelProps) {
  const { children, value, index, ...other } = props;

  return (
    <div
      role="tabpanel"
      hidden={value !== index}
      id={`order-tabpanel-${index}`}
      aria-labelledby={`order-tab-${index}`}
      {...other}
    >
      {value === index && <Box sx={{ p: 2 }}>{children}</Box>}
    </div>
  );
}

export default function Dashboard() {
  const [selectedTab, setSelectedTab] = useState(0);
  const [selectedOrder, setSelectedOrder] = useState<string | null>(null);
  const { orders, stats, loading } = useOrders();
  const { socket } = useSocket();
  const { playNewOrderSound } = useSoundAlerts();

  // Listen for new orders
  useEffect(() => {
    if (!socket) return;

    socket.on('order:new', (order) => {
      playNewOrderSound();
      // Auto-select new order if none selected
      if (!selectedOrder) {
        setSelectedOrder(order.id);
      }
    });

    return () => {
      socket.off('order:new');
    };
  }, [socket, selectedOrder, playNewOrderSound]);

  const handleTabChange = (event: React.SyntheticEvent, newValue: number) => {
    setSelectedTab(newValue);
  };

  const getOrdersByStatus = (status: string) => {
    return orders.filter((order) => {
      switch (status) {
        case 'new':
          return order.status === 'PENDING';
        case 'preparing':
          return ['ACCEPTED', 'PREPARING'].includes(order.status);
        case 'ready':
          return order.status === 'READY_FOR_PICKUP';
        case 'completed':
          return ['PICKED_UP', 'DELIVERED'].includes(order.status);
        default:
          return false;
      }
    });
  };

  return (
    <DashboardLayout>
      <Box sx={{ flexGrow: 1, height: '100%', display: 'flex', flexDirection: 'column' }}>
        {/* Live Metrics Bar */}
        <Box sx={{ mb: 2 }}>
          <LiveMetrics stats={stats} />
        </Box>

        {/* Quick Actions */}
        <Box sx={{ mb: 2 }}>
          <QuickActions />
        </Box>

        {/* Main Content Area */}
        <Grid container spacing={2} sx={{ flexGrow: 1, height: 'calc(100% - 200px)' }}>
          {/* Orders List */}
          <Grid item xs={12} md={6} sx={{ height: '100%' }}>
            <Paper sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
              <Box sx={{ borderBottom: 1, borderColor: 'divider' }}>
                <Tabs
                  value={selectedTab}
                  onChange={handleTabChange}
                  variant="fullWidth"
                  sx={{
                    '& .MuiTab-root': {
                      fontSize: '1rem',
                      fontWeight: 500,
                    },
                  }}
                >
                  <Tab 
                    label={`New (${getOrdersByStatus('new').length})`}
                    sx={{
                      color: getOrdersByStatus('new').length > 0 ? 'error.main' : 'text.primary',
                    }}
                  />
                  <Tab 
                    label={`Preparing (${getOrdersByStatus('preparing').length})`}
                    sx={{
                      color: getOrdersByStatus('preparing').length > 0 ? 'warning.main' : 'text.primary',
                    }}
                  />
                  <Tab 
                    label={`Ready (${getOrdersByStatus('ready').length})`}
                    sx={{
                      color: getOrdersByStatus('ready').length > 0 ? 'success.main' : 'text.primary',
                    }}
                  />
                  <Tab label={`Completed (${getOrdersByStatus('completed').length})`} />
                </Tabs>
              </Box>

              <Box sx={{ flexGrow: 1, overflow: 'auto' }}>
                <AnimatePresence mode="wait">
                  <TabPanel value={selectedTab} index={0}>
                    <OrdersList
                      orders={getOrdersByStatus('new')}
                      selectedOrderId={selectedOrder}
                      onSelectOrder={setSelectedOrder}
                      emptyMessage="No new orders"
                    />
                  </TabPanel>
                  <TabPanel value={selectedTab} index={1}>
                    <OrdersList
                      orders={getOrdersByStatus('preparing')}
                      selectedOrderId={selectedOrder}
                      onSelectOrder={setSelectedOrder}
                      emptyMessage="No orders being prepared"
                    />
                  </TabPanel>
                  <TabPanel value={selectedTab} index={2}>
                    <OrdersList
                      orders={getOrdersByStatus('ready')}
                      selectedOrderId={selectedOrder}
                      onSelectOrder={setSelectedOrder}
                      emptyMessage="No orders ready for pickup"
                    />
                  </TabPanel>
                  <TabPanel value={selectedTab} index={3}>
                    <OrdersList
                      orders={getOrdersByStatus('completed')}
                      selectedOrderId={selectedOrder}
                      onSelectOrder={setSelectedOrder}
                      emptyMessage="No completed orders today"
                    />
                  </TabPanel>
                </AnimatePresence>
              </Box>
            </Paper>
          </Grid>

          {/* Order Details */}
          <Grid item xs={12} md={6} sx={{ height: '100%' }}>
            <Paper sx={{ height: '100%', p: 2, overflow: 'auto' }}>
              {selectedOrder ? (
                <OrderDetails 
                  orderId={selectedOrder}
                  onClose={() => setSelectedOrder(null)}
                />
              ) : (
                <Box
                  sx={{
                    height: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: 'text.secondary',
                  }}
                >
                  <Typography variant="h6">
                    Select an order to view details
                  </Typography>
                </Box>
              )}
            </Paper>
          </Grid>
        </Grid>
      </Box>
    </DashboardLayout>
  );
}