# Advanced Search Service

This service provides intelligent search capabilities with dietary filters, personalization, and AI-powered recommendations.

## Features

- **Elasticsearch Integration**: Full-text search with fuzzy matching and autocomplete
- **Dietary Filters**: Support for 12+ dietary restrictions and 9 allergen filters
- **Personalization**: Learn from user behavior and preferences
- **Search Analytics**: Track search patterns, popular queries, and conversion rates
- **Recommendation Integration**: AI-powered result enhancement
- **Multi-language Support**: Query expansion and synonym handling
- **Real-time Suggestions**: Autocomplete with personalized suggestions
- **Cross-sell Recommendations**: Suggest complementary items

## API Endpoints

### Search
- `POST /api/search` - Main search endpoint with filters
- `GET /api/search/suggestions` - Get search suggestions
- `GET /api/search/recent` - Get user's recent searches

### Dietary Filters
- `GET /api/dietary/filters` - Get available dietary filters
- `GET /api/dietary/allergens` - Get allergen list
- `POST /api/dietary/analyze-item` - Analyze item compatibility

### User Preferences
- `GET /api/preferences` - Get user preferences
- `PUT /api/preferences` - Update preferences
- `POST /api/preferences/learn` - Track behavior for learning

### Analytics
- `GET /api/search/analytics/popular` - Get popular searches
- `GET /api/search/analytics/trends` - Get search trends
- `GET /api/search/analytics/conversion` - Get conversion rates

## Environment Variables

```env
PORT=3021
DATABASE_URL=postgresql://user:pass@localhost:5432/reskflow
REDIS_HOST=localhost
REDIS_PORT=6379
ELASTICSEARCH_URL=http://localhost:9200
ELASTICSEARCH_USERNAME=elastic
ELASTICSEARCH_PASSWORD=changeme
RECOMMENDATION_SERVICE_URL=http://recommendation-service:3013
```

## Dietary Filters Supported

- Vegetarian
- Vegan
- Gluten-Free
- Dairy-Free
- Keto
- Paleo
- Halal
- Kosher
- Low Sodium
- Sugar-Free
- Nut-Free
- Soy-Free

## Allergens Tracked

- Milk
- Eggs
- Fish
- Shellfish
- Tree Nuts
- Peanuts
- Wheat
- Soy
- Sesame

## Search Algorithm

1. **Query Processing**
   - Tokenization and normalization
   - Synonym expansion
   - Spell correction

2. **Elasticsearch Query**
   - Multi-field search (name, description, category, tags)
   - Fuzzy matching for typos
   - Boost exact matches

3. **Filtering**
   - Location-based filtering
   - Dietary compatibility check
   - Allergen filtering
   - Price range filtering

4. **Personalization**
   - User preference scoring
   - Order history boost
   - Behavioral pattern matching

5. **Result Enhancement**
   - Recommendation service integration
   - Cross-sell suggestions
   - Faceted search results

## Dependencies

- Elasticsearch 8.x
- Redis for caching
- Bull for job queues
- Natural for NLP
- Fuse.js for fuzzy search fallback