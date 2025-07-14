import { createSlice, PayloadAction } from '@reduxjs/toolkit';

export interface CartItem {
  id: string;
  productId: string;
  merchantId: string;
  name: string;
  price: number;
  quantity: number;
  image?: string;
  specialInstructions?: string;
}

interface CartState {
  items: CartItem[];
  merchantId: string | null;
  merchantName: string | null;
  subtotal: number;
  tax: number;
  reskflowFee: number;
  total: number;
}

const initialState: CartState = {
  items: [],
  merchantId: null,
  merchantName: null,
  subtotal: 0,
  tax: 0,
  reskflowFee: 5.99,
  total: 0,
};

const calculateTotals = (state: CartState) => {
  state.subtotal = state.items.reduce((sum, item) => sum + item.price * item.quantity, 0);
  state.tax = state.subtotal * 0.08; // 8% tax
  state.total = state.subtotal + state.tax + state.reskflowFee;
};

const cartSlice = createSlice({
  name: 'cart',
  initialState,
  reducers: {
    addToCart: (state, action: PayloadAction<{
      product: any;
      quantity: number;
      merchantId: string;
      merchantName: string;
    }>) => {
      const { product, quantity, merchantId, merchantName } = action.payload;
      
      // Clear cart if adding from different merchant
      if (state.merchantId && state.merchantId !== merchantId) {
        state.items = [];
      }
      
      state.merchantId = merchantId;
      state.merchantName = merchantName;
      
      const existingItem = state.items.find(item => item.productId === product.id);
      
      if (existingItem) {
        existingItem.quantity += quantity;
      } else {
        state.items.push({
          id: `${product.id}-${Date.now()}`,
          productId: product.id,
          merchantId,
          name: product.name,
          price: product.price,
          quantity,
          image: product.image,
        });
      }
      
      calculateTotals(state);
    },
    updateQuantity: (state, action: PayloadAction<{ itemId: string; quantity: number }>) => {
      const item = state.items.find(item => item.id === action.payload.itemId);
      if (item) {
        if (action.payload.quantity === 0) {
          state.items = state.items.filter(item => item.id !== action.payload.itemId);
        } else {
          item.quantity = action.payload.quantity;
        }
        calculateTotals(state);
      }
    },
    removeFromCart: (state, action: PayloadAction<string>) => {
      state.items = state.items.filter(item => item.id !== action.payload);
      if (state.items.length === 0) {
        state.merchantId = null;
        state.merchantName = null;
      }
      calculateTotals(state);
    },
    updateSpecialInstructions: (state, action: PayloadAction<{ itemId: string; instructions: string }>) => {
      const item = state.items.find(item => item.id === action.payload.itemId);
      if (item) {
        item.specialInstructions = action.payload.instructions;
      }
    },
    clearCart: (state) => {
      state.items = [];
      state.merchantId = null;
      state.merchantName = null;
      state.subtotal = 0;
      state.tax = 0;
      state.total = 0;
    },
  },
});

export const { 
  addToCart, 
  updateQuantity, 
  removeFromCart, 
  updateSpecialInstructions,
  clearCart 
} = cartSlice.actions;

export default cartSlice.reducer;