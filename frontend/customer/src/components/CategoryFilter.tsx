import { useState } from 'react';
import { Box, Chip, Avatar } from '@mui/material';
import FastfoodIcon from '@mui/icons-material/Fastfood';
import LocalPizzaIcon from '@mui/icons-material/LocalPizza';
import RamenDiningIcon from '@mui/icons-material/RamenDining';
import LunchDiningIcon from '@mui/icons-material/LunchDining';
import BakeryDiningIcon from '@mui/icons-material/BakeryDining';
import EmojiFoodBeverageIcon from '@mui/icons-material/EmojiFoodBeverage';

const categories = [
  { name: 'All', icon: FastfoodIcon },
  { name: 'Pizza', icon: LocalPizzaIcon },
  { name: 'Asian', icon: RamenDiningIcon },
  { name: 'Burgers', icon: LunchDiningIcon },
  { name: 'Bakery', icon: BakeryDiningIcon },
  { name: 'Coffee', icon: EmojiFoodBeverageIcon },
];

export default function CategoryFilter() {
  const [selectedCategory, setSelectedCategory] = useState('All');

  return (
    <Box sx={{ display: 'flex', gap: 1, overflowX: 'auto', pb: 2 }}>
      {categories.map((category) => {
        const Icon = category.icon;
        return (
          <Chip
            key={category.name}
            label={category.name}
            avatar={
              <Avatar sx={{ bgcolor: 'transparent' }}>
                <Icon fontSize="small" />
              </Avatar>
            }
            onClick={() => setSelectedCategory(category.name)}
            color={selectedCategory === category.name ? 'primary' : 'default'}
            variant={selectedCategory === category.name ? 'filled' : 'outlined'}
          />
        );
      })}
    </Box>
  );
}