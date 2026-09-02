FROM cgr.dev/chainguard/node:latest-dev AS deps

WORKDIR /app
COPY package*.json ./
RUN npm ci

FROM cgr.dev/chainguard/node:latest-dev AS builder

WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM cgr.dev/chainguard/node:latest AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=5000

# Install only production dependencies for final image size + security
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/public ./public

# Run as non-root user provided by Chainguard images
USER nonroot

EXPOSE 5000

CMD ["node", "dist/index.js"]
