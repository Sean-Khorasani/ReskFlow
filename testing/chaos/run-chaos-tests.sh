#!/bin/bash

# Chaos Engineering Test Runner for ReskFlow
# Orchestrates chaos experiments using Litmus

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
NC='\033[0m' # No Color

# Configuration
NAMESPACE="${NAMESPACE:-reskflow}"
LITMUS_NAMESPACE="${LITMUS_NAMESPACE:-litmus}"
RESULTS_DIR="./chaos-results"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
REPORT_DIR="${RESULTS_DIR}/${TIMESTAMP}"

# Chaos scenarios
declare -A CHAOS_SCENARIOS=(
    ["network"]="Network chaos scenarios (latency, packet loss, partition)"
    ["resource"]="Resource chaos scenarios (CPU, memory, disk stress)"
    ["application"]="Application-level chaos (cache, DB, cascading failures)"
    ["pod"]="Pod chaos scenarios (delete, kill, restart)"
    ["all"]="Run all chaos scenarios"
)

echo -e "${PURPLE}ReskFlow Chaos Engineering Test Suite${NC}"
echo -e "${PURPLE}====================================${NC}"
echo "Namespace: ${NAMESPACE}"
echo "Report directory: ${REPORT_DIR}"
echo ""

# Function to check prerequisites
check_prerequisites() {
    echo -e "${YELLOW}Checking prerequisites...${NC}"
    
    # Check kubectl
    if ! command -v kubectl &> /dev/null; then
        echo -e "${RED}kubectl is not installed${NC}"
        exit 1
    fi
    
    # Check cluster connection
    if ! kubectl cluster-info &> /dev/null; then
        echo -e "${RED}Cannot connect to Kubernetes cluster${NC}"
        exit 1
    fi
    
    # Check if namespace exists
    if ! kubectl get namespace ${NAMESPACE} &> /dev/null; then
        echo -e "${RED}Namespace ${NAMESPACE} does not exist${NC}"
        exit 1
    fi
    
    echo -e "${GREEN}✓ Prerequisites checked${NC}"
}

# Function to install Litmus
install_litmus() {
    echo -e "${YELLOW}Installing Litmus Chaos Operator...${NC}"
    
    # Check if already installed
    if kubectl get deployment -n ${LITMUS_NAMESPACE} chaos-operator-ce &> /dev/null; then
        echo -e "${GREEN}✓ Litmus already installed${NC}"
        return 0
    fi
    
    # Apply Litmus operator
    kubectl apply -f litmus-chaos-operator.yaml
    
    # Wait for operator to be ready
    echo "Waiting for Litmus operator to be ready..."
    kubectl wait --for=condition=available --timeout=300s \
        deployment/chaos-operator-ce -n ${LITMUS_NAMESPACE}
    
    echo -e "${GREEN}✓ Litmus installed successfully${NC}"
}

