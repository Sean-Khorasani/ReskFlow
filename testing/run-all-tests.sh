#!/bin/bash

# Master Test Runner Script for ReskFlow
# Orchestrates all test suites and generates comprehensive reports

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Configuration
RESULTS_DIR="./test-results"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
REPORT_DIR="${RESULTS_DIR}/${TIMESTAMP}"
PARALLEL=${PARALLEL:-true}
FAIL_FAST=${FAIL_FAST:-false}

# Test suite status tracking
declare -A TEST_STATUS
declare -A TEST_DURATION
TOTAL_START_TIME=$(date +%s)

echo -e "${CYAN}╔═══════════════════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║          ReskFlow Comprehensive Test Suite                ║${NC}"
echo -e "${CYAN}╚═══════════════════════════════════════════════════════════╝${NC}"
echo ""
echo "Timestamp: $(date)"
echo "Report Directory: ${REPORT_DIR}"
echo "Parallel Execution: ${PARALLEL}"
echo "Fail Fast: ${FAIL_FAST}"
echo ""

# Create report directory structure
mkdir -p "${REPORT_DIR}"/{unit,integration,contract,e2e,performance,security,chaos,coverage}

# Function to display progress
show_progress() {
    local test_name=$1
    local status=$2
    local duration=$3
    
    case $status in
        "RUNNING")
            echo -e "${YELLOW}⏳ ${test_name}...${NC}"
            ;;
        "PASSED")
            echo -e "${GREEN}✅ ${test_name} (${duration}s)${NC}"
            ;;
        "FAILED")
            echo -e "${RED}❌ ${test_name} (${duration}s)${NC}"
            ;;
        "SKIPPED")
            echo -e "${BLUE}⏭️  ${test_name} (skipped)${NC}"
            ;;
    esac
}

# Function to run a test suite
run_test_suite() {
    local suite_name=$1
    local command=$2
    local output_dir="${REPORT_DIR}/${suite_name}"
    
    show_progress "$suite_name Tests" "RUNNING"
    local start_time=$(date +%s)
    
    if eval "$command" > "${output_dir}/output.log" 2>&1; then
        local end_time=$(date +%s)
        local duration=$((end_time - start_time))
        TEST_STATUS[$suite_name]="PASSED"
        TEST_DURATION[$suite_name]=$duration
        show_progress "$suite_name Tests" "PASSED" $duration
        return 0
    else
        local end_time=$(date +%s)
        local duration=$((end_time - start_time))
        TEST_STATUS[$suite_name]="FAILED"
        TEST_DURATION[$suite_name]=$duration
        show_progress "$suite_name Tests" "FAILED" $duration
        
        if [[ "$FAIL_FAST" == "true" ]]; then
            echo -e "${RED}Fail fast enabled. Stopping test execution.${NC}"
            exit 1
        fi
        return 1
    fi
}

