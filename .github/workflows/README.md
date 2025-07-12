# GitHub Actions Workflows

## Performance Testing

We have two approaches for performance testing:

### 1. Automatic Smoke Test (Default)
- Runs on every PR automatically
- Quick 10-second smoke test
- Doesn't require full service stack
- Creates placeholder results if services aren't available

### 2. Full Performance Test (Optional)
To run comprehensive performance tests with all services:

#### Option A: Using PR Label
1. Add the label `run-performance-tests` to your PR
2. The full performance test workflow will automatically start
3. It will:
   - Install PostgreSQL, Redis, MongoDB, RabbitMQ
   - Start all microservices (User, Payment, Order, etc.)
   - Run complete performance test suite
   - Comment results on the PR
   - Remove the label when complete

#### Option B: Manual Trigger
1. Go to Actions tab
2. Select "Performance Tests (Optional)" workflow
3. Click "Run workflow"
4. Enter the PR number
5. Click "Run workflow" button

### Performance Test Results
- **Smoke Test**: Basic connectivity check, appears in regular CI
- **Full Test**: Comprehensive load testing with:
  - Authentication flow testing
  - API endpoint stress testing
  - Concurrent user simulations
  - Order flow performance
  - Database query optimization checks

### Requirements for Full Tests
The optional performance test workflow will automatically:
- Set up all required databases
- Run migrations
- Start all microservices
- Wait for services to be healthy
- Execute full K6 test suite
- Generate detailed reports