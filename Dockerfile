# Portable production image — works on Fly.io, Render, Railway, or any Docker host.
FROM node:18-alpine

WORKDIR /app

# Install production dependencies only (dev deps like jest are skipped).
COPY package*.json ./
RUN npm ci --omit=dev

# Copy the application source.
COPY . .

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

# Basic container healthcheck hitting the app's /healthz endpoint.
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:'+(process.env.PORT||3000)+'/healthz',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

CMD ["node", "src/server/index.js"]
