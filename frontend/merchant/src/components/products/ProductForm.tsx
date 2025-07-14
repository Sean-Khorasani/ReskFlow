import React, { useState, useEffect } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useForm, Controller } from 'react-hook-form';
import {
  Box,
  Button,
  TextField,
  Typography,
  IconButton,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  InputAdornment,
  Chip,
  Switch,
  FormControlLabel,
  Grid,
  DialogTitle,
  DialogContent,
  DialogActions,
  CircularProgress,
  Paper,
} from '@mui/material';
import {
  Close,
  CloudUpload,
  Delete as DeleteIcon,
  Add,
} from '@mui/icons-material';
import { useDropzone } from 'react-dropzone';
import { AppDispatch, RootState } from '@/store';
import {
  createProduct,
  updateProduct,
  fetchCategories,
} from '@/store/slices/productsSlice';
import { useSnackbar } from 'notistack';

interface ProductFormProps {
  product?: any;
  onClose: () => void;
}

interface ProductFormData {
  name: string;
  description: string;
  price: number;
  categoryId: string;
  available: boolean;
  stock?: number;
  preparationTime: number;
  tags: string[];
}

export default function ProductForm({ product, onClose }: ProductFormProps) {
  const dispatch = useDispatch<AppDispatch>();
  const { enqueueSnackbar } = useSnackbar();
  const { categories } = useSelector((state: RootState) => state.products);
  
  const [loading, setLoading] = useState(false);
  const [images, setImages] = useState<File[]>([]);
  const [existingImages, setExistingImages] = useState<string[]>(product?.images || []);
  const [tagInput, setTagInput] = useState('');

  const {
    control,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm<ProductFormData>({
    defaultValues: {
      name: product?.name || '',
      description: product?.description || '',
      price: product?.price || 0,
      categoryId: product?.categoryId || '',
      available: product?.available ?? true,
      stock: product?.stock,
      preparationTime: product?.preparationTime || 15,
      tags: product?.tags || [],
    },
  });

  const tags = watch('tags');

  useEffect(() => {
    dispatch(fetchCategories());
  }, [dispatch]);

  const onDrop = (acceptedFiles: File[]) => {
    setImages((prev) => [...prev, ...acceptedFiles]);
  };

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'image/*': ['.jpeg', '.jpg', '.png', '.webp'],
    },
    maxFiles: 5,
  });

  const removeImage = (index: number) => {
    setImages((prev) => prev.filter((_, i) => i !== index));
  };

  const removeExistingImage = (index: number) => {
    setExistingImages((prev) => prev.filter((_, i) => i !== index));
  };

  const handleAddTag = () => {
    if (tagInput.trim() && !tags.includes(tagInput.trim())) {
      setValue('tags', [...tags, tagInput.trim()]);
      setTagInput('');
    }
  };

  const handleRemoveTag = (tagToRemove: string) => {
    setValue('tags', tags.filter((tag) => tag !== tagToRemove));
  };

  const onSubmit = async (data: ProductFormData) => {
    setLoading(true);
    
    try {
      const formData = new FormData();
      
      // Add text fields
      formData.append('name', data.name);
      formData.append('description', data.description);
      formData.append('price', data.price.toString());
      formData.append('categoryId', data.categoryId);
      formData.append('available', data.available.toString());
      formData.append('preparationTime', data.preparationTime.toString());
      
      if (data.stock !== undefined) {
        formData.append('stock', data.stock.toString());
      }
      
      // Add tags as JSON
      formData.append('tags', JSON.stringify(data.tags));
      
      // Add existing images
      if (existingImages.length > 0) {
        formData.append('existingImages', JSON.stringify(existingImages));
      }
      
      // Add new images
      images.forEach((image) => {
        formData.append('images', image);
      });
      
      if (product) {
        await dispatch(updateProduct({ id: product.id, formData })).unwrap();
        enqueueSnackbar('Product updated successfully', { variant: 'success' });
      } else {
        await dispatch(createProduct(formData)).unwrap();
        enqueueSnackbar('Product created successfully', { variant: 'success' });
      }
      
      onClose();
    } catch (error) {
      enqueueSnackbar('Failed to save product', { variant: 'error' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <DialogTitle>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Typography variant="h6">{product ? 'Edit Product' : 'Add Product'}</Typography>
          <IconButton onClick={onClose} size="small">
            <Close />
          </IconButton>
        </Box>
      </DialogTitle>
      
      <form onSubmit={handleSubmit(onSubmit)}>
        <DialogContent dividers>
          <Grid container spacing={3}>
            {/* Basic Information */}
            <Grid item xs={12}>
              <Typography variant="subtitle1" fontWeight="medium" gutterBottom>
                Basic Information
              </Typography>
            </Grid>
            
            <Grid item xs={12}>
              <Controller
                name="name"
                control={control}
                rules={{ required: 'Product name is required' }}
                render={({ field }) => (
                  <TextField
                    {...field}
                    fullWidth
                    label="Product Name"
                    error={!!errors.name}
                    helperText={errors.name?.message}
                  />
                )}
              />
            </Grid>
            
            <Grid item xs={12}>
              <Controller
                name="description"
                control={control}
                rules={{ required: 'Description is required' }}
                render={({ field }) => (
                  <TextField
                    {...field}
                    fullWidth
                    multiline
                    rows={3}
                    label="Description"
                    error={!!errors.description}
                    helperText={errors.description?.message}
                  />
                )}
              />
            </Grid>
            
            <Grid item xs={12} sm={6}>
              <Controller
                name="price"
                control={control}
                rules={{
                  required: 'Price is required',
                  min: { value: 0, message: 'Price must be positive' },
                }}
                render={({ field }) => (
                  <TextField
                    {...field}
                    fullWidth
                    type="number"
                    label="Price"
                    InputProps={{
                      startAdornment: <InputAdornment position="start">$</InputAdornment>,
                    }}
                    error={!!errors.price}
                    helperText={errors.price?.message}
                  />
                )}
              />
            </Grid>
            
            <Grid item xs={12} sm={6}>
              <Controller
                name="categoryId"
                control={control}
                rules={{ required: 'Category is required' }}
                render={({ field }) => (
                  <FormControl fullWidth error={!!errors.categoryId}>
                    <InputLabel>Category</InputLabel>
                    <Select {...field} label="Category">
                      {categories.map((category) => (
                        <MenuItem key={category.id} value={category.id}>
                          {category.name}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                )}
              />
            </Grid>
            
            {/* Inventory & Availability */}
            <Grid item xs={12}>
              <Typography variant="subtitle1" fontWeight="medium" gutterBottom sx={{ mt: 2 }}>
                Inventory & Availability
              </Typography>
            </Grid>
            
            <Grid item xs={12} sm={6}>
              <Controller
                name="stock"
                control={control}
                render={({ field }) => (
                  <TextField
                    {...field}
                    fullWidth
                    type="number"
                    label="Stock Quantity (Optional)"
                    InputProps={{
                      inputProps: { min: 0 },
                    }}
                  />
                )}
              />
            </Grid>
            
            <Grid item xs={12} sm={6}>
              <Controller
                name="preparationTime"
                control={control}
                rules={{
                  required: 'Preparation time is required',
                  min: { value: 1, message: 'Must be at least 1 minute' },
                }}
                render={({ field }) => (
                  <TextField
                    {...field}
                    fullWidth
                    type="number"
                    label="Preparation Time"
                    InputProps={{
                      endAdornment: <InputAdornment position="end">minutes</InputAdornment>,
                      inputProps: { min: 1 },
                    }}
                    error={!!errors.preparationTime}
                    helperText={errors.preparationTime?.message}
                  />
                )}
              />
            </Grid>
            
            <Grid item xs={12}>
              <Controller
                name="available"
                control={control}
                render={({ field }) => (
                  <FormControlLabel
                    control={<Switch {...field} checked={field.value} />}
                    label="Available for ordering"
                  />
                )}
              />
            </Grid>
            
            {/* Tags */}
            <Grid item xs={12}>
              <Typography variant="subtitle1" fontWeight="medium" gutterBottom sx={{ mt: 2 }}>
                Tags
              </Typography>
              <Box sx={{ display: 'flex', gap: 1, mb: 2 }}>
                <TextField
                  size="small"
                  placeholder="Add a tag"
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  onKeyPress={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleAddTag();
                    }
                  }}
                />
                <Button
                  variant="outlined"
                  size="small"
                  onClick={handleAddTag}
                  startIcon={<Add />}
                >
                  Add
                </Button>
              </Box>
              <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                {tags.map((tag) => (
                  <Chip
                    key={tag}
                    label={tag}
                    onDelete={() => handleRemoveTag(tag)}
                  />
                ))}
              </Box>
            </Grid>
            
            {/* Images */}
            <Grid item xs={12}>
              <Typography variant="subtitle1" fontWeight="medium" gutterBottom sx={{ mt: 2 }}>
                Images
              </Typography>
              
              {/* Existing Images */}
              {existingImages.length > 0 && (
                <Box sx={{ mb: 2 }}>
                  <Typography variant="body2" color="text.secondary" gutterBottom>
                    Current Images
                  </Typography>
                  <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                    {existingImages.map((image, index) => (
                      <Paper
                        key={index}
                        sx={{
                          position: 'relative',
                          width: 100,
                          height: 100,
                          p: 0.5,
                        }}
                      >
                        <img
                          src={image}
                          alt={`Product ${index + 1}`}
                          style={{
                            width: '100%',
                            height: '100%',
                            objectFit: 'cover',
                            borderRadius: 4,
                          }}
                        />
                        <IconButton
                          size="small"
                          sx={{
                            position: 'absolute',
                            top: 4,
                            right: 4,
                            bgcolor: 'background.paper',
                            '&:hover': { bgcolor: 'error.light' },
                          }}
                          onClick={() => removeExistingImage(index)}
                        >
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      </Paper>
                    ))}
                  </Box>
                </Box>
              )}
              
              {/* Upload New Images */}
              <Box
                {...getRootProps()}
                sx={{
                  border: '2px dashed',
                  borderColor: isDragActive ? 'primary.main' : 'divider',
                  borderRadius: 2,
                  p: 3,
                  textAlign: 'center',
                  cursor: 'pointer',
                  bgcolor: isDragActive ? 'action.hover' : 'background.default',
                  transition: 'all 0.2s',
                }}
              >
                <input {...getInputProps()} />
                <CloudUpload sx={{ fontSize: 48, color: 'text.secondary', mb: 1 }} />
                <Typography variant="body1" gutterBottom>
                  {isDragActive ? 'Drop images here' : 'Drag & drop images here'}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  or click to select files
                </Typography>
              </Box>
              
              {/* New Images Preview */}
              {images.length > 0 && (
                <Box sx={{ mt: 2 }}>
                  <Typography variant="body2" color="text.secondary" gutterBottom>
                    New Images ({images.length})
                  </Typography>
                  <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                    {images.map((image, index) => (
                      <Paper
                        key={index}
                        sx={{
                          position: 'relative',
                          width: 100,
                          height: 100,
                          p: 0.5,
                        }}
                      >
                        <img
                          src={URL.createObjectURL(image)}
                          alt={`New ${index + 1}`}
                          style={{
                            width: '100%',
                            height: '100%',
                            objectFit: 'cover',
                            borderRadius: 4,
                          }}
                        />
                        <IconButton
                          size="small"
                          sx={{
                            position: 'absolute',
                            top: 4,
                            right: 4,
                            bgcolor: 'background.paper',
                            '&:hover': { bgcolor: 'error.light' },
                          }}
                          onClick={() => removeImage(index)}
                        >
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      </Paper>
                    ))}
                  </Box>
                </Box>
              )}
            </Grid>
          </Grid>
        </DialogContent>
        
        <DialogActions>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            type="submit"
            variant="contained"
            disabled={loading}
            startIcon={loading && <CircularProgress size={20} />}
          >
            {product ? 'Update Product' : 'Create Product'}
          </Button>
        </DialogActions>
      </form>
    </>
  );
}