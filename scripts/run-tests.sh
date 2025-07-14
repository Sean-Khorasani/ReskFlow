#!/bin/bash

# Run Tests Script for ReskFlow Platform
# This script runs all test suites for the platform

set -e

echo "🧪 Starting ReskFlow Test Suite..."
echo "================================="

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Test results
TOTAL_TESTS=0
PASSED_TESTS=0
FAILED_TESTS=0

# Function to run tests for a service
run_service_tests() {
    local service_name=$1
    local service_path=$2
    
    echo -e "\n${YELLOW}Testing ${service_name}...${NC}"
    
    if [ -d "$service_path" ]; then
        cd "$service_path"
        
        # Install dependencies if needed
        if [ ! -d "node_modules" ]; then
            echo "Installing dependencies..."
            npm install --silent
        fi
        
        # Run tests
        if npm test -- --coverage --silent; then
            echo -e "${GREEN}✓ ${service_name} tests passed${NC}"
            ((PASSED_TESTS++))
        else
            echo -e "${RED}✗ ${service_name} tests failed${NC}"
            ((FAILED_TESTS++))
        fi
        ((TOTAL_TESTS++))
        
        cd - > /dev/null
    else
        echo -e "${YELLOW}⚠ ${service_name} directory not found${NC}"
    fi
}

# Function to run integration tests
run_integration_tests() {
    echo -e "\n${YELLOW}Running Integration Tests...${NC}"
    
    # Start test containers
    echo "Starting test infrastructure..."
    docker-compose -f docker-compose.test.yml up -d postgres redis mongodb
    
    # Wait for services
    echo "Waiting for services to be ready..."
    sleep 10
    
    # Run integration tests
    if npm run test:integration -- --ci; then
        echo -e "${GREEN}✓ Integration tests passed${NC}"
        ((PASSED_TESTS++))
    else
        echo -e "${RED}✗ Integration tests failed${NC}"
        ((FAILED_TESTS++))
    fi
    ((TOTAL_TESTS++))
    
    # Stop test containers
    docker-compose -f docker-compose.test.yml down
}

# Main test execution
echo "1. Running Unit Tests"
echo "--------------------"

# Run root level tests
echo -e "\n${YELLOW}Testing root project...${NC}"
if npm test -- --coverage; then
    echo -e "${GREEN}✓ Root tests passed${NC}"
    ((PASSED_TESTS++))
else
    echo -e "${RED}✗ Root tests failed${NC}"
    ((FAILED_TESTS++))
fi
((TOTAL_TESTS++))

# Test backend services
run_service_tests "User Service" "backend/services/user"
run_service_tests "Payment Service" "backend/services/payment"
run_service_tests "Order Service" "backend/services/order"
run_service_tests "Delivery Service" "backend/services/reskflow"
run_service_tests "Notification Service" "backend/services/notification"
run_service_tests "API Gateway" "backend/gateway"

# Test frontend applications
echo -e "\n2. Running Frontend Tests"
echo "------------------------"
run_service_tests "Customer Web App" "frontend/customer"
run_service_tests "Admin Dashboard" "frontend/admin"
run_service_tests "Merchant Portal" "frontend/merchant"
run_service_tests "Partner Portal" "frontend/partner"

# Test mobile applications
echo -e "\n3. Running Mobile Tests"
echo "----------------------"
run_service_tests "Customer Mobile App" "mobile/customer"
run_service_tests "Driver Mobile App" "mobile/driver"

# Run integration tests if requested
if [ "$1" == "--integration" ]; then
    run_integration_tests
fi

# Generate combined coverage report
echo -e "\n4. Generating Coverage Report"
echo "----------------------------"
if command -v nyc &> /dev/null; then
    nyc report --reporter=html --reporter=text
    echo -e "${GREEN}✓ Coverage report generated in coverage/index.html${NC}"
fi

# Summary
echo -e "\n================================="
echo "Test Summary"
echo "================================="
echo -e "Total test suites: ${TOTAL_TESTS}"
echo -e "${GREEN}Passed: ${PASSED_TESTS}${NC}"
echo -e "${RED}Failed: ${FAILED_TESTS}${NC}"

if [ $FAILED_TESTS -eq 0 ]; then
    echo -e "\n${GREEN}✓ All tests passed!${NC}"
    exit 0
else
    echo -e "\n${RED}✗ Some tests failed!${NC}"
    exit 1
fi