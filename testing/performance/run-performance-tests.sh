#!/bin/bash

# Performance Test Runner Script
# This script runs K6 performance tests with different scenarios

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
BASE_URL="${BASE_URL:-http://localhost:3000}"
RESULTS_DIR="./results"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
REPORT_DIR="${RESULTS_DIR}/${TIMESTAMP}"

# Create results directory
mkdir -p "${REPORT_DIR}"

echo -e "${GREEN}ReskFlow Performance Test Suite${NC}"
echo -e "${GREEN}================================${NC}"
echo "Base URL: ${BASE_URL}"
echo "Results will be saved to: ${REPORT_DIR}"
echo ""

# Function to run a test
run_test() {
    local test_name=$1
    local test_file=$2
    local scenario=$3
    
    echo -e "${YELLOW}Running ${test_name}...${NC}"
    
    # Create test-specific directory
    mkdir -p "${REPORT_DIR}/${test_name}"
    
    # Run the test
    k6 run \
        --out json="${REPORT_DIR}/${test_name}/metrics.json" \
        --out csv="${REPORT_DIR}/${test_name}/metrics.csv" \
        --summary-export="${REPORT_DIR}/${test_name}/summary.json" \
        -e BASE_URL="${BASE_URL}" \
        ${scenario:+--env SCENARIO=$scenario} \
        "${test_file}" \
        2>&1 | tee "${REPORT_DIR}/${test_name}/output.log"
    
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}✓ ${test_name} completed successfully${NC}"
    else
        echo -e "${RED}✗ ${test_name} failed${NC}"
        return 1
    fi
    echo ""
}

# Function to generate HTML report
generate_html_report() {
    echo -e "${YELLOW}Generating HTML report...${NC}"
    
    cat > "${REPORT_DIR}/index.html" << 'EOF'
<!DOCTYPE html>
<html>
<head>
    <title>ReskFlow Performance Test Report</title>
    <meta charset="UTF-8">
    <style>
        body {
            font-family: Arial, sans-serif;
            margin: 20px;
            background-color: #f5f5f5;
        }
        .container {
            max-width: 1200px;
            margin: 0 auto;
            background-color: white;
            padding: 20px;
            border-radius: 8px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
        h1, h2 {
            color: #333;
        }
        .test-summary {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
            gap: 20px;
            margin: 20px 0;
        }
        .test-card {
            border: 1px solid #ddd;
            border-radius: 8px;
            padding: 15px;
            background-color: #fafafa;
        }
        .metric {
            display: flex;
            justify-content: space-between;
            margin: 10px 0;
            padding: 5px 0;
            border-bottom: 1px solid #eee;
        }
        .metric-name {
            font-weight: bold;
        }
        .metric-value {
            color: #2196F3;
        }
        .status-pass {
            color: #4CAF50;
            font-weight: bold;
        }
        .status-fail {
            color: #f44336;
            font-weight: bold;
        }
        table {
            width: 100%;
            border-collapse: collapse;
            margin: 20px 0;
        }
        th, td {
            border: 1px solid #ddd;
            padding: 8px;
            text-align: left;
        }
        th {
            background-color: #f2f2f2;
            font-weight: bold;
        }
        .charts {
            margin: 20px 0;
        }
        pre {
            background-color: #f5f5f5;
            padding: 10px;
            border-radius: 4px;
            overflow-x: auto;
        }
    </style>
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
</head>
<body>
    <div class="container">
        <h1>ReskFlow Performance Test Report</h1>
        <p>Generated on: <span id="timestamp"></span></p>
        <p>Base URL: ${BASE_URL}</p>
        
        <h2>Test Summary</h2>
        <div class="test-summary" id="test-summary">
            <!-- Test cards will be inserted here -->
        </div>
        
        <h2>Performance Metrics</h2>
        <div class="charts">
            <canvas id="responseTimeChart" width="400" height="200"></canvas>
        </div>
        
        <h2>Detailed Results</h2>
        <div id="detailed-results">
            <!-- Detailed results will be inserted here -->
        </div>
    </div>
    
    <script>
        // Add timestamp
        document.getElementById('timestamp').textContent = new Date().toLocaleString();
        
        // Load test results
        // This would be populated by parsing the K6 output files
        const testResults = [
            // Results will be populated here by the script
        ];
        
        // Render test summary cards
        // Render charts
        // Render detailed results
    </script>
</body>
</html>
EOF
    
    echo -e "${GREEN}✓ HTML report generated${NC}"
}

# Main test execution
echo -e "${GREEN}Starting Performance Test Suite${NC}"
echo "==============================="

# 1. Authentication Flow Test
run_test "auth-flow" "./auth-flow.test.js" "load"

# 2. Order Flow Test
run_test "order-flow" "./order-flow.test.js" "stress"

# 3. API Endpoints Test
run_test "api-endpoints" "./api-endpoints.test.js" ""

# 4. Concurrent Users Test
run_test "concurrent-users" "./concurrent-users.test.js" ""

# Generate consolidated report
generate_html_report

# Summary
echo ""
echo -e "${GREEN}Performance Test Suite Completed${NC}"
echo "================================"
echo "Results saved to: ${REPORT_DIR}"
echo "View the HTML report: ${REPORT_DIR}/index.html"
echo ""

# Check for failures
if grep -q "✗" "${REPORT_DIR}/*/output.log" 2>/dev/null; then
    echo -e "${RED}Warning: Some tests had failures. Please review the results.${NC}"
    exit 1
else
    echo -e "${GREEN}All tests completed successfully!${NC}"
fi