# Function to check prerequisites
check_prerequisites() {
    echo -e "${PURPLE}Checking prerequisites...${NC}"
    
    local missing_deps=()
    
    # Check for required tools
    command -v node >/dev/null 2>&1 || missing_deps+=("Node.js")
    command -v npm >/dev/null 2>&1 || missing_deps+=("npm")
    command -v docker >/dev/null 2>&1 || missing_deps+=("Docker")
    command -v k6 >/dev/null 2>&1 || missing_deps+=("k6")
    
    if [ ${#missing_deps[@]} -ne 0 ]; then
        echo -e "${RED}Missing dependencies: ${missing_deps[*]}${NC}"
        echo "Please install missing dependencies before running tests."
        exit 1
    fi
    
    # Check if services are running
    if ! curl -s http://localhost:3000/health >/dev/null 2>&1; then
        echo -e "${YELLOW}Warning: Application not running on localhost:3000${NC}"
        echo -e "${YELLOW}Some integration and E2E tests may fail.${NC}"
    fi
    
    echo -e "${GREEN}✓ Prerequisites checked${NC}"
    echo ""
}

# Function to generate HTML report
generate_html_report() {
    echo -e "${PURPLE}Generating comprehensive test report...${NC}"
    
    cat > "${REPORT_DIR}/index.html" << 'EOF'
<!DOCTYPE html>
<html>
<head>
    <title>ReskFlow Test Report</title>
    <meta charset="UTF-8">
    <style>
        :root {
            --primary: #6a1b9a;
            --success: #4caf50;
            --danger: #f44336;
            --warning: #ff9800;
            --info: #2196f3;
        }
        
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            margin: 0;
            padding: 0;
            background-color: #f5f5f5;
        }
        
        .header {
            background: linear-gradient(135deg, var(--primary) 0%, #9c27b0 100%);
            color: white;
            padding: 2rem;
            text-align: center;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
        
        .container {
            max-width: 1200px;
            margin: 0 auto;
            padding: 2rem;
        }
        
        .summary-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
            gap: 1rem;
            margin-bottom: 2rem;
        }
        
        .summary-card {
            background: white;
            border-radius: 8px;
            padding: 1.5rem;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            text-align: center;
        }
        
        .metric-value {
            font-size: 2.5rem;
            font-weight: bold;
            margin: 0.5rem 0;
        }
        
        .metric-label {
            color: #666;
            font-size: 0.9rem;
        }
        
        .test-results {
            background: white;
            border-radius: 8px;
            padding: 1.5rem;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            margin-bottom: 2rem;
        }
        
        .test-suite {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 1rem;
            border-bottom: 1px solid #eee;
        }
        
        .test-suite:last-child {
            border-bottom: none;
        }
        
        .status-badge {
            padding: 0.25rem 0.75rem;
            border-radius: 20px;
            font-size: 0.8rem;
            font-weight: bold;
        }
        
        .status-passed {
            background-color: var(--success);
            color: white;
        }
        
        .status-failed {
            background-color: var(--danger);
            color: white;
        }
        
        .progress-bar {
            width: 100%;
            height: 20px;
            background-color: #e0e0e0;
            border-radius: 10px;
            overflow: hidden;
            margin: 1rem 0;
        }
        
        .progress-fill {
            height: 100%;
            background-color: var(--success);
            transition: width 0.3s ease;
        }
        
        .charts {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 2rem;
            margin-top: 2rem;
        }
        
        .chart-container {
            background: white;
            border-radius: 8px;
            padding: 1.5rem;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
        
        table {
            width: 100%;
            border-collapse: collapse;
            margin-top: 1rem;
        }
        
        th, td {
            padding: 0.75rem;
            text-align: left;
            border-bottom: 1px solid #eee;
        }
        
        th {
            background-color: #f5f5f5;
            font-weight: 600;
        }
        
        .footer {
            text-align: center;
            padding: 2rem;
            color: #666;
        }
    </style>
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
</head>
<body>
    <div class="header">
        <h1>🧪 ReskFlow Test Report</h1>
        <p>Generated on: TIMESTAMP_PLACEHOLDER</p>
    </div>
    
    <div class="container">
        <div class="summary-grid">
            <div class="summary-card">
                <div class="metric-label">Total Tests</div>
                <div class="metric-value">TOTAL_TESTS</div>
            </div>
            <div class="summary-card">
                <div class="metric-label">Pass Rate</div>
                <div class="metric-value" style="color: var(--success)">PASS_RATE%</div>
            </div>
            <div class="summary-card">
                <div class="metric-label">Coverage</div>
                <div class="metric-value" style="color: var(--info)">COVERAGE%</div>
            </div>
            <div class="summary-card">
                <div class="metric-label">Duration</div>
                <div class="metric-value">DURATION</div>
            </div>
        </div>
        
        <div class="test-results">
            <h2>Test Suite Results</h2>
            TEST_SUITE_RESULTS
        </div>
        
        <div class="charts">
            <div class="chart-container">
                <h3>Test Distribution</h3>
                <canvas id="distributionChart"></canvas>
            </div>
            <div class="chart-container">
                <h3>Execution Time</h3>
                <canvas id="executionChart"></canvas>
            </div>
        </div>
        
        <div class="test-results">
            <h2>Detailed Metrics</h2>
            <table>
                <thead>
                    <tr>
                        <th>Metric</th>
                        <th>Value</th>
                        <th>Target</th>
                        <th>Status</th>
                    </tr>
                </thead>
                <tbody>
                    DETAILED_METRICS
                </tbody>
            </table>
        </div>
    </div>
    
    <div class="footer">
        <p>ReskFlow Testing Suite v1.0 | <a href="coverage/index.html">Coverage Report</a> | <a href="performance/index.html">Performance Report</a></p>
    </div>
    
    <script>
        // Test Distribution Chart
        const distCtx = document.getElementById('distributionChart').getContext('2d');
        new Chart(distCtx, {
            type: 'doughnut',
            data: {
                labels: ['Passed', 'Failed', 'Skipped'],
                datasets: [{
                    data: [PASSED_COUNT, FAILED_COUNT, SKIPPED_COUNT],
                    backgroundColor: ['#4caf50', '#f44336', '#ff9800']
                }]
            }
        });
        
        // Execution Time Chart
        const execCtx = document.getElementById('executionChart').getContext('2d');
        new Chart(execCtx, {
            type: 'bar',
            data: {
                labels: SUITE_LABELS,
                datasets: [{
                    label: 'Execution Time (seconds)',
                    data: SUITE_TIMES,
                    backgroundColor: '#2196f3'
                }]
            },
            options: {
                scales: {
                    y: {
                        beginAtZero: true
                    }
                }
            }
        });
    </script>
</body>
</html>
EOF
    
    # Calculate metrics
    local total_tests=0
    local passed_tests=0
    local failed_tests=0
    local total_duration=0
    
    for suite in "${!TEST_STATUS[@]}"; do
        total_tests=$((total_tests + 1))
        if [[ "${TEST_STATUS[$suite]}" == "PASSED" ]]; then
            passed_tests=$((passed_tests + 1))
        else
            failed_tests=$((failed_tests + 1))
        fi
        total_duration=$((total_duration + ${TEST_DURATION[$suite]:-0}))
    done
    
    local pass_rate=0
    if [[ $total_tests -gt 0 ]]; then
        pass_rate=$((passed_tests * 100 / total_tests))
    fi
    
    # Generate suite results HTML
    local suite_results=""
    for suite in unit integration contract e2e performance security chaos; do
        if [[ -n "${TEST_STATUS[$suite]}" ]]; then
            local status_class="status-${TEST_STATUS[$suite],,}"
            suite_results+="<div class='test-suite'>"
            suite_results+="<div><strong>${suite^} Tests</strong></div>"
            suite_results+="<div><span class='status-badge ${status_class}'>${TEST_STATUS[$suite]}</span>"
            suite_results+=" <span>${TEST_DURATION[$suite]}s</span></div>"
            suite_results+="</div>"
        fi
    done
    
    # Replace placeholders
    sed -i "s/TIMESTAMP_PLACEHOLDER/$(date)/g" "${REPORT_DIR}/index.html"
    sed -i "s/TOTAL_TESTS/${total_tests}/g" "${REPORT_DIR}/index.html"
    sed -i "s/PASS_RATE/${pass_rate}/g" "${REPORT_DIR}/index.html"
    sed -i "s/PASSED_COUNT/${passed_tests}/g" "${REPORT_DIR}/index.html"
    sed -i "s/FAILED_COUNT/${failed_tests}/g" "${REPORT_DIR}/index.html"
    sed -i "s/SKIPPED_COUNT/0/g" "${REPORT_DIR}/index.html"
    sed -i "s/DURATION/${total_duration}s/g" "${REPORT_DIR}/index.html"
    sed -i "s|TEST_SUITE_RESULTS|${suite_results}|g" "${REPORT_DIR}/index.html"
    
    echo -e "${GREEN}✓ Test report generated: ${REPORT_DIR}/index.html${NC}"
}

# Main execution
main() {
    check_prerequisites
    
    echo -e "${CYAN}Starting Test Execution${NC}"
    echo "═══════════════════════════════════════════════"
    echo ""
    
    # Run test suites
    if [[ "$PARALLEL" == "true" ]]; then
        # Run tests in parallel
        run_test_suite "unit" "npm run test:unit:coverage" &
        run_test_suite "integration" "npm run test:integration" &
        wait
        
        run_test_suite "contract" "npm run test:contract" &
        run_test_suite "e2e" "cd testing/e2e && ./run-e2e-tests.sh all" &
        wait
        
        run_test_suite "performance" "cd testing/performance && ./run-performance-tests.sh" &
        run_test_suite "security" "cd testing/security && ./run-security-tests.sh" &
        wait
        
        # Chaos tests run last and separately
        if [[ "${RUN_CHAOS:-false}" == "true" ]]; then
            run_test_suite "chaos" "cd testing/chaos && ./run-chaos-tests.sh all"
        else
            echo -e "${BLUE}⏭️  Chaos Tests (skipped - set RUN_CHAOS=true to enable)${NC}"
        fi
    else
        # Run tests sequentially
        run_test_suite "unit" "npm run test:unit:coverage"
        run_test_suite "integration" "npm run test:integration"
        run_test_suite "contract" "npm run test:contract"
        run_test_suite "e2e" "cd testing/e2e && ./run-e2e-tests.sh all"
        run_test_suite "performance" "cd testing/performance && ./run-performance-tests.sh"
        run_test_suite "security" "cd testing/security && ./run-security-tests.sh"
        
        if [[ "${RUN_CHAOS:-false}" == "true" ]]; then
            run_test_suite "chaos" "cd testing/chaos && ./run-chaos-tests.sh all"
        fi
    fi
    
    # Copy coverage reports
    if [[ -d "coverage" ]]; then
        cp -r coverage/* "${REPORT_DIR}/coverage/"
    fi
    
    # Generate final report
    echo ""
    echo -e "${CYAN}Test Execution Summary${NC}"
    echo "═══════════════════════════════════════════════"
    
    generate_html_report
    
    # Display summary
    echo ""
    echo -e "${CYAN}Test Results:${NC}"
    for suite in "${!TEST_STATUS[@]}"; do
        printf "  %-15s: %s (%ss)\n" "${suite^}" "${TEST_STATUS[$suite]}" "${TEST_DURATION[$suite]}"
    done
    
    # Calculate total time
    local total_end_time=$(date +%s)
    local total_execution_time=$((total_end_time - TOTAL_START_TIME))
    
    echo ""
    echo -e "${CYAN}Total Execution Time: ${total_execution_time}s${NC}"
    echo ""
    
    # Determine exit status
    local exit_code=0
    for status in "${TEST_STATUS[@]}"; do
        if [[ "$status" == "FAILED" ]]; then
            exit_code=1
            break
        fi
    done
    
    if [[ $exit_code -eq 0 ]]; then
        echo -e "${GREEN}✅ All tests passed!${NC}"
    else
        echo -e "${RED}❌ Some tests failed!${NC}"
    fi
    
    echo ""
    echo "📊 Full report available at: ${REPORT_DIR}/index.html"
    
    # Open report if on desktop
    if command -v xdg-open &> /dev/null; then
        xdg-open "${REPORT_DIR}/index.html" 2>/dev/null &
    elif command -v open &> /dev/null; then
        open "${REPORT_DIR}/index.html" 2>/dev/null &
    fi
    
    exit $exit_code
}

# Handle arguments
case "${1:-all}" in
    "unit")
        run_test_suite "unit" "npm run test:unit:coverage"
        ;;
    "integration")
        run_test_suite "integration" "npm run test:integration"
        ;;
    "contract")
        run_test_suite "contract" "npm run test:contract"
        ;;
    "e2e")
        run_test_suite "e2e" "cd testing/e2e && ./run-e2e-tests.sh all"
        ;;
    "performance")
        run_test_suite "performance" "cd testing/performance && ./run-performance-tests.sh"
        ;;
    "security")
        run_test_suite "security" "cd testing/security && ./run-security-tests.sh"
        ;;
    "chaos")
        run_test_suite "chaos" "cd testing/chaos && ./run-chaos-tests.sh all"
        ;;
    "all")
        main
        ;;
    "help"|*)
        echo "Usage: $0 [test-suite|all]"
        echo ""
        echo "Test Suites:"
        echo "  unit         Run unit tests"
        echo "  integration  Run integration tests"
        echo "  contract     Run contract tests"
        echo "  e2e          Run end-to-end tests"
        echo "  performance  Run performance tests"
        echo "  security     Run security tests"
        echo "  chaos        Run chaos engineering tests"
        echo "  all          Run all test suites (default)"
        echo ""
        echo "Environment Variables:"
        echo "  PARALLEL=true     Run tests in parallel (default: true)"
        echo "  FAIL_FAST=true    Stop on first failure (default: false)"
        echo "  RUN_CHAOS=true    Include chaos tests (default: false)"
        exit 0
        ;;
esac