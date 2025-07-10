# AI Recommendation Service

This service provides personalized recommendations using a hybrid approach combining collaborative filtering and content-based filtering.

## Features

- **Personalized Recommendations**: Get items tailored to user preferences and behavior
- **Similar Items**: Find items similar to a given item
- **Trending Items**: Discover what's popular in a specific area
- **Recommendation Explanations**: Understand why items are recommended
- **A/B Testing**: Support for recommendation experiments
- **Model Training**: Automated and manual model retraining

## Architecture

### Components

1. **RecommendationEngine**: Main orchestrator for recommendations
2. **UserProfileService**: Manages user preferences and behavior tracking
3. **CollaborativeFilteringService**: Finds patterns from similar users
4. **ContentBasedService**: Matches items to user preferences
5. **HybridRecommendationService**: Combines multiple recommendation approaches
6. **ModelTrainingService**: Handles model training and updates

### Algorithms

- **Collaborative Filtering**: Matrix factorization and user-item similarity
- **Content-Based**: TF-IDF for text similarity, feature extraction for items
- **Hybrid Approach**: Weighted combination with context awareness

## API Endpoints

### Get Personalized Recommendations
```
GET /recommendations/:userId?latitude=&longitude=&limit=20&context=
```

### Get Similar Items
```
GET /items/:itemId/similar?limit=10
```

### Get Trending Items
```
GET /trending?latitude=&longitude=&timeRange=day&limit=20
```

### Get Personalized Categories
```
GET /categories/:userId/personalized
```

### Record User Interaction
```
POST /interactions
{
  "userId": "string",
  "itemId": "string",
  "interactionType": "view|click|order|rate|favorite",
  "context": "optional-string"
}
```

### Get Recommendation Explanation
```
GET /recommendations/:userId/explain/:itemId
```

### Admin: Trigger Model Retrain
```
POST /admin/retrain
{
  "modelType": "collaborative|content|hybrid|full"
}
```

### Admin: Get Metrics
```
GET /admin/metrics
```

## Model Training

Models are automatically retrained daily at 2 AM. Manual retraining can be triggered through the admin API.

### Training Types

1. **Collaborative Filtering**: Trains on user-item interactions
2. **Content-Based**: Trains on item features and similarities
3. **Hybrid**: Combines both approaches
4. **Full**: Retrains all models

## Configuration

Environment variables:
- `DATABASE_URL`: PostgreSQL connection string
- `REDIS_URL`: Redis connection string
- `MONGODB_URL`: MongoDB connection string (optional)

## Development

```bash
# Install dependencies
npm install

# Run in development mode
npm run dev

# Build
npm run build

# Run tests
npm test
```