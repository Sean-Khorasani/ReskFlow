# ReskFlow Testing Documentation

This directory contains the comprehensive test suite for the ReskFlow enterprise blockchain reskflow platform. Our testing strategy follows industry best practices and covers all aspects of quality assurance.

## 📋 Table of Contents

- [Testing Strategy](#testing-strategy)
- [Test Categories](#test-categories)
- [Getting Started](#getting-started)
- [Running Tests](#running-tests)
- [Test Reports](#test-reports)
- [CI/CD Integration](#cicd-integration)
- [Best Practices](#best-practices)

## 🎯 Testing Strategy

Our testing approach follows the **Test Pyramid** principle with additional specialized testing categories:

```
         /\
        /  \         E2E Tests (UI/Flow)
       /----\        Integration Tests
      /      \       Contract Tests
     /--------\      Unit Tests
    /          \     
   /------------\    Performance | Security | Chaos
```

### Testing Goals

1. **Quality Assurance**: Ensure all features work as expected
2. **Regression Prevention**: Catch bugs before they reach production
3. **Performance Validation**: Verify system meets performance SLAs
4. **Security Compliance**: Validate security requirements
5. **Resilience Testing**: Ensure system handles failures gracefully

## 📚 Test Categories

### 1. Unit Tests
- **Location**: `/testing/unit/`
- **Framework**: Jest
- **Coverage Target**: > 80%
- **Purpose**: Test individual functions and components in isolation

### 2. Integration Tests
- **Location**: `/testing/integration/`
- **Framework**: Jest + TestContainers
- **Purpose**: Test service interactions and API endpoints

### 3. Contract Tests
- **Location**: `/testing/contract/`
- **Framework**: Pact
- **Purpose**: Ensure API compatibility between services

### 4. Performance Tests
- **Location**: `/testing/performance/`
- **Framework**: K6
- **Purpose**: Validate performance under various load conditions

### 5. Security Tests
- **Location**: `/testing/security/`
- **Framework**: OWASP ZAP
- **Purpose**: Identify security vulnerabilities

### 6. E2E Tests
- **Location**: `/testing/e2e/`
- **Framework**: Playwright
- **Purpose**: Test complete user workflows

### 7. Chaos Engineering
- **Location**: `/testing/chaos/`
- **Framework**: Litmus
- **Purpose**: Test system resilience to failures

## 🚀 Getting Started

### Prerequisites

```bash
# Install Node.js dependencies
npm install --save-dev

# Install test frameworks
npm install --save-dev jest @types/jest ts-jest
npm install --save-dev @testcontainers/testcontainers
npm install --save-dev @pact-foundation/pact
npm install --save-dev @playwright/test

# Install K6 for performance testing
brew install k6  # macOS
# or
sudo apt-get install k6  # Ubuntu

# Install Docker for integration tests
# Follow instructions at https://docs.docker.com/get-docker/
```

### Configuration

1. Copy test environment configuration:
```bash
cp .env.test.example .env.test
```

2. Configure test database:
```bash
docker-compose -f docker-compose.test.yml up -d
```

## 🧪 Running Tests

### All Tests
```bash
npm test
```

### Unit Tests
```bash
npm run test:unit

# With coverage
npm run test:unit:coverage

# Watch mode
npm run test:unit:watch
```

### Integration Tests
```bash
npm run test:integration

# Specific service
npm run test:integration -- auth.integration.test.ts
```

### Contract Tests
```bash
npm run test:contract

# Publish contracts
npm run test:contract:publish
```

### Performance Tests
```bash
cd testing/performance
./run-performance-tests.sh

# Specific scenario
k6 run auth-flow.test.js
k6 run order-flow.test.js --vus 100 --duration 5m
```

### Security Tests
```bash
cd testing/security
./run-security-tests.sh

# Quick scan
./run-security-tests.sh baseline

# Full scan
./run-security-tests.sh full
```

### E2E Tests
```bash
cd testing/e2e
./run-e2e-tests.sh

# Specific test suite
./run-e2e-tests.sh customer
./run-e2e-tests.sh merchant

# Headed mode (see browser)
HEADED=true ./run-e2e-tests.sh
```

### Chaos Tests
```bash
cd testing/chaos
./run-chaos-tests.sh all

# Specific chaos scenario
./run-chaos-tests.sh network
./run-chaos-tests.sh resource
```

## 📊 Test Reports

Test reports are generated in various formats:

### Unit/Integration Test Reports
- **Location**: `/coverage/`
- **Format**: HTML, LCOV
- **View**: `open coverage/index.html`

### Performance Test Reports
- **Location**: `/testing/performance/results/`
- **Format**: HTML, JSON, CSV
- **Metrics**: Response times, throughput, error rates

### Security Test Reports
- **Location**: `/testing/security/results/`
- **Format**: HTML, XML, JSON
- **Contents**: Vulnerabilities, OWASP compliance

### E2E Test Reports
- **Location**: `/testing/e2e/playwright-report/`
- **Format**: HTML with screenshots/videos
- **View**: `npx playwright show-report`

### Chaos Test Reports
- **Location**: `/testing/chaos/chaos-results/`
- **Format**: HTML, YAML
- **Contents**: Resilience metrics, failure analysis

## 🔄 CI/CD Integration

### GitHub Actions

```yaml
name: Test Suite
on: [push, pull_request]

jobs:
  unit-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
      - run: npm ci
      - run: npm run test:unit:coverage
      - uses: codecov/codecov-action@v3

  integration-tests:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:14
      redis:
        image: redis:7
    steps:
      - uses: actions/checkout@v3
      - run: npm ci
      - run: npm run test:integration

  e2e-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - run: npm ci
      - run: npx playwright install
      - run: npm run test:e2e

  performance-tests:
    runs-on: ubuntu-latest
    if: github.event_name == 'pull_request'
    steps:
      - uses: actions/checkout@v3
      - uses: k6io/action@v0.1
      - run: |
          cd testing/performance
          k6 run --out cloud auth-flow.test.js
```

### Test Gates

- **Pull Requests**: Must pass unit, integration, and contract tests
- **Pre-deployment**: Must pass security and E2E tests
- **Post-deployment**: Run smoke tests and monitor performance

## 📏 Best Practices

### Writing Tests

1. **Follow AAA Pattern**: Arrange, Act, Assert
2. **Use Descriptive Names**: Test names should explain what they test
3. **Keep Tests Independent**: Each test should be able to run in isolation
4. **Mock External Dependencies**: Use mocks for external services
5. **Test Edge Cases**: Include boundary conditions and error scenarios

### Test Data

1. **Use Factories**: Generate test data dynamically
2. **Avoid Hard-coded Values**: Use constants and generators
3. **Clean Up After Tests**: Ensure tests don't leave side effects
4. **Use Realistic Data**: Test with production-like data

### Performance Testing

1. **Baseline First**: Establish performance baselines
2. **Test Incrementally**: Start with small loads and increase
3. **Monitor Resources**: Track CPU, memory, and network
4. **Test in Production-like Environment**: Use similar infrastructure

### Security Testing

1. **Regular Scans**: Run security tests on every deployment
2. **Update Security Rules**: Keep OWASP rules up to date
3. **Test Authentication**: Verify all auth mechanisms
4. **Check Dependencies**: Scan for vulnerable packages

## 🔍 Debugging Tests

### Common Issues

1. **Flaky Tests**
   - Add proper waits and retries
   - Check for race conditions
   - Ensure proper test isolation

2. **Slow Tests**
   - Use test containers wisely
   - Parallelize where possible
   - Mock expensive operations

3. **Environment Issues**
   - Verify all services are running
   - Check environment variables
   - Ensure correct database state

### Debug Commands

```bash
# Run tests with debug output
DEBUG=* npm test

# Run specific test with verbose output
npm test -- --verbose auth.test.ts

# Run tests in band (no parallelization)
npm test -- --runInBand

# Debug E2E tests
PWDEBUG=1 npx playwright test

# Debug K6 tests
k6 run --http-debug auth-flow.test.js
```

## 📈 Metrics and KPIs

### Test Coverage Targets
- Unit Tests: > 80%
- Integration Tests: > 70%
- E2E Critical Paths: 100%

### Performance Targets
- API Response Time: < 500ms (p95)
- Throughput: > 1000 RPS
- Error Rate: < 0.1%

### Security Compliance
- OWASP Top 10: 100% coverage
- Zero high-severity vulnerabilities
- Regular penetration testing

## 🤝 Contributing

1. Write tests for all new features
2. Ensure tests pass before submitting PR
3. Update test documentation
4. Follow testing best practices

## 📞 Support

For testing-related questions:
- Check the documentation first
- Ask in #testing Slack channel
- Create an issue with `testing` label

---

Last Updated: January 2024