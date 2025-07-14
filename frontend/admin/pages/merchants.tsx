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
  Slider,
} from '@mui/material';
import { DataGrid, GridColDef, GridRenderCellParams } from '@mui/x-data-grid';
import {
  Search,
  FilterList,
  MoreVert,
  Block,
  CheckCircle,
  Edit,
  Store,
  Download,
  Refresh,
  AttachMoney,
  TrendingUp,
  LocationOn,
} from '@mui/icons-material';
import AdminLayout from '../components/layouts/AdminLayout';
import { merchantApi } from '../services/api';
import { format } from 'date-fns';
import Head from 'next/head';

interface Merchant {
  id: string;
  businessName: string;
  ownerName: string;
  email: string;
  phone: string;
  businessType: string;
  status: 'active' | 'suspended' | 'pending' | 'rejected';
  rating: number;
  totalOrders: number;
  totalRevenue: number;
  commission: number;
  address: string;
  createdAt: string;
  documents: {
    businessLicense: boolean;
    taxId: boolean;
    bankAccount: boolean;
  };
}

export default function MerchantsPage() {
  const [merchants, setMerchants] = useState<Merchant[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [selectedTab, setSelectedTab] = useState(0);
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const [selectedMerchant, setSelectedMerchant] = useState<Merchant | null>(null);
  const [approveDialog, setApproveDialog] = useState(false);
  const [rejectDialog, setRejectDialog] = useState(false);
  const [commissionDialog, setCommissionDialog] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [newCommission, setNewCommission] = useState(15);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [totalRows, setTotalRows] = useState(0);

  // Summary stats
  const [stats, setStats] = useState({
    totalMerchants: 0,
    activeMerchants: 0,
    pendingApproval: 0,
    totalRevenue: 0,
  });

  useEffect(() => {
    fetchMerchants();
    fetchStats();
  }, [page, pageSize, statusFilter]);

  const fetchMerchants = async () => {
    setLoading(true);
    try {
      const params = {
        page: page + 1,
        limit: pageSize,
        ...(statusFilter !== 'all' && { status: statusFilter }),
        ...(searchQuery && { search: searchQuery }),
      };
      
      const response = await merchantApi.getMerchants(params);
      setMerchants(response.data.merchants);
      setTotalRows(response.data.total);
    } catch (error) {
      console.error('Failed to fetch merchants:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchStats = async () => {
    // Fetch summary statistics
    setStats({
      totalMerchants: 156,
      activeMerchants: 142,
      pendingApproval: 8,
      totalRevenue: 1250000,
    });
  };

  const handleMenuOpen = (event: React.MouseEvent<HTMLElement>, merchant: Merchant) => {
    setAnchorEl(event.currentTarget);
    setSelectedMerchant(merchant);
  };

  const handleMenuClose = () => {
    setAnchorEl(null);
  };

  const handleApprove = () => {
    handleMenuClose();
    setApproveDialog(true);
  };

  const confirmApprove = async () => {
    if (!selectedMerchant) return;
    
    try {
      await merchantApi.approveMerchant(selectedMerchant.id);
      fetchMerchants();
      setApproveDialog(false);
    } catch (error) {
      console.error('Failed to approve merchant:', error);
    }
  };

  const handleReject = () => {
    handleMenuClose();
    setRejectDialog(true);
  };

  const confirmReject = async () => {
    if (!selectedMerchant || !rejectReason) return;
    
    try {
      await merchantApi.rejectMerchant(selectedMerchant.id, rejectReason);
      fetchMerchants();
      setRejectDialog(false);
      setRejectReason('');
    } catch (error) {
      console.error('Failed to reject merchant:', error);
    }
  };

  const handleCommissionChange = () => {
    if (selectedMerchant) {
      setNewCommission(selectedMerchant.commission);
    }
    handleMenuClose();
    setCommissionDialog(true);
  };

  const confirmCommissionChange = async () => {
    if (!selectedMerchant) return;
    
    try {
      await merchantApi.updateMerchantCommission(selectedMerchant.id, newCommission);
      fetchMerchants();
      setCommissionDialog(false);
    } catch (error) {
      console.error('Failed to update commission:', error);
    }
  };

  const columns: GridColDef[] = [
    {
      field: 'businessName',
      headerName: 'Business Name',
      width: 250,
      renderCell: (params: GridRenderCellParams) => (
        <Box sx={{ display: 'flex', alignItems: 'center' }}>
          <Avatar sx={{ width: 32, height: 32, mr: 1, bgcolor: 'primary.main' }}>
            <Store fontSize="small" />
          </Avatar>
          <Box>
            <Typography variant="body2" fontWeight="medium">
              {params.value}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {params.row.businessType}
            </Typography>
          </Box>
        </Box>
      ),
    },
    {
      field: 'ownerName',
      headerName: 'Owner',
      width: 150,
    },
    {
      field: 'email',
      headerName: 'Email',
      width: 200,
    },
    {
      field: 'phone',
      headerName: 'Phone',
      width: 130,
    },
    {
      field: 'status',
      headerName: 'Status',
      width: 120,
      renderCell: (params: GridRenderCellParams) => (
        <Chip
          label={params.value}
          color={
            params.value === 'active' ? 'success' :
            params.value === 'pending' ? 'warning' :
            params.value === 'rejected' ? 'error' : 'default'
          }
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
            {params.value.toFixed(1)}
          </Typography>
        </Box>
      ),
    },
    {
      field: 'totalOrders',
      headerName: 'Orders',
      width: 100,
      type: 'number',
    },
    {
      field: 'totalRevenue',
      headerName: 'Revenue',
      width: 120,
      type: 'number',
      renderCell: (params: GridRenderCellParams) => `$${params.value.toLocaleString()}`,
    },
    {
      field: 'commission',
      headerName: 'Commission',
      width: 100,
      renderCell: (params: GridRenderCellParams) => `${params.value}%`,
    },
    {
      field: 'documents',
      headerName: 'Documents',
      width: 150,
      renderCell: (params: GridRenderCellParams) => {
        const docs = params.value as Merchant['documents'];
        const verified = docs.businessLicense && docs.taxId && docs.bankAccount;
        return (
          <Chip
            label={verified ? 'Verified' : 'Incomplete'}
            color={verified ? 'success' : 'warning'}
            size="small"
            icon={verified ? <CheckCircle /> : undefined}
          />
        );
      },
    },
    {
      field: 'createdAt',
      headerName: 'Joined',
      width: 120,
      renderCell: (params: GridRenderCellParams) => 
        format(new Date(params.value), 'MMM dd, yyyy'),
    },
    {
      field: 'actions',
      headerName: 'Actions',
      width: 80,
      sortable: false,
      renderCell: (params: GridRenderCellParams) => (
        <IconButton
          size="small"
          onClick={(e) => handleMenuOpen(e, params.row as Merchant)}
        >
          <MoreVert />
        </IconButton>
      ),
    },
  ];

  return (
    <>
      <Head>
        <title>Merchant Management - ReskFlow Admin</title>
      </Head>
      
      <AdminLayout>
        <Box sx={{ flexGrow: 1 }}>
          {/* Header */}
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
            <Typography variant="h4" fontWeight="bold">
              Merchant Management
            </Typography>
            <Box sx={{ display: 'flex', gap: 2 }}>
              <Button
                variant="outlined"
                startIcon={<Download />}
              >
                Export
              </Button>
            </Box>
          </Box>

          {/* Stats Cards */}
          <Grid container spacing={3} sx={{ mb: 3 }}>
            <Grid item xs={12} sm={6} md={3}>
              <Card>
                <CardContent>
                  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <Box>
                      <Typography color="textSecondary" gutterBottom>
                        Total Merchants
                      </Typography>
                      <Typography variant="h4">
                        {stats.totalMerchants}
                      </Typography>
                    </Box>
                    <Store sx={{ fontSize: 40, color: 'primary.main' }} />
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
                      <Typography variant="h4">
                        {stats.activeMerchants}
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
                        Pending
                      </Typography>
                      <Typography variant="h4">
                        {stats.pendingApproval}
                      </Typography>
                    </Box>
                    <Block sx={{ fontSize: 40, color: 'warning.main' }} />
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
                        Total Revenue
                      </Typography>
                      <Typography variant="h4">
                        ${stats.totalRevenue.toLocaleString()}
                      </Typography>
                    </Box>
                    <AttachMoney sx={{ fontSize: 40, color: 'success.main' }} />
                  </Box>
                </CardContent>
              </Card>
            </Grid>
          </Grid>

          {/* Filters */}
          <Paper sx={{ p: 2, mb: 3 }}>
            <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap' }}>
              <TextField
                placeholder="Search merchants..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && fetchMerchants()}
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
                  <MenuItem value="pending">Pending</MenuItem>
                  <MenuItem value="suspended">Suspended</MenuItem>
                  <MenuItem value="rejected">Rejected</MenuItem>
                </Select>
              </FormControl>
              
              <IconButton onClick={fetchMerchants}>
                <Refresh />
              </IconButton>
            </Box>
          </Paper>

          {/* Data Grid */}
          <Paper sx={{ height: 600 }}>
            <DataGrid
              rows={merchants}
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
          <MenuItem onClick={() => { handleMenuClose(); /* View details */ }}>
            <Edit fontSize="small" sx={{ mr: 1 }} />
            View Details
          </MenuItem>
          {selectedMerchant?.status === 'pending' && (
            <>
              <MenuItem onClick={handleApprove}>
                <CheckCircle fontSize="small" sx={{ mr: 1 }} />
                Approve Merchant
              </MenuItem>
              <MenuItem onClick={handleReject}>
                <Block fontSize="small" sx={{ mr: 1 }} />
                Reject Application
              </MenuItem>
            </>
          )}
          {selectedMerchant?.status === 'active' && (
            <MenuItem onClick={() => { handleMenuClose(); /* Suspend */ }}>
              <Block fontSize="small" sx={{ mr: 1 }} />
              Suspend Merchant
            </MenuItem>
          )}
          <MenuItem onClick={handleCommissionChange}>
            <AttachMoney fontSize="small" sx={{ mr: 1 }} />
            Update Commission
          </MenuItem>
        </Menu>

        {/* Approve Dialog */}
        <Dialog
          open={approveDialog}
          onClose={() => setApproveDialog(false)}
        >
          <DialogTitle>Approve Merchant</DialogTitle>
          <DialogContent>
            <Typography>
              Are you sure you want to approve {selectedMerchant?.businessName}?
              This will allow them to start receiving orders.
            </Typography>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setApproveDialog(false)}>Cancel</Button>
            <Button
              onClick={confirmApprove}
              variant="contained"
              color="success"
            >
              Approve
            </Button>
          </DialogActions>
        </Dialog>

        {/* Reject Dialog */}
        <Dialog
          open={rejectDialog}
          onClose={() => setRejectDialog(false)}
          maxWidth="sm"
          fullWidth
        >
          <DialogTitle>Reject Merchant Application</DialogTitle>
          <DialogContent>
            <Typography variant="body2" color="text.secondary" gutterBottom>
              Please provide a reason for rejecting {selectedMerchant?.businessName}:
            </Typography>
            <TextField
              fullWidth
              multiline
              rows={3}
              placeholder="Reason for rejection..."
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              sx={{ mt: 2 }}
            />
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setRejectDialog(false)}>Cancel</Button>
            <Button
              onClick={confirmReject}
              variant="contained"
              color="error"
              disabled={!rejectReason}
            >
              Reject
            </Button>
          </DialogActions>
        </Dialog>

        {/* Commission Dialog */}
        <Dialog
          open={commissionDialog}
          onClose={() => setCommissionDialog(false)}
          maxWidth="sm"
          fullWidth
        >
          <DialogTitle>Update Commission Rate</DialogTitle>
          <DialogContent>
            <Typography variant="body2" color="text.secondary" gutterBottom>
              Update commission rate for {selectedMerchant?.businessName}
            </Typography>
            <Box sx={{ mt: 3 }}>
              <Typography gutterBottom>Commission Rate: {newCommission}%</Typography>
              <Slider
                value={newCommission}
                onChange={(e, value) => setNewCommission(value as number)}
                min={0}
                max={30}
                step={0.5}
                marks
                valueLabelDisplay="auto"
              />
            </Box>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setCommissionDialog(false)}>Cancel</Button>
            <Button
              onClick={confirmCommissionChange}
              variant="contained"
            >
              Update
            </Button>
          </DialogActions>
        </Dialog>
      </AdminLayout>
    </>
  );
}