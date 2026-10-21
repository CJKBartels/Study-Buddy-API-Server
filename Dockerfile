# Production image for the API. App Platform builds this file; locally,
# docker compose uses it too.

# Alpine is a small Linux. bcrypt ships a prebuilt binary for it (musl),
# so nothing has to be compiled during the build.
FROM node:24-alpine

WORKDIR /app

# Copy only the dependency list first. Docker caches each step, so the slow
# npm ci step reruns only when these two files change, not on every code edit.
# --omit=dev skips devDependencies (vitest, eslint, ...) the server never loads.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Only what the server needs at runtime. swagger.js reads the @openapi
# comments from src/routers when the app starts.
COPY swagger.js ./
COPY src ./src

# The official image includes a non-root user named node. Running as that
# user limits what a compromised process can do inside the container.
USER node

# The platform provides PORT (and the other env vars) at run time.
CMD ["node", "src/server.js"]
