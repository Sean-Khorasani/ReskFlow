import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { useDispatch, useSelector } from 'react-redux';
import {
  Container,
  Grid,
  Typography,
  Card,
  CardContent,
  CardMedia,
  Box,
  Tabs,
  Tab,
  Button,
  IconButton,
  Chip,
  Rating,
  Skeleton,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Badge,
  Paper,
  List,
  ListItem,
  ListItemText,
  Divider,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import RemoveIcon from '@mui/icons-material/Remove';
import ShoppingCartIcon from '@mui/icons-material/ShoppingCart';
import AccessTimeIcon from '@mui/icons-material/AccessTime';
import LocationOnIcon from '@mui/icons-material/LocationOn';
import PhoneIcon from '@mui/icons-material/Phone';
import InfoIcon from '@mui/icons-material/Info';
import { AppDispatch, RootState } from '@/store';
import { fetchMerchantById } from '@/store/slices/merchantsSlice';
import { fetchProductsByMerchant, Product } from '@/store/slices/productsSlice';
import { addToCart } from '@/store/slices/cartSlice';

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
      id={`merchant-tabpanel-${index}`}
      aria-labelledby={`merchant-tab-${index}`}
      {...other}
    >
      {value === index && <Box sx={{ py: 3 }}>{children}</Box>}
    </div>
  );
}

