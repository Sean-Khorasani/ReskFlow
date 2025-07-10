import { useContext } from 'react';
import { SoundContext } from '@/providers/SoundProvider';

export function useSoundAlerts() {
  const context = useContext(SoundContext);
  
  if (!context) {
    throw new Error('useSoundAlerts must be used within a SoundProvider');
  }
  
  return context;
}