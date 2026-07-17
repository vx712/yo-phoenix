FROM node:20

# Install system dependencies for image processing and other modules
RUN apt-get update && apt-get install -y \
    git \
    ffmpeg \
    imagemagick \
    webp \
    libc6 \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies with legacy-peer-deps to avoid conflicts
# Use --ignore-scripts to prevent any problematic preinstall/postinstall scripts from running
RUN npm install --legacy-peer-deps --ignore-scripts

# Copy the rest of the project files
COPY . .

# Start the bot
CMD ["node", "index.js"]
