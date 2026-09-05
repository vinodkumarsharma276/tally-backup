# Cloud Run runs one container per revision and terminates TLS for us, so this
# image only needs to serve plain HTTP on $PORT as a non-root user.
FROM node:22-slim

ENV NODE_ENV=production
WORKDIR /app

# Dependencies are copied and installed before the source so that a code-only
# change reuses the cached layer instead of reinstalling every package.
COPY package.json package-lock.json ./

# Optional deps are skipped deliberately: better-sqlite3 is useless on Cloud Run
# (the filesystem is ephemeral) and needs a native toolchain. The stores this
# image can actually use are installed explicitly.
RUN npm ci --omit=dev --omit=optional --no-audit --no-fund \
 && npm install --omit=dev --no-save --no-audit --no-fund \
      @google-cloud/firestore@^7.11.0 \
      pg@^8.13.1 \
 && npm cache clean --force

COPY src ./src

# Containers that run as root are one escape away from a host-level problem.
USER node

# Cloud Run injects PORT; this default only matters for local `docker run`.
ENV PORT=8080
EXPOSE 8080

CMD ["node", "src/index.js"]
