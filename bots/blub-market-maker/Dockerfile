# BLUB/AQUA market maker — single-process worker image.
#
# Ships INERT: DRY_RUN defaults to true both in the bot's config schema and here,
# and the schema only goes live on an explicit false/0/no/off. An unset or empty
# DRY_RUN keeps it in dry run.
FROM node:22-alpine

WORKDIR /app

# npm ci installs devDependencies on purpose: `tsx` is the runtime here, and
# there is no build step. Adding one would mean inventing a build config that
# has never been exercised against a process that moves money — not a trade
# worth making for a smaller image.
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY tsconfig.json ./
COPY src ./src

ENV NODE_ENV=production
ENV DRY_RUN=true

# Exec form, and `node` rather than `npm start`, so node is PID 1.
# This is load-bearing: the container's SIGTERM must reach the SIGTERM handler
# in src/index.ts, which cancels every resting offer before exiting. Behind
# `npm start` the signal is swallowed and offers are left on the book.
CMD ["node", "--import", "tsx", "src/index.ts"]
