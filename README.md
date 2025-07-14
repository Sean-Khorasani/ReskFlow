# ReskFlow

A cutting-edge enterprise reskflow platform leveraging blockchain technology for transparency, security, and minimal transaction costs.

## Key Features

- **Blockchain Integration**: Polygon-based smart contracts with <$0.01 gas fees
- **Multi-stakeholder Platform**: Support for customers, drivers, enterprises, and partners
- **Real-time Tracking**: IoT and GPS-based tracking with blockchain verification
- **AI/ML Optimization**: Advanced route optimization and predictive analytics
- **Scalable Architecture**: Microservices-based design supporting 1M+ daily deliveries
- **Enterprise Ready**: API-first design with comprehensive security and compliance

## Technology Stack

- **Blockchain**: Polygon, Solidity, Hardhat
- **Backend**: Node.js, TypeScript, GraphQL, Microservices
- **Frontend**: React, Next.js, React Native
- **Database**: PostgreSQL, MongoDB, Redis
- **Infrastructure**: Docker, Kubernetes, AWS/GCP
- **Monitoring**: Prometheus, Grafana, ELK Stack

## Quick Start

### Prerequisites
- Node.js 18+
- Docker & Docker Compose
- Git

### Installation

#### Option 1: Automated Ubuntu Setup
For Ubuntu users with minimal systems (1GB RAM):
```bash
wget https://raw.githubusercontent.com/Sean-Khorasani/ReskFlow/main/scripts/ubuntu-setup.sh
chmod +x ubuntu-setup.sh
./ubuntu-setup.sh
```

See [Ubuntu Quick Start Guide](docs/ubuntu-quickstart-guide.md) for detailed instructions.

#### Option 2: Manual Installation

1. Clone the repository:
```bash
git clone https://github.com/Sean-Khorasani/ReskFlow.git
cd ReskFlow
```

2. Install dependencies:
```bash
npm install
```

3. Start development environment:
```bash
docker-compose up -d
npm run dev
```

### Development

- Blockchain contracts: `npm run dev:blockchain`
- Backend services: `npm run dev:backend`
- Frontend apps: `npm run dev:frontend`

### Testing

```bash
# Run all tests
cd testing
./run-all-tests.sh

# Run specific test suites
npm run test:unit          # Unit tests with coverage
npm run test:integration   # Integration tests
npm run test:contract      # Contract tests
npm run test:e2e          # End-to-end tests

# Performance testing
cd testing/performance
./run-performance-tests.sh

# Security testing
cd testing/security
./run-security-tests.sh
```

See [Testing Documentation](testing/README.md) for comprehensive testing guide.

## Project Structure

```
reskflow/
├── blockchain/          # Smart contracts and blockchain integration
├── backend/            # Microservices backend
│   ├── gateway/        # API Gateway
│   ├── services/       # Core services
│   ├── src/            # Core service implementations
│   └── shared/         # Shared libraries
├── frontend/           # Web applications
│   ├── customer/       # Customer portal (Next.js)
│   ├── admin/          # Admin dashboard (Next.js)
│   ├── merchant/       # Merchant portal (Next.js)
│   └── partner/        # Partner portal (Next.js)
├── mobile/             # Mobile applications
│   ├── driver/         # Driver app (React Native)
│   └── customer/       # Customer app (React Native)
├── infrastructure/     # Infrastructure as Code
│   ├── kubernetes/     # K8s manifests
│   ├── terraform/      # Cloud infrastructure
│   └── monitoring/     # Monitoring configs
├── testing/            # Comprehensive test suites
│   ├── unit/           # Unit tests
│   ├── integration/    # Integration tests
│   ├── contract/       # Contract tests
│   ├── e2e/            # End-to-end tests
│   ├── performance/    # Performance tests
│   ├── security/       # Security tests
│   └── chaos/          # Chaos engineering
├── docs/               # Documentation
└── scripts/            # Utility scripts
```

## Smart Contract Architecture

The platform uses a multi-contract architecture for modularity and gas optimization:

- **DeliveryRegistry**: Core reskflow tracking and status management
- **PaymentEscrow**: Secure payment handling with escrow functionality
- **GasOptimizer**: Batch processing and meta-transactions
- **AccessControl**: Role-based permissions and security

## API Documentation

API documentation is available at `http://localhost:3000/docs` when running locally.

## Security

- End-to-end encryption for sensitive data
- Multi-factor authentication
- Role-based access control
- Regular security audits
- Bug bounty program

## Contributing

Please read [Contributing](docs/contributing.md) for details on our code of conduct and the process for submitting pull requests.

## License

This project is licensed under the MIT License - see the [License](LICENSE) file for details.

