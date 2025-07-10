# Production Deployment Guide

## Overview
This guide provides step-by-step instructions for deploying the Enterprise Blockchain ReskFlow to production.

## Prerequisites

### Infrastructure Requirements
- **Cloud Provider**: AWS, GCP, or Azure
- **Kubernetes**: v1.28+ (EKS, GKE, or AKS)
- **Database**: 
  - PostgreSQL 16+ (RDS/Cloud SQL)
  - MongoDB 7+ (Atlas/DocumentDB)
  - Redis 7+ (ElastiCache/MemoryStore)
- **Blockchain**: Polygon Mainnet access
- **Domain**: SSL certificates for all subdomains

### Required Services
- **SendGrid**: Email delivery
- **Twilio**: SMS notifications
- **Stripe**: Payment processing
- **Google Maps**: Geocoding and routing
- **AWS S3**: File storage
- **Cloudflare**: CDN and DDoS protection

## Pre-Deployment Checklist

### 1. Security Audit
- [ ] Smart contract audit completed (Certik/OpenZeppelin)
- [ ] Penetration testing passed
- [ ] OWASP Top 10 compliance verified
- [ ] SSL/TLS certificates installed
- [ ] Secrets management configured (AWS Secrets Manager/Vault)

### 2. Legal & Compliance
- [ ] Privacy Policy updated
- [ ] Terms of Service finalized
- [ ] GDPR compliance implemented
- [ ] Data retention policies configured
- [ ] Cookie consent mechanism deployed

### 3. Performance Testing
- [ ] Load testing passed (1M+ daily transactions)
- [ ] Stress testing completed
- [ ] Database optimization done
- [ ] CDN configured for static assets

## Deployment Steps

### Step 1: Infrastructure Setup

```bash
# Clone infrastructure repository
git clone https://github.com/ReskFlow/infrastructure.git
cd infrastructure/terraform

# Initialize Terraform
terraform init

# Create production workspace
terraform workspace new production

# Apply infrastructure
terraform apply -var-file="production.tfvars"
```

### Step 2: Database Migration

```bash
# Set production database URL
export DATABASE_URL="postgresql://prod_user:password@prod-db.region.rds.amazonaws.com:5432/delivery"

# Run migrations
cd backend/shared
npx prisma migrate deploy

# Seed initial data
npx prisma db seed -- --environment production
```

### Step 3: Deploy Smart Contracts

```bash
cd blockchain

# Set environment variables
export PRIVATE_KEY="0x..."
export POLYGON_RPC_URL="https://polygon-rpc.com"

# Deploy to Polygon Mainnet
npm run deploy:mainnet

# Verify contracts
npm run verify:mainnet

# Save deployment addresses
cat deployments/deployment-137.json
```

### Step 4: Configure Kubernetes Secrets

```bash
# Create namespace
kubectl create namespace ReskFlow

# Create secrets
kubectl create secret generic delivery-secrets \
  --from-literal=database-url=$DATABASE_URL \
  --from-literal=redis-url=$REDIS_URL \
  --from-literal=jwt-secret=$JWT_SECRET \
  --from-literal=polygon-rpc-url=$POLYGON_RPC_URL \
  --from-literal=private-key=$PRIVATE_KEY \
  -n ReskFlow

# Create service accounts
kubectl apply -f infrastructure/kubernetes/rbac/
```

### Step 5: Deploy Services

```bash
# Deploy core services
kubectl apply -f infrastructure/kubernetes/gateway/
kubectl apply -f infrastructure/kubernetes/delivery/
kubectl apply -f infrastructure/kubernetes/payment/
kubectl apply -f infrastructure/kubernetes/tracking/
kubectl apply -f infrastructure/kubernetes/optimization/
kubectl apply -f infrastructure/kubernetes/security/
kubectl apply -f infrastructure/kubernetes/notification/

# Wait for rollout
kubectl rollout status deployment --all -n ReskFlow

# Verify pods are running
kubectl get pods -n ReskFlow
```

### Step 6: Configure Ingress & SSL

```bash
# Deploy ingress controller
kubectl apply -f https://raw.githubusercontent.com/kubernetes/ingress-nginx/controller-v1.8.2/deploy/static/provider/aws/deploy.yaml

# Deploy cert-manager
kubectl apply -f https://github.com/cert-manager/cert-manager/releases/download/v1.13.0/cert-manager.yaml

# Apply ingress rules
kubectl apply -f infrastructure/kubernetes/ingress/
```

### Step 7: Deploy Frontend Applications

```bash
# Build and deploy admin dashboard
cd frontend/admin
npm run build
aws s3 sync out/ s3://delivery-admin-prod --delete
aws cloudfront create-invalidation --distribution-id $CF_DISTRIBUTION_ID --paths "/*"

# Deploy customer web app
cd ../customer
npm run build
aws s3 sync out/ s3://delivery-customer-prod --delete
```

