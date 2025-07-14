import { Box, Typography, Container } from '@mui/material';

export default function HeroSection() {
  return (
    <Box
      sx={{
        background: 'linear-gradient(135deg, #007AFF 0%, #FF9500 100%)',
        color: 'white',
        py: 8,
        mb: 4,
      }}
    >
      <Container maxWidth="lg">
        <Typography variant="h2" gutterBottom>
          Your favorite food, delivered fast
        </Typography>
        <Typography variant="h6">
          Order from the best local restaurants with easy, on-demand reskflow
        </Typography>
      </Container>
    </Box>
  );
}