# Build stage
FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile
COPY tsconfig.json ./
COPY src ./src
RUN yarn build

# Production stage
FROM node:20-alpine AS production
WORKDIR /app
COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile --production
COPY --from=builder /app/dist ./dist

# Create state directory
RUN mkdir -p /app/state

# Run the compiled JavaScript file
CMD ["node", "dist/bot/run.js"] 