#!/bin/bash

# E2E Test Runner Script for ReskFlow
# Uses Playwright for end-to-end testing

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
BASE_URL="${BASE_URL:-http://localhost:3000}"
BROWSER="${BROWSER:-chromium}"
HEADED="${HEADED:-false}"
WORKERS="${WORKERS:-1}"
RETRIES="${RETRIES:-2}"

echo -e "${BLUE}ReskFlow E2E Test Suite${NC}"
echo -e "${BLUE}======================${NC}"
echo "Base URL: ${BASE_URL}"
echo "Browser: ${BROWSER}"
echo "Headed: ${HEADED}"
echo "Workers: ${WORKERS}"
echo "Retries: ${RETRIES}"
echo ""

# Function to check if app is running
check_app() {
    echo -e "${YELLOW}Checking if application is running...${NC}"
    if curl -s -o /dev/null -w "%{http_code}" "${BASE_URL}/health" | grep -q "200"; then
        echo -e "${GREEN}✓ Application is running${NC}"
    else
        echo -e "${RED}✗ Application is not running at ${BASE_URL}${NC}"
        echo "Please start the application first."
        exit 1
    fi
}

# Function to install dependencies
install_deps() {
    echo -e "${YELLOW}Installing test dependencies...${NC}"
    npm install --save-dev @playwright/test
    npx playwright install
    echo -e "${GREEN}✓ Dependencies installed${NC}"
}

# Function to run specific test suite
run_test_suite() {
    local suite_name=$1
    local test_pattern=$2
    
    echo -e "${YELLOW}Running ${suite_name} tests...${NC}"
    
    npx playwright test ${test_pattern} \
        --config=playwright.config.ts \
        --browser=${BROWSER} \
        ${HEADED:+--headed} \
        --workers=${WORKERS} \
        --retries=${RETRIES} \
        --reporter=list,html \
        2>&1 | tee "test-results/${suite_name}.log"
    
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}✓ ${suite_name} tests passed${NC}"
        return 0
    else
        echo -e "${RED}✗ ${suite_name} tests failed${NC}"
        return 1
    fi
}

# Function to run all tests
run_all_tests() {
    echo -e "${YELLOW}Running all E2E tests...${NC}"
    
    npx playwright test \
        --config=playwright.config.ts \
        --browser=${BROWSER} \
        ${HEADED:+--headed} \
        --workers=${WORKERS} \
        --retries=${RETRIES} \
        --reporter=list,html,json \
        2>&1 | tee "test-results/all-tests.log"
    
    return $?
}

# Function to run tests in watch mode
run_watch_mode() {
    echo -e "${YELLOW}Running tests in watch mode...${NC}"
    
    npx playwright test \
        --config=playwright.config.ts \
        --browser=${BROWSER} \
        --headed \
        --workers=1 \
        --reporter=list \
        --watch
}

# Function to open test report
open_report() {
    echo -e "${YELLOW}Opening test report...${NC}"
    npx playwright show-report
}

# Function to generate test summary
generate_summary() {
    echo -e "${YELLOW}Generating test summary...${NC}"
    
    local report_file="test-results/summary-$(date +%Y%m%d-%H%M%S).md"
    
    cat > "$report_file" << EOF
# E2E Test Summary
Date: $(date)
Base URL: ${BASE_URL}

## Test Results

### Overall Statistics
EOF
    
    if [ -f "test-results.json" ]; then
        # Parse JSON results if available
        local total=$(jq '.stats.total' test-results.json)
        local passed=$(jq '.stats.passed' test-results.json)
        local failed=$(jq '.stats.failed' test-results.json)
        local skipped=$(jq '.stats.skipped' test-results.json)
        local duration=$(jq '.stats.duration' test-results.json)
        
        cat >> "$report_file" << EOF
- Total Tests: $total
- Passed: $passed
- Failed: $failed
- Skipped: $skipped
- Duration: ${duration}ms

### Failed Tests
EOF
        
        if [ "$failed" -gt 0 ]; then
            jq -r '.failures[] | "- \(.title): \(.error)"' test-results.json >> "$report_file"
        else
            echo "No failures!" >> "$report_file"
        fi
    fi
    
    echo -e "${GREEN}✓ Summary generated: $report_file${NC}"
}

# Main execution
case "${1:-all}" in
    "install")
        install_deps
        ;;
    "auth")
        check_app
        run_test_suite "Authentication" "tests/auth/"
        ;;
    "customer")
        check_app
        run_test_suite "Customer" "tests/customer/"
        ;;
    "merchant")
        check_app
        run_test_suite "Merchant" "tests/merchant/"
        ;;
    "driver")
        check_app
        run_test_suite "Driver" "tests/driver/"
        ;;
    "smoke")
        check_app
        echo -e "${YELLOW}Running smoke tests...${NC}"
        WORKERS=1 RETRIES=0 run_test_suite "Smoke" "tests/**/*.spec.ts"
        ;;
    "watch")
        check_app
        run_watch_mode
        ;;
    "report")
        open_report
        ;;
    "all"|*)
        check_app
        mkdir -p test-results
        
        # Run all test suites
        failed=0
        
        run_all_tests || failed=1
        
        # Generate summary
        generate_summary
        
        # Open report if tests passed
        if [ $failed -eq 0 ]; then
            echo ""
            echo -e "${GREEN}All E2E tests passed!${NC}"
            echo -e "${BLUE}Opening test report...${NC}"
            open_report
        else
            echo ""
            echo -e "${RED}Some E2E tests failed!${NC}"
            echo -e "${YELLOW}Run './run-e2e-tests.sh report' to view detailed report${NC}"
            exit 1
        fi
        ;;
esac

echo ""
echo -e "${BLUE}E2E Test Run Complete${NC}"
echo "=============================="