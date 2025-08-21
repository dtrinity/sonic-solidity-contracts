FROM node:20-alpine as builder
WORKDIR /app
COPY package.json yarn.lock* ./
RUN yarn install --frozen-lockfile || yarn install
COPY . .
RUN yarn compile && yarn build || true

FROM node:20-alpine
WORKDIR /app
COPY --from=builder /app /app
CMD ["yarn", "hardhat", "run", "scripts/run_once.ts"]

