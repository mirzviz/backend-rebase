# Build stage - installs all deps (incl. dev) and compiles TypeScript.
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.json ./
COPY src ./src
RUN npm ci
RUN npm run build

# Runtime stage - compiled JS plus production-only node_modules. Unlike
# the earlier exercises in this repo, this image can't ship with zero
# node_modules: NestJS and mime-types are real runtime dependencies here,
# not dev-only tools - this assignment explicitly allows an HTTP
# framework/lib of your choice, so that trade-off is intentional.
FROM node:20-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
ENV PORT=3000
EXPOSE 3000
ENTRYPOINT ["node", "dist/main.js"]
