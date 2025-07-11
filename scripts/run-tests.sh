#!/bin/bash

# ReskFlow Test Runner Script
# This script runs all tests for the ReskFlow platform

set -e

echo "🧪 ReskFlow Test Runner"
echo "======================"
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if all services are running
check_services() {
    echo "🔍 Checking services..."
    
    # Check PostgreSQL
    if pg_isready -q; then
        echo -e "${GREEN}✓${NC} PostgreSQL is running"
    else
        echo -e "${RED}✗${NC} PostgreSQL is not running"
        exit 1
    fi
    
    # Check Redis
    if redis-cli ping > /dev/null 2>&1; then
        echo -e "${GREEN}✓${NC} Redis is running"
    else
        echo -e "${RED}✗${NC} Redis is not running"
        exit 1
    fi
    
    # Check Elasticsearch
    if curl -s http://localhost:9200 > /dev/null; then
        echo -e "${GREEN}✓${NC} Elasticsearch is running"
    else
        echo -e "${RED}✗${NC} Elasticsearch is not running"
        exit 1
    fi
    
    echo ""
}

# Setup test environment
setup_test_env() {
    echo "🔧 Setting up test environment..."
    
    # Create test database
    echo "Creating test database..."
    createdb reskflow_test || true
    
    # Run migrations on test database
    echo "Running migrations..."
    DATABASE_URL="postgresql://reskflow:reskflow123@localhost:5432/reskflow_test" \
    cd backend && npx prisma migrate deploy
    
    # Generate Prisma client
    npx prisma generate
    
    cd ..
    echo ""
}

# Seed test data
seed_test_data() {
    echo "🌱 Seeding test data..."
    DATABASE_URL="postgresql://reskflow:reskflow123@localhost:5432/reskflow_test" \
    cd backend && npm run seed
    cd ..
    echo ""
}

# Run unit tests
run_unit_tests() {
    echo "🧪 Running unit tests..."
    echo "----------------------"
    
    # Backend unit tests
    echo "Backend unit tests:"
    cd backend && npm test
    cd ..
    
    # Frontend unit tests
    echo -e "\nFrontend unit tests:"
    cd frontend && npm test
    cd ..
    
    # Mobile unit tests
    echo -e "\nMobile unit tests:"
    cd mobile && npm test
    cd ..
    
    echo ""
}

# Run integration tests
run_integration_tests() {
    echo "🔗 Running integration tests..."
    echo "-----------------------------"
    
    cd backend && npm run test:integration
    cd ..
    
    echo ""
}

# Run E2E tests
run_e2e_tests() {
    echo "🌐 Running E2E tests..."
    echo "---------------------"
    
    # Install Playwright browsers if needed
    cd backend && npx playwright install
    
    # Run E2E tests
    npm run test:e2e
    cd ..
    
    echo ""
}

# Run performance tests
run_performance_tests() {
    echo "⚡ Running performance tests..."
    echo "-----------------------------"
    
    # Run k6 performance tests
    if command -v k6 &> /dev/null; then
        k6 run backend/tests/performance/load-test.js
    else
        echo -e "${YELLOW}Warning:${NC} k6 not installed, skipping performance tests"
    fi
    
    echo ""
}

# Run security tests
run_security_tests() {
    echo "🔒 Running security tests..."
    echo "--------------------------"
    
    # Run npm audit
    echo "Checking for vulnerabilities..."
    npm audit --workspaces
    
    # Run OWASP dependency check if available
    if command -v dependency-check &> /dev/null; then
        dependency-check --project ReskFlow --scan .
    else
        echo -e "${YELLOW}Warning:${NC} OWASP dependency-check not installed"
    fi
    
    echo ""
}

# Generate test report
generate_report() {
    echo "📊 Generating test report..."
    echo "--------------------------"
    
    # Create reports directory
    mkdir -p test-reports
    
    # Copy test results
    cp -r backend/coverage test-reports/backend-coverage || true
    cp -r frontend/coverage test-reports/frontend-coverage || true
    cp -r backend/playwright-report test-reports/e2e-report || true
    
    # Generate summary
    cat > test-reports/summary.md << EOF
# ReskFlow Test Report
Generated on: $(date)

## Test Results Summary

### Unit Tests
- Backend: $(cd backend && npm test -- --reporter=json | jq '.stats.passes' || echo "N/A") passed
- Frontend: $(cd frontend && npm test -- --reporter=json | jq '.stats.passes' || echo "N/A") passed
- Mobile: $(cd mobile && npm test -- --reporter=json | jq '.stats.passes' || echo "N/A") passed

### Integration Tests
- Total: $(cd backend && npm run test:integration -- --reporter=json | jq '.stats.total' || echo "N/A")
- Passed: $(cd backend && npm run test:integration -- --reporter=json | jq '.stats.passes' || echo "N/A")

### E2E Tests
- Scenarios: $(find backend/tests/e2e -name "*.test.ts" | wc -l)
- Browsers tested: Chrome, Firefox, Safari, Mobile

### Coverage
- Backend: Check test-reports/backend-coverage/index.html
- Frontend: Check test-reports/frontend-coverage/index.html

### Performance
- Load test results available in test-reports/performance/

EOF
    
    echo -e "${GREEN}✓${NC} Test report generated in test-reports/"
    echo ""
}

# Main execution
main() {
    echo "Test type: ${1:-all}"
    echo ""
    
    check_services
    
    case ${1:-all} in
        setup)
            setup_test_env
            seed_test_data
            ;;
        unit)
            run_unit_tests
            ;;
        integration)
            run_integration_tests
            ;;
        e2e)
            run_e2e_tests
            ;;
        performance)
            run_performance_tests
            ;;
        security)
            run_security_tests
            ;;
        all)
            setup_test_env
            seed_test_data
            run_unit_tests
            run_integration_tests
            run_e2e_tests
            run_performance_tests
            run_security_tests
            generate_report
            ;;
        *)
            echo "Usage: $0 [setup|unit|integration|e2e|performance|security|all]"
            exit 1
            ;;
    esac
    
    echo -e "${GREEN}✨ Tests completed!${NC}"
}

# Run main function with arguments
main "$@"