export default function MerchantPage() {
  const router = useRouter();
  const { id } = router.query;
  const dispatch = useDispatch<AppDispatch>();
  
  const { currentMerchant, isLoading: merchantLoading } = useSelector((state: RootState) => state.merchants);
  const { items: products, categories, isLoading: productsLoading } = useSelector((state: RootState) => state.products);
  const { items: cartItems } = useSelector((state: RootState) => state.cart);
  
  const [tabValue, setTabValue] = useState(0);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [specialInstructions, setSpecialInstructions] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);

  useEffect(() => {
    if (id) {
      dispatch(fetchMerchantById(id as string));
      dispatch(fetchProductsByMerchant(id as string));
    }
  }, [dispatch, id]);

  const handleTabChange = (event: React.SyntheticEvent, newValue: number) => {
    setTabValue(newValue);
  };

  const handleAddToCart = (product: Product) => {
    setSelectedProduct(product);
    setQuantity(1);
    setSpecialInstructions('');
    setDialogOpen(true);
  };

  const confirmAddToCart = () => {
    if (selectedProduct && currentMerchant) {
      dispatch(addToCart({
        product: selectedProduct,
        quantity,
        merchantId: currentMerchant.id,
        merchantName: currentMerchant.name,
      }));
      setDialogOpen(false);
    }
  };

  const handleViewCart = () => {
    router.push('/cart');
  };

  const getProductsByCategory = (category: string) => {
    return products.filter(product => product.category === category);
  };

  const cartItemCount = cartItems.reduce((sum, item) => sum + item.quantity, 0);

  if (merchantLoading || !currentMerchant) {
    return (
      <Container maxWidth="lg" sx={{ py: 4 }}>
        <Skeleton variant="rectangular" height={300} sx={{ mb: 4 }} />
        <Skeleton variant="text" height={60} />
        <Skeleton variant="text" width="60%" />
      </Container>
    );
  }

  return (
    <>
      <Box
        sx={{
          backgroundImage: `url(${currentMerchant.image || '/placeholder-restaurant.jpg'})`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          height: 300,
          position: 'relative',
          '&::before': {
            content: '""',
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.4)',
          },
        }}
      >
        <Container maxWidth="lg" sx={{ position: 'relative', height: '100%' }}>
          <Box
            sx={{
              position: 'absolute',
              bottom: 32,
              left: 0,
              right: 0,
              color: 'white',
            }}
          >
            <Typography variant="h3" gutterBottom>
              {currentMerchant.name}
            </Typography>
            <Box display="flex" alignItems="center" gap={2}>
              <Rating value={currentMerchant.rating} precision={0.1} readOnly />
              <Typography>({currentMerchant.reviewCount} reviews)</Typography>
              <Chip
                label={currentMerchant.isOpen ? 'Open' : 'Closed'}
                color={currentMerchant.isOpen ? 'success' : 'error'}
                size="small"
              />
            </Box>
          </Box>
        </Container>
      </Box>

      <Container maxWidth="lg" sx={{ py: 4 }}>
        <Grid container spacing={4}>
          <Grid item xs={12} md={8}>
            <Paper sx={{ mb: 3, p: 2 }}>
              <Box display="flex" justifyContent="space-between" alignItems="center">
                <Box display="flex" gap={3}>
                  <Box display="flex" alignItems="center" gap={1}>
                    <AccessTimeIcon color="action" />
                    <Typography variant="body2">{currentMerchant.reskflowTime}</Typography>
                  </Box>
                  <Box display="flex" alignItems="center" gap={1}>
                    <LocationOnIcon color="action" />
                    <Typography variant="body2">${currentMerchant.reskflowFee} reskflow</Typography>
                  </Box>
                  <Box display="flex" alignItems="center" gap={1}>
                    <InfoIcon color="action" />
                    <Typography variant="body2">${currentMerchant.minimumOrder} minimum</Typography>
                  </Box>
                </Box>
              </Box>
            </Paper>

            <Tabs value={tabValue} onChange={handleTabChange} aria-label="merchant tabs">
              <Tab label="Menu" />
              <Tab label="Info" />
              <Tab label="Reviews" />
            </Tabs>

            <TabPanel value={tabValue} index={0}>
              {productsLoading ? (
                <Box>
                  {[1, 2, 3].map((i) => (
                    <Skeleton key={i} variant="rectangular" height={120} sx={{ mb: 2 }} />
                  ))}
                </Box>
              ) : (
                categories.map((category) => (
                  <Box key={category} mb={4}>
                    <Typography variant="h5" gutterBottom>
                      {category}
                    </Typography>
                    <Grid container spacing={2}>
                      {getProductsByCategory(category).map((product) => (
                        <Grid item xs={12} key={product.id}>
                          <Card sx={{ display: 'flex' }}>
                            <Box sx={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
                              <CardContent>
                                <Typography variant="h6">{product.name}</Typography>
                                <Typography variant="body2" color="text.secondary" paragraph>
                                  {product.description}
                                </Typography>
                                <Box display="flex" justifyContent="space-between" alignItems="center">
                                  <Typography variant="h6" color="primary">
                                    ${product.price.toFixed(2)}
                                  </Typography>
                                  <Button
                                    variant="contained"
                                    startIcon={<AddIcon />}
                                    onClick={() => handleAddToCart(product)}
                                    disabled={!product.available || !currentMerchant.isOpen}
                                  >
                                    Add
                                  </Button>
                                </Box>
                              </CardContent>
                            </Box>
                            {product.image && (
                              <CardMedia
                                component="img"
                                sx={{ width: 151 }}
                                image={product.image}
                                alt={product.name}
                              />
                            )}
                          </Card>
                        </Grid>
                      ))}
                    </Grid>
                  </Box>
                ))
              )}
            </TabPanel>

            <TabPanel value={tabValue} index={1}>
              <List>
                <ListItem>
                  <ListItemText
                    primary="Address"
                    secondary={currentMerchant.address}
                  />
                </ListItem>
                <Divider />
                <ListItem>
                  <ListItemText
                    primary="Phone"
                    secondary={currentMerchant.phone}
                  />
                </ListItem>
                <Divider />
                <ListItem>
                  <ListItemText
                    primary="Hours"
                    secondary={
                      <Box>
                        {Object.entries(currentMerchant.hours).map(([day, hours]) => (
                          <Typography key={day} variant="body2">
                            {day}: {hours.open} - {hours.close}
                          </Typography>
                        ))}
                      </Box>
                    }
                  />
                </ListItem>
              </List>
            </TabPanel>

            <TabPanel value={tabValue} index={2}>
              <Typography color="text.secondary">
                Reviews coming soon...
              </Typography>
            </TabPanel>
          </Grid>

          <Grid item xs={12} md={4}>
            {/* Sticky cart summary */}
            <Box sx={{ position: 'sticky', top: 80 }}>
              <Button
                variant="contained"
                fullWidth
                size="large"
                startIcon={
                  <Badge badgeContent={cartItemCount} color="error">
                    <ShoppingCartIcon />
                  </Badge>
                }
                onClick={handleViewCart}
                disabled={cartItemCount === 0}
              >
                View Cart
              </Button>
            </Box>
          </Grid>
        </Grid>
      </Container>

      {/* Add to Cart Dialog */}
      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{selectedProduct?.name}</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" paragraph>
            {selectedProduct?.description}
          </Typography>
          
          <Box display="flex" alignItems="center" justifyContent="center" my={3}>
            <IconButton onClick={() => setQuantity(Math.max(1, quantity - 1))}>
              <RemoveIcon />
            </IconButton>
            <Typography variant="h5" mx={3}>
              {quantity}
            </Typography>
            <IconButton onClick={() => setQuantity(quantity + 1)}>
              <AddIcon />
            </IconButton>
          </Box>

          <TextField
            fullWidth
            multiline
            rows={3}
            label="Special Instructions (Optional)"
            value={specialInstructions}
            onChange={(e) => setSpecialInstructions(e.target.value)}
            placeholder="E.g., no onions, extra sauce..."
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            onClick={confirmAddToCart}
            startIcon={<AddIcon />}
          >
            Add {quantity} to Cart - ${(selectedProduct ? selectedProduct.price * quantity : 0).toFixed(2)}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}