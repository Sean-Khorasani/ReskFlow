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
  Grid,
  Card,
  CardContent,
  FormControl,
  InputLabel,
  Select,
  LinearProgress,
  List,
  ListItem,
  ListItemText,
  ListItemIcon,
  Divider,
  Alert,
} from '@mui/material';
import { DataGrid, GridColDef, GridRenderCellParams } from '@mui/x-data-grid';
import {
  Search,
  DirectionsCar,
  TwoWheeler,
  LocalShipping,
  Add,
  Edit,
  Delete,
  MoreVert,
  Build,
  Warning,
  CheckCircle,
  Schedule,
  AttachMoney,
  Speed,
  LocalGasStation,
  CalendarToday,
  Person,
  Refresh,
} from '@mui/icons-material';
import PartnerLayout from '../components/layouts/PartnerLayout';
import { vehicleApi } from '../services/api';
import { format } from 'date-fns';
import Head from 'next/head';

interface Vehicle {
  id: string;
  type: 'bike' | 'car' | 'van' | 'truck';
  make: string;
  model: string;
  year: number;
  plate: string;
  vin: string;
  status: 'active' | 'maintenance' | 'inactive';
  assignedDriver?: {
    id: string;
    name: string;
  };
  mileage: number;
  fuelType: string;
  lastMaintenance: string;
  nextMaintenance: string;
  insurance: {
    provider: string;
    policyNumber: string;
    expiryDate: string;
  };
  documents: {
    registration: boolean;
    insurance: boolean;
    inspection: boolean;
  };
  performance: {
    totalDeliveries: number;
    avgFuelConsumption: number;
    dailyUtilization: number;
  };
}

interface MaintenanceRecord {
  id: string;
  date: string;
  type: string;
  description: string;
  cost: number;
  mileage: number;
}

