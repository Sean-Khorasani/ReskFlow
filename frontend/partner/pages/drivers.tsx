import React, { useState, useEffect } from 'react';
import {
  Box,
  Paper,
  Typography,
  TextField,
  Button,
  Chip,
  IconButton,
  Menu,
  MenuItem,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  InputAdornment,
  Avatar,
  Tab,
  Tabs,
  FormControl,
  InputLabel,
  Select,
  Grid,
  Card,
  CardContent,
  Rating,
  List,
  ListItem,
  ListItemText,
  ListItemAvatar,
  Divider,
} from '@mui/material';
import { DataGrid, GridColDef, GridRenderCellParams } from '@mui/x-data-grid';
import {
  Search,
  FilterList,
  MoreVert,
  Block,
  CheckCircle,
  Edit,
  PersonAdd,
  Download,
  Refresh,
  Phone,
  Email,
  LocationOn,
  DirectionsCar,
  Star,
  Schedule,
  TrendingUp,
  Warning,
  Send,
} from '@mui/icons-material';
import PartnerLayout from '../components/layouts/PartnerLayout';
import { driverApi } from '../services/api';
import { format } from 'date-fns';
import Head from 'next/head';

interface Driver {
  id: string;
  name: string;
  email: string;
  phone: string;
  vehicleId?: string;
  vehiclePlate?: string;
  status: 'active' | 'inactive' | 'suspended' | 'pending';
  rating: number;
  totalDeliveries: number;
  todayDeliveries: number;
  joinedAt: string;
  lastActive: string;
  earnings: {
    today: number;
    week: number;
    month: number;
  };
  performance: {
    onTimeRate: number;
    acceptanceRate: number;
    completionRate: number;
  };
  documents: {
    license: boolean;
    insurance: boolean;
    background: boolean;
  };
}

