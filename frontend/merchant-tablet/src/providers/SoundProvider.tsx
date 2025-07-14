import React, { createContext, useCallback, useRef, ReactNode } from 'react';

interface SoundContextType {
  playNewOrderSound: () => void;
  playNotificationSound: () => void;
  playSuccessSound: () => void;
  playErrorSound: () => void;
  setVolume: (volume: number) => void;
  toggleMute: () => void;
  isMuted: boolean;
}

export const SoundContext = createContext<SoundContextType>({
  playNewOrderSound: () => {},
  playNotificationSound: () => {},
  playSuccessSound: () => {},
  playErrorSound: () => {},
  setVolume: () => {},
  toggleMute: () => {},
  isMuted: false,
});

export function SoundProvider({ children }: { children: ReactNode }) {
  const volumeRef = useRef(0.7);
  const isMutedRef = useRef(false);

  // Sound file URLs - in production, these would be actual audio files
  const sounds = {
    newOrder: '/sounds/new-order.mp3',
    notification: '/sounds/notification.mp3',
    success: '/sounds/success.mp3',
    error: '/sounds/error.mp3',
  };

  const playSound = useCallback((soundUrl: string) => {
    if (isMutedRef.current) return;

    try {
      const audio = new Audio(soundUrl);
      audio.volume = volumeRef.current;
      audio.play().catch((error) => {
        console.error('Failed to play sound:', error);
      });
    } catch (error) {
      console.error('Error creating audio:', error);
    }
  }, []);

  const playNewOrderSound = useCallback(() => {
    // For demo, using a data URL for a simple beep
    const beep = 'data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2/LDciUFLIHO8tiJNwgZaLvt559NEAxQp+PwtmMcBjiR1/LMeSwFJHfH8N2QQAoUXrTp66hVFApGn+DyvmwhBTGM0fPTgjMGHm7A7+OZURE';
    playSound(beep);
  }, [playSound]);

  const playNotificationSound = useCallback(() => {
    playSound(sounds.notification);
  }, [playSound]);

  const playSuccessSound = useCallback(() => {
    playSound(sounds.success);
  }, [playSound]);

  const playErrorSound = useCallback(() => {
    playSound(sounds.error);
  }, [playSound]);

  const setVolume = useCallback((volume: number) => {
    volumeRef.current = Math.max(0, Math.min(1, volume));
  }, []);

  const toggleMute = useCallback(() => {
    isMutedRef.current = !isMutedRef.current;
  }, []);

  return (
    <SoundContext.Provider
      value={{
        playNewOrderSound,
        playNotificationSound,
        playSuccessSound,
        playErrorSound,
        setVolume,
        toggleMute,
        isMuted: isMutedRef.current,
      }}
    >
      {children}
    </SoundContext.Provider>
  );
}