# ReskFlow Ubuntu Quick Start Guide

## Minimal System Setup for Testing and Development

This guide helps you set up a complete ReskFlow environment on a single Ubuntu machine with minimal resources (1 CPU, 1GB RAM). Perfect for testing, development, or demonstration purposes.

---

## Table of Contents

1. [System Requirements](#system-requirements)
2. [Prerequisites Installation](#prerequisites-installation)
3. [Database Setup](#database-setup)
4. [ReskFlow Installation](#reskflow-installation)
5. [Configuration](#configuration)
6. [Starting the Platform](#starting-the-platform)
7. [Accessing Different Roles](#accessing-different-roles)
8. [Testing Workflows](#testing-workflows)
9. [Troubleshooting](#troubleshooting)

---

## System Requirements

### Minimum Requirements
- Ubuntu 20.04 LTS or newer (Server or Desktop)
- 1 CPU core
- 1GB RAM (2GB recommended)
- 10GB free disk space
- Internet connection for package downloads

### Network Requirements
- Port 3000 (Frontend)
- Port 4000 (API Gateway)
- Port 5432 (PostgreSQL)
- Port 6379 (Redis)
- Port 9200 (Elasticsearch)

---

## Prerequisites Installation

### Step 1: Update System
```bash
sudo apt update && sudo apt upgrade -y
```

### Step 2: Install Node.js 18.x
```bash
# Install Node.js repository
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -

# Install Node.js
sudo apt install -y nodejs

# Verify installation
node --version  # Should show v18.x.x
npm --version   # Should show 9.x.x
```

### Step 3: Install Git
```bash
sudo apt install -y git
```

### Step 4: Install PostgreSQL
```bash
# Install PostgreSQL
sudo apt install -y postgresql postgresql-contrib

# Start and enable PostgreSQL
sudo systemctl start postgresql
sudo systemctl enable postgresql

# Set password for postgres user
sudo -u postgres psql -c "ALTER USER postgres PASSWORD 'reskflow123';"
```

### Step 5: Install Redis
```bash
# Install Redis
sudo apt install -y redis-server

# Configure Redis for background saves
sudo sed -i 's/supervised no/supervised systemd/g' /etc/redis/redis.conf

# Start and enable Redis
sudo systemctl restart redis
sudo systemctl enable redis
```

### Step 6: Install Elasticsearch (Lightweight Setup)
```bash
# Install Java (required for Elasticsearch)
sudo apt install -y openjdk-11-jre-headless

# Download and install Elasticsearch 7.x
wget -qO - https://artifacts.elastic.co/GPG-KEY-elasticsearch | sudo apt-key add -
echo "deb https://artifacts.elastic.co/packages/7.x/apt stable main" | sudo tee /etc/apt/sources.list.d/elastic-7.x.list
sudo apt update && sudo apt install -y elasticsearch

# Configure Elasticsearch for minimal memory usage
sudo tee -a /etc/elasticsearch/jvm.options.d/heap.options <<EOF
-Xms256m
-Xmx256m
EOF

# Start and enable Elasticsearch
sudo systemctl start elasticsearch
sudo systemctl enable elasticsearch
```

### Step 7: Install nginx (Optional but Recommended)
```bash
sudo apt install -y nginx
```

---

## Database Setup

### Create ReskFlow Database
```bash
# Create database
sudo -u postgres createdb reskflow

# Create application user
sudo -u postgres psql <<EOF
CREATE USER reskflow WITH PASSWORD 'reskflow123';
GRANT ALL PRIVILEGES ON DATABASE reskflow TO reskflow;
EOF
```

---

## ReskFlow Installation

### Step 1: Clone Repository
```bash
# Create application directory
sudo mkdir -p /opt/reskflow
sudo chown $USER:$USER /opt/reskflow
cd /opt/reskflow

# Clone the repository
git clone https://github.com/Sean-Khorasani/ReskFlow.git .
```

### Step 2: Install Dependencies
```bash
# Install root dependencies
npm install

# Install backend dependencies
cd backend
npm install

# Install frontend dependencies
cd ../frontend
npm install

# Return to root
cd ..
```

### Step 3: Environment Configuration
```bash
# Create environment file
cat > .env <<EOF
# Database
DATABASE_URL=postgresql://reskflow:reskflow123@localhost:5432/reskflow

# Redis
REDIS_URL=redis://localhost:6379

# Elasticsearch
ELASTICSEARCH_URL=http://localhost:9200

# JWT Secret
JWT_SECRET=your-super-secret-jwt-key-change-this

# API URLs
API_URL=http://localhost:4000
FRONTEND_URL=http://localhost:3000

# Admin credentials
ADMIN_EMAIL=admin@localhost
ADMIN_PASSWORD=Admin123!

# Development mode
NODE_ENV=development
EOF
```

---

## Configuration

### Step 1: Database Migrations
```bash
# Run database migrations
cd backend
npx prisma migrate deploy
npx prisma generate

# Seed initial data
npm run seed
```

### Step 2: Build Applications
```bash
# Build backend services
npm run build

# Build frontend applications
cd ../frontend
npm run build
```

### Step 3: Configure nginx (Optional)
```bash
# Create nginx configuration
sudo tee /etc/nginx/sites-available/reskflow <<EOF
server {
    listen 80;
    server_name localhost;

    # Frontend
    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_cache_bypass \$http_upgrade;
    }

    # API
    location /api {
        proxy_pass http://localhost:4000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_cache_bypass \$http_upgrade;
    }
}
EOF

# Enable site
sudo ln -s /etc/nginx/sites-available/reskflow /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

---

## Starting the Platform

### Option 1: Development Mode (Recommended for Testing)
```bash
# Terminal 1: Start backend services
cd /opt/reskflow/backend
npm run dev

# Terminal 2: Start frontend
cd /opt/reskflow/frontend
npm run dev
```

### Option 2: Production Mode
```bash
# Create systemd service for backend
sudo tee /etc/systemd/system/reskflow-backend.service <<EOF
[Unit]
Description=ReskFlow Backend
After=network.target

[Service]
Type=simple
User=$USER
WorkingDirectory=/opt/reskflow/backend
ExecStart=/usr/bin/node dist/index.js
Restart=on-failure
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOF

# Create systemd service for frontend
sudo tee /etc/systemd/system/reskflow-frontend.service <<EOF
[Unit]
Description=ReskFlow Frontend
After=network.target

[Service]
Type=simple
User=$USER
WorkingDirectory=/opt/reskflow/frontend
ExecStart=/usr/bin/npm start
Restart=on-failure
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOF

# Enable and start services
sudo systemctl daemon-reload
sudo systemctl enable reskflow-backend reskflow-frontend
sudo systemctl start reskflow-backend reskflow-frontend
```

---

## Accessing Different Roles

> ⚠️ **Important Note**: The platform is in early development. Not all features are fully implemented. See [Implementation Status](IMPLEMENTATION_STATUS.md) for details.

### 1. Admin Portal ✅ (Working)
- **URL**: http://localhost:3000/admin
- **Default Login**: 
  - Email: admin@localhost
  - Password: Admin123!
- **Working Features**:
  - Dashboard with system metrics
  - Real-time statistics
  - Revenue charts
  - Platform monitoring

### 2. Customer Web App ❌ (Not Implemented)
- **Status**: Not yet implemented
- **Alternative**: Customer mobile app has basic home screen only
- **Note**: Cannot place orders in current version

### 3. Merchant Portal ✅ (Partially Working)
- **URL**: http://localhost:3000/merchant
- **Status**: Basic order management works
- **Working Features**:
  - View orders
  - Change order status
  - Sound alerts
- **Missing**: Product management, analytics

### 4. Driver App ⚠️ (Minimal Implementation)
- **URL**: Mobile app only (React Native)
- **Working Features**:
  - Home screen
  - Online/offline toggle
  - View statistics
- **Missing**: Cannot accept or complete deliveries

---

## Testing Workflows

### ⚠️ Current Limitations

Due to incomplete implementation, a full end-to-end order flow is **not currently possible**. Here's what you can test:

#### What Works:
1. **Admin Dashboard**: View statistics and monitoring
2. **Merchant Dashboard**: View and manage order status (if orders exist in database)
3. **Mobile Home Screens**: View basic UI for customer and driver apps

#### What Doesn't Work:
1. **Customer Cannot**: Browse products, add to cart, or place orders
2. **Driver Cannot**: Accept deliveries or complete delivery flow
3. **No Integration**: Orders don't flow between customer → merchant → driver

### Demo Data Setup

To see the dashboards with data, you can manually insert test data into the database:

### Quick Test Script
```bash
# Create test data script
cat > /opt/reskflow/test-data.sh <<'EOF'
#!/bin/bash

# Function to make API calls
api_call() {
    curl -X POST http://localhost:4000/api/$1 \
         -H "Content-Type: application/json" \
         -d "$2"
}

# Create test merchant
MERCHANT_DATA='{
  "name": "Test Restaurant",
  "email": "merchant@test.com",
  "password": "Test123!",
  "address": "123 Test St",
  "cuisine": "Italian"
}'

echo "Creating test merchant..."
api_call "merchants/register" "$MERCHANT_DATA"

# Create test driver
DRIVER_DATA='{
  "name": "Test Driver",
  "email": "driver@test.com",
  "password": "Test123!",
  "vehicle": "Car",
  "license": "TEST123"
}'

echo "Creating test driver..."
api_call "drivers/register" "$DRIVER_DATA"

# Create test products
PRODUCT_DATA='{
  "merchantId": "1",
  "name": "Pizza Margherita",
  "price": 12.99,
  "description": "Classic Italian pizza",
  "category": "Main Course"
}'

echo "Creating test product..."
api_call "products" "$PRODUCT_DATA"

echo "Test data created successfully!"
echo "Merchant login: merchant@test.com / Test123!"
echo "Driver login: driver@test.com / Test123!"
EOF

chmod +x /opt/reskflow/test-data.sh
```

---

## Troubleshooting

### Common Issues and Solutions

#### 1. Port Already in Use
```bash
# Check what's using the port
sudo lsof -i :3000

# Kill the process
sudo kill -9 <PID>
```

#### 2. Database Connection Failed
```bash
# Check PostgreSQL status
sudo systemctl status postgresql

# Check connection
psql -U reskflow -d reskflow -h localhost

# Reset database
cd /opt/reskflow/backend
npx prisma migrate reset
```

#### 3. Elasticsearch Not Starting
```bash
# Check Elasticsearch logs
sudo journalctl -u elasticsearch

# Increase memory if needed
sudo sysctl -w vm.max_map_count=262144
```

#### 4. Redis Connection Issues
```bash
# Check Redis status
redis-cli ping  # Should return PONG

# Restart Redis
sudo systemctl restart redis
```

### Performance Optimization for Low Memory

#### 1. Reduce Node.js Memory
```bash
# Add to .env
NODE_OPTIONS="--max-old-space-size=512"
```

#### 2. Optimize PostgreSQL
```bash
# Edit PostgreSQL config
sudo nano /etc/postgresql/*/main/postgresql.conf

# Add these settings:
shared_buffers = 128MB
work_mem = 1MB
maintenance_work_mem = 16MB
```

#### 3. Disable Unnecessary Services
```bash
# For testing, you can run only essential services
# Disable analytics service
# Disable monitoring service
```

### Monitoring System Resources
```bash
# Install htop for monitoring
sudo apt install -y htop

# Monitor in real-time
htop

# Check memory usage
free -h

# Check disk usage
df -h
```

---

## Security Notes

**⚠️ Important**: This setup is for development/testing only. For production:

1. Change all default passwords
2. Use environment-specific secrets
3. Enable HTTPS with proper certificates
4. Configure firewall rules
5. Set up proper backup procedures
6. Enable authentication for Elasticsearch and Redis
7. Use production-grade database configurations

---

## Next Steps

1. **Explore Features**: Try all user roles and workflows
2. **Customize**: Modify configurations for your needs
3. **Develop**: Use this setup for development and testing
4. **Scale**: When ready, deploy to cloud infrastructure

For more information and updates:
- Documentation: `/docs/`
- Support: shahin@resket.ca

---

*This guide is optimized for minimal resource usage. For production deployments, refer to the full deployment guide.*