# Portable production image — works on Fly.io, Render, Railway, or any Docker host.
FROM node:22-alpine

WORKDIR /app

# Install production dependencies only (dev deps like jest are skipped).
# better-sqlite3 is a native addon; on Alpine (musl) it may need to compile, so
# add build tools just for the install and drop them afterwards to stay slim.
# (pg is pure JS. Prod uses Postgres, but better-sqlite3 is still installed.)
COPY package*.json ./
RUN apk add --no-cache --virtual .build-deps python3 make g++ \
  && npm ci --omit=dev \
  && apk del .build-deps

# Copy the application source.
COPY . .

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

# Basic container healthcheck hitting the app's /healthz endpoint.
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:'+(process.env.PORT||3000)+'/healthz',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

CMD ["node", "src/server/index.js"]
