FROM node:20-alpine

WORKDIR /app

# Install Python and build dependencies for TensorFlow
RUN apk add --no-cache python3 py3-pip make g++ libc6-compat

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy TypeScript config
COPY tsconfig.json ./

# Copy source code
COPY src ./src

# Build the application
RUN npm run build

# Expose port
EXPOSE 3013

# Start the service
CMD ["npm", "start"]