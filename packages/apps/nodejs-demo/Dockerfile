# ============================================================================
# Build Stage - Install dependencies
# ============================================================================
FROM node:24-alpine AS builder

WORKDIR /app

# Copy package files first (Docker layer caching)
COPY app/package*.json ./

# Install production dependencies only
RUN npm ci --only=production && \
    npm cache clean --force

# ============================================================================
# Runtime Stage - Minimal production image
# ============================================================================
FROM node:24-alpine

WORKDIR /app

# Security: Create non-root user
# This is REQUIRED for Pod Security Standard "restricted"
RUN addgroup -g 10000 appuser && \
    adduser -D -u 10000 -G appuser appuser

# Copy dependencies from builder stage with correct ownership
COPY --from=builder --chown=appuser:appuser /app/node_modules ./node_modules

# Copy application source code with correct ownership
COPY --chown=appuser:appuser app/*.js ./

# Switch to non-root user (REQUIRED for homelab)
USER appuser

# Expose application port
EXPOSE 3000

# Health check for container runtime
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', (r) => process.exit(r.statusCode === 200 ? 0 : 1))"

# Start application
CMD ["node", "index.js"]
