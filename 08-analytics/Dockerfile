# Build stage - installs all deps (incl. dev) and compiles TypeScript.
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.json ./
COPY src ./src
RUN npm ci
RUN npm run build

# Runtime stage - compiled JS plus production-only node_modules. Shared by
# both the api and cleaner docker-compose services: they run this same
# image with a different CMD (see docker-compose.yml), so there's one
# image to build and version instead of two near-identical ones.
FROM node:20-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
COPY migrations ./migrations
ENV PORT=3000
EXPOSE 3000
CMD ["node", "dist/src/main.js"]
