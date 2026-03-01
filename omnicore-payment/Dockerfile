# ── Builder ───────────────────────────────────────────────────────────────────
FROM node:22-alpine AS builder

WORKDIR /app

# Root workspace metadata
COPY package.json package-lock.json ./

# Workspace package.json stubs (required for npm ci to resolve the full workspace graph)
COPY omnicore-db/package.json       ./omnicore-db/package.json
COPY omnicore-auth/package.json     ./omnicore-auth/package.json
COPY omnicore-user/package.json     ./omnicore-user/package.json
COPY omnicore-product/package.json  ./omnicore-product/package.json
COPY omnicore-gateway/package.json  ./omnicore-gateway/package.json
COPY omnicore-order/package.json    ./omnicore-order/package.json
COPY omnicore-payment/package.json  ./omnicore-payment/package.json

# Shared DB package — contains schema + Prisma client source
COPY omnicore-db/ ./omnicore-db/

# Install all deps (devDeps included so prisma CLI is available)
RUN npm ci && npm cache clean --force

# Generate Prisma client into root node_modules/@prisma/client
RUN cd omnicore-db && npx prisma generate

# Ensure per-service node_modules dir exists (npm may hoist all packages to root)
RUN mkdir -p /app/omnicore-payment/node_modules

# Prune devDependencies for a lean production image
RUN npm prune --omit=dev

# ── Runner ────────────────────────────────────────────────────────────────────
FROM node:22-alpine

WORKDIR /app

RUN addgroup -g 1001 -S nodejs && adduser -S nodejs -u 1001

# Pruned root node_modules
COPY --from=builder --chown=nodejs:nodejs /app/node_modules ./node_modules

# Per-service node_modules (packages not hoisted to root by npm workspaces)
COPY --from=builder --chown=nodejs:nodejs /app/omnicore-payment/node_modules ./omnicore-payment/node_modules

# Shared DB package (resolves node_modules/@omnicore/db → ../../omnicore-db symlink)
COPY --chown=nodejs:nodejs omnicore-db/ ./omnicore-db/

# Payment service source
COPY --chown=nodejs:nodejs omnicore-payment/ ./omnicore-payment/

USER nodejs

WORKDIR /app/omnicore-payment

EXPOSE 3005

HEALTHCHECK --interval=30s --timeout=3s --start-period=15s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3005/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

CMD ["npm", "start"]
