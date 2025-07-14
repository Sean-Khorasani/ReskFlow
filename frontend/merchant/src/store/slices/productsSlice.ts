import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import { productApi, categoryApi } from '../../services/api';

interface Product {
  id: string;
  name: string;
  description: string;
  price: number;
  categoryId: string;
  categoryName?: string;
  images: string[];
  available: boolean;
  stock?: number;
  preparationTime: number;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

interface Category {
  id: string;
  name: string;
  description?: string;
  productCount?: number;
}

interface ProductsState {
  products: Product[];
  categories: Category[];
  selectedProduct: Product | null;
  loading: boolean;
  error: string | null;
  filters: {
    categoryId?: string;
    available?: boolean;
    search?: string;
  };
}

const initialState: ProductsState = {
  products: [],
  categories: [],
  selectedProduct: null,
  loading: false,
  error: null,
  filters: {},
};

// Product Thunks
export const fetchProducts = createAsyncThunk(
  'products/fetchProducts',
  async () => {
    const response = await productApi.getProducts();
    return response.data;
  }
);

export const fetchProduct = createAsyncThunk(
  'products/fetchProduct',
  async (id: string) => {
    const response = await productApi.getProduct(id);
    return response.data;
  }
);

export const createProduct = createAsyncThunk(
  'products/createProduct',
  async (formData: FormData) => {
    const response = await productApi.createProduct(formData);
    return response.data;
  }
);

export const updateProduct = createAsyncThunk(
  'products/updateProduct',
  async ({ id, formData }: { id: string; formData: FormData }) => {
    const response = await productApi.updateProduct(id, formData);
    return response.data;
  }
);

export const deleteProduct = createAsyncThunk(
  'products/deleteProduct',
  async (id: string) => {
    await productApi.deleteProduct(id);
    return id;
  }
);

export const toggleProductAvailability = createAsyncThunk(
  'products/toggleAvailability',
  async ({ id, available }: { id: string; available: boolean }) => {
    const response = await productApi.toggleAvailability(id, available);
    return response.data;
  }
);

export const updateProductStock = createAsyncThunk(
  'products/updateStock',
  async ({ id, stock }: { id: string; stock: number }) => {
    const response = await productApi.updateStock(id, stock);
    return response.data;
  }
);

// Category Thunks
export const fetchCategories = createAsyncThunk(
  'products/fetchCategories',
  async () => {
    const response = await categoryApi.getCategories();
    return response.data;
  }
);

export const createCategory = createAsyncThunk(
  'products/createCategory',
  async (data: { name: string; description?: string }) => {
    const response = await categoryApi.createCategory(data);
    return response.data;
  }
);

export const updateCategory = createAsyncThunk(
  'products/updateCategory',
  async ({ id, data }: { id: string; data: { name: string; description?: string } }) => {
    const response = await categoryApi.updateCategory(id, data);
    return response.data;
  }
);

export const deleteCategory = createAsyncThunk(
  'products/deleteCategory',
  async (id: string) => {
    await categoryApi.deleteCategory(id);
    return id;
  }
);

const productsSlice = createSlice({
  name: 'products',
  initialState,
  reducers: {
    setFilters: (state, action) => {
      state.filters = action.payload;
    },
    clearFilters: (state) => {
      state.filters = {};
    },
    setSelectedProduct: (state, action) => {
      state.selectedProduct = action.payload;
    },
    clearError: (state) => {
      state.error = null;
    },
  },
  extraReducers: (builder) => {
    // Fetch Products
    builder
      .addCase(fetchProducts.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchProducts.fulfilled, (state, action) => {
        state.loading = false;
        state.products = action.payload;
      })
      .addCase(fetchProducts.rejected, (state, action) => {
        state.loading = false;
        state.error = action.error.message || 'Failed to fetch products';
      });
    
    // Create Product
    builder
      .addCase(createProduct.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(createProduct.fulfilled, (state, action) => {
        state.loading = false;
        state.products.push(action.payload);
      })
      .addCase(createProduct.rejected, (state, action) => {
        state.loading = false;
        state.error = action.error.message || 'Failed to create product';
      });
    
    // Update Product
    builder
      .addCase(updateProduct.fulfilled, (state, action) => {
        const index = state.products.findIndex(p => p.id === action.payload.id);
        if (index !== -1) {
          state.products[index] = action.payload;
        }
        if (state.selectedProduct?.id === action.payload.id) {
          state.selectedProduct = action.payload;
        }
      });
    
    // Delete Product
    builder
      .addCase(deleteProduct.fulfilled, (state, action) => {
        state.products = state.products.filter(p => p.id !== action.payload);
        if (state.selectedProduct?.id === action.payload) {
          state.selectedProduct = null;
        }
      });
    
    // Toggle Availability
    builder
      .addCase(toggleProductAvailability.fulfilled, (state, action) => {
        const index = state.products.findIndex(p => p.id === action.payload.id);
        if (index !== -1) {
          state.products[index] = action.payload;
        }
      });
    
    // Update Stock
    builder
      .addCase(updateProductStock.fulfilled, (state, action) => {
        const index = state.products.findIndex(p => p.id === action.payload.id);
        if (index !== -1) {
          state.products[index] = action.payload;
        }
      });
    
    // Fetch Categories
    builder
      .addCase(fetchCategories.fulfilled, (state, action) => {
        state.categories = action.payload;
      });
    
    // Create Category
    builder
      .addCase(createCategory.fulfilled, (state, action) => {
        state.categories.push(action.payload);
      });
    
    // Update Category
    builder
      .addCase(updateCategory.fulfilled, (state, action) => {
        const index = state.categories.findIndex(c => c.id === action.payload.id);
        if (index !== -1) {
          state.categories[index] = action.payload;
        }
      });
    
    // Delete Category
    builder
      .addCase(deleteCategory.fulfilled, (state, action) => {
        state.categories = state.categories.filter(c => c.id !== action.payload);
      });
  },
});

export const { setFilters, clearFilters, setSelectedProduct, clearError } = productsSlice.actions;
export default productsSlice.reducer;