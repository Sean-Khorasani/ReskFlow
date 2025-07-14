import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  FlatList,
  TouchableOpacity,
  Image,
  ActivityIndicator,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { searchRestaurants, searchProducts } from '../services/api';

interface SearchResult {
  id: string;
  name: string;
  type: 'restaurant' | 'product';
  image?: string;
  rating?: number;
  reskflowTime?: string;
  price?: number;
  restaurantName?: string;
  restaurantId?: string;
}

export default function SearchScreen() {
  const navigation = useNavigation();
  const [searchQuery, setSearchQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [recentSearches, setRecentSearches] = useState<string[]>([
    'Pizza',
    'Burger',
    'Chinese',
    'Sushi',
    'Coffee',
  ]);

  useEffect(() => {
    if (searchQuery.length > 2) {
      performSearch();
    } else {
      setResults([]);
    }
  }, [searchQuery]);

  const performSearch = async () => {
    setLoading(true);
    try {
      const [restaurants, products] = await Promise.all([
        searchRestaurants(searchQuery),
        searchProducts(searchQuery),
      ]);

      const combinedResults: SearchResult[] = [
        ...restaurants.map((r: any) => ({
          id: r.id,
          name: r.name,
          type: 'restaurant' as const,
          image: r.image,
          rating: r.rating,
          reskflowTime: r.reskflowTime,
        })),
        ...products.map((p: any) => ({
          id: p.id,
          name: p.name,
          type: 'product' as const,
          image: p.image,
          price: p.price,
          restaurantName: p.restaurantName,
          restaurantId: p.restaurantId,
        })),
      ];

      setResults(combinedResults);
    } catch (error) {
      console.error('Search error:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleResultPress = (result: SearchResult) => {
    if (result.type === 'restaurant') {
      navigation.navigate('Restaurant' as never, { restaurantId: result.id } as never);
    } else {
      navigation.navigate('Restaurant' as never, { restaurantId: result.restaurantId } as never);
    }
  };

  const handleRecentSearch = (query: string) => {
    setSearchQuery(query);
  };

  const renderSearchResult = ({ item }: { item: SearchResult }) => (
    <TouchableOpacity
      style={styles.resultItem}
      onPress={() => handleResultPress(item)}
    >
      <Image
        source={{ uri: item.image || 'https://via.placeholder.com/60' }}
        style={styles.resultImage}
      />
      <View style={styles.resultContent}>
        <Text style={styles.resultName}>{item.name}</Text>
        {item.type === 'restaurant' ? (
          <View style={styles.restaurantInfo}>
            <Icon name="star" size={16} color="#FFB800" />
            <Text style={styles.rating}>{item.rating?.toFixed(1)}</Text>
            <Text style={styles.dot}>•</Text>
            <Text style={styles.reskflowTime}>{item.reskflowTime}</Text>
          </View>
        ) : (
          <View style={styles.productInfo}>
            <Text style={styles.restaurantName}>{item.restaurantName}</Text>
            <Text style={styles.price}>${item.price?.toFixed(2)}</Text>
          </View>
        )}
      </View>
      <Icon name="chevron-right" size={24} color="#9CA3AF" />
    </TouchableOpacity>
  );

  const renderRecentSearch = (search: string) => (
    <TouchableOpacity
      key={search}
      style={styles.recentSearchChip}
      onPress={() => handleRecentSearch(search)}
    >
      <Icon name="history" size={16} color="#6B7280" />
      <Text style={styles.recentSearchText}>{search}</Text>
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      <View style={styles.searchHeader}>
        <View style={styles.searchBar}>
          <Icon name="magnify" size={24} color="#9CA3AF" />
          <TextInput
            style={styles.searchInput}
            placeholder="Search for restaurants or dishes"
            value={searchQuery}
            onChangeText={setSearchQuery}
            autoFocus
            placeholderTextColor="#9CA3AF"
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity onPress={() => setSearchQuery('')}>
              <Icon name="close-circle" size={20} color="#9CA3AF" />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {searchQuery.length === 0 ? (
        <View style={styles.recentSearchesContainer}>
          <Text style={styles.sectionTitle}>Recent Searches</Text>
          <View style={styles.recentSearches}>
            {recentSearches.map(renderRecentSearch)}
          </View>

          <Text style={styles.sectionTitle}>Popular Cuisines</Text>
          <View style={styles.cuisineGrid}>
            {[
              { name: 'Pizza', icon: '🍕' },
              { name: 'Burger', icon: '🍔' },
              { name: 'Chinese', icon: '🥡' },
              { name: 'Mexican', icon: '🌮' },
              { name: 'Indian', icon: '🍛' },
              { name: 'Sushi', icon: '🍱' },
            ].map((cuisine) => (
              <TouchableOpacity
                key={cuisine.name}
                style={styles.cuisineItem}
                onPress={() => handleRecentSearch(cuisine.name)}
              >
                <Text style={styles.cuisineIcon}>{cuisine.icon}</Text>
                <Text style={styles.cuisineName}>{cuisine.name}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      ) : (
        <>
          {loading ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color="#007AFF" />
            </View>
          ) : results.length > 0 ? (
            <FlatList
              data={results}
              renderItem={renderSearchResult}
              keyExtractor={(item) => `${item.type}-${item.id}`}
              contentContainerStyle={styles.resultsList}
            />
          ) : searchQuery.length > 2 ? (
            <View style={styles.emptyContainer}>
              <Icon name="magnify-close" size={64} color="#D1D5DB" />
              <Text style={styles.emptyTitle}>No results found</Text>
              <Text style={styles.emptySubtitle}>
                Try searching for something else
              </Text>
            </View>
          ) : null}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  searchHeader: {
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F3F4F6',
    borderRadius: 12,
    paddingHorizontal: 16,
    height: 48,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    marginLeft: 12,
    color: '#111827',
  },
  recentSearchesContainer: {
    padding: 16,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#111827',
    marginBottom: 12,
    marginTop: 16,
  },
  recentSearches: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginHorizontal: -4,
  },
  recentSearchChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F3F4F6',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    margin: 4,
  },
  recentSearchText: {
    fontSize: 14,
    color: '#6B7280',
    marginLeft: 6,
  },
  cuisineGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginHorizontal: -8,
  },
  cuisineItem: {
    width: '31%',
    alignItems: 'center',
    backgroundColor: '#F9FAFB',
    padding: 16,
    borderRadius: 12,
    margin: '1.16%',
  },
  cuisineIcon: {
    fontSize: 32,
    marginBottom: 8,
  },
  cuisineName: {
    fontSize: 14,
    color: '#374151',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  resultsList: {
    paddingVertical: 8,
  },
  resultItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  resultImage: {
    width: 60,
    height: 60,
    borderRadius: 8,
    marginRight: 12,
  },
  resultContent: {
    flex: 1,
  },
  resultName: {
    fontSize: 16,
    fontWeight: '500',
    color: '#111827',
    marginBottom: 4,
  },
  restaurantInfo: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  rating: {
    fontSize: 14,
    color: '#6B7280',
    marginLeft: 4,
  },
  dot: {
    fontSize: 14,
    color: '#9CA3AF',
    marginHorizontal: 6,
  },
  reskflowTime: {
    fontSize: 14,
    color: '#6B7280',
  },
  productInfo: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  restaurantName: {
    fontSize: 14,
    color: '#6B7280',
  },
  price: {
    fontSize: 16,
    fontWeight: '600',
    color: '#007AFF',
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#374151',
    marginTop: 16,
  },
  emptySubtitle: {
    fontSize: 16,
    color: '#6B7280',
    marginTop: 8,
  },
});