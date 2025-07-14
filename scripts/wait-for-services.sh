#!/bin/bash

# wait-for-services.sh
# Script to wait for all services to be ready before running tests

# Don't exit on error
set +e

echo "Waiting for services to be ready..."

# Maximum wait time (60 seconds)
MAX_WAIT=60
WAITED=0

# Function to check if a service is ready
check_service() {
    local service_name=$1
    local url=$2
    local max_attempts=30
    local attempt=0
    
    echo -n "Checking $service_name..."
    
    while [ $attempt -lt $max_attempts ]; do
        if command -v curl >/dev/null 2>&1 && curl -s -o /dev/null -w "%{http_code}" "$url/health" 2>/dev/null | grep -q "200"; then
            echo " Ready!"
            return 0
        fi
        
        attempt=$((attempt + 1))
        echo -n "."
        sleep 1
    done
    
    echo " Not available (skipping)"
    return 0  # Don't fail, just continue
}

# Check PostgreSQL with timeout
echo -n "Checking PostgreSQL..."
attempt=0
while [ $attempt -lt 10 ]; do
    if command -v pg_isready >/dev/null 2>&1 && pg_isready -h localhost -p 5432 -q 2>/dev/null; then
        echo " Ready!"
        break
    fi
    attempt=$((attempt + 1))
    echo -n "."
    sleep 1
done
if [ $attempt -eq 10 ]; then
    echo " Not available (skipping)"
fi

# Check Redis with timeout
echo -n "Checking Redis..."
attempt=0
while [ $attempt -lt 10 ]; do
    if command -v redis-cli >/dev/null 2>&1 && redis-cli -h localhost ping > /dev/null 2>&1; then
        echo " Ready!"
        break
    fi
    attempt=$((attempt + 1))
    echo -n "."
    sleep 1
done
if [ $attempt -eq 10 ]; then
    echo " Not available (skipping)"
fi

# Check MongoDB with timeout
echo -n "Checking MongoDB..."
attempt=0
while [ $attempt -lt 10 ]; do
    if command -v mongosh >/dev/null 2>&1 && mongosh --host localhost --eval "db.adminCommand('ping')" > /dev/null 2>&1; then
        echo " Ready!"
        break
    elif command -v mongo >/dev/null 2>&1 && mongo --host localhost --eval "db.adminCommand('ping')" > /dev/null 2>&1; then
        echo " Ready!"
        break
    fi
    attempt=$((attempt + 1))
    echo -n "."
    sleep 1
done
if [ $attempt -eq 10 ]; then
    echo " Not available (skipping)"
fi

# Only check services if we're in a full environment
if [ -f "docker-compose.yml" ] && command -v docker >/dev/null 2>&1 && docker ps >/dev/null 2>&1; then
    # Check API Gateway
    check_service "API Gateway" "http://localhost:3000"
    
    # Check core services
    check_service "User Service" "http://localhost:3001"
    check_service "Payment Service" "http://localhost:3002"
    check_service "Order Service" "http://localhost:3003"
    check_service "Delivery Service" "http://localhost:3004"
else
    echo "Docker not running or not in full environment - skipping service checks"
fi

echo "Service check completed!"
exit 0  # Always exit successfully