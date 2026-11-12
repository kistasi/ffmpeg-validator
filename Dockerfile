# Pinned to an exact version, like the rest of the malna stack: a floating tag
# can move between builds and invalidate the cached `npm ci` layer.
# --- Dependencies -----------------------------------------------------------
FROM node:26.13.0-alpine3.24 AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# --- Build ------------------------------------------------------------------
FROM node:26.13.0-alpine3.24 AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# --- Runtime ----------------------------------------------------------------
FROM node:26.13.0-alpine3.24 AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# The decode checks run here, with the image's own ffmpeg, against the movie
# library mounted read-only. tzdata so run times follow TZ.
RUN apk add --no-cache ffmpeg tzdata

# Run as an unprivileged user.
RUN addgroup -g 1001 -S nodejs \
  && adduser -u 1001 -S nextjs -G nodejs

# The standalone output bundles only the files needed to run the server.
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Persisted data (scan results and run history) lives here; mount a volume to keep it.
RUN mkdir -p /app/data && chown -R nextjs:nodejs /app/data
VOLUME ["/app/data"]

USER nextjs
EXPOSE 3000

CMD ["node", "server.js"]
