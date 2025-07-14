import React, { useState, useEffect } from 'react';
import {
  Box,
  Paper,
  Typography,
  Grid,
  Card,
  CardContent,
  Button,
  TextField,
  Tab,
  Tabs,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Chip,
  IconButton,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Alert,
  LinearProgress,
  useTheme,
} from '@mui/material';
import {
  AttachMoney,
  TrendingUp,
  TrendingDown,
  Download,
  AccountBalance,
  Receipt,
  CalendarToday,
  ArrowUpward,
  ArrowDownward,
  CheckCircle,
  Schedule,
  Error,
  Info,
} from '@mui/icons-material';
import { DateRangePicker } from '@mui/x-date-pickers-pro/DateRangePicker';
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import { AdapterDateFns } from '@mui/x-date-pickers/AdapterDateFns';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Title,
  Tooltip,
  Legend,
  Filler,
} from 'chart.js';
import { Line, Bar } from 'react-chartjs-2';
import PartnerLayout from '../components/layouts/PartnerLayout';
import { earningsApi } from '../services/api';
import { format, subDays, startOfMonth, endOfMonth } from 'date-fns';
import Head from 'next/head';

// Register ChartJS components
ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Title,
  Tooltip,
  Legend,
  Filler
);

interface EarningsSummary {
  today: number;
  yesterday: number;
  thisWeek: number;
  lastWeek: number;
  thisMonth: number;
  lastMonth: number;
  pending: number;
  available: number;
}

interface Payout {
  id: string;
  amount: number;
  method: 'bank_transfer' | 'check' | 'paypal';
  status: 'pending' | 'processing' | 'completed' | 'failed';
  requestedAt: string;
  processedAt?: string;
  reference?: string;
}

interface Invoice {
  id: string;
  invoiceNumber: string;
  period: string;
  amount: number;
  status: 'draft' | 'sent' | 'paid';
  createdAt: string;
  dueDate: string;
}

interface Transaction {
  id: string;
  type: 'reskflow_fee' | 'bonus' | 'deduction' | 'payout';
  description: string;
  amount: number;
  balance: number;
  createdAt: string;
  orderId?: string;
  driverId?: string;
  driverName?: string;
}