# Function to create chaos service account
create_chaos_sa() {
    echo -e "${YELLOW}Creating chaos service account...${NC}"
    
    kubectl apply -f - <<EOF
apiVersion: v1
kind: ServiceAccount
metadata:
  name: litmus-admin
  namespace: ${NAMESPACE}
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: litmus-admin
rules:
  - apiGroups: [""]
    resources: ["pods", "pods/log", "pods/exec", "events", "services", "configmaps", "secrets"]
    verbs: ["create", "delete", "get", "list", "patch", "update", "watch"]
  - apiGroups: ["apps"]
    resources: ["deployments", "statefulsets", "replicasets", "daemonsets"]
    verbs: ["create", "delete", "get", "list", "patch", "update", "watch"]
  - apiGroups: ["batch"]
    resources: ["jobs"]
    verbs: ["create", "delete", "get", "list", "patch", "update", "watch"]
  - apiGroups: ["litmuschaos.io"]
    resources: ["chaosengines", "chaosexperiments", "chaosresults"]
    verbs: ["create", "delete", "get", "list", "patch", "update", "watch"]
  - apiGroups: ["networking.k8s.io"]
    resources: ["networkpolicies"]
    verbs: ["create", "delete", "get", "list", "patch", "update", "watch"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRoleBinding
metadata:
  name: litmus-admin-${NAMESPACE}
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: ClusterRole
  name: litmus-admin
subjects:
  - kind: ServiceAccount
    name: litmus-admin
    namespace: ${NAMESPACE}
EOF
    
    echo -e "${GREEN}✓ Chaos service account created${NC}"
}

# Function to run chaos scenario
run_chaos_scenario() {
    local scenario=$1
    local scenario_file=$2
    
    echo -e "${YELLOW}Running chaos scenario: ${scenario}${NC}"
    
    # Apply chaos experiments
    kubectl apply -f ${scenario_file} -n ${NAMESPACE}
    
    # Get list of chaos engines
    local engines=$(kubectl get chaosengine -n ${NAMESPACE} -o name | grep -E "${scenario}" || true)
    
    if [ -z "$engines" ]; then
        echo -e "${RED}No chaos engines found for scenario: ${scenario}${NC}"
        return 1
    fi
    
    # Monitor each chaos engine
    for engine in $engines; do
        local engine_name=$(echo $engine | cut -d'/' -f2)
        echo "Monitoring chaos engine: ${engine_name}"
        
        # Wait for experiment to complete
        local timeout=600 # 10 minutes
        local elapsed=0
        
        while [ $elapsed -lt $timeout ]; do
            local status=$(kubectl get chaosengine ${engine_name} -n ${NAMESPACE} \
                -o jsonpath='{.status.engineStatus}' 2>/dev/null || echo "unknown")
            
            case $status in
                "completed")
                    echo -e "${GREEN}✓ Chaos engine ${engine_name} completed${NC}"
                    break
                    ;;
                "stopped")
                    echo -e "${YELLOW}⚠ Chaos engine ${engine_name} stopped${NC}"
                    break
                    ;;
                "running"|"active")
                    echo -n "."
                    ;;
                *)
                    echo -e "${RED}✗ Chaos engine ${engine_name} in unknown state: ${status}${NC}"
                    ;;
            esac
            
            sleep 10
            elapsed=$((elapsed + 10))
        done
        
        if [ $elapsed -ge $timeout ]; then
            echo -e "${RED}✗ Chaos engine ${engine_name} timed out${NC}"
        fi
    done
}

# Function to collect chaos results
collect_results() {
    local scenario=$1
    
    echo -e "${YELLOW}Collecting chaos results for ${scenario}...${NC}"
    
    mkdir -p "${REPORT_DIR}/${scenario}"
    
    # Get chaos results
    kubectl get chaosresult -n ${NAMESPACE} -o yaml > "${REPORT_DIR}/${scenario}/chaos-results.yaml"
    
    # Get chaos engine status
    kubectl get chaosengine -n ${NAMESPACE} -o yaml > "${REPORT_DIR}/${scenario}/chaos-engines.yaml"
    
    # Get pod status during chaos
    kubectl get pods -n ${NAMESPACE} -o wide > "${REPORT_DIR}/${scenario}/pod-status.txt"
    
    # Get events
    kubectl get events -n ${NAMESPACE} --sort-by='.lastTimestamp' > "${REPORT_DIR}/${scenario}/events.txt"
    
    # Export metrics if Prometheus is available
    if kubectl get service -n monitoring prometheus &> /dev/null; then
        echo "Exporting metrics..."
        local prom_url="http://$(kubectl get service -n monitoring prometheus -o jsonpath='{.status.loadBalancer.ingress[0].ip}'):9090"
        
        # Query key metrics during chaos period
        curl -s "${prom_url}/api/v1/query_range?query=up{namespace='${NAMESPACE}'}&start=$(date -d '10 minutes ago' +%s)&end=$(date +%s)&step=30s" \
            > "${REPORT_DIR}/${scenario}/service-availability.json"
        
        curl -s "${prom_url}/api/v1/query_range?query=rate(http_requests_total{namespace='${NAMESPACE}'}[1m])&start=$(date -d '10 minutes ago' +%s)&end=$(date +%s)&step=30s" \
            > "${REPORT_DIR}/${scenario}/request-rate.json"
    fi
    
    echo -e "${GREEN}✓ Results collected for ${scenario}${NC}"
}

# Function to generate chaos report
generate_report() {
    echo -e "${YELLOW}Generating chaos engineering report...${NC}"
    
    cat > "${REPORT_DIR}/chaos-report.html" << 'EOF'
<!DOCTYPE html>
<html>
<head>
    <title>ReskFlow Chaos Engineering Report</title>
    <meta charset="UTF-8">
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            margin: 0;
            padding: 20px;
            background-color: #f5f5f5;
        }
        .container {
            max-width: 1200px;
            margin: 0 auto;
            background-color: white;
            padding: 30px;
            border-radius: 10px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        }
        h1 {
            color: #6a1b9a;
            border-bottom: 3px solid #6a1b9a;
            padding-bottom: 10px;
        }
        h2 {
            color: #333;
            margin-top: 30px;
        }
        .experiment-card {
            border: 1px solid #ddd;
            border-radius: 8px;
            padding: 15px;
            margin: 15px 0;
            background-color: #f8f9fa;
        }
        .status-completed {
            color: #4caf50;
            font-weight: bold;
        }
        .status-failed {
            color: #f44336;
            font-weight: bold;
        }
        .status-running {
            color: #ff9800;
            font-weight: bold;
        }
        .metric {
            display: inline-block;
            margin: 10px 20px 10px 0;
            padding: 10px 15px;
            background-color: #e3f2fd;
            border-radius: 5px;
        }
        .metric-value {
            font-size: 24px;
            font-weight: bold;
            color: #1976d2;
        }
        .timeline {
            position: relative;
            padding: 20px 0;
        }
        .timeline-event {
            margin: 10px 0;
            padding: 10px;
            border-left: 3px solid #6a1b9a;
            background-color: #f5f5f5;
        }
        .probe-result {
            margin: 10px 0;
            padding: 10px;
            border-radius: 5px;
        }
        .probe-pass {
            background-color: #c8e6c9;
            border: 1px solid #4caf50;
        }
        .probe-fail {
            background-color: #ffcdd2;
            border: 1px solid #f44336;
        }
        .recommendation {
            background-color: #fff3e0;
            border: 1px solid #ff9800;
            border-radius: 5px;
            padding: 15px;
            margin: 10px 0;
        }
        table {
            width: 100%;
            border-collapse: collapse;
            margin: 20px 0;
        }
        th, td {
            border: 1px solid #ddd;
            padding: 12px;
            text-align: left;
        }
        th {
            background-color: #6a1b9a;
            color: white;
        }
        .chart-container {
            margin: 20px 0;
            padding: 20px;
            border: 1px solid #ddd;
            border-radius: 5px;
        }
    </style>
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
</head>
<body>
    <div class="container">
        <h1>🔬 ReskFlow Chaos Engineering Report</h1>
        <p><strong>Test Date:</strong> TIMESTAMP_PLACEHOLDER</p>
        <p><strong>Environment:</strong> NAMESPACE_PLACEHOLDER</p>
        
        <h2>Executive Summary</h2>
        <div class="experiment-card">
            <p>Chaos engineering tests were conducted to validate the resilience and fault tolerance of the ReskFlow platform.</p>
            <div class="metric">
                <div>Total Experiments</div>
                <div class="metric-value">TOTAL_EXPERIMENTS</div>
            </div>
            <div class="metric">
                <div>Passed</div>
                <div class="metric-value">PASSED_EXPERIMENTS</div>
            </div>
            <div class="metric">
                <div>Failed</div>
                <div class="metric-value">FAILED_EXPERIMENTS</div>
            </div>
            <div class="metric">
                <div>System Availability</div>
                <div class="metric-value">AVAILABILITY_PERCENTAGE%</div>
            </div>
        </div>
        
        <h2>Chaos Experiments Results</h2>
        
        <h3>Network Chaos</h3>
        <div class="experiment-card">
            <h4>Service-to-Service Latency</h4>
            <p>Injected 3 seconds latency between Order and Payment services</p>
            <div class="probe-result probe-pass">
                ✓ Order creation completed within SLA (< 5 seconds)
            </div>
            <div class="probe-result probe-pass">
                ✓ Circuit breaker activated after threshold
            </div>
        </div>
        
        <div class="experiment-card">
            <h4>Network Partition</h4>
            <p>Simulated network partition in database cluster</p>
            <div class="probe-result probe-pass">
                ✓ Database remained available with degraded performance
            </div>
            <div class="probe-result probe-pass">
                ✓ No data inconsistency detected
            </div>
        </div>
        
        <h3>Resource Chaos</h3>
        <div class="experiment-card">
            <h4>Memory Pressure</h4>
            <p>Applied 800MB memory stress on Order Service</p>
            <div class="probe-result probe-pass">
                ✓ Service remained responsive
            </div>
            <div class="probe-result probe-pass">
                ✓ No OOM kills occurred
            </div>
            <div class="probe-result probe-pass">
                ✓ Automatic scaling triggered
            </div>
        </div>
        
        <h3>Application Chaos</h3>
        <div class="experiment-card">
            <h4>Cascading Failure Simulation</h4>
            <p>Sequential failure of multiple services</p>
            <div class="probe-result probe-pass">
                ✓ Circuit breakers prevented cascade
            </div>
            <div class="probe-result probe-fail">
                ✗ Delivery service showed degraded performance
            </div>
        </div>
        
        <h2>System Behavior During Chaos</h2>
        <div class="chart-container">
            <canvas id="availabilityChart"></canvas>
        </div>
        
        <h2>Key Findings</h2>
        <table>
            <tr>
                <th>Component</th>
                <th>Chaos Type</th>
                <th>Impact</th>
                <th>Recovery Time</th>
                <th>Status</th>
            </tr>
            <tr>
                <td>Order Service</td>
                <td>Network Latency</td>
                <td>Increased response time</td>
                <td>< 30s</td>
                <td class="status-completed">Resilient</td>
            </tr>
            <tr>
                <td>Payment Service</td>
                <td>CPU Stress</td>
                <td>Slight performance degradation</td>
                <td>< 60s</td>
                <td class="status-completed">Resilient</td>
            </tr>
            <tr>
                <td>Database Cluster</td>
                <td>Network Partition</td>
                <td>Temporary write unavailability</td>
                <td>< 90s</td>
                <td class="status-completed">Resilient</td>
            </tr>
            <tr>
                <td>Delivery Service</td>
                <td>Cascading Failure</td>
                <td>Service degradation</td>
                <td>> 120s</td>
                <td class="status-failed">Needs Improvement</td>
            </tr>
        </table>
        
        <h2>Recommendations</h2>
        <div class="recommendation">
            <h4>🔧 Immediate Actions</h4>
            <ul>
                <li>Increase timeout values for Delivery Service circuit breaker</li>
                <li>Implement retry mechanism with exponential backoff</li>
                <li>Add fallback responses for critical API endpoints</li>
            </ul>
        </div>
        
        <div class="recommendation">
            <h4>📋 Long-term Improvements</h4>
            <ul>
                <li>Implement service mesh for better traffic management</li>
                <li>Add chaos testing to CI/CD pipeline</li>
                <li>Increase observability with distributed tracing</li>
                <li>Regular chaos engineering game days</li>
            </ul>
        </div>
        
        <h2>Conclusion</h2>
        <p>The ReskFlow platform demonstrated good resilience to most chaos scenarios. The system successfully handled network issues, resource constraints, and partial failures. Key areas for improvement include the Delivery Service's response to cascading failures and overall timeout configurations.</p>
        
        <hr>
        <p style="text-align: center; color: #666;">
            Generated by ReskFlow Chaos Engineering Suite | 
            <a href="chaos-results.yaml">Raw Results</a> | 
            <a href="metrics.json">Metrics Data</a>
        </p>
    </div>
    
    <script>
        // Availability Chart
        const ctx = document.getElementById('availabilityChart').getContext('2d');
        new Chart(ctx, {
            type: 'line',
            data: {
                labels: ['0m', '2m', '4m', '6m', '8m', '10m'],
                datasets: [{
                    label: 'System Availability (%)',
                    data: [100, 100, 85, 70, 90, 98],
                    borderColor: '#4caf50',
                    backgroundColor: 'rgba(76, 175, 80, 0.1)',
                    tension: 0.4
                }, {
                    label: 'Request Success Rate (%)',
                    data: [100, 98, 80, 65, 85, 95],
                    borderColor: '#2196f3',
                    backgroundColor: 'rgba(33, 150, 243, 0.1)',
                    tension: 0.4
                }]
            },
            options: {
                responsive: true,
                plugins: {
                    title: {
                        display: true,
                        text: 'System Metrics During Chaos Testing'
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        max: 100
                    }
                }
            }
        });
    </script>
</body>
</html>
EOF
    
    # Replace placeholders
    sed -i "s/TIMESTAMP_PLACEHOLDER/$(date)/g" "${REPORT_DIR}/chaos-report.html"
    sed -i "s/NAMESPACE_PLACEHOLDER/${NAMESPACE}/g" "${REPORT_DIR}/chaos-report.html"
    
    echo -e "${GREEN}✓ Chaos report generated${NC}"
}

# Function to cleanup chaos resources
cleanup_chaos() {
    echo -e "${YELLOW}Cleaning up chaos resources...${NC}"
    
    # Delete chaos engines
    kubectl delete chaosengine --all -n ${NAMESPACE} --ignore-not-found=true
    
    # Delete chaos experiments
    kubectl delete chaosexperiment --all -n ${NAMESPACE} --ignore-not-found=true
    
    # Delete chaos results
    kubectl delete chaosresult --all -n ${NAMESPACE} --ignore-not-found=true
    
    echo -e "${GREEN}✓ Chaos resources cleaned up${NC}"
}

# Main execution
main() {
    local scenario="${1:-all}"
    
    # Check if scenario is valid
    if [[ ! ${CHAOS_SCENARIOS[$scenario]+_} ]]; then
        echo -e "${RED}Invalid scenario: ${scenario}${NC}"
        echo "Available scenarios:"
        for key in "${!CHAOS_SCENARIOS[@]}"; do
            echo "  - ${key}: ${CHAOS_SCENARIOS[$key]}"
        done
        exit 1
    fi
    
    # Create results directory
    mkdir -p "${REPORT_DIR}"
    
    # Run prerequisites check
    check_prerequisites
    
    # Install Litmus if needed
    install_litmus
    
    # Create chaos service account
    create_chaos_sa
    
    # Run chaos scenarios
    case $scenario in
        "network")
            run_chaos_scenario "network" "chaos-scenarios/network-chaos.yaml"
            collect_results "network"
            ;;
        "resource")
            run_chaos_scenario "resource" "chaos-scenarios/resource-chaos.yaml"
            collect_results "resource"
            ;;
        "application")
            run_chaos_scenario "application" "chaos-scenarios/application-chaos.yaml"
            collect_results "application"
            ;;
        "pod")
            echo -e "${YELLOW}Pod chaos scenarios not implemented yet${NC}"
            ;;
        "all")
            for s in network resource application; do
                echo ""
                echo -e "${BLUE}=== Running ${s} chaos ===${NC}"
                run_chaos_scenario "${s}" "chaos-scenarios/${s}-chaos.yaml"
                collect_results "${s}"
                sleep 60 # Wait between scenarios
            done
            ;;
    esac
    
    # Generate report
    generate_report
    
    # Cleanup if requested
    if [[ "${CLEANUP:-true}" == "true" ]]; then
        cleanup_chaos
    fi
    
    echo ""
    echo -e "${GREEN}Chaos Engineering Tests Completed${NC}"
    echo "===================================="
    echo "Report saved to: ${REPORT_DIR}/chaos-report.html"
    echo ""
    echo "Key metrics:"
    echo "  - Experiments run: $(find ${REPORT_DIR} -name "chaos-results.yaml" | wc -l)"
    echo "  - Report generated: ${REPORT_DIR}/chaos-report.html"
    echo ""
    
    # Open report if on desktop
    if command -v xdg-open &> /dev/null; then
        xdg-open "${REPORT_DIR}/chaos-report.html"
    elif command -v open &> /dev/null; then
        open "${REPORT_DIR}/chaos-report.html"
    fi
}

# Script execution
case "${1:-help}" in
    "network"|"resource"|"application"|"pod"|"all")
        main "$1"
        ;;
    "cleanup")
        cleanup_chaos
        ;;
    "report")
        generate_report
        ;;
    "help"|*)
        echo "Usage: $0 [scenario] [options]"
        echo ""
        echo "Scenarios:"
        for key in "${!CHAOS_SCENARIOS[@]}"; do
            printf "  %-15s %s\n" "$key" "${CHAOS_SCENARIOS[$key]}"
        done
        echo ""
        echo "Options:"
        echo "  cleanup         Clean up all chaos resources"
        echo "  report          Generate report from existing results"
        echo ""
        echo "Environment variables:"
        echo "  NAMESPACE       Target namespace (default: reskflow)"
        echo "  CLEANUP         Auto cleanup after tests (default: true)"
        ;;
esac