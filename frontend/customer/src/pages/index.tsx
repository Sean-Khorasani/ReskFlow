import { useEffect } from 'react';
import { useRouter } from 'next/router';
import { useDispatch, useSelector } from 'react-redux';
import {
  Container,
  Grid,
  Typography,
  Card,
  CardContent,
  CardMedia,
  CardActionArea,
  Box,
  Chip,
  Rating,
  Skeleton,
  TextField,
  InputAdornment,
  IconButton,
  Paper,
} from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import LocationOnIcon from '@mui/icons-material/LocationOn';
import AccessTimeIcon from '@mui/icons-material/AccessTime';
import DeliveryDiningIcon from '@mui/icons-material/DeliveryDining';
import { AppDispatch, RootState } from '@/store';
import { fetchMerchants } from '@/store/slices/merchantsSlice';
import HeroSection from '@/components/HeroSection';
import CategoryFilter from '@/components/CategoryFilter';

export default function Home() {
  const router = useRouter();
  const dispatch = useDispatch<AppDispatch>();
  const { merchants, isLoading } = useSelector((state: RootState) => state.merchants);
  const { user } = useSelector((state: RootState) => state.auth);

  useEffect(() => {
    // Fetch merchants near user location
    if (navigator.geolocation && user?.address) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          dispatch(fetchMerchants({
            lat: position.coords.latitude,
            lng: position.coords.longitude,
            radius: 10, // 10 km radius
          }));
        },
        () => {
          // Fallback to fetch all merchants
          dispatch(fetchMerchants());
        }
      );
    } else {
      dispatch(fetchMerchants());
    }
  }, [dispatch, user]);

  const handleMerchantClick = (merchantId: string) => {
    router.push(`/merchant/${merchantId}`);
  };

  const handleSearch = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const query = formData.get('search') as string;
    if (query) {
      router.push(`/search?q=${encodeURIComponent(query)}`);
    }
  };

  return (
    <>
      <HeroSection />
      
      <Container maxWidth="lg" sx={{ py: 4 }}>
        {/* Search Bar */}
        <Paper
          component="form"
          onSubmit={handleSearch}
          sx={{ p: 2, mb: 4, display: 'flex', alignItems: 'center' }}
          elevation={3}
        >
          <IconButton sx={{ p: '10px' }} aria-label="location">
            <LocationOnIcon />
          </IconButton>
          <TextField
            fullWidth
            name="search"
            placeholder="Search for restaurants, cuisines, or dishes..."
            variant="standard"
            InputProps={{
              disableUnderline: true,
              endAdornment: (
                <InputAdornment position="end">
                  <IconButton type="submit" sx={{ p: '10px' }} aria-label="search">
                    <SearchIcon />
                  </IconButton>
                </InputAdornment>
              ),
            }}
          />
        </Paper>

        {/* Category Filter */}
        <CategoryFilter />

        {/* Merchants Grid */}
        <Typography variant="h4" gutterBottom sx={{ mt: 4, mb: 3 }}>
          Popular Near You
        </Typography>

        <Grid container spacing={3}>
          {isLoading
            ? Array.from(new Array(6)).map((_, index) => (
                <Grid item xs={12} sm={6} md={4} key={index}>
                  <Card>
                    <Skeleton variant="rectangular" height={200} />
                    <CardContent>
                      <Skeleton variant="text" />
                      <Skeleton variant="text" width="60%" />
                    </CardContent>
                  </Card>
                </Grid>
              ))
            : merchants.map((merchant) => (
                <Grid item xs={12} sm={6} md={4} key={merchant.id}>
                  <Card 
                    sx={{ 
                      height: '100%',
                      '&:hover': { 
                        transform: 'translateY(-4px)',
                        transition: 'transform 0.2s ease-in-out',
                        boxShadow: 3,
                      },
                    }}
                  >
                    <CardActionArea onClick={() => handleMerchantClick(merchant.id)}>
                      <CardMedia
                        component="img"
                        height="200"
                        image={merchant.image || '/placeholder-restaurant.jpg'}
                        alt={merchant.name}
                      />
                      <CardContent>
                        <Typography gutterBottom variant="h6" component="div">
                          {merchant.name}
                        </Typography>
                        
                        <Box display="flex" alignItems="center" mb={1}>
                          <Rating value={merchant.rating} precision={0.1} size="small" readOnly />
                          <Typography variant="body2" color="text.secondary" ml={1}>
                            ({merchant.reviewCount})
                          </Typography>
                        </Box>

                        <Typography variant="body2" color="text.secondary" gutterBottom>
                          {merchant.cuisine} • ${merchant.minimumOrder} min
                        </Typography>

                        <Box display="flex" gap={1} mt={2}>
                          <Chip
                            icon={<AccessTimeIcon />}
                            label={merchant.reskflowTime}
                            size="small"
                            variant="outlined"
                          />
                          <Chip
                            icon={<DeliveryDiningIcon />}
                            label={`$${merchant.reskflowFee}`}
                            size="small"
                            variant="outlined"
                          />
                        </Box>

                        {!merchant.isOpen && (
                          <Chip
                            label="Closed"
                            color="error"
                            size="small"
                            sx={{ mt: 1 }}
                          />
                        )}
                      </CardContent>
                    </CardActionArea>
                  </Card>
                </Grid>
              ))}
        </Grid>

        {merchants.length === 0 && !isLoading && (
          <Box textAlign="center" py={8}>
            <Typography variant="h6" color="text.secondary">
              No restaurants found in your area
            </Typography>
            <Typography variant="body2" color="text.secondary" mt={1}>
              Try expanding your search radius or check back later
            </Typography>
          </Box>
        )}
      </Container>
    </>
  );
}