export default function VehiclesPage() {
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [selectedVehicle, setSelectedVehicle] = useState<Vehicle | null>(null);
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const [addDialog, setAddDialog] = useState(false);
  const [detailsDialog, setDetailsDialog] = useState(false);
  const [maintenanceDialog, setMaintenanceDialog] = useState(false);
  const [assignDialog, setAssignDialog] = useState(false);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [totalRows, setTotalRows] = useState(0);

  // Form state for new vehicle
  const [vehicleForm, setVehicleForm] = useState({
    type: 'car',
    make: '',
    model: '',
    year: new Date().getFullYear(),
    plate: '',
    vin: '',
    fuelType: 'gasoline',
  });

  // Stats
  const [stats, setStats] = useState({
    totalVehicles: 52,
    activeVehicles: 46,
    inMaintenance: 4,
    avgUtilization: 82.5,
  });

  useEffect(() => {
    fetchVehicles();
  }, [page, pageSize, typeFilter, statusFilter]);

  const fetchVehicles = async () => {
    setLoading(true);
    try {
      // Mock data
      const mockVehicles: Vehicle[] = [
        {
          id: 'v1',
          type: 'car',
          make: 'Toyota',
          model: 'Camry',
          year: 2022,
          plate: 'ABC-123',
          vin: '1HGCM82633A123456',
          status: 'active',
          assignedDriver: {
            id: 'd1',
            name: 'John Smith',
          },
          mileage: 15234,
          fuelType: 'Hybrid',
          lastMaintenance: new Date('2024-01-01').toISOString(),
          nextMaintenance: new Date('2024-04-01').toISOString(),
          insurance: {
            provider: 'State Farm',
            policyNumber: 'POL-123456',
            expiryDate: new Date('2024-12-31').toISOString(),
          },
          documents: {
            registration: true,
            insurance: true,
            inspection: true,
          },
          performance: {
            totalDeliveries: 1234,
            avgFuelConsumption: 32.5,
            dailyUtilization: 85.3,
          },
        },
        {
          id: 'v2',
          type: 'bike',
          make: 'Honda',
          model: 'PCX',
          year: 2023,
          plate: 'XYZ-789',
          vin: '2HGCM82633B789012',
          status: 'active',
          assignedDriver: {
            id: 'd2',
            name: 'Sarah Johnson',
          },
          mileage: 8567,
          fuelType: 'Gasoline',
          lastMaintenance: new Date('2023-12-15').toISOString(),
          nextMaintenance: new Date('2024-03-15').toISOString(),
          insurance: {
            provider: 'Geico',
            policyNumber: 'POL-789012',
            expiryDate: new Date('2024-11-30').toISOString(),
          },
          documents: {
            registration: true,
            insurance: true,
            inspection: true,
          },
          performance: {
            totalDeliveries: 987,
            avgFuelConsumption: 65.8,
            dailyUtilization: 92.1,
          },
        },
        {
          id: 'v3',
          type: 'van',
          make: 'Ford',
          model: 'Transit',
          year: 2021,
          plate: 'VAN-456',
          vin: '3FGCM82633C345678',
          status: 'maintenance',
          mileage: 45678,
          fuelType: 'Diesel',
          lastMaintenance: new Date('2024-01-20').toISOString(),
          nextMaintenance: new Date('2024-01-25').toISOString(),
          insurance: {
            provider: 'Progressive',
            policyNumber: 'POL-345678',
            expiryDate: new Date('2024-10-31').toISOString(),
          },
          documents: {
            registration: true,
            insurance: true,
            inspection: false,
          },
          performance: {
            totalDeliveries: 567,
            avgFuelConsumption: 24.3,
            dailyUtilization: 0,
          },
        },
      ];

      setVehicles(mockVehicles);
      setTotalRows(mockVehicles.length);
    } catch (error) {
      console.error('Failed to fetch vehicles:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleMenuOpen = (event: React.MouseEvent<HTMLElement>, vehicle: Vehicle) => {
    setAnchorEl(event.currentTarget);
    setSelectedVehicle(vehicle);
  };

  const handleMenuClose = () => {
    setAnchorEl(null);
  };

  const handleAddVehicle = async () => {
    try {
      await vehicleApi.addVehicle(vehicleForm);
      setAddDialog(false);
      setVehicleForm({
        type: 'car',
        make: '',
        model: '',
        year: new Date().getFullYear(),
        plate: '',
        vin: '',
        fuelType: 'gasoline',
      });
      fetchVehicles();
    } catch (error) {
      console.error('Failed to add vehicle:', error);
    }
  };

  const getVehicleIcon = (type: Vehicle['type']) => {
    switch (type) {
      case 'bike': return <TwoWheeler />;
      case 'car': return <DirectionsCar />;
      case 'van': 
      case 'truck': return <LocalShipping />;
      default: return <DirectionsCar />;
    }
  };

  const getStatusColor = (status: Vehicle['status']) => {
    switch (status) {
      case 'active': return 'success';
      case 'maintenance': return 'warning';
      case 'inactive': return 'error';
      default: return 'default';
    }
  };

  const columns: GridColDef[] = [
    {
      field: 'vehicle',
      headerName: 'Vehicle',
      width: 250,
      renderCell: (params: GridRenderCellParams) => (
        <Box sx={{ display: 'flex', alignItems: 'center' }}>
          <Avatar sx={{ width: 40, height: 40, mr: 2, bgcolor: 'primary.light' }}>
            {getVehicleIcon(params.row.type)}
          </Avatar>
          <Box>
            <Typography variant="body2" fontWeight="medium">
              {params.row.make} {params.row.model}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {params.row.plate} • {params.row.year}
            </Typography>
          </Box>
        </Box>
      ),
    },
    {
      field: 'type',
      headerName: 'Type',
      width: 100,
      renderCell: (params: GridRenderCellParams) => (
        <Chip
          label={params.value}
          size="small"
          variant="outlined"
        />
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
      field: 'assignedDriver',
      headerName: 'Assigned Driver',
      width: 200,
      renderCell: (params: GridRenderCellParams) => (
        params.value ? (
          <Box sx={{ display: 'flex', alignItems: 'center' }}>
            <Person sx={{ fontSize: 16, mr: 0.5 }} />
            <Typography variant="body2">{params.value.name}</Typography>
          </Box>
        ) : (
          <Typography variant="caption" color="text.secondary">
            Unassigned
          </Typography>
        )
      ),
    },
    {
      field: 'mileage',
      headerName: 'Mileage',
      width: 120,
      type: 'number',
      renderCell: (params: GridRenderCellParams) => 
        `${params.value.toLocaleString()} km`,
    },
    {
      field: 'nextMaintenance',
      headerName: 'Next Service',
      width: 150,
      renderCell: (params: GridRenderCellParams) => {
        const daysUntil = Math.floor(
          (new Date(params.value).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24)
        );
        return (
          <Box>
            <Typography variant="body2">
              {format(new Date(params.value), 'MMM dd, yyyy')}
            </Typography>
            <Typography 
              variant="caption" 
              color={daysUntil < 7 ? 'error.main' : 'text.secondary'}
            >
              {daysUntil > 0 ? `In ${daysUntil} days` : 'Overdue'}
            </Typography>
          </Box>
        );
      },
    },
    {
      field: 'performance',
      headerName: 'Utilization',
      width: 120,
      renderCell: (params: GridRenderCellParams) => (
        <Box sx={{ width: '100%' }}>
          <Typography variant="body2">
            {params.row.performance.dailyUtilization}%
          </Typography>
          <LinearProgress
            variant="determinate"
            value={params.row.performance.dailyUtilization}
            sx={{ mt: 0.5 }}
            color={params.row.performance.dailyUtilization > 80 ? 'success' : 'warning'}
          />
        </Box>
      ),
    },
    {
      field: 'documents',
      headerName: 'Documents',
      width: 150,
      renderCell: (params: GridRenderCellParams) => {
        const docs = params.value as Vehicle['documents'];
        const allValid = docs.registration && docs.insurance && docs.inspection;
        return (
          <Chip
            label={allValid ? 'Complete' : 'Incomplete'}
            color={allValid ? 'success' : 'warning'}
            size="small"
            icon={allValid ? <CheckCircle /> : <Warning />}
          />
        );
      },
    },
    {
      field: 'actions',
      headerName: 'Actions',
      width: 80,
      sortable: false,
      renderCell: (params: GridRenderCellParams) => (
        <IconButton
          size="small"
          onClick={(e) => handleMenuOpen(e, params.row as Vehicle)}
        >
          <MoreVert />
        </IconButton>
      ),
    },
  ];

  return (
    <>
      <Head>
        <title>Vehicle Management - ReskFlow Partner Portal</title>
      </Head>
      
      <PartnerLayout>
        <Box sx={{ flexGrow: 1 }}>
          {/* Header */}
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
            <Typography variant="h4" fontWeight="bold">
              Fleet Management
            </Typography>
            <Button
              variant="contained"
              startIcon={<Add />}
              onClick={() => setAddDialog(true)}
            >
              Add Vehicle
            </Button>
          </Box>

          {/* Stats Cards */}
          <Grid container spacing={3} sx={{ mb: 3 }}>
            <Grid item xs={12} sm={6} md={3}>
              <Card>
                <CardContent>
                  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <Box>
                      <Typography color="textSecondary" gutterBottom>
                        Total Vehicles
                      </Typography>
                      <Typography variant="h4">
                        {stats.totalVehicles}
                      </Typography>
                    </Box>
                    <DirectionsCar sx={{ fontSize: 40, color: 'primary.main' }} />
                  </Box>
                </CardContent>
              </Card>
            </Grid>
            <Grid item xs={12} sm={6} md={3}>
              <Card>
                <CardContent>
                  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <Box>
                      <Typography color="textSecondary" gutterBottom>
                        Active
                      </Typography>
                      <Typography variant="h4" color="success.main">
                        {stats.activeVehicles}
                      </Typography>
                    </Box>
                    <CheckCircle sx={{ fontSize: 40, color: 'success.main' }} />
                  </Box>
                </CardContent>
              </Card>
            </Grid>
            <Grid item xs={12} sm={6} md={3}>
              <Card>
                <CardContent>
                  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <Box>
                      <Typography color="textSecondary" gutterBottom>
                        In Maintenance
                      </Typography>
                      <Typography variant="h4" color="warning.main">
                        {stats.inMaintenance}
                      </Typography>
                    </Box>
                    <Build sx={{ fontSize: 40, color: 'warning.main' }} />
                  </Box>
                </CardContent>
              </Card>
            </Grid>
            <Grid item xs={12} sm={6} md={3}>
              <Card>
                <CardContent>
                  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <Box>
                      <Typography color="textSecondary" gutterBottom>
                        Avg Utilization
                      </Typography>
                      <Typography variant="h4">
                        {stats.avgUtilization}%
                      </Typography>
                    </Box>
                    <Speed sx={{ fontSize: 40, color: 'info.main' }} />
                  </Box>
                </CardContent>
              </Card>
            </Grid>
          </Grid>

          {/* Filters */}
          <Paper sx={{ p: 2, mb: 3 }}>
            <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap' }}>
              <TextField
                placeholder="Search vehicles..."
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
                <InputLabel>Type</InputLabel>
                <Select
                  value={typeFilter}
                  onChange={(e) => setTypeFilter(e.target.value)}
                  label="Type"
                >
                  <MenuItem value="all">All Types</MenuItem>
                  <MenuItem value="bike">Bike</MenuItem>
                  <MenuItem value="car">Car</MenuItem>
                  <MenuItem value="van">Van</MenuItem>
                  <MenuItem value="truck">Truck</MenuItem>
                </Select>
              </FormControl>
              
              <FormControl sx={{ minWidth: 150 }}>
                <InputLabel>Status</InputLabel>
                <Select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  label="Status"
                >
                  <MenuItem value="all">All Status</MenuItem>
                  <MenuItem value="active">Active</MenuItem>
                  <MenuItem value="maintenance">Maintenance</MenuItem>
                  <MenuItem value="inactive">Inactive</MenuItem>
                </Select>
              </FormControl>
              
              <IconButton onClick={fetchVehicles}>
                <Refresh />
              </IconButton>
            </Box>
          </Paper>

          {/* Maintenance Alert */}
          <Alert severity="warning" sx={{ mb: 3 }}>
            <Typography variant="subtitle2">
              3 vehicles require maintenance within the next 7 days
            </Typography>
          </Alert>

          {/* Data Grid */}
          <Paper sx={{ height: 600 }}>
            <DataGrid
              rows={vehicles}
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
          <MenuItem onClick={() => {
            handleMenuClose();
            setMaintenanceDialog(true);
          }}>
            <Build fontSize="small" sx={{ mr: 1 }} />
            Schedule Maintenance
          </MenuItem>
          <MenuItem onClick={() => {
            handleMenuClose();
            setAssignDialog(true);
          }}>
            <Person fontSize="small" sx={{ mr: 1 }} />
            Assign Driver
          </MenuItem>
          <MenuItem onClick={handleMenuClose} sx={{ color: 'error.main' }}>
            <Delete fontSize="small" sx={{ mr: 1 }} />
            Remove Vehicle
          </MenuItem>
        </Menu>

        {/* Add Vehicle Dialog */}
        <Dialog
          open={addDialog}
          onClose={() => setAddDialog(false)}
          maxWidth="sm"
          fullWidth
        >
          <DialogTitle>Add New Vehicle</DialogTitle>
          <DialogContent>
            <FormControl fullWidth margin="normal">
              <InputLabel>Vehicle Type</InputLabel>
              <Select
                value={vehicleForm.type}
                onChange={(e) => setVehicleForm({ ...vehicleForm, type: e.target.value as Vehicle['type'] })}
                label="Vehicle Type"
              >
                <MenuItem value="bike">Bike</MenuItem>
                <MenuItem value="car">Car</MenuItem>
                <MenuItem value="van">Van</MenuItem>
                <MenuItem value="truck">Truck</MenuItem>
              </Select>
            </FormControl>
            <TextField
              fullWidth
              label="Make"
              value={vehicleForm.make}
              onChange={(e) => setVehicleForm({ ...vehicleForm, make: e.target.value })}
              margin="normal"
            />
            <TextField
              fullWidth
              label="Model"
              value={vehicleForm.model}
              onChange={(e) => setVehicleForm({ ...vehicleForm, model: e.target.value })}
              margin="normal"
            />
            <TextField
              fullWidth
              label="Year"
              type="number"
              value={vehicleForm.year}
              onChange={(e) => setVehicleForm({ ...vehicleForm, year: parseInt(e.target.value) })}
              margin="normal"
            />
            <TextField
              fullWidth
              label="License Plate"
              value={vehicleForm.plate}
              onChange={(e) => setVehicleForm({ ...vehicleForm, plate: e.target.value })}
              margin="normal"
            />
            <TextField
              fullWidth
              label="VIN"
              value={vehicleForm.vin}
              onChange={(e) => setVehicleForm({ ...vehicleForm, vin: e.target.value })}
              margin="normal"
            />
            <FormControl fullWidth margin="normal">
              <InputLabel>Fuel Type</InputLabel>
              <Select
                value={vehicleForm.fuelType}
                onChange={(e) => setVehicleForm({ ...vehicleForm, fuelType: e.target.value })}
                label="Fuel Type"
              >
                <MenuItem value="gasoline">Gasoline</MenuItem>
                <MenuItem value="diesel">Diesel</MenuItem>
                <MenuItem value="electric">Electric</MenuItem>
                <MenuItem value="hybrid">Hybrid</MenuItem>
              </Select>
            </FormControl>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setAddDialog(false)}>Cancel</Button>
            <Button onClick={handleAddVehicle} variant="contained">
              Add Vehicle
            </Button>
          </DialogActions>
        </Dialog>

        {/* Vehicle Details Dialog */}
        <Dialog
          open={detailsDialog}
          onClose={() => setDetailsDialog(false)}
          maxWidth="md"
          fullWidth
        >
          <DialogTitle>Vehicle Details</DialogTitle>
          <DialogContent>
            {selectedVehicle && (
              <Grid container spacing={3}>
                <Grid item xs={12} md={6}>
                  <Paper sx={{ p: 2 }}>
                    <Typography variant="subtitle2" gutterBottom>
                      Vehicle Information
                    </Typography>
                    <List>
                      <ListItem>
                        <ListItemIcon>
                          {getVehicleIcon(selectedVehicle.type)}
                        </ListItemIcon>
                        <ListItemText
                          primary={`${selectedVehicle.make} ${selectedVehicle.model}`}
                          secondary={`${selectedVehicle.year} • ${selectedVehicle.plate}`}
                        />
                      </ListItem>
                      <ListItem>
                        <ListItemText
                          primary={selectedVehicle.vin}
                          secondary="VIN"
                        />
                      </ListItem>
                      <ListItem>
                        <ListItemText
                          primary={`${selectedVehicle.mileage.toLocaleString()} km`}
                          secondary="Current Mileage"
                        />
                      </ListItem>
                      <ListItem>
                        <ListItemText
                          primary={selectedVehicle.fuelType}
                          secondary="Fuel Type"
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
                        <ListItemIcon>
                          <LocalShipping />
                        </ListItemIcon>
                        <ListItemText
                          primary={selectedVehicle.performance.totalDeliveries}
                          secondary="Total Deliveries"
                        />
                      </ListItem>
                      <ListItem>
                        <ListItemIcon>
                          <LocalGasStation />
                        </ListItemIcon>
                        <ListItemText
                          primary={`${selectedVehicle.performance.avgFuelConsumption} MPG`}
                          secondary="Avg Fuel Consumption"
                        />
                      </ListItem>
                      <ListItem>
                        <ListItemIcon>
                          <Speed />
                        </ListItemIcon>
                        <ListItemText
                          primary={`${selectedVehicle.performance.dailyUtilization}%`}
                          secondary="Daily Utilization"
                        />
                      </ListItem>
                    </List>
                  </Paper>
                </Grid>
                
                <Grid item xs={12}>
                  <Paper sx={{ p: 2 }}>
                    <Typography variant="subtitle2" gutterBottom>
                      Maintenance History
                    </Typography>
                    <List>
                      <ListItem>
                        <ListItemIcon>
                          <Schedule />
                        </ListItemIcon>
                        <ListItemText
                          primary={format(new Date(selectedVehicle.lastMaintenance), 'MMM dd, yyyy')}
                          secondary="Last Service"
                        />
                      </ListItem>
                      <ListItem>
                        <ListItemIcon>
                          <CalendarToday />
                        </ListItemIcon>
                        <ListItemText
                          primary={format(new Date(selectedVehicle.nextMaintenance), 'MMM dd, yyyy')}
                          secondary="Next Service Due"
                        />
                      </ListItem>
                    </List>
                  </Paper>
                </Grid>
              </Grid>
            )}
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setDetailsDialog(false)}>Close</Button>
          </DialogActions>
        </Dialog>
      </PartnerLayout>
    </>
  );
}