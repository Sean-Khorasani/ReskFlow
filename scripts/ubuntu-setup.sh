#!/bin/bash

# ReskFlow Ubuntu Setup Script
# This script automates the installation process for Ubuntu systems

set -e  # Exit on error

echo "================================================"
echo "ReskFlow Ubuntu Setup Script"
echo "================================================"
echo ""

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${GREEN}[✓]${NC} $1"
}

print_error() {
    echo -e "${RED}[✗]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[!]${NC} $1"
}

# Check if running as root
if [[ $EUID -eq 0 ]]; then
   print_error "This script should not be run as root!"
   exit 1
fi

# Check Ubuntu version
if ! grep -q "Ubuntu" /etc/os-release; then
    print_error "This script is designed for Ubuntu systems only."
    exit 1
fi

echo "Starting ReskFlow installation..."
echo ""

# Step 1: Update system
print_status "Updating system packages..."
sudo apt update && sudo apt upgrade -y

# Step 2: Install Node.js
print_status "Installing Node.js 18.x..."
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt install -y nodejs
node_version=$(node --version)
print_status "Node.js installed: $node_version"

# Step 3: Install Git
print_status "Installing Git..."
sudo apt install -y git

# Step 4: Install PostgreSQL
print_status "Installing PostgreSQL..."
sudo apt install -y postgresql postgresql-contrib

# Generate random password for PostgreSQL
PG_PASSWORD=$(openssl rand -base64 12)
sudo -u postgres psql -c "ALTER USER postgres PASSWORD '$PG_PASSWORD';"
print_status "PostgreSQL installed with password: $PG_PASSWORD"

# Step 5: Install Redis
print_status "Installing Redis..."
sudo apt install -y redis-server
sudo sed -i 's/supervised no/supervised systemd/g' /etc/redis/redis.conf
sudo systemctl restart redis
sudo systemctl enable redis

# Step 6: Install Elasticsearch
print_status "Installing Elasticsearch (this may take a while)..."
sudo apt install -y openjdk-11-jre-headless
wget -qO - https://artifacts.elastic.co/GPG-KEY-elasticsearch | sudo apt-key add -
echo "deb https://artifacts.elastic.co/packages/7.x/apt stable main" | sudo tee /etc/apt/sources.list.d/elastic-7.x.list
sudo apt update && sudo apt install -y elasticsearch

# Configure Elasticsearch for low memory
sudo mkdir -p /etc/elasticsearch/jvm.options.d/
echo -e "-Xms256m\n-Xmx256m" | sudo tee /etc/elasticsearch/jvm.options.d/heap.options
sudo systemctl start elasticsearch
sudo systemctl enable elasticsearch

# Step 7: Install nginx
print_status "Installing nginx..."
sudo apt install -y nginx

# Step 8: Create ReskFlow directory
print_status "Creating ReskFlow directory..."
sudo mkdir -p /opt/reskflow
sudo chown $USER:$USER /opt/reskflow
cd /opt/reskflow

# Step 9: Clone repository
print_status "Cloning ReskFlow repository..."
git clone https://github.com/Sean-Khorasani/ReskFlow.git .

# Step 10: Create database
print_status "Setting up PostgreSQL database..."
sudo -u postgres createdb reskflow
sudo -u postgres psql <<EOF
CREATE USER reskflow WITH PASSWORD '$PG_PASSWORD';
GRANT ALL PRIVILEGES ON DATABASE reskflow TO reskflow;
EOF

# Step 11: Generate JWT secret
JWT_SECRET=$(openssl rand -base64 32)

# Step 12: Create environment file
print_status "Creating environment configuration..."
cat > .env <<EOF
# Database
DATABASE_URL=postgresql://reskflow:$PG_PASSWORD@localhost:5432/reskflow

# Redis
REDIS_URL=redis://localhost:6379

# Elasticsearch
ELASTICSEARCH_URL=http://localhost:9200

# JWT Secret
JWT_SECRET=$JWT_SECRET

# API URLs
API_URL=http://localhost:4000
FRONTEND_URL=http://localhost:3000

# Admin credentials
ADMIN_EMAIL=admin@localhost
ADMIN_PASSWORD=Admin123!

# Development mode
NODE_ENV=development

# Low memory mode
NODE_OPTIONS="--max-old-space-size=512"
EOF

# Step 13: Install dependencies
print_status "Installing Node.js dependencies (this may take a while)..."
npm install

cd backend
npm install

cd ../frontend
npm install

cd ..

# Step 14: Setup database
print_status "Setting up database schema..."
cd backend
npx prisma generate
npx prisma migrate deploy || {
    print_warning "Database migration failed. Creating fresh schema..."
    npx prisma migrate dev --name init
}

# Step 15: Create startup script
print_status "Creating startup script..."
cat > /opt/reskflow/start-reskflow.sh <<'EOF'
#!/bin/bash