### Step 8: Mobile App Deployment

```bash
# Android - Build and upload to Play Store
cd mobile/driver/android
./gradlew bundleRelease
# Upload to Play Console

# iOS - Build and upload to App Store
cd ../ios
fastlane release
```

### Step 9: Configure Monitoring

```bash
# Deploy Prometheus
helm repo add prometheus-community https://prometheus-community.github.io/helm-charts
helm install prometheus prometheus-community/kube-prometheus-stack \
  -f infrastructure/monitoring/prometheus-values.yaml \
  -n monitoring --create-namespace

# Deploy Grafana dashboards
kubectl apply -f infrastructure/monitoring/dashboards/

# Configure alerts
kubectl apply -f infrastructure/monitoring/alerts/
```

### Step 10: Setup Backups

```bash
# Database backups
aws rds modify-db-instance \
  --db-instance-identifier delivery-prod \
  --backup-retention-period 30 \
  --preferred-backup-window "03:00-04:00"

# Configure S3 lifecycle for logs
aws s3api put-bucket-lifecycle-configuration \
  --bucket delivery-logs-prod \
  --lifecycle-configuration file://s3-lifecycle.json
```

## Post-Deployment Tasks

### 1. Health Checks
```bash
# API health
curl https://api.ReskFlow.com/health

# WebSocket connectivity
wscat -c wss://ws.ReskFlow.com

# Blockchain connectivity
curl https://api.ReskFlow.com/blockchain/status
```

### 2. Load Testing
```bash
# Run k6 load test
k6 run --vus 1000 --duration 30m performance-test.k6.js
```

### 3. Security Scan
```bash
# Run OWASP ZAP scan
docker run -t owasp/zap2docker-stable zap-baseline.py \
  -t https://api.ReskFlow.com
```

### 4. Configure Auto-scaling
```bash
# Apply HPA policies
kubectl apply -f infrastructure/kubernetes/autoscaling/

# Configure cluster autoscaler
kubectl apply -f infrastructure/kubernetes/cluster-autoscaler/
```

## Monitoring & Alerts

### Key Metrics to Monitor
- **API Response Time**: < 100ms p95
- **Error Rate**: < 0.1%
- **Blockchain Gas Usage**: < $0.01 per transaction
- **Database Connections**: < 80% of max
- **Pod CPU/Memory**: < 80% utilization

### Alert Channels
- PagerDuty: Critical production issues
- Slack: Non-critical alerts
- Email: Daily reports

## Rollback Procedure

```bash
# Rollback Kubernetes deployment
kubectl rollout undo deployment/gateway-deployment -n ReskFlow

# Rollback database migration
npx prisma migrate resolve --rolled-back

# Revert to previous Docker image
kubectl set image deployment/gateway-deployment gateway=delivery/gateway:previous-tag -n ReskFlow
```

## Disaster Recovery

### RTO: 4 hours, RPO: 1 hour

1. **Database Recovery**
   ```bash
   aws rds restore-db-instance-from-db-snapshot \
     --db-instance-identifier delivery-prod-restore \
     --db-snapshot-identifier delivery-prod-snapshot-latest
   ```

2. **Kubernetes Recovery**
   ```bash
   # Restore from backup
   velero restore create --from-backup production-backup-latest
   ```

3. **Blockchain Recovery**
   - Smart contracts are immutable
   - Sync from blockchain events if needed

## Production Checklist

### Launch Day
- [ ] All services healthy
- [ ] SSL certificates valid
- [ ] Monitoring alerts configured
- [ ] Support team briefed
- [ ] Rollback plan tested
- [ ] Communication channels ready

### Post-Launch (Week 1)
- [ ] Performance metrics reviewed
- [ ] User feedback collected
- [ ] Security logs analyzed
- [ ] Cost optimization review
- [ ] Scaling adjustments made

### Monthly Maintenance
- [ ] Security patches applied
- [ ] Dependencies updated
- [ ] Database optimization
- [ ] Backup restoration test
- [ ] Disaster recovery drill

## Support Contacts

- **DevOps Lead**: devops@ReskFlow.com
- **Security Team**: security@ReskFlow.com
- **On-call Engineer**: +1-555-DELIVERY
- **Escalation**: cto@ReskFlow.com

## Useful Commands

```bash
# View logs
kubectl logs -f deployment/gateway-deployment -n ReskFlow

# Database connection
kubectl run -it --rm psql --image=postgres:16 --restart=Never -- psql $DATABASE_URL

# Redis CLI
kubectl run -it --rm redis-cli --image=redis:7 --restart=Never -- redis-cli -h redis-service

# Port forwarding for debugging
kubectl port-forward service/gateway-service 3000:80 -n ReskFlow
```

## Conclusion

Following this guide ensures a smooth production deployment of the Enterprise Blockchain ReskFlow. Regular monitoring, maintenance, and updates are crucial for optimal performance and security.