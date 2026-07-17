FROM node:20

# Install system dependencies
RUN apt-get update && apt-get install -y \
    git \
    ffmpeg \
    imagemagick \
    webp \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy all project files first
COPY . .

# Install dependencies
RUN npm install --legacy-peer-deps

# Start the bot
CMD ["node", "index.js"]
