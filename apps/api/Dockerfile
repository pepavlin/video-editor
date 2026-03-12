FROM node:20-slim

# Replace Debian sources with snapshot.debian.org to bypass CDN cache inconsistencies.
# node:20-slim uses DEB822 format in sources.list.d/debian.sources (no sources.list).
RUN echo 'Acquire::Check-Valid-Until "false";' > /etc/apt/apt.conf.d/10snapshot \
    && printf '%s\n' \
    'Types: deb' \
    'URIs: http://snapshot.debian.org/archive/debian/20260202T000000Z/' \
    'Suites: bookworm bookworm-updates' \
    'Components: main' \
    'Signed-By: /usr/share/keyrings/debian-archive-keyring.gpg' \
    '' \
    'Types: deb' \
    'URIs: http://snapshot.debian.org/archive/debian-security/20260202T000000Z/' \
    'Suites: bookworm-security' \
    'Components: main' \
    'Signed-By: /usr/share/keyrings/debian-archive-keyring.gpg' \
    > /etc/apt/sources.list.d/debian.sources

# Install system deps: ffmpeg, python3, pip
RUN rm -rf /var/lib/apt/lists/* \
    && apt-get update \
    && apt-get install -y \
    ffmpeg \
    python3 \
    python3-pip \
    python3-venv \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy root workspace config + lockfile first (for cache layering)
COPY package.json package-lock.json ./

# Copy ALL workspace package.json files so npm can resolve the monorepo
COPY packages/shared/package.json ./packages/shared/
COPY packages/elements/package.json ./packages/elements/
COPY apps/api/package.json ./apps/api/
# Create empty web package.json so npm workspace glob doesn't fail
COPY apps/web/package.json ./apps/web/

# Install Node dependencies and clean npm cache in same layer
RUN npm ci --ignore-scripts && npm cache clean --force

# Build shared package
COPY packages/shared/tsconfig.json ./packages/shared/
COPY packages/shared/src ./packages/shared/src
RUN npm run build -w packages/shared

# Build elements package (depends on shared)
COPY packages/elements/tsconfig.json ./packages/elements/
COPY packages/elements/src ./packages/elements/src
RUN npm run build -w packages/elements

# Copy API source
COPY apps/api/tsconfig.json ./apps/api/
COPY apps/api/src ./apps/api/src

# Copy Python scripts
COPY scripts ./scripts

# Install all Python dependencies in a single layer to minimize VFS overhead
COPY requirements.txt ./
RUN (pip3 install --no-cache-dir --break-system-packages --only-binary=:all: librosa soundfile numpy \
    || pip3 install --no-cache-dir --only-binary=:all: librosa soundfile numpy) \
    && (pip3 install --no-cache-dir --break-system-packages rembg onnxruntime pillow \
    || pip3 install --no-cache-dir rembg onnxruntime pillow) \
    && (python3 -c "from rembg import new_session; new_session('u2net_human_seg'); print('rembg model cached')" \
    || echo "WARNING: rembg model pre-download failed – it will be downloaded on first use") \
    && (pip3 install --no-cache-dir --break-system-packages --only-binary=:all: opencv-python-headless \
    || pip3 install --no-cache-dir --only-binary=:all: opencv-python-headless) \
    && (pip3 install --no-cache-dir --break-system-packages faster-whisper \
    || pip3 install --no-cache-dir faster-whisper)

# Build API
RUN npm run build -w apps/api

# Workspace data directory
RUN mkdir -p /data/workspace

ENV NODE_ENV=production
ENV WORKSPACE_DIR=/data/workspace
ENV SCRIPTS_DIR=/app/scripts
ENV PYTHON_BIN=python3
ENV FFMPEG_BIN=ffmpeg
ENV FFPROBE_BIN=ffprobe
ENV PORT=3001
ENV HOST=0.0.0.0
ENV CORS_ORIGIN=http://localhost:3000

EXPOSE 3001

CMD ["node", "apps/api/dist/index.js"]
