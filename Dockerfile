# Use Node.js LTS version
FROM node:20-slim

# Install PostgreSQL client tools (includes pg_dump)
RUN apt-get update && \
    apt-get install -y postgresql-client && \
    rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy ONLY backend package files (avoid mixing with web lockfile)
COPY backend/package.json backend/package-lock.json ./
COPY backend/prisma ./prisma/

# Install all dependencies (including dev dependencies for build)
RUN npm ci

# Copy backend application files
COPY backend/. .

# Build the application
RUN npm run build

# Remove dev dependencies to reduce image size
RUN npm prune --production

# Expose port
EXPOSE 8080

# Start the application
CMD ["npm", "run", "start:prod"]
