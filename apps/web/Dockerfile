FROM node:20-slim

WORKDIR /app

# Copy root workspace config + lockfile
COPY package.json package-lock.json ./

# Copy ALL workspace package.json files
COPY packages/shared/package.json ./packages/shared/
COPY apps/web/package.json ./apps/web/
# Create empty api package.json so npm workspace glob doesn't fail
COPY apps/api/package.json ./apps/api/

# Install all deps
RUN npm ci --ignore-scripts

# Build shared package
COPY packages/shared/tsconfig.json ./packages/shared/
COPY packages/shared/src ./packages/shared/src
RUN npm run build -w packages/shared

# Copy web source
COPY apps/web/tsconfig.json ./apps/web/
COPY apps/web/next.config.mjs ./apps/web/
COPY apps/web/tailwind.config.ts ./apps/web/
COPY apps/web/postcss.config.js ./apps/web/
COPY apps/web/src ./apps/web/src

# Build Next.js
ENV NEXT_TELEMETRY_DISABLED=1
ARG NEXT_PUBLIC_API_URL=http://localhost:3001
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}

RUN npm run build -w apps/web

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

CMD ["npm", "run", "start", "-w", "apps/web"]
