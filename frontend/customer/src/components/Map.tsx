import { Box, Typography } from '@mui/material';

interface MapProps {
  center: { lat: number; lng: number };
  markers?: Array<{
    position: { lat: number; lng: number };
    type: 'restaurant' | 'destination' | 'driver';
  }>;
}

export default function Map({ center, markers }: MapProps) {
  // This is a placeholder for the map component
  // In a real implementation, you would use Google Maps, Mapbox, or another mapping service
  return (
    <Box
      sx={{
        width: '100%',
        height: '100%',
        bgcolor: 'grey.100',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 1,
      }}
    >
      <Typography color="text.secondary">
        Map View (Google Maps integration required)
      </Typography>
    </Box>
  );
}