export default function DriversPage() {
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [selectedTab, setSelectedTab] = useState(0);
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const [selectedDriver, setSelectedDriver] = useState<Driver | null>(null);
  const [inviteDialog, setInviteDialog] = useState(false);
  const [detailsDialog, setDetailsDialog] = useState(false);
  const [suspendDialog, setSuspendDialog] = useState(false);
  const [suspendReason, setSuspendReason] = useState('');
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [totalRows, setTotalRows] = useState(0);

  // Form state for invite
  const [inviteForm, setInviteForm] = useState({
    name: '',
    email: '',
    phone: '',
    vehicleType: 'car',
  });

  // Summary stats
  const [stats, setStats] = useState({
    totalDrivers: 45,
    activeDrivers: 38,
    avgRating: 4.6,
    todayDeliveries: 234,
  });

  useEffect(() => {
    fetchDrivers();
  }, [page, pageSize, statusFilter]);

  const fetchDrivers = async () => {
    setLoading(true);
    try {
      // Mock data for now
      const mockDrivers: Driver[] = [
        {
          id: '1',
          name: 'John Smith',
          email: 'john.smith@email.com',
          phone: '+1 234-567-8901',
          vehicleId: 'v1',
          vehiclePlate: 'ABC-123',
          status: 'active',
          rating: 4.8,
          totalDeliveries: 1234,
          todayDeliveries: 12,
          joinedAt: new Date('2023-01-15').toISOString(),
          lastActive: new Date().toISOString(),
          earnings: { today: 145.50, week: 876.25, month: 3542.75 },
          performance: { onTimeRate: 94.5, acceptanceRate: 87.3, completionRate: 98.2 },
          documents: { license: true, insurance: true, background: true },
        },
        {
          id: '2',
          name: 'Sarah Johnson',
          email: 'sarah.j@email.com',
          phone: '+1 234-567-8902',
          vehicleId: 'v2',
          vehiclePlate: 'XYZ-789',
          status: 'active',
          rating: 4.9,
          totalDeliveries: 987,
          todayDeliveries: 8,
          joinedAt: new Date('2023-02-20').toISOString(),
          lastActive: new Date().toISOString(),
          earnings: { today: 98.75, week: 654.30, month: 2876.40 },
          performance: { onTimeRate: 96.2, acceptanceRate: 91.5, completionRate: 99.1 },
          documents: { license: true, insurance: true, background: true },
        },
        {
          id: '3',
          name: 'Mike Williams',
          email: 'mike.w@email.com',
          phone: '+1 234-567-8903',
          status: 'inactive',
          rating: 4.5,
          totalDeliveries: 543,
          todayDeliveries: 0,
          joinedAt: new Date('2023-03-10').toISOString(),
          lastActive: new Date('2024-01-10').toISOString(),
          earnings: { today: 0, week: 0, month: 0 },
          performance: { onTimeRate: 88.7, acceptanceRate: 82.4, completionRate: 95.6 },
          documents: { license: true, insurance: false, background: true },
        },
      ];

      setDrivers(mockDrivers);
      setTotalRows(mockDrivers.length);
    } catch (error) {
      console.error('Failed to fetch drivers:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleMenuOpen = (event: React.MouseEvent<HTMLElement>, driver: Driver) => {
    setAnchorEl(event.currentTarget);
    setSelectedDriver(driver);
  };

  const handleMenuClose = () => {
    setAnchorEl(null);
  };

  const handleInviteDriver = async () => {
    try {
      await driverApi.inviteDriver(inviteForm);
      setInviteDialog(false);
      setInviteForm({ name: '', email: '', phone: '', vehicleType: 'car' });
      fetchDrivers();
    } catch (error) {
      console.error('Failed to invite driver:', error);
    }
  };

  const handleSuspendDriver = async () => {
    if (!selectedDriver || !suspendReason) return;
    
    try {
      await driverApi.suspendDriver(selectedDriver.id, suspendReason);
      setSuspendDialog(false);
      setSuspendReason('');
      fetchDrivers();
    } catch (error) {
      console.error('Failed to suspend driver:', error);
    }
  };

  const handleActivateDriver = async (driverId: string) => {
    try {
      await driverApi.activateDriver(driverId);
      fetchDrivers();
    } catch (error) {
      console.error('Failed to activate driver:', error);
    }
  };

  const getStatusColor = (status: Driver['status']) => {
    switch (status) {
      case 'active': return 'success';
      case 'inactive': return 'warning';
      case 'suspended': return 'error';
      case 'pending': return 'info';
      default: return 'default';
    }
  };

  const columns: GridColDef[] = [
    {
      field: 'name',
      headerName: 'Driver',
      width: 250,
      renderCell: (params: GridRenderCellParams) => (
        <Box sx={{ display: 'flex', alignItems: 'center' }}>
          <Avatar sx={{ width: 40, height: 40, mr: 2 }}>
            {params.row.name.split(' ').map((n: string) => n[0]).join('')}
          </Avatar>
          <Box>
            <Typography variant="body2" fontWeight="medium">
              {params.value}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              ID: {params.row.id}
            </Typography>
          </Box>
        </Box>
      ),
    },
    {
      field: 'contact',
      headerName: 'Contact',
      width: 200,
      renderCell: (params: GridRenderCellParams) => (
        <Box>
          <Box sx={{ display: 'flex', alignItems: 'center', mb: 0.5 }}>
            <Phone sx={{ fontSize: 14, mr: 0.5 }} />
            <Typography variant="caption">{params.row.phone}</Typography>
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center' }}>
            <Email sx={{ fontSize: 14, mr: 0.5 }} />
            <Typography variant="caption">{params.row.email}</Typography>
          </Box>
        </Box>
      ),
    },
    {
      field: 'vehicle',
      headerName: 'Vehicle',
      width: 150,
      renderCell: (params: GridRenderCellParams) => (
        params.row.vehiclePlate ? (
          <Chip
            icon={<DirectionsCar />}
            label={params.row.vehiclePlate}
            size="small"
            variant="outlined"
          />
        ) : (
          <Typography variant="caption" color="text.secondary">
            No vehicle assigned
          </Typography>
        )
      ),
    },
    {
      field: 'status',
      headerName: 'Status',
      width: 120,
      renderCell: (params: GridRenderCellParams) => (
        <Chip
          label={params.value}
          color={getStatusColor(params.value)}
          size="small"
        />
      ),
    },
    {
      field: 'rating',
      headerName: 'Rating',
      width: 150,
      renderCell: (params: GridRenderCellParams) => (
        <Box sx={{ display: 'flex', alignItems: 'center' }}>
          <Rating value={params.value} readOnly size="small" />
          <Typography variant="body2" sx={{ ml: 1 }}>
            {params.value}
          </Typography>
        </Box>
      ),
    },
    {
      field: 'todayDeliveries',
      headerName: "Today's Deliveries",
      width: 130,
      type: 'number',
    },
    {
      field: 'totalDeliveries',
      headerName: 'Total Deliveries',
      width: 130,
      type: 'number',
    },
    {
      field: 'todayEarnings',
      headerName: "Today's Earnings",
      width: 130,
      renderCell: (params: GridRenderCellParams) => 
        `$${params.row.earnings.today.toFixed(2)}`,
    },
    {
      field: 'performance',
      headerName: 'On-Time Rate',
      width: 120,
      renderCell: (params: GridRenderCellParams) => (
        <Box sx={{ display: 'flex', alignItems: 'center' }}>
          {params.row.performance.onTimeRate > 90 ? (
            <TrendingUp sx={{ color: 'success.main', fontSize: 16, mr: 0.5 }} />
          ) : (
            <Warning sx={{ color: 'warning.main', fontSize: 16, mr: 0.5 }} />
          )}
          <Typography variant="body2">
            {params.row.performance.onTimeRate}%
          </Typography>
        </Box>
      ),
    },
    {
      field: 'lastActive',
      headerName: 'Last Active',
      width: 150,
      renderCell: (params: GridRenderCellParams) => 
        format(new Date(params.value), 'MMM dd, HH:mm'),
    },
    {
      field: 'actions',
      headerName: 'Actions',
      width: 80,
      sortable: false,
      renderCell: (params: GridRenderCellParams) => (
        <IconButton
          size="small"
          onClick={(e) => handleMenuOpen(e, params.row as Driver)}
        >
          <MoreVert />
        </IconButton>
      ),
    },
  ];

  return (
    <>
      <Head>
        <title>Driver Management - ReskFlow Partner Portal</title>
      </Head>
      
      <PartnerLayout>
        <Box sx={{ flexGrow: 1 }}>
          {/* Header */}
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
            <Typography variant="h4" fontWeight="bold">
              Driver Management
            </Typography>
            <Box sx={{ display: 'flex', gap: 2 }}>
              <Button
                variant="outlined"
                startIcon={<Download />}
              >
                Export
              </Button>
              <Button
                variant="contained"
                startIcon={<PersonAdd />}
                onClick={() => setInviteDialog(true)}
              >
                Invite Driver
              </Button>
            </Box>
          </Box>

          {/* Stats Cards */}
          <Grid container spacing={3} sx={{ mb: 3 }}>
            <Grid item xs={12} sm={6} md={3}>
              <Card>
                <CardContent>
                  <Typography color="textSecondary" gutterBottom>
                    Total Drivers
                  </Typography>
                  <Typography variant="h4">
                    {stats.totalDrivers}
                  </Typography>
                </CardContent>
              </Card>
            </Grid>
            <Grid item xs={12} sm={6} md={3}>
              <Card>
                <CardContent>
                  <Typography color="textSecondary" gutterBottom>
                    Active Now
                  </Typography>
                  <Typography variant="h4" color="success.main">
                    {stats.activeDrivers}
                  </Typography>
                </CardContent>
              </Card>
            </Grid>
            <Grid item xs={12} sm={6} md={3}>
              <Card>
                <CardContent>
                  <Typography color="textSecondary" gutterBottom>
                    Average Rating
                  </Typography>
                  <Box sx={{ display: 'flex', alignItems: 'center' }}>
                    <Typography variant="h4">
                      {stats.avgRating}
                    </Typography>
                    <Star sx={{ color: 'warning.main', ml: 1 }} />
                  </Box>
                </CardContent>
              </Card>
            </Grid>
            <Grid item xs={12} sm={6} md={3}>
              <Card>
                <CardContent>
                  <Typography color="textSecondary" gutterBottom>
                    Today's Deliveries
                  </Typography>
                  <Typography variant="h4">
                    {stats.todayDeliveries}
                  </Typography>
                </CardContent>
              </Card>
            </Grid>
          </Grid>

          {/* Filters */}
          <Paper sx={{ p: 2, mb: 3 }}>
            <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap' }}>
              <TextField
                placeholder="Search drivers..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                sx={{ flex: 1, minWidth: 300 }}
                InputProps={{
                  startAdornment: (
                    <InputAdornment position="start">
                      <Search />
                    </InputAdornment>
                  ),
                }}
              />
              
              <FormControl sx={{ minWidth: 150 }}>
                <InputLabel>Status</InputLabel>
                <Select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  label="Status"
                >
                  <MenuItem value="all">All Status</MenuItem>
                  <MenuItem value="active">Active</MenuItem>
                  <MenuItem value="inactive">Inactive</MenuItem>
                  <MenuItem value="suspended">Suspended</MenuItem>
                  <MenuItem value="pending">Pending</MenuItem>
                </Select>
              </FormControl>
              
              <IconButton onClick={fetchDrivers}>
                <Refresh />
              </IconButton>
            </Box>
          </Paper>

          {/* Tabs */}
          <Paper sx={{ mb: 3 }}>
            <Tabs
              value={selectedTab}
              onChange={(e, value) => setSelectedTab(value)}
              variant="fullWidth"
            >
              <Tab label="All Drivers" />
              <Tab label="Active" />
              <Tab label="Inactive" />
              <Tab label="Pending Approval" />
            </Tabs>
          </Paper>

          {/* Data Grid */}
          <Paper sx={{ height: 600 }}>
            <DataGrid
              rows={drivers}
              columns={columns}
              loading={loading}
              paginationMode="server"
              rowCount={totalRows}
              pageSizeOptions={[10, 25, 50, 100]}
              paginationModel={{
                page,
                pageSize,
              }}
              onPaginationModelChange={(model) => {
                setPage(model.page);
                setPageSize(model.pageSize);
              }}
              disableRowSelectionOnClick
            />
          </Paper>
        </Box>

        {/* Action Menu */}
        <Menu
          anchorEl={anchorEl}
          open={Boolean(anchorEl)}
          onClose={handleMenuClose}
        >
          <MenuItem onClick={() => {
            handleMenuClose();
            setDetailsDialog(true);
          }}>
            <Edit fontSize="small" sx={{ mr: 1 }} />
            View Details
          </MenuItem>
          {selectedDriver?.status === 'active' && (
            <MenuItem onClick={() => {
              handleMenuClose();
              setSuspendDialog(true);
            }}>
              <Block fontSize="small" sx={{ mr: 1 }} />
              Suspend Driver
            </MenuItem>
          )}
          {selectedDriver?.status === 'inactive' && (
            <MenuItem onClick={() => {
              handleMenuClose();
              handleActivateDriver(selectedDriver.id);
            }}>
              <CheckCircle fontSize="small" sx={{ mr: 1 }} />
              Activate Driver
            </MenuItem>
          )}
        </Menu>

        {/* Invite Driver Dialog */}
        <Dialog
          open={inviteDialog}
          onClose={() => setInviteDialog(false)}
          maxWidth="sm"
          fullWidth
        >
          <DialogTitle>Invite New Driver</DialogTitle>
          <DialogContent>
            <TextField
              fullWidth
              label="Driver Name"
              value={inviteForm.name}
              onChange={(e) => setInviteForm({ ...inviteForm, name: e.target.value })}
              margin="normal"
            />
            <TextField
              fullWidth
              label="Email Address"
              type="email"
              value={inviteForm.email}
              onChange={(e) => setInviteForm({ ...inviteForm, email: e.target.value })}
              margin="normal"
            />
            <TextField
              fullWidth
              label="Phone Number"
              value={inviteForm.phone}
              onChange={(e) => setInviteForm({ ...inviteForm, phone: e.target.value })}
              margin="normal"
            />
            <FormControl fullWidth margin="normal">
              <InputLabel>Vehicle Type</InputLabel>
              <Select
                value={inviteForm.vehicleType}
                onChange={(e) => setInviteForm({ ...inviteForm, vehicleType: e.target.value })}
                label="Vehicle Type"
              >
                <MenuItem value="bike">Bike</MenuItem>
                <MenuItem value="car">Car</MenuItem>
                <MenuItem value="van">Van</MenuItem>
                <MenuItem value="truck">Truck</MenuItem>
              </Select>
            </FormControl>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setInviteDialog(false)}>Cancel</Button>
            <Button
              onClick={handleInviteDriver}
              variant="contained"
              startIcon={<Send />}
            >
              Send Invitation
            </Button>
          </DialogActions>
        </Dialog>

        {/* Driver Details Dialog */}
        <Dialog
          open={detailsDialog}
          onClose={() => setDetailsDialog(false)}
          maxWidth="md"
          fullWidth
        >
          <DialogTitle>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <Typography variant="h6">Driver Details</Typography>
              {selectedDriver && (
                <Chip
                  label={selectedDriver.status}
                  color={getStatusColor(selectedDriver.status)}
                />
              )}
            </Box>
          </DialogTitle>
          <DialogContent>
            {selectedDriver && (
              <Grid container spacing={3}>
                <Grid item xs={12} md={6}>
                  <Paper sx={{ p: 2 }}>
                    <Typography variant="subtitle2" gutterBottom>
                      Personal Information
                    </Typography>
                    <List>
                      <ListItem>
                        <ListItemAvatar>
                          <Avatar>
                            {selectedDriver.name.split(' ').map(n => n[0]).join('')}
                          </Avatar>
                        </ListItemAvatar>
                        <ListItemText
                          primary={selectedDriver.name}
                          secondary={`Driver ID: ${selectedDriver.id}`}
                        />
                      </ListItem>
                      <ListItem>
                        <ListItemText
                          primary={selectedDriver.email}
                          secondary="Email"
                        />
                      </ListItem>
                      <ListItem>
                        <ListItemText
                          primary={selectedDriver.phone}
                          secondary="Phone"
                        />
                      </ListItem>
                      <ListItem>
                        <ListItemText
                          primary={format(new Date(selectedDriver.joinedAt), 'MMM dd, yyyy')}
                          secondary="Joined Date"
                        />
                      </ListItem>
                    </List>
                  </Paper>
                </Grid>
                
                <Grid item xs={12} md={6}>
                  <Paper sx={{ p: 2 }}>
                    <Typography variant="subtitle2" gutterBottom>
                      Performance Metrics
                    </Typography>
                    <List>
                      <ListItem>
                        <ListItemText
                          primary={`${selectedDriver.performance.onTimeRate}%`}
                          secondary="On-Time Delivery Rate"
                        />
                      </ListItem>
                      <ListItem>
                        <ListItemText
                          primary={`${selectedDriver.performance.acceptanceRate}%`}
                          secondary="Order Acceptance Rate"
                        />
                      </ListItem>
                      <ListItem>
                        <ListItemText
                          primary={`${selectedDriver.performance.completionRate}%`}
                          secondary="Order Completion Rate"
                        />
                      </ListItem>
                      <ListItem>
                        <ListItemText
                          primary={
                            <Rating value={selectedDriver.rating} readOnly size="small" />
                          }
                          secondary={`Customer Rating (${selectedDriver.rating})`}
                        />
                      </ListItem>
                    </List>
                  </Paper>
                </Grid>
                
                <Grid item xs={12}>
                  <Paper sx={{ p: 2 }}>
                    <Typography variant="subtitle2" gutterBottom>
                      Earnings Summary
                    </Typography>
                    <Grid container spacing={2}>
                      <Grid item xs={4}>
                        <Typography variant="h6">
                          ${selectedDriver.earnings.today.toFixed(2)}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          Today
                        </Typography>
                      </Grid>
                      <Grid item xs={4}>
                        <Typography variant="h6">
                          ${selectedDriver.earnings.week.toFixed(2)}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          This Week
                        </Typography>
                      </Grid>
                      <Grid item xs={4}>
                        <Typography variant="h6">
                          ${selectedDriver.earnings.month.toFixed(2)}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          This Month
                        </Typography>
                      </Grid>
                    </Grid>
                  </Paper>
                </Grid>
                
                <Grid item xs={12}>
                  <Paper sx={{ p: 2 }}>
                    <Typography variant="subtitle2" gutterBottom>
                      Document Status
                    </Typography>
                    <Box sx={{ display: 'flex', gap: 2 }}>
                      <Chip
                        label="Driver's License"
                        color={selectedDriver.documents.license ? 'success' : 'error'}
                        icon={selectedDriver.documents.license ? <CheckCircle /> : <Warning />}
                      />
                      <Chip
                        label="Insurance"
                        color={selectedDriver.documents.insurance ? 'success' : 'error'}
                        icon={selectedDriver.documents.insurance ? <CheckCircle /> : <Warning />}
                      />
                      <Chip
                        label="Background Check"
                        color={selectedDriver.documents.background ? 'success' : 'error'}
                        icon={selectedDriver.documents.background ? <CheckCircle /> : <Warning />}
                      />
                    </Box>
                  </Paper>
                </Grid>
              </Grid>
            )}
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setDetailsDialog(false)}>Close</Button>
          </DialogActions>
        </Dialog>

        {/* Suspend Dialog */}
        <Dialog
          open={suspendDialog}
          onClose={() => setSuspendDialog(false)}
          maxWidth="sm"
          fullWidth
        >
          <DialogTitle>Suspend Driver</DialogTitle>
          <DialogContent>
            <Typography variant="body2" color="text.secondary" gutterBottom>
              Are you sure you want to suspend {selectedDriver?.name}? Please provide a reason:
            </Typography>
            <TextField
              fullWidth
              multiline
              rows={3}
              placeholder="Reason for suspension..."
              value={suspendReason}
              onChange={(e) => setSuspendReason(e.target.value)}
              sx={{ mt: 2 }}
            />
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setSuspendDialog(false)}>Cancel</Button>
            <Button
              onClick={handleSuspendDriver}
              variant="contained"
              color="error"
              disabled={!suspendReason}
            >
              Suspend Driver
            </Button>
          </DialogActions>
        </Dialog>
      </PartnerLayout>
    </>
  );
}