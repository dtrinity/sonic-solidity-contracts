FROM node:18.12.0-slim

# As it is hard to compile the TypeScript code when using typechain, thus we decided
# to run the bot with TypeScript instead of JavaScript.

WORKDIR /usr/src

# Install the necessary packages
COPY package.json /usr/src/
COPY yarn.lock /usr/src/
COPY .yarnrc.yml /usr/src/
COPY ./.yarn /usr/src/.yarn
RUN yarn install

# Prepare the TypeScript environment
COPY tsconfig.json /usr/src/tsconfig.json

# Copy the necessary files
COPY scripts/sh/replace_string.sh /usr/src/scripts/replace_string.sh
COPY hardhat.config.ts /usr/src/
COPY deployments/ /usr/src/deployments/
COPY contracts/ /usr/src/contracts/
COPY cache/ /usr/src/cache/
COPY artifacts/ /usr/src/artifacts/
COPY typechain-types/ /usr/src/typechain-types/
# COPY test/ /usr/src/test/

ARG HOST_PWD

# Replace the path in cache file and compile the contracts
# The compilation is expected to be done without any actual compilation as we copied the artifacts
# We run the compilation here to trigger pre-downloading of the necessary compiler versions
RUN sh ./scripts/replace_string.sh $HOST_PWD /usr/src /usr/src/cache/solidity-files-cache.json
RUN yarn hardhat compile

# Copy the rest of the files
COPY config/ /usr/src/config/
COPY scripts/sh/docker-entrypoint.sh /usr/src/scripts/docker-entrypoint.sh
# COPY scripts/liquidator-bot/docker-entrypoint-slack-bot.sh /usr/src/scripts/docker-entrypoint-slack-bot.sh
COPY typescript/odos_bot /usr/src/scripts/liquidator-bot/odos_bot

# Default entrypoint
ENTRYPOINT [ "sh", "/usr/src/scripts/docker-entrypoint.sh" ]
