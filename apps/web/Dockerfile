FROM node:20-slim AS builder

WORKDIR /app

# Copy root workspace config + lockfile
COPY package.json package-lock.json ./

# Copy ALL workspace package.json files
COPY packages/shared/package.json ./packages/shared/
COPY packages/elements/package.json ./packages/elements/
COPY apps/web/package.json ./apps/web/
# Create empty api package.json so npm workspace glob doesn't fail
COPY apps/api/package.json ./apps/api/

# Install all deps and clean cache in same layer to save space (VFS driver)
RUN npm ci --ignore-scripts && npm cache clean --force

# Copy shared + elements source, build them, then copy web source and build it
COPY packages/shared ./packages/shared
COPY packages/elements ./packages/elements
COPY apps/web/tsconfig.json apps/web/next.config.mjs apps/web/tailwind.config.ts apps/web/postcss.config.js ./apps/web/
COPY apps/web/src ./apps/web/src

ENV NEXT_TELEMETRY_DISABLED=1
ARG NEXT_PUBLIC_API_URL=http://localhost:3001
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}

RUN npm run build -w packages/shared \
    && npm run build -w packages/elements \
    && npm run build -w apps/web

# Prune dev dependencies so we can copy clean node_modules to production
RUN npm prune --omit=dev && npm cache clean --force

# --- Production stage ---
FROM node:20-slim

WORKDIR /app

# Copy only what's needed to run the app
COPY --from=builder /app/package.json /app/package-lock.json ./
COPY --from=builder /app/packages/shared/package.json ./packages/shared/
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/packages/elements/package.json ./packages/elements/
COPY --from=builder /app/packages/elements/dist ./packages/elements/dist
COPY --from=builder /app/apps/web/package.json ./apps/web/
COPY --from=builder /app/apps/web/.next ./apps/web/.next
COPY --from=builder /app/apps/web/next.config.mjs ./apps/web/

# Stub api package.json so npm workspace resolution works
RUN mkdir -p apps/api && echo '{"name":"@video-editor/api","version":"1.0.0","private":true}' > apps/api/package.json

# Copy pre-pruned node_modules from builder instead of re-running npm ci
# This avoids a second install pass and saves significant disk space
# All deps are hoisted to root node_modules in npm workspaces
COPY --from=builder /app/node_modules ./node_modules

ENV NODE_ENV=production
ENV PORT=3000
ENV NEXT_TELEMETRY_DISABLED=1

EXPOSE 3000

CMD ["npm", "run", "start", "-w", "apps/web"]
