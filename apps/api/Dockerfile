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
COPY apps/api/package.json ./apps/api/
# Create empty web package.json so npm workspace glob doesn't fail
COPY apps/web/package.json ./apps/web/

# Install Node dependencies (root-level installs all workspaces)
RUN npm ci --ignore-scripts

# Build shared package
COPY packages/shared/tsconfig.json ./packages/shared/
COPY packages/shared/src ./packages/shared/src
RUN npm run build -w packages/shared

# Copy API source
COPY apps/api/tsconfig.json ./apps/api/
COPY apps/api/src ./apps/api/src

# Copy Python scripts
COPY scripts ./scripts

# Install Python dependencies (lightweight core ones, skip Whisper/torch by default)
COPY requirements.txt ./
RUN pip3 install --no-cache-dir --break-system-packages --only-binary=:all: librosa soundfile numpy \
    || pip3 install --no-cache-dir --only-binary=:all: librosa soundfile numpy

# Install cutout dependencies (rembg for AI background removal)
RUN pip3 install --no-cache-dir --break-system-packages rembg onnxruntime pillow \
    || pip3 install --no-cache-dir rembg onnxruntime pillow

# Pre-download the rembg segmentation model so the first cutout job doesn't
# need network access and avoids a silent hang while downloading ~170 MB.
# Falls back gracefully if the build host has no internet access.
RUN python3 -c "from rembg import new_session; new_session('u2net_human_seg'); print('rembg model cached')" \
    || echo "WARNING: rembg model pre-download failed – it will be downloaded on first use"

# Install head stabilization dependencies (opencv for face detection)
RUN pip3 install --no-cache-dir --break-system-packages --only-binary=:all: opencv-python-headless \
    || pip3 install --no-cache-dir --only-binary=:all: opencv-python-headless

# Optional: Whisper for lyrics alignment (comment in to enable, adds ~1.5GB)
# RUN pip3 install --no-cache-dir --break-system-packages openai-whisper \
#     || pip3 install --no-cache-dir openai-whisper

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