export default function EarningsPage() {
  const theme = useTheme();
  const [loading, setLoading] = useState(false);
  const [selectedTab, setSelectedTab] = useState(0);
  const [dateRange, setDateRange] = useState({
    start: startOfMonth(new Date()),
    end: new Date(),
  });
  const [payoutDialog, setPayoutDialog] = useState(false);
  const [payoutAmount, setPayoutAmount] = useState('');
  const [payoutMethod, setPayoutMethod] = useState('bank_transfer');

  const [earnings, setEarnings] = useState<EarningsSummary>({
    today: 456.78,
    yesterday: 398.45,
    thisWeek: 2834.56,
    lastWeek: 2567.89,
    thisMonth: 12456.78,
    lastMonth: 11234.56,
    pending: 1234.56,
    available: 8765.43,
  });

  const [payouts, setPayouts] = useState<Payout[]>([
    {
      id: '1',
      amount: 5000,
      method: 'bank_transfer',
      status: 'completed',
      requestedAt: new Date('2024-01-15').toISOString(),
      processedAt: new Date('2024-01-17').toISOString(),
      reference: 'PAY-001234',
    },
    {
      id: '2',
      amount: 3500,
      method: 'bank_transfer',
      status: 'processing',
      requestedAt: new Date('2024-01-20').toISOString(),
    },
  ]);

  const [invoices, setInvoices] = useState<Invoice[]>([
    {
      id: '1',
      invoiceNumber: 'INV-2024-001',
      period: 'January 2024',
      amount: 12456.78,
      status: 'paid',
      createdAt: new Date('2024-02-01').toISOString(),
      dueDate: new Date('2024-02-15').toISOString(),
    },
  ]);

  const [transactions, setTransactions] = useState<Transaction[]>([
    {
      id: '1',
      type: 'reskflow_fee',
      description: 'Delivery commission - Order #12345',
      amount: 45.67,
      balance: 8765.43,
      createdAt: new Date().toISOString(),
      orderId: '12345',
      driverId: 'd1',
      driverName: 'John Smith',
    },
    {
      id: '2',
      type: 'bonus',
      description: 'Performance bonus - High ratings',
      amount: 100.00,
      balance: 8719.76,
      createdAt: new Date().toISOString(),
    },
  ]);

  useEffect(() => {
    fetchEarningsData();
  }, [dateRange]);

  const fetchEarningsData = async () => {
    setLoading(true);
    try {
      // Fetch earnings data
      // const response = await earningsApi.getEarnings(period);
      // setEarnings(response.data);
    } catch (error) {
      console.error('Failed to fetch earnings:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleRequestPayout = async () => {
    try {
      await earningsApi.requestPayout(parseFloat(payoutAmount), payoutMethod);
      setPayoutDialog(false);
      setPayoutAmount('');
      fetchEarningsData();
    } catch (error) {
      console.error('Failed to request payout:', error);
    }
  };

  // Chart data
  const earningsChartData = {
    labels: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
    datasets: [
      {
        label: 'Daily Earnings',
        data: [380, 420, 395, 480, 520, 445, 456],
        borderColor: theme.palette.primary.main,
        backgroundColor: `${theme.palette.primary.main}20`,
        tension: 0.4,
        fill: true,
      },
    ],
  };

  const monthlyChartData = {
    labels: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'],
    datasets: [
      {
        label: 'Monthly Earnings',
        data: [11234, 12456, 13567, 12890, 14567, 15234],
        backgroundColor: theme.palette.secondary.main,
      },
    ],
  };

  const getChangeIndicator = (current: number, previous: number) => {
    const change = ((current - previous) / previous) * 100;
    const isPositive = change > 0;
    
    return (
      <Box sx={{ display: 'flex', alignItems: 'center' }}>
        {isPositive ? (
          <TrendingUp sx={{ color: 'success.main', fontSize: 16, mr: 0.5 }} />
        ) : (
          <TrendingDown sx={{ color: 'error.main', fontSize: 16, mr: 0.5 }} />
        )}
        <Typography
          variant="caption"
          color={isPositive ? 'success.main' : 'error.main'}
        >
          {isPositive ? '+' : ''}{change.toFixed(1)}%
        </Typography>
      </Box>
    );
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed':
      case 'paid':
        return 'success';
      case 'processing':
      case 'sent':
        return 'warning';
      case 'pending':
      case 'draft':
        return 'info';
      case 'failed':
        return 'error';
      default:
        return 'default';
    }
  };

  return (
    <>
      <Head>
        <title>Earnings - ReskFlow Partner Portal</title>
      </Head>
      
      <PartnerLayout>
        <Box sx={{ flexGrow: 1 }}>
          {/* Header */}
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
            <Typography variant="h4" fontWeight="bold">
              Earnings & Payouts
            </Typography>
            <Box sx={{ display: 'flex', gap: 2 }}>
              <Button
                variant="outlined"
                startIcon={<Download />}
              >
                Export Report
              </Button>
              <Button
                variant="contained"
                startIcon={<AttachMoney />}
                onClick={() => setPayoutDialog(true)}
                disabled={earnings.available === 0}
              >
                Request Payout
              </Button>
            </Box>
          </Box>

          {/* Earnings Summary */}
          <Grid container spacing={3} sx={{ mb: 3 }}>
            <Grid item xs={12} md={3}>
              <Card>
                <CardContent>
                  <Typography color="textSecondary" gutterBottom>
                    Today's Earnings
                  </Typography>
                  <Typography variant="h4">
                    ${earnings.today.toFixed(2)}
                  </Typography>
                  {getChangeIndicator(earnings.today, earnings.yesterday)}
                </CardContent>
              </Card>
            </Grid>
            <Grid item xs={12} md={3}>
              <Card>
                <CardContent>
                  <Typography color="textSecondary" gutterBottom>
                    This Week
                  </Typography>
                  <Typography variant="h4">
                    ${earnings.thisWeek.toFixed(2)}
                  </Typography>
                  {getChangeIndicator(earnings.thisWeek, earnings.lastWeek)}
                </CardContent>
              </Card>
            </Grid>
            <Grid item xs={12} md={3}>
              <Card>
                <CardContent>
                  <Typography color="textSecondary" gutterBottom>
                    This Month
                  </Typography>
                  <Typography variant="h4">
                    ${earnings.thisMonth.toFixed(2)}
                  </Typography>
                  {getChangeIndicator(earnings.thisMonth, earnings.lastMonth)}
                </CardContent>
              </Card>
            </Grid>
            <Grid item xs={12} md={3}>
              <Card sx={{ bgcolor: 'primary.main', color: 'white' }}>
                <CardContent>
                  <Typography color="inherit" gutterBottom sx={{ opacity: 0.9 }}>
                    Available Balance
                  </Typography>
                  <Typography variant="h4" color="inherit">
                    ${earnings.available.toFixed(2)}
                  </Typography>
                  <Typography variant="caption" color="inherit" sx={{ opacity: 0.9 }}>
                    Pending: ${earnings.pending.toFixed(2)}
                  </Typography>
                </CardContent>
              </Card>
            </Grid>
          </Grid>

          {/* Date Filter */}
          <Paper sx={{ p: 2, mb: 3 }}>
            <LocalizationProvider dateAdapter={AdapterDateFns}>
              <DateRangePicker
                startText="Start Date"
                endText="End Date"
                value={[dateRange.start, dateRange.end]}
                onChange={(newValue) => {
                  if (newValue[0] && newValue[1]) {
                    setDateRange({ start: newValue[0], end: newValue[1] });
                  }
                }}
                renderInput={(startProps, endProps) => (
                  <>
                    <TextField {...startProps} size="small" />
                    <Box sx={{ mx: 2 }}> to </Box>
                    <TextField {...endProps} size="small" />
                  </>
                )}
              />
            </LocalizationProvider>
          </Paper>

          {/* Charts */}
          <Grid container spacing={3} sx={{ mb: 3 }}>
            <Grid item xs={12} md={8}>
              <Paper sx={{ p: 3 }}>
                <Typography variant="h6" gutterBottom>
                  Daily Earnings Trend
                </Typography>
                <Box sx={{ height: 300 }}>
                  <Line
                    data={earningsChartData}
                    options={{
                      responsive: true,
                      maintainAspectRatio: false,
                      plugins: {
                        legend: {
                          display: false,
                        },
                      },
                      scales: {
                        y: {
                          ticks: {
                            callback: function(value) {
                              return '$' + value;
                            },
                          },
                        },
                      },
                    }}
                  />
                </Box>
              </Paper>
            </Grid>
            <Grid item xs={12} md={4}>
              <Paper sx={{ p: 3 }}>
                <Typography variant="h6" gutterBottom>
                  Monthly Comparison
                </Typography>
                <Box sx={{ height: 300 }}>
                  <Bar
                    data={monthlyChartData}
                    options={{
                      responsive: true,
                      maintainAspectRatio: false,
                      plugins: {
                        legend: {
                          display: false,
                        },
                      },
                      scales: {
                        y: {
                          ticks: {
                            callback: function(value) {
                              return '$' + value.toLocaleString();
                            },
                          },
                        },
                      },
                    }}
                  />
                </Box>
              </Paper>
            </Grid>
          </Grid>

          {/* Tabs */}
          <Paper sx={{ mb: 3 }}>
            <Tabs
              value={selectedTab}
              onChange={(e, value) => setSelectedTab(value)}
              variant="fullWidth"
            >
              <Tab label="Transactions" />
              <Tab label="Payouts" />
              <Tab label="Invoices" />
            </Tabs>
          </Paper>

          {/* Tab Content */}
          {selectedTab === 0 && (
            <Paper>
              <TableContainer>
                <Table>
                  <TableHead>
                    <TableRow>
                      <TableCell>Date & Time</TableCell>
                      <TableCell>Description</TableCell>
                      <TableCell>Driver</TableCell>
                      <TableCell align="right">Amount</TableCell>
                      <TableCell align="right">Balance</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {transactions.map((transaction) => (
                      <TableRow key={transaction.id}>
                        <TableCell>
                          {format(new Date(transaction.createdAt), 'MMM dd, HH:mm')}
                        </TableCell>
                        <TableCell>
                          <Box>
                            <Typography variant="body2">
                              {transaction.description}
                            </Typography>
                            {transaction.orderId && (
                              <Typography variant="caption" color="text.secondary">
                                Order #{transaction.orderId}
                              </Typography>
                            )}
                          </Box>
                        </TableCell>
                        <TableCell>
                          {transaction.driverName || '-'}
                        </TableCell>
                        <TableCell align="right">
                          <Typography
                            variant="body2"
                            color={
                              transaction.type === 'deduction' || transaction.type === 'payout'
                                ? 'error.main'
                                : 'success.main'
                            }
                          >
                            {transaction.type === 'deduction' || transaction.type === 'payout' ? '-' : '+'}
                            ${transaction.amount.toFixed(2)}
                          </Typography>
                        </TableCell>
                        <TableCell align="right">
                          ${transaction.balance.toFixed(2)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            </Paper>
          )}

          {selectedTab === 1 && (
            <Paper>
              <TableContainer>
                <Table>
                  <TableHead>
                    <TableRow>
                      <TableCell>Request Date</TableCell>
                      <TableCell>Amount</TableCell>
                      <TableCell>Method</TableCell>
                      <TableCell>Status</TableCell>
                      <TableCell>Reference</TableCell>
                      <TableCell>Processed Date</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {payouts.map((payout) => (
                      <TableRow key={payout.id}>
                        <TableCell>
                          {format(new Date(payout.requestedAt), 'MMM dd, yyyy')}
                        </TableCell>
                        <TableCell>
                          <Typography variant="body2" fontWeight="medium">
                            ${payout.amount.toFixed(2)}
                          </Typography>
                        </TableCell>
                        <TableCell>
                          <Chip
                            label={payout.method.replace('_', ' ')}
                            size="small"
                            variant="outlined"
                          />
                        </TableCell>
                        <TableCell>
                          <Chip
                            label={payout.status}
                            color={getStatusColor(payout.status)}
                            size="small"
                          />
                        </TableCell>
                        <TableCell>
                          {payout.reference || '-'}
                        </TableCell>
                        <TableCell>
                          {payout.processedAt
                            ? format(new Date(payout.processedAt), 'MMM dd, yyyy')
                            : '-'}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            </Paper>
          )}

          {selectedTab === 2 && (
            <Paper>
              <TableContainer>
                <Table>
                  <TableHead>
                    <TableRow>
                      <TableCell>Invoice #</TableCell>
                      <TableCell>Period</TableCell>
                      <TableCell>Amount</TableCell>
                      <TableCell>Status</TableCell>
                      <TableCell>Created</TableCell>
                      <TableCell>Due Date</TableCell>
                      <TableCell align="center">Actions</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {invoices.map((invoice) => (
                      <TableRow key={invoice.id}>
                        <TableCell>
                          <Typography variant="body2" fontWeight="medium">
                            {invoice.invoiceNumber}
                          </Typography>
                        </TableCell>
                        <TableCell>{invoice.period}</TableCell>
                        <TableCell>
                          <Typography variant="body2" fontWeight="medium">
                            ${invoice.amount.toFixed(2)}
                          </Typography>
                        </TableCell>
                        <TableCell>
                          <Chip
                            label={invoice.status}
                            color={getStatusColor(invoice.status)}
                            size="small"
                          />
                        </TableCell>
                        <TableCell>
                          {format(new Date(invoice.createdAt), 'MMM dd, yyyy')}
                        </TableCell>
                        <TableCell>
                          {format(new Date(invoice.dueDate), 'MMM dd, yyyy')}
                        </TableCell>
                        <TableCell align="center">
                          <IconButton size="small">
                            <Download />
                          </IconButton>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            </Paper>
          )}
        </Box>

        {/* Request Payout Dialog */}
        <Dialog
          open={payoutDialog}
          onClose={() => setPayoutDialog(false)}
          maxWidth="sm"
          fullWidth
        >
          <DialogTitle>Request Payout</DialogTitle>
          <DialogContent>
            <Alert severity="info" sx={{ mb: 2 }}>
              Available balance: ${earnings.available.toFixed(2)}
            </Alert>
            
            <TextField
              fullWidth
              label="Payout Amount"
              type="number"
              value={payoutAmount}
              onChange={(e) => setPayoutAmount(e.target.value)}
              inputProps={{
                max: earnings.available,
                step: 0.01,
              }}
              margin="normal"
            />
            
            <FormControl fullWidth margin="normal">
              <InputLabel>Payout Method</InputLabel>
              <Select
                value={payoutMethod}
                onChange={(e) => setPayoutMethod(e.target.value)}
                label="Payout Method"
              >
                <MenuItem value="bank_transfer">Bank Transfer (2-3 days)</MenuItem>
                <MenuItem value="paypal">PayPal (Instant)</MenuItem>
                <MenuItem value="check">Check (5-7 days)</MenuItem>
              </Select>
            </FormControl>
            
            <Alert severity="warning" sx={{ mt: 2 }}>
              Processing fees may apply. Bank transfers: $0, PayPal: 2.9%, Check: $5
            </Alert>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setPayoutDialog(false)}>Cancel</Button>
            <Button
              onClick={handleRequestPayout}
              variant="contained"
              disabled={
                !payoutAmount ||
                parseFloat(payoutAmount) <= 0 ||
                parseFloat(payoutAmount) > earnings.available
              }
            >
              Request Payout
            </Button>
          </DialogActions>
        </Dialog>
      </PartnerLayout>
    </>
  );
}