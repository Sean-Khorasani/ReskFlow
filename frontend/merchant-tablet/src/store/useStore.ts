import { create } from 'zustand';
import api from '@/services/api';

interface Merchant {
  id: string;
  name: string;
  isOpen: boolean;
  autoAcceptOrders: boolean;
  preparationTime: number;
  // Add other merchant properties as needed
}

interface Store {
  merchant: Merchant | null;
  setMerchant: (merchant: Merchant) => void;
  updateMerchantStatus: (status: Partial<Merchant>) => Promise<void>;
}

export const useStore = create<Store>((set, get) => ({
  merchant: null,
  
  setMerchant: (merchant) => set({ merchant }),
  
  updateMerchantStatus: async (status) => {
    const merchant = get().merchant;
    if (!merchant) return;

    try {
      const response = await api.put(`/merchants/${merchant.id}/status`, status);
      set({ merchant: { ...merchant, ...response.data } });
    } catch (error) {
      throw error;
    }
  },
}));