echo "Starting ReskFlow services..."

# Function to check if port is in use
check_port() {
    if lsof -Pi :$1 -sTCP:LISTEN -t >/dev/null ; then
        echo "Port $1 is already in use. Please stop the service using it."
        return 1
    fi
    return 0
}

# Check required ports
check_port 3000 || exit 1
check_port 4000 || exit 1

# Start backend
cd /opt/reskflow/backend
echo "Starting backend services..."
npm run dev &
BACKEND_PID=$!

# Wait for backend to start
sleep 5

# Start frontend
cd /opt/reskflow/frontend
echo "Starting frontend..."
npm run dev &
FRONTEND_PID=$!

echo ""
echo "ReskFlow is starting up..."
echo ""
echo "Backend PID: $BACKEND_PID"
echo "Frontend PID: $FRONTEND_PID"
echo ""
echo "Access points:"
echo "- Customer App: http://localhost:3000"
echo "- Admin Portal: http://localhost:3000/admin"
echo "- Merchant Portal: http://localhost:3000/merchant"
echo "- Driver App: http://localhost:3000/driver"
echo ""
echo "Default admin login:"
echo "Email: admin@localhost"
echo "Password: Admin123!"
echo ""
echo "Press Ctrl+C to stop all services"

# Wait for interrupt
trap "kill $BACKEND_PID $FRONTEND_PID; exit" INT
wait
EOF

chmod +x /opt/reskflow/start-reskflow.sh

# Step 16: Create test data script
print_status "Creating test data script..."
cat > /opt/reskflow/create-test-data.js <<'EOF'
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

async function createTestData() {
  console.log('Creating test data...');

  try {
    // Create admin user
    const adminPassword = await bcrypt.hash('Admin123!', 10);
    const admin = await prisma.user.create({
      data: {
        email: 'admin@localhost',
        password: adminPassword,
        name: 'System Admin',
        role: 'ADMIN',
        isActive: true
      }
    });
    console.log('✓ Admin user created');

    // Create test merchant
    const merchantPassword = await bcrypt.hash('Merchant123!', 10);
    const merchant = await prisma.user.create({
      data: {
        email: 'merchant@test.com',
        password: merchantPassword,
        name: 'Test Restaurant',
        role: 'MERCHANT',
        isActive: true
      }
    });
    console.log('✓ Test merchant created');

    // Create test driver
    const driverPassword = await bcrypt.hash('Driver123!', 10);
    const driver = await prisma.user.create({
      data: {
        email: 'driver@test.com',
        password: driverPassword,
        name: 'Test Driver',
        role: 'DRIVER',
        isActive: true
      }
    });
    console.log('✓ Test driver created');

    // Create test customer
    const customerPassword = await bcrypt.hash('Customer123!', 10);
    const customer = await prisma.user.create({
      data: {
        email: 'customer@test.com',
        password: customerPassword,
        name: 'Test Customer',
        role: 'CUSTOMER',
        isActive: true
      }
    });
    console.log('✓ Test customer created');

    console.log('\nTest accounts created:');
    console.log('Admin: admin@localhost / Admin123!');
    console.log('Merchant: merchant@test.com / Merchant123!');
    console.log('Driver: driver@test.com / Driver123!');
    console.log('Customer: customer@test.com / Customer123!');

  } catch (error) {
    console.error('Error creating test data:', error);
  } finally {
    await prisma.$disconnect();
  }
}

createTestData();
EOF

# Step 17: nginx configuration
print_status "Configuring nginx..."
sudo tee /etc/nginx/sites-available/reskflow > /dev/null <<EOF
server {
    listen 80;
    server_name localhost;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_cache_bypass \$http_upgrade;
    }

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

sudo ln -sf /etc/nginx/sites-available/reskflow /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx

# Final summary
echo ""
echo "================================================"
echo -e "${GREEN}Installation Complete!${NC}"
echo "================================================"
echo ""
echo "Installation Summary:"
echo "- PostgreSQL password: $PG_PASSWORD"
echo "- JWT Secret: $JWT_SECRET"
echo "- Installation directory: /opt/reskflow"
echo ""
echo "To start ReskFlow:"
echo "  cd /opt/reskflow"
echo "  ./start-reskflow.sh"
echo ""
echo "To create test data:"
echo "  cd /opt/reskflow/backend"
echo "  node ../create-test-data.js"
echo ""
echo "Access points:"
echo "- Customer App: http://localhost:3000"
echo "- Admin Portal: http://localhost:3000/admin"
echo "- Merchant Portal: http://localhost:3000/merchant"
echo "- Driver App: http://localhost:3000/driver"
echo ""
echo "For detailed instructions, see: /opt/reskflow/docs/ubuntu-quickstart-guide.md"
echo ""
print_warning "Note: This is a development setup. Do not use in production!"