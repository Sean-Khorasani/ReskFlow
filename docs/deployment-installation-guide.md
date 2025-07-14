# Deployment and Installation Guide

## ReskFlow

### Version 1.0.0
### Last Updated: July 2025

---

## Table of Contents

1. [System Requirements](#system-requirements)
2. [Pre-Installation Checklist](#pre-installation-checklist)
3. [Installation Methods](#installation-methods)
4. [Docker Installation](#docker-installation)
5. [Kubernetes Deployment](#kubernetes-deployment)
6. [Manual Installation](#manual-installation)
7. [Configuration](#configuration)
8. [Database Setup](#database-setup)
9. [Service Dependencies](#service-dependencies)
10. [SSL/TLS Configuration](#ssltls-configuration)
11. [Monitoring Setup](#monitoring-setup)
12. [Backup Configuration](#backup-configuration)
13. [Maintenance Procedures](#maintenance-procedures)
14. [Troubleshooting](#troubleshooting)
15. [Health Checks](#health-checks)

---

## System Requirements

### Minimum Hardware Requirements

#### Development Environment
- **CPU**: 4 cores (2.4GHz+)
- **RAM**: 8GB
- **Storage**: 50GB SSD
- **Network**: 100 Mbps

#### Production Environment
- **CPU**: 16 cores (3.0GHz+)
- **RAM**: 32GB
- **Storage**: 500GB SSD (NVMe preferred)
- **Network**: 1 Gbps

### Software Requirements

- **Operating System**: Ubuntu 20.04+ / CentOS 8+ / Amazon Linux 2
- **Node.js**: 18.x LTS or higher
- **Docker**: 24.0+ with Docker Compose 2.20+
- **Kubernetes**: 1.28+ (for K8s deployment)
- **PostgreSQL**: 16+
- **Redis**: 7.0+
- **MongoDB**: 7.0+
- **Elasticsearch**: 8.11+

### Network Requirements

- **Ports Required**:
  - 80/443: HTTP/HTTPS
  - 5432: PostgreSQL
  - 6379: Redis
  - 27017: MongoDB
  - 9200: Elasticsearch
  - 3000-3030: Microservices
  - 9090: Prometheus
  - 3100: Grafana

---

## Pre-Installation Checklist

### 1. System Preparation

```bash
# Update system packages
sudo apt update && sudo apt upgrade -y

# Install essential tools
sudo apt install -y \
  curl \
  wget \
  git \
  build-essential \
  software-properties-common \
  apt-transport-https \
  ca-certificates \
  gnupg \
  lsb-release
```

### 2. Create Deployment User

```bash
# Create deployment user
sudo useradd -m -s /bin/bash deploy
sudo usermod -aG sudo deploy

# Set up SSH keys
sudo -u deploy ssh-keygen -t rsa -b 4096
```

### 3. Directory Structure

```bash
# Create directory structure
sudo mkdir -p /opt/ReskFlow/{services,data,logs,backups,configs}
sudo chown -R deploy:deploy /opt/ReskFlow
```

### 4. Environment Variables

Create `/opt/ReskFlow/.env`:

```bash
# Platform Configuration
NODE_ENV=production
PLATFORM_NAME=ReskFlow
PLATFORM_VERSION=1.0.0

# Database Configuration
DATABASE_URL=postgresql://reskflow:secure_password@localhost:5432/reskflow
REDIS_URL=redis://localhost:6379
MONGODB_URL=mongodb://reskflow:secure_password@localhost:27017/reskflow
ELASTICSEARCH_URL=http://localhost:9200

# Security
JWT_SECRET=your_jwt_secret_here
ENCRYPTION_KEY=your_encryption_key_here

# Blockchain
POLYGON_RPC_URL=https://polygon-rpc.com
WALLET_PRIVATE_KEY=your_wallet_private_key

# External Services
STRIPE_API_KEY=your_stripe_key
TWILIO_ACCOUNT_SID=your_twilio_sid
TWILIO_AUTH_TOKEN=your_twilio_token
SENDGRID_API_KEY=your_sendgrid_key

# Monitoring
PROMETHEUS_URL=http://localhost:9090
GRAFANA_URL=http://localhost:3100
```

---

## Installation Methods

### Quick Start (Development)

```bash
# Clone repository
git clone https://github.com/your-org/ReskFlow.git
cd ReskFlow

# Install dependencies
npm install

# Start with Docker Compose
docker-compose up -d

# Run migrations
npm run migrate

# Seed database (optional)
npm run seed

# Start services
npm run dev
```

---

## Docker Installation

### 1. Install Docker

```bash
# Add Docker's official GPG key
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /usr/share/keyrings/docker-archive-keyring.gpg

# Add Docker repository
echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/docker-archive-keyring.gpg] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

# Install Docker
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin

# Add user to docker group
sudo usermod -aG docker $USER

# Start Docker
sudo systemctl enable docker
sudo systemctl start docker
```

### 2. Docker Compose Setup

Create `docker-compose.prod.yml`:

```yaml
version: '3.8'

services:
  # API Gateway
  gateway:
    image: ReskFlow/gateway:latest
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
    env_file:
      - .env
    depends_on:
      - postgres
      - redis
    restart: unless-stopped
    networks:
      - reskflow-network
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/health"]
      interval: 30s
      timeout: 10s
      retries: 3

  # User Service
  user-service:
    image: ReskFlow/user-service:latest
    ports:
      - "3001:3001"
    environment:
      - NODE_ENV=production
    env_file:
      - .env
    depends_on:
      - postgres
      - redis
    restart: unless-stopped
    networks:
      - reskflow-network

  # Payment Service
  payment-service:
    image: ReskFlow/payment-service:latest
    ports:
      - "3002:3002"
    environment:
      - NODE_ENV=production
    env_file:
      - .env
    depends_on:
      - postgres
      - redis
    restart: unless-stopped
    networks:
      - reskflow-network

  # Add all other services...

  # Databases
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: reskflow
      POSTGRES_PASSWORD: ${DB_PASSWORD}
      POSTGRES_DB: reskflow
    volumes:
      - postgres_data:/var/lib/postgresql/data
    ports:
      - "5432:5432"
    restart: unless-stopped
    networks:
      - reskflow-network

  redis:
    image: redis:7-alpine
    command: redis-server --appendonly yes --requirepass ${REDIS_PASSWORD}
    volumes:
      - redis_data:/data
    ports:
      - "6379:6379"
    restart: unless-stopped
    networks:
      - reskflow-network

  mongodb:
    image: mongo:7
    environment:
      MONGO_INITDB_ROOT_USERNAME: reskflow
      MONGO_INITDB_ROOT_PASSWORD: ${MONGO_PASSWORD}
      MONGO_INITDB_DATABASE: reskflow
    volumes:
      - mongodb_data:/data/db
    ports:
      - "27017:27017"
    restart: unless-stopped
    networks:
      - reskflow-network

  elasticsearch:
    image: docker.elastic.co/elasticsearch/elasticsearch:8.11.0
    environment:
      - discovery.type=single-node
      - xpack.security.enabled=true
      - ELASTIC_PASSWORD=${ELASTIC_PASSWORD}
    volumes:
      - elasticsearch_data:/usr/share/elasticsearch/data
    ports:
      - "9200:9200"
    restart: unless-stopped
    networks:
      - reskflow-network

  # Monitoring
  prometheus:
    image: prom/prometheus:latest
    volumes:
      - ./monitoring/prometheus.yml:/etc/prometheus/prometheus.yml
      - prometheus_data:/prometheus
    ports:
      - "9090:9090"
    restart: unless-stopped
    networks:
      - reskflow-network

  grafana:
    image: grafana/grafana:latest
    environment:
      - GF_SECURITY_ADMIN_PASSWORD=${GRAFANA_PASSWORD}
    volumes:
      - grafana_data:/var/lib/grafana
    ports:
      - "3100:3000"
    restart: unless-stopped
    networks:
      - reskflow-network

volumes:
  postgres_data:
  redis_data:
  mongodb_data:
  elasticsearch_data:
  prometheus_data:
  grafana_data:

networks:
  reskflow-network:
    driver: bridge
```

### 3. Build and Deploy

```bash
# Build all services
docker-compose -f docker-compose.prod.yml build

# Start services
docker-compose -f docker-compose.prod.yml up -d

# Check status
docker-compose -f docker-compose.prod.yml ps

# View logs
docker-compose -f docker-compose.prod.yml logs -f
```

---

## Kubernetes Deployment

### 1. Prerequisites

```bash
# Install kubectl
curl -LO "https://dl.k8s.io/release/$(curl -L -s https://dl.k8s.io/release/stable.txt)/bin/linux/amd64/kubectl"
sudo install -o root -g root -m 0755 kubectl /usr/local/bin/kubectl

# Install Helm
curl https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 | bash
```

### 2. Namespace Setup

```yaml
# namespace.yaml
apiVersion: v1
kind: Namespace
metadata:
  name: ReskFlow
  labels:
    name: ReskFlow
```

### 3. ConfigMaps and Secrets

```yaml
# configmap.yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: platform-config
  namespace: ReskFlow
data:
  NODE_ENV: "production"
  PLATFORM_NAME: "ReskFlow"
  DATABASE_HOST: "postgres-service"
  REDIS_HOST: "redis-service"
```

```bash
# Create secrets
kubectl create secret generic platform-secrets \
  --from-literal=jwt-secret=$JWT_SECRET \
  --from-literal=db-password=$DB_PASSWORD \
  --from-literal=stripe-api-key=$STRIPE_API_KEY \
  -n ReskFlow
```

### 4. Database Deployments

```yaml
# postgres-deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: postgres
  namespace: ReskFlow
spec:
  replicas: 1
  selector:
    matchLabels:
      app: postgres
  template:
    metadata:
      labels:
        app: postgres
    spec:
      containers:
      - name: postgres
        image: postgres:16-alpine
        ports:
        - containerPort: 5432
        env:
        - name: POSTGRES_USER
          value: reskflow
        - name: POSTGRES_PASSWORD
          valueFrom:
            secretKeyRef:
              name: platform-secrets
              key: db-password
        - name: POSTGRES_DB
          value: reskflow
        volumeMounts:
        - name: postgres-storage
          mountPath: /var/lib/postgresql/data
      volumes:
      - name: postgres-storage
        persistentVolumeClaim:
          claimName: postgres-pvc
---
apiVersion: v1
kind: Service
metadata:
  name: postgres-service
  namespace: ReskFlow
spec:
  selector:
    app: postgres
  ports:
  - port: 5432
    targetPort: 5432
```

### 5. Application Deployments

```yaml
# gateway-deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: gateway
  namespace: ReskFlow
spec:
  replicas: 3
  selector:
    matchLabels:
      app: gateway
  template:
    metadata:
      labels:
        app: gateway
    spec:
      containers:
      - name: gateway
        image: ReskFlow/gateway:latest
        ports:
        - containerPort: 3000
        env:
        - name: NODE_ENV
          valueFrom:
            configMapKeyRef:
              name: platform-config
              key: NODE_ENV
        - name: DATABASE_URL
          valueFrom:
            secretKeyRef:
              name: platform-secrets
              key: database-url
        livenessProbe:
          httpGet:
            path: /health
            port: 3000
          initialDelaySeconds: 30
          periodSeconds: 10
        readinessProbe:
          httpGet:
            path: /health
            port: 3000
          initialDelaySeconds: 10
          periodSeconds: 5
        resources:
          requests:
            memory: "256Mi"
            cpu: "250m"
          limits:
            memory: "512Mi"
            cpu: "500m"
---
apiVersion: v1
kind: Service
metadata:
  name: gateway-service
  namespace: ReskFlow
spec:
  type: LoadBalancer
  selector:
    app: gateway
  ports:
  - port: 80
    targetPort: 3000
```

### 6. Ingress Configuration

```yaml
# ingress.yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: platform-ingress
  namespace: ReskFlow
  annotations:
    kubernetes.io/ingress.class: nginx
    cert-manager.io/cluster-issuer: letsencrypt-prod
spec:
  tls:
  - hosts:
    - api.ReskFlow.com
    secretName: platform-tls
  rules:
  - host: api.ReskFlow.com
    http:
      paths:
      - path: /
        pathType: Prefix
        backend:
          service:
            name: gateway-service
            port:
              number: 80
```

### 7. Deploy to Kubernetes

```bash
# Apply configurations
kubectl apply -f namespace.yaml
kubectl apply -f configmap.yaml
kubectl apply -f postgres-deployment.yaml
kubectl apply -f gateway-deployment.yaml
kubectl apply -f ingress.yaml

# Check deployment status
kubectl get all -n ReskFlow

# Scale deployment
kubectl scale deployment gateway --replicas=5 -n ReskFlow
```

---

## Manual Installation

### 1. Install Node.js

```bash
# Install Node.js 18.x
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# Verify installation
node --version
npm --version
```

### 2. Install PostgreSQL

```bash
# Install PostgreSQL
sudo apt install -y postgresql postgresql-contrib

# Start PostgreSQL
sudo systemctl start postgresql
sudo systemctl enable postgresql

# Create database and user
sudo -u postgres psql <<EOF
CREATE USER reskflow WITH PASSWORD 'secure_password';
CREATE DATABASE reskflow OWNER reskflow;
GRANT ALL PRIVILEGES ON DATABASE reskflow TO reskflow;
EOF
```

### 3. Install Redis

```bash
# Install Redis
sudo apt install -y redis-server

# Configure Redis
sudo sed -i 's/supervised no/supervised systemd/g' /etc/redis/redis.conf
sudo sed -i 's/# requirepass foobared/requirepass your_redis_password/g' /etc/redis/redis.conf

# Start Redis
sudo systemctl restart redis
sudo systemctl enable redis
```

### 4. Install MongoDB

```bash
# Import MongoDB GPG key
wget -qO - https://www.mongodb.org/static/pgp/server-7.0.asc | sudo apt-key add -

# Add MongoDB repository
echo "deb [ arch=amd64,arm64 ] https://repo.mongodb.org/apt/ubuntu focal/mongodb-org/7.0 multiverse" | sudo tee /etc/apt/sources.list.d/mongodb-org-7.0.list

# Install MongoDB
sudo apt update
sudo apt install -y mongodb-org

# Start MongoDB
sudo systemctl start mongod
sudo systemctl enable mongod
```

### 5. Install Elasticsearch

```bash
# Import Elasticsearch GPG key
wget -qO - https://artifacts.elastic.co/GPG-KEY-elasticsearch | sudo gpg --dearmor -o /usr/share/keyrings/elasticsearch-keyring.gpg

# Add Elasticsearch repository
echo "deb [signed-by=/usr/share/keyrings/elasticsearch-keyring.gpg] https://artifacts.elastic.co/packages/8.x/apt stable main" | sudo tee /etc/apt/sources.list.d/elastic-8.x.list

# Install Elasticsearch
sudo apt update
sudo apt install -y elasticsearch

# Configure Elasticsearch
sudo sed -i 's/#network.host: 192.168.0.1/network.host: 0.0.0.0/g' /etc/elasticsearch/elasticsearch.yml

# Start Elasticsearch
sudo systemctl start elasticsearch
sudo systemctl enable elasticsearch
```

### 6. Deploy Application

```bash
# Clone repository
cd /opt/ReskFlow
git clone https://github.com/your-org/ReskFlow.git .

# Install dependencies
npm install

# Build services
npm run build

# Run database migrations
npm run migrate

# Start services with PM2
npm install -g pm2
pm2 start ecosystem.config.js
pm2 save
pm2 startup
```

---

## Configuration

### 1. Service Configuration

Each service requires specific configuration in `/opt/ReskFlow/configs/`:

```yaml
# gateway-config.yml
server:
  port: 3000
  host: 0.0.0.0

security:
  cors:
    origin: "*"
    credentials: true
  
rateLimit:
  windowMs: 60000
  max: 100

services:
  userService: http://localhost:3001
  paymentService: http://localhost:3002
  orderService: http://localhost:3003
```

### 2. Database Configuration

```yaml
# database-config.yml
postgres:
  host: localhost
  port: 5432
  database: reskflow
  user: reskflow
  password: ${DB_PASSWORD}
  pool:
    min: 2
    max: 10
  
redis:
  host: localhost
  port: 6379
  password: ${REDIS_PASSWORD}
  db: 0
  
mongodb:
  uri: mongodb://reskflow:${MONGO_PASSWORD}@localhost:27017/reskflow
  options:
    useNewUrlParser: true
    useUnifiedTopology: true
```

### 3. Security Configuration

```yaml
# security-config.yml
jwt:
  secret: ${JWT_SECRET}
  expiresIn: 1h
  refreshExpiresIn: 7d

encryption:
  algorithm: aes-256-gcm
  key: ${ENCRYPTION_KEY}

mfa:
  issuer: ReskFlow
  window: 1

cors:
  origins:
    - https://app.ReskFlow.com
    - https://admin.ReskFlow.com
```

---

## Database Setup

### 1. PostgreSQL Schema

```sql
-- Create extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "postgis";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- Create schemas
CREATE SCHEMA IF NOT EXISTS users;
CREATE SCHEMA IF NOT EXISTS orders;
CREATE SCHEMA IF NOT EXISTS payments;
CREATE SCHEMA IF NOT EXISTS reskflow;
CREATE SCHEMA IF NOT EXISTS merchants;
```

### 2. Run Migrations

```bash
# Development
npm run migrate:dev

# Production
NODE_ENV=production npm run migrate

# Rollback
npm run migrate:rollback
```

### 3. Seed Data (Optional)

```bash
# Seed test data
npm run seed

# Seed specific data
npm run seed:users
npm run seed:merchants
npm run seed:products
```

---

## Service Dependencies

### 1. Install PM2

```bash
# Install PM2 globally
npm install -g pm2

# Install PM2 log rotate
pm2 install pm2-logrotate

# Configure log rotation
pm2 set pm2-logrotate:max_size 100M
pm2 set pm2-logrotate:retain 7
```

### 2. PM2 Ecosystem Configuration

```javascript
// ecosystem.config.js
module.exports = {
  apps: [
    {
      name: 'gateway',
      script: './backend/gateway/dist/index.js',
      instances: 'max',
      exec_mode: 'cluster',
      env: {
        NODE_ENV: 'production',
        PORT: 3000
      },
      error_file: '/opt/ReskFlow/logs/gateway-error.log',
      out_file: '/opt/ReskFlow/logs/gateway-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z'
    },
    {
      name: 'user-service',
      script: './backend/services/user/dist/index.js',
      instances: 2,
      exec_mode: 'cluster',
      env: {
        NODE_ENV: 'production',
        PORT: 3001
      }
    },
    // Add all other services...
  ]
};
```

### 3. Start Services

```bash
# Start all services
pm2 start ecosystem.config.js

# Save PM2 configuration
pm2 save

# Setup startup script
pm2 startup

# Monitor services
pm2 monit
```

---

## SSL/TLS Configuration

### 1. Install Certbot

```bash
# Install Certbot
sudo apt install -y certbot python3-certbot-nginx

# Obtain SSL certificate
sudo certbot --nginx -d api.ReskFlow.com -d app.ReskFlow.com
```

### 2. Nginx Configuration

```nginx
# /etc/nginx/sites-available/ReskFlow
upstream gateway {
    least_conn;
    server localhost:3000 weight=10 max_fails=3 fail_timeout=30s;
    server localhost:3001 weight=10 max_fails=3 fail_timeout=30s;
    server localhost:3002 weight=10 max_fails=3 fail_timeout=30s;
}

server {
    listen 80;
    server_name api.ReskFlow.com;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name api.ReskFlow.com;

    ssl_certificate /etc/letsencrypt/live/api.ReskFlow.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/api.ReskFlow.com/privkey.pem;
    
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;
    
    # Security headers
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Frame-Options "DENY" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;
    
    location / {
        proxy_pass http://gateway;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        
        # Timeouts
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }
    
    # WebSocket support
    location /ws {
        proxy_pass http://gateway;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

### 3. Enable and Test

```bash
# Enable site
sudo ln -s /etc/nginx/sites-available/ReskFlow /etc/nginx/sites-enabled/

# Test configuration
sudo nginx -t

# Reload Nginx
sudo systemctl reload nginx

# Test SSL
curl https://api.ReskFlow.com/health
```

---

## Monitoring Setup

### 1. Prometheus Configuration

```yaml
# /opt/ReskFlow/monitoring/prometheus.yml
global:
  scrape_interval: 15s
  evaluation_interval: 15s

scrape_configs:
  - job_name: 'platform-services'
    static_configs:
      - targets:
        - 'localhost:3000'  # Gateway
        - 'localhost:3001'  # User Service
        - 'localhost:3002'  # Payment Service
        labels:
          environment: 'production'
  
  - job_name: 'node-exporter'
    static_configs:
      - targets: ['localhost:9100']
  
  - job_name: 'postgres-exporter'
    static_configs:
      - targets: ['localhost:9187']
```

### 2. Grafana Dashboards

```bash
# Import dashboards
curl -X POST http://admin:admin@localhost:3100/api/dashboards/import \
  -H "Content-Type: application/json" \
  -d @monitoring/dashboards/platform-overview.json
```

### 3. Alert Rules

```yaml
# /opt/ReskFlow/monitoring/alerts.yml
groups:
  - name: platform_alerts
    rules:
      - alert: HighErrorRate
        expr: rate(http_requests_total{status=~"5.."}[5m]) > 0.05
        for: 5m
        labels:
          severity: critical
        annotations:
          summary: High error rate detected
          
      - alert: ServiceDown
        expr: up == 0
        for: 1m
        labels:
          severity: critical
        annotations:
          summary: Service {{ $labels.job }} is down
```

---

## Backup Configuration

### 1. Database Backup Script

```bash
#!/bin/bash
# /opt/ReskFlow/scripts/backup.sh

BACKUP_DIR="/opt/ReskFlow/backups"
DATE=$(date +%Y%m%d_%H%M%S)

# PostgreSQL backup
PGPASSWORD=$DB_PASSWORD pg_dump -h localhost -U reskflow -d reskflow | gzip > $BACKUP_DIR/postgres_$DATE.sql.gz

# MongoDB backup
mongodump --uri="mongodb://reskflow:$MONGO_PASSWORD@localhost:27017/reskflow" --gzip --archive=$BACKUP_DIR/mongodb_$DATE.gz

# Redis backup
redis-cli -a $REDIS_PASSWORD --rdb $BACKUP_DIR/redis_$DATE.rdb

# Upload to S3 (optional)
aws s3 sync $BACKUP_DIR s3://ReskFlow-backups/

# Clean old backups (keep 7 days)
find $BACKUP_DIR -name "*.gz" -mtime +7 -delete
find $BACKUP_DIR -name "*.rdb" -mtime +7 -delete
```

### 2. Automated Backup

```bash
# Add to crontab
crontab -e

# Daily backup at 2 AM
0 2 * * * /opt/ReskFlow/scripts/backup.sh >> /opt/ReskFlow/logs/backup.log 2>&1
```

---

## Maintenance Procedures

### 1. Service Updates

```bash
# Update single service
cd /opt/ReskFlow
git pull origin main
npm install
npm run build:user-service
pm2 reload user-service

# Update all services
npm run build
pm2 reload all
```

### 2. Database Maintenance

```bash
# PostgreSQL maintenance
sudo -u postgres psql -d reskflow -c "VACUUM ANALYZE;"
sudo -u postgres psql -d reskflow -c "REINDEX DATABASE reskflow;"

# MongoDB maintenance
mongosh reskflow --eval "db.runCommand({ compact: 'orders' })"

# Redis maintenance
redis-cli -a $REDIS_PASSWORD BGREWRITEAOF
```

### 3. Log Rotation

```bash
# Configure logrotate
cat > /etc/logrotate.d/ReskFlow << EOF
/opt/ReskFlow/logs/*.log {
    daily
    rotate 7
    compress
    delaycompress
    missingok
    notifempty
    create 0640 deploy deploy
    sharedscripts
    postrotate
        pm2 reloadLogs
    endscript
}
EOF
```

### 4. Security Updates

```bash
# Update system packages
sudo apt update && sudo apt upgrade -y

# Update Node.js dependencies
npm audit fix

# Update Docker images
docker-compose pull
docker-compose up -d
```

---

## Troubleshooting

### Common Issues

#### 1. Service Won't Start

```bash
# Check logs
pm2 logs service-name --lines 100

# Check port availability
sudo lsof -i :3000

# Check service health
curl http://localhost:3000/health
```

#### 2. Database Connection Issues

```bash
# Test PostgreSQL connection
psql -h localhost -U reskflow -d reskflow -c "SELECT 1;"

# Test Redis connection
redis-cli -a $REDIS_PASSWORD ping

# Test MongoDB connection
mongosh mongodb://reskflow:$MONGO_PASSWORD@localhost:27017/reskflow --eval "db.runCommand({ ping: 1 })"
```

#### 3. High Memory Usage

```bash
# Check memory usage
pm2 monit

# Restart services with memory issues
pm2 restart service-name

# Adjust memory limits
pm2 set service-name:max_memory_restart 1G
```

#### 4. SSL Certificate Issues

```bash
# Renew certificate
sudo certbot renew --dry-run
sudo certbot renew

# Check certificate expiry
echo | openssl s_client -servername api.ReskFlow.com -connect api.ReskFlow.com:443 2>/dev/null | openssl x509 -noout -dates
```

### Debug Mode

```bash
# Enable debug logging
export DEBUG=reskflow:*
pm2 restart all --update-env

# View detailed logs
pm2 logs --raw
```

---

## Health Checks

### 1. Service Health Endpoints

All services expose health check endpoints:

```bash
# Check individual services
curl http://localhost:3000/health    # Gateway
curl http://localhost:3001/health    # User Service
curl http://localhost:3002/health    # Payment Service

# Check all services
for port in {3000..3024}; do
  echo "Checking port $port:"
  curl -s http://localhost:$port/health | jq .
done
```

### 2. System Health Script

```bash
#!/bin/bash
# /opt/ReskFlow/scripts/health-check.sh

echo "=== System Health Check ==="
echo "Date: $(date)"
echo

# Check services
echo "=== Service Status ==="
pm2 list

# Check databases
echo -e "\n=== Database Status ==="
echo -n "PostgreSQL: "
pg_isready -h localhost -p 5432 && echo "OK" || echo "FAILED"

echo -n "Redis: "
redis-cli -a $REDIS_PASSWORD ping && echo "OK" || echo "FAILED"

echo -n "MongoDB: "
mongosh --quiet --eval "db.runCommand({ ping: 1 })" && echo "OK" || echo "FAILED"

echo -n "Elasticsearch: "
curl -s http://localhost:9200/_cluster/health | jq -r .status

# Check disk space
echo -e "\n=== Disk Usage ==="
df -h | grep -E '^/dev/'

# Check memory
echo -e "\n=== Memory Usage ==="
free -h

# Check load average
echo -e "\n=== Load Average ==="
uptime
```

### 3. Monitoring Dashboard

Access monitoring dashboards:
- Grafana: http://localhost:3100
- Prometheus: http://localhost:9090
- PM2 Web: `pm2 web`

---

## Post-Installation

### 1. Verify Installation

```bash
# Run installation verification script
npm run verify:installation

# Run integration tests
npm run test:integration

# Check API endpoints
npm run test:api
```

### 2. Configure Firewall

```bash
# Configure UFW firewall
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow ssh
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
```

### 3. Setup Monitoring Alerts

```bash
# Configure email alerts
pm2 set pm2-health:smtp_host smtp.gmail.com
pm2 set pm2-health:smtp_port 587
pm2 set pm2-health:mail_from shahin@resket.ca
pm2 set pm2-health:mail_to shahin@resket.ca
```

### 4. Documentation

- API Documentation: http://api.ReskFlow.com/docs
- Admin Guide: `/docs/ADMIN_GUIDE.md`
- Developer Guide: `/docs/DEVELOPER_GUIDE.md`

---

*For additional support, contact shahin@resket.ca*