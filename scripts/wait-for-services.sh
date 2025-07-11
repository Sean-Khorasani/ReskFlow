#!/bin/bash

# wait-for-services.sh
# Script to wait for all services to be ready before running tests

set -e

echo "Waiting for services to be ready..."

# Function to check if a service is ready
check_service() {
    local service_name=$1
    local url=$2
    local max_attempts=60
    local attempt=0
    
    echo -n "Checking $service_name..."
    
    while [ $attempt -lt $max_attempts ]; do
        if curl -s -o /dev/null -w "%{http_code}" "$url/health" | grep -q "200"; then
            echo " Ready!"
            return 0
        fi
        
        attempt=$((attempt + 1))
        echo -n "."
        sleep 2
    done
    
    echo " Failed!"
    return 1
}

# Check PostgreSQL
echo -n "Checking PostgreSQL..."
while ! pg_isready -h localhost -p 5432 -q; do
    echo -n "."
    sleep 2
done
echo " Ready!"

# Check Redis
echo -n "Checking Redis..."
while ! redis-cli -h localhost ping > /dev/null 2>&1; do
    echo -n "."
    sleep 2
done
echo " Ready!"

# Check MongoDB
echo -n "Checking MongoDB..."
while ! mongosh --host localhost --eval "db.adminCommand('ping')" > /dev/null 2>&1; do
    echo -n "."
    sleep 2
done
echo " Ready!"

# Check API Gateway
check_service "API Gateway" "http://localhost:3000"

# Check core services
check_service "User Service" "http://localhost:3001"
check_service "Payment Service" "http://localhost:3002"
check_service "Order Service" "http://localhost:3003"
check_service "Delivery Service" "http://localhost:3004"

echo "All services are ready!"