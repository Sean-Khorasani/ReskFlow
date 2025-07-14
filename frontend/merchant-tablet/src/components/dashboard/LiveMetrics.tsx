import { Box, Paper, Typography, Grid } from '@mui/material';
import { TrendingUp, TrendingDown, Timer, ShoppingBag, AttachMoney, Star } from '@mui/icons-material';
import { motion } from 'framer-motion';

interface MetricCardProps {
  title: string;
  value: string | number;
  change?: number;
  icon: React.ReactNode;
  color: string;
}

function MetricCard({ title, value, change, icon, color }: MetricCardProps) {
  return (
    <motion.div
      initial={{ scale: 0.9, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ duration: 0.3 }}
    >
      <Paper
        sx={{
          p: 2,
          height: '100%',
          background: `linear-gradient(135deg, ${color}20 0%, ${color}10 100%)`,
          border: `1px solid ${color}30`,
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
          <Box
            sx={{
              width: 40,
              height: 40,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              bgcolor: color,
              borderRadius: 2,
              color: 'white',
              mr: 2,
            }}
          >
            {icon}
          </Box>
          <Typography variant="body2" color="text.secondary" sx={{ fontWeight: 500 }}>
            {title}
          </Typography>
        </Box>
        <Typography variant="h4" sx={{ fontWeight: 700, mb: 0.5 }}>
          {value}
        </Typography>
        {change !== undefined && (
          <Box sx={{ display: 'flex', alignItems: 'center' }}>
            {change >= 0 ? (
              <TrendingUp sx={{ fontSize: 16, color: 'success.main', mr: 0.5 }} />
            ) : (
              <TrendingDown sx={{ fontSize: 16, color: 'error.main', mr: 0.5 }} />
            )}
            <Typography
              variant="body2"
              sx={{
                color: change >= 0 ? 'success.main' : 'error.main',
                fontWeight: 500,
              }}
            >
              {Math.abs(change)}% from yesterday
            </Typography>
          </Box>
        )}
      </Paper>
    </motion.div>
  );
}

interface LiveMetricsProps {
  stats: {
    todayOrders: number;
    todayRevenue: number;
    avgPrepTime: number;
    activeOrders: number;
    rating: number;
    orderChange: number;
    revenueChange: number;
  };
}

export default function LiveMetrics({ stats }: LiveMetricsProps) {
  return (
    <Grid container spacing={2}>
      <Grid item xs={6} md={2.4}>
        <MetricCard
          title="Today's Orders"
          value={stats.todayOrders}
          change={stats.orderChange}
          icon={<ShoppingBag />}
          color="#4ECDC4"
        />
      </Grid>
      <Grid item xs={6} md={2.4}>
        <MetricCard
          title="Revenue"
          value={`$${stats.todayRevenue.toFixed(0)}`}
          change={stats.revenueChange}
          icon={<AttachMoney />}
          color="#51CF66"
        />
      </Grid>
      <Grid item xs={6} md={2.4}>
        <MetricCard
          title="Active Orders"
          value={stats.activeOrders}
          icon={<ShoppingBag />}
          color="#FF6B6B"
        />
      </Grid>
      <Grid item xs={6} md={2.4}>
        <MetricCard
          title="Avg Prep Time"
          value={`${stats.avgPrepTime}m`}
          icon={<Timer />}
          color="#FFD93D"
        />
      </Grid>
      <Grid item xs={12} md={2.4}>
        <MetricCard
          title="Rating"
          value={stats.rating.toFixed(1)}
          icon={<Star />}
          color="#9B59B6"
        />
      </Grid>
    </Grid>
  );
}