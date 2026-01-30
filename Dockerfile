# Use Node.js LTS version
FROM node:20-slim

# Install PostgreSQL client tools (includes pg_dump)
RUN apt-get update && \
    apt-get install -y postgresql-client && \
    rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy backend package files (context is already /backend when building)
COPY package.json package-lock.json ./
COPY prisma ./prisma/

# Install all dependencies (including dev dependencies for build)
RUN npm ci

# Generate Prisma Client (required before TypeScript build)
RUN npx prisma generate

# Copy backend application files
COPY . .

# Build the application
RUN npm run build

# Remove dev dependencies to reduce image size
RUN npm prune --production

# Expose port
EXPOSE 8080

# Start the application
CMD ["npm", "run", "start:prod"]
