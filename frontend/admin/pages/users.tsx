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
} from '@mui/material';
import { DataGrid, GridColDef, GridRenderCellParams } from '@mui/x-data-grid';
import {
  Search,
  FilterList,
  MoreVert,
  Block,
  CheckCircle,
  Edit,
  Delete,
  PersonAdd,
  Download,
  Refresh,
} from '@mui/icons-material';
import AdminLayout from '../components/layouts/AdminLayout';
import { userApi } from '../services/api';
import { format } from 'date-fns';
import Head from 'next/head';

interface User {
  id: string;
  name: string;
  email: string;
  phone: string;
  role: 'customer' | 'driver' | 'merchant';
  status: 'active' | 'suspended' | 'pending';
  createdAt: string;
  lastLogin: string;
  totalOrders: number;
  totalSpent: number;
}

export default function UsersPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [selectedTab, setSelectedTab] = useState(0);
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [suspendDialog, setSuspendDialog] = useState(false);
  const [suspendReason, setSuspendReason] = useState('');
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [totalRows, setTotalRows] = useState(0);

  useEffect(() => {
    fetchUsers();
  }, [page, pageSize, roleFilter, statusFilter]);

  const fetchUsers = async () => {
    setLoading(true);
    try {
      const params = {
        page: page + 1,
        limit: pageSize,
        ...(roleFilter !== 'all' && { role: roleFilter }),
        ...(statusFilter !== 'all' && { status: statusFilter }),
        ...(searchQuery && { search: searchQuery }),
      };
      
      const response = await userApi.getUsers(params);
      setUsers(response.data.users);
      setTotalRows(response.data.total);
    } catch (error) {
      console.error('Failed to fetch users:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleMenuOpen = (event: React.MouseEvent<HTMLElement>, user: User) => {
    setAnchorEl(event.currentTarget);
    setSelectedUser(user);
  };

  const handleMenuClose = () => {
    setAnchorEl(null);
  };

  const handleSuspendUser = () => {
    handleMenuClose();
    setSuspendDialog(true);
  };

  const confirmSuspend = async () => {
    if (!selectedUser || !suspendReason) return;
    
    try {
      await userApi.suspendUser(selectedUser.id, suspendReason);
      fetchUsers();
      setSuspendDialog(false);
      setSuspendReason('');
    } catch (error) {
      console.error('Failed to suspend user:', error);
    }
  };

  const handleActivateUser = async () => {
    if (!selectedUser) return;
    
    try {
      await userApi.activateUser(selectedUser.id);
      fetchUsers();
      handleMenuClose();
    } catch (error) {
      console.error('Failed to activate user:', error);
    }
  };

  const handleExport = () => {
    // Implement export functionality
    console.log('Exporting users...');
  };

  const columns: GridColDef[] = [
    {
      field: 'name',
      headerName: 'Name',
      width: 200,
      renderCell: (params: GridRenderCellParams) => (
        <Box sx={{ display: 'flex', alignItems: 'center' }}>
          <Avatar sx={{ width: 32, height: 32, mr: 1 }}>
            {params.row.name[0]}
          </Avatar>
          {params.value}
        </Box>
      ),
    },
    {
      field: 'email',
      headerName: 'Email',
      width: 250,
    },
    {
      field: 'phone',
      headerName: 'Phone',
      width: 150,
    },
    {
      field: 'role',
      headerName: 'Role',
      width: 120,
      renderCell: (params: GridRenderCellParams) => (
        <Chip
          label={params.value}
          color={
            params.value === 'customer' ? 'primary' :
            params.value === 'driver' ? 'secondary' : 'warning'
          }
          size="small"
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
          color={
            params.value === 'active' ? 'success' :
            params.value === 'suspended' ? 'error' : 'warning'
          }
          size="small"
          icon={params.value === 'active' ? <CheckCircle /> : <Block />}
        />
      ),
    },
    {
      field: 'totalOrders',
      headerName: 'Orders',
      width: 100,
      type: 'number',
    },
    {
      field: 'totalSpent',
      headerName: 'Total Spent',
      width: 120,
      type: 'number',
      renderCell: (params: GridRenderCellParams) => `$${params.value.toFixed(2)}`,
    },
    {
      field: 'createdAt',
      headerName: 'Joined',
      width: 150,
      renderCell: (params: GridRenderCellParams) => 
        format(new Date(params.value), 'MMM dd, yyyy'),
    },
    {
      field: 'lastLogin',
      headerName: 'Last Login',
      width: 150,
      renderCell: (params: GridRenderCellParams) => 
        params.value ? format(new Date(params.value), 'MMM dd, yyyy HH:mm') : 'Never',
    },
    {
      field: 'actions',
      headerName: 'Actions',
      width: 80,
      sortable: false,
      renderCell: (params: GridRenderCellParams) => (
        <IconButton
          size="small"
          onClick={(e) => handleMenuOpen(e, params.row as User)}
        >
          <MoreVert />
        </IconButton>
      ),
    },
  ];

  const getTabCount = (role: string) => {
    if (role === 'all') return totalRows;
    return users.filter(u => u.role === role).length;
  };

  return (
    <>
      <Head>
        <title>User Management - ReskFlow Admin</title>
      </Head>
      
      <AdminLayout>
        <Box sx={{ flexGrow: 1 }}>
          {/* Header */}
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
            <Typography variant="h4" fontWeight="bold">
              User Management
            </Typography>
            <Box sx={{ display: 'flex', gap: 2 }}>
              <Button
                variant="outlined"
                startIcon={<Download />}
                onClick={handleExport}
              >
                Export
              </Button>
              <Button
                variant="contained"
                startIcon={<PersonAdd />}
              >
                Add User
              </Button>
            </Box>
          </Box>

          {/* Filters */}
          <Paper sx={{ p: 2, mb: 3 }}>
            <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap' }}>
              <TextField
                placeholder="Search users..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && fetchUsers()}
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
                  <MenuItem value="suspended">Suspended</MenuItem>
                  <MenuItem value="pending">Pending</MenuItem>
                </Select>
              </FormControl>
              
              <IconButton onClick={fetchUsers}>
                <Refresh />
              </IconButton>
            </Box>
          </Paper>

          {/* Tabs */}
          <Paper sx={{ mb: 3 }}>
            <Tabs
              value={selectedTab}
              onChange={(e, value) => {
                setSelectedTab(value);
                setRoleFilter(value === 0 ? 'all' : value === 1 ? 'customer' : value === 2 ? 'driver' : 'merchant');
              }}
              variant="fullWidth"
            >
              <Tab label={`All Users (${getTabCount('all')})`} />
              <Tab label={`Customers (${getTabCount('customer')})`} />
              <Tab label={`Drivers (${getTabCount('driver')})`} />
              <Tab label={`Merchants (${getTabCount('merchant')})`} />
            </Tabs>
          </Paper>

          {/* Data Grid */}
          <Paper sx={{ height: 600 }}>
            <DataGrid
              rows={users}
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
              sx={{
                '& .MuiDataGrid-cell': {
                  borderBottom: '1px solid rgba(224, 224, 224, 0.5)',
                },
              }}
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
          {selectedUser?.status === 'active' ? (
            <MenuItem onClick={handleSuspendUser}>
              <Block fontSize="small" sx={{ mr: 1 }} />
              Suspend User
            </MenuItem>
          ) : (
            <MenuItem onClick={handleActivateUser}>
              <CheckCircle fontSize="small" sx={{ mr: 1 }} />
              Activate User
            </MenuItem>
          )}
          <MenuItem onClick={() => { handleMenuClose(); /* Delete */ }} sx={{ color: 'error.main' }}>
            <Delete fontSize="small" sx={{ mr: 1 }} />
            Delete User
          </MenuItem>
        </Menu>

        {/* Suspend Dialog */}
        <Dialog
          open={suspendDialog}
          onClose={() => setSuspendDialog(false)}
          maxWidth="sm"
          fullWidth
        >
          <DialogTitle>Suspend User</DialogTitle>
          <DialogContent>
            <Typography variant="body2" color="text.secondary" gutterBottom>
              Are you sure you want to suspend {selectedUser?.name}? Please provide a reason:
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
              onClick={confirmSuspend}
              variant="contained"
              color="error"
              disabled={!suspendReason}
            >
              Suspend User
            </Button>
          </DialogActions>
        </Dialog>
      </AdminLayout>
    </>
  );
}