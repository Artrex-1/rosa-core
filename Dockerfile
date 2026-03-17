FROM node:20-slim

# Install build tools for better-sqlite3
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install dependencies
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Copy source with correct ownership
COPY --chown=node:node src/ src/

# Create data dir and set ownership before switching user
RUN mkdir -p /app/data && chown -R node:node /app

# Use non-root user
USER node

# Data volume for persistent storage
VOLUME /app/data

EXPOSE 3100

CMD ["node", "src/server.js"]
