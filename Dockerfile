# Tally Backup Pro Docker Image
FROM node:18-alpine

# Set working directory
WORKDIR /app

# Create app user
RUN addgroup -g 1001 -S nodejs
RUN adduser -S nodejs -u 1001

# Install dependencies
COPY package*.json ./
RUN npm ci --only=production && npm cache clean --force

# Copy application code
COPY --chown=nodejs:nodejs . .

# Create required directories
RUN mkdir -p /app/data /app/logs /app/temp /app/config
RUN chown -R nodejs:nodejs /app

# Install cron for scheduling
RUN apk add --no-cache dcron

# Create cron job
RUN echo "0 20 * * * cd /app && node index.js >> /app/logs/cron.log 2>&1" | crontab -u nodejs -

# Switch to non-root user
USER nodejs

# Expose volume for configuration
VOLUME ["/app/config", "/app/data", "/app/logs"]

# Set environment variables
ENV NODE_ENV=production
ENV TZ=Asia/Kolkata

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD node -e "require('./status.js')" || exit 1

# Default command
CMD ["sh", "-c", "crond && node index.js"]
