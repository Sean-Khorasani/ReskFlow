import React, { useEffect, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import {
  Box,
  Button,
  Card,
  CardMedia,
  CardContent,
  CardActions,
  Grid,
  Typography,
  IconButton,
  Chip,
  TextField,
  InputAdornment,
  Menu,
  MenuItem,
  Dialog,
  Switch,
  FormControlLabel,
  Skeleton,
  Fab,
  Select,
  FormControl,
  InputLabel,
} from '@mui/material';
import {
  Add,
  Search,
  Edit,
  Delete,
  MoreVert,
  FilterList,
  Image as ImageIcon,
} from '@mui/icons-material';
import { AppDispatch, RootState } from '@/store';
import {
  fetchProducts,
  deleteProduct,
  toggleProductAvailability,
  setFilters,
} from '@/store/slices/productsSlice';
import MainLayout from '@/components/layouts/MainLayout';
import ProductForm from '@/components/products/ProductForm';
import Head from 'next/head';
import { useSnackbar } from 'notistack';

export default function ProductsPage() {
  const dispatch = useDispatch<AppDispatch>();
  const { enqueueSnackbar } = useSnackbar();
  const { products, categories, loading, filters } = useSelector(
    (state: RootState) => state.products
  );
  
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [availabilityFilter, setAvailabilityFilter] = useState('all');
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const [selectedProduct, setSelectedProduct] = useState<any>(null);
  const [openForm, setOpenForm] = useState(false);
  const [editingProduct, setEditingProduct] = useState<any>(null);
  const [deleteDialog, setDeleteDialog] = useState(false);

  useEffect(() => {
    dispatch(fetchProducts());
  }, [dispatch]);

  const handleMenuOpen = (event: React.MouseEvent<HTMLElement>, product: any) => {
    setAnchorEl(event.currentTarget);
    setSelectedProduct(product);
  };

  const handleMenuClose = () => {
    setAnchorEl(null);
    setSelectedProduct(null);
  };

  const handleEdit = () => {
    setEditingProduct(selectedProduct);
    setOpenForm(true);
    handleMenuClose();
  };

  const handleDelete = async () => {
    handleMenuClose();
    setDeleteDialog(true);
  };

  const confirmDelete = async () => {
    try {
      await dispatch(deleteProduct(selectedProduct.id)).unwrap();
      enqueueSnackbar('Product deleted successfully', { variant: 'success' });
    } catch (error) {
      enqueueSnackbar('Failed to delete product', { variant: 'error' });
    }
    setDeleteDialog(false);
    setSelectedProduct(null);
  };

  const handleToggleAvailability = async (product: any) => {
    try {
      await dispatch(
        toggleProductAvailability({
          id: product.id,
          available: !product.available,
        })
      ).unwrap();
      enqueueSnackbar(
        `Product ${!product.available ? 'enabled' : 'disabled'} successfully`,
        { variant: 'success' }
      );
    } catch (error) {
      enqueueSnackbar('Failed to update product availability', { variant: 'error' });
    }
  };

  const handleAddProduct = () => {
    setEditingProduct(null);
    setOpenForm(true);
  };

  const filteredProducts = products.filter((product) => {
    const matchesSearch = product.name
      .toLowerCase()
      .includes(searchQuery.toLowerCase());
    const matchesCategory =
      selectedCategory === 'all' || product.categoryId === selectedCategory;
    const matchesAvailability =
      availabilityFilter === 'all' ||
      (availabilityFilter === 'available' && product.available) ||
      (availabilityFilter === 'unavailable' && !product.available);
    
    return matchesSearch && matchesCategory && matchesAvailability;
  });

  return (
    <>
      <Head>
        <title>Products - ReskFlow Merchant</title>
      </Head>
      
      <MainLayout>
        <Box sx={{ flexGrow: 1 }}>
          {/* Header */}
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
            <Typography variant="h4" fontWeight="bold">
              Products
            </Typography>
            <Button
              variant="contained"
              startIcon={<Add />}
              onClick={handleAddProduct}
            >
              Add Product
            </Button>
          </Box>

          {/* Filters */}
          <Box sx={{ display: 'flex', gap: 2, mb: 3, flexWrap: 'wrap' }}>
            <TextField
              placeholder="Search products..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              sx={{ flex: 1, minWidth: 250 }}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <Search />
                  </InputAdornment>
                ),
              }}
            />
            
            <FormControl sx={{ minWidth: 150 }}>
              <InputLabel>Category</InputLabel>
              <Select
                value={selectedCategory}
                onChange={(e) => setSelectedCategory(e.target.value)}
                label="Category"
              >
                <MenuItem value="all">All Categories</MenuItem>
                {categories.map((category) => (
                  <MenuItem key={category.id} value={category.id}>
                    {category.name}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            
            <FormControl sx={{ minWidth: 150 }}>
              <InputLabel>Availability</InputLabel>
              <Select
                value={availabilityFilter}
                onChange={(e) => setAvailabilityFilter(e.target.value)}
                label="Availability"
              >
                <MenuItem value="all">All</MenuItem>
                <MenuItem value="available">Available</MenuItem>
                <MenuItem value="unavailable">Unavailable</MenuItem>
              </Select>
            </FormControl>
          </Box>

          {/* Product Stats */}
          <Box sx={{ display: 'flex', gap: 2, mb: 3 }}>
            <Chip
              label={`Total: ${products.length}`}
              color="primary"
              variant="outlined"
            />
            <Chip
              label={`Available: ${products.filter(p => p.available).length}`}
              color="success"
              variant="outlined"
            />
            <Chip
              label={`Unavailable: ${products.filter(p => !p.available).length}`}
              color="default"
              variant="outlined"
            />
          </Box>

          {/* Products Grid */}
          {loading ? (
            <Grid container spacing={3}>
              {[1, 2, 3, 4, 5, 6].map((i) => (
                <Grid item xs={12} sm={6} md={4} key={i}>
                  <Skeleton variant="rectangular" height={300} />
                </Grid>
              ))}
            </Grid>
          ) : (
            <Grid container spacing={3}>
              {filteredProducts.map((product) => (
                <Grid item xs={12} sm={6} md={4} key={product.id}>
                  <Card sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
                    <CardMedia
                      component="div"
                      sx={{
                        height: 200,
                        bgcolor: 'grey.200',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      {product.images && product.images[0] ? (
                        <img
                          src={product.images[0]}
                          alt={product.name}
                          style={{
                            width: '100%',
                            height: '100%',
                            objectFit: 'cover',
                          }}
                        />
                      ) : (
                        <ImageIcon sx={{ fontSize: 60, color: 'grey.400' }} />
                      )}
                    </CardMedia>
                    
                    <CardContent sx={{ flexGrow: 1 }}>
                      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <Box sx={{ flexGrow: 1 }}>
                          <Typography gutterBottom variant="h6" component="div">
                            {product.name}
                          </Typography>
                          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                            {product.description}
                          </Typography>
                        </Box>
                        <IconButton
                          size="small"
                          onClick={(e) => handleMenuOpen(e, product)}
                        >
                          <MoreVert />
                        </IconButton>
                      </Box>
                      
                      <Box sx={{ display: 'flex', gap: 1, mb: 2 }}>
                        <Chip
                          label={product.categoryName || 'Uncategorized'}
                          size="small"
                          color="primary"
                          variant="outlined"
                        />
                        {product.tags?.map((tag: string) => (
                          <Chip key={tag} label={tag} size="small" />
                        ))}
                      </Box>
                      
                      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <Typography variant="h6" color="primary">
                          ${product.price.toFixed(2)}
                        </Typography>
                        {product.stock !== undefined && (
                          <Typography variant="body2" color="text.secondary">
                            Stock: {product.stock}
                          </Typography>
                        )}
                      </Box>
                    </CardContent>
                    
                    <CardActions sx={{ px: 2, pb: 2 }}>
                      <FormControlLabel
                        control={
                          <Switch
                            checked={product.available}
                            onChange={() => handleToggleAvailability(product)}
                            color="primary"
                          />
                        }
                        label={product.available ? 'Available' : 'Unavailable'}
                      />
                    </CardActions>
                  </Card>
                </Grid>
              ))}
            </Grid>
          )}

          {/* Empty State */}
          {!loading && filteredProducts.length === 0 && (
            <Box sx={{ textAlign: 'center', py: 8 }}>
              <Typography variant="h6" color="text.secondary" gutterBottom>
                No products found
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
                {searchQuery || selectedCategory !== 'all' || availabilityFilter !== 'all'
                  ? 'Try adjusting your filters'
                  : 'Add your first product to get started'}
              </Typography>
              {!searchQuery && selectedCategory === 'all' && availabilityFilter === 'all' && (
                <Button variant="contained" startIcon={<Add />} onClick={handleAddProduct}>
                  Add Product
                </Button>
              )}
            </Box>
          )}
        </Box>

        {/* Product Menu */}
        <Menu
          anchorEl={anchorEl}
          open={Boolean(anchorEl)}
          onClose={handleMenuClose}
        >
          <MenuItem onClick={handleEdit}>
            <Edit fontSize="small" sx={{ mr: 1 }} />
            Edit
          </MenuItem>
          <MenuItem onClick={handleDelete}>
            <Delete fontSize="small" sx={{ mr: 1 }} />
            Delete
          </MenuItem>
        </Menu>

        {/* Product Form Dialog */}
        <Dialog
          open={openForm}
          onClose={() => setOpenForm(false)}
          maxWidth="md"
          fullWidth
        >
          <ProductForm
            product={editingProduct}
            onClose={() => {
              setOpenForm(false);
              setEditingProduct(null);
            }}
          />
        </Dialog>

        {/* Delete Confirmation Dialog */}
        <Dialog
          open={deleteDialog}
          onClose={() => setDeleteDialog(false)}
        >
          <Box sx={{ p: 3 }}>
            <Typography variant="h6" gutterBottom>
              Delete Product
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
              Are you sure you want to delete "{selectedProduct?.name}"? This action cannot be undone.
            </Typography>
            <Box sx={{ display: 'flex', gap: 1, justifyContent: 'flex-end' }}>
              <Button onClick={() => setDeleteDialog(false)}>
                Cancel
              </Button>
              <Button
                variant="contained"
                color="error"
                onClick={confirmDelete}
              >
                Delete
              </Button>
            </Box>
          </Box>
        </Dialog>
      </MainLayout>
    </>
  );
}