# Build stage - compiles TypeScript to plain JS. TypeScript itself never
# ships in the final image; it's a dev-only tool, same as running locally.
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.json ./
COPY src ./src
RUN npm ci
RUN npm run build

# Runtime stage - just the compiled JS on a bare Node image. No
# node_modules at all: dist/*.js only touches Node's built-in http/url
# modules, so there's nothing left to install.
FROM node:20-alpine
WORKDIR /app
COPY --from=build /app/dist ./dist
EXPOSE 43210
ENTRYPOINT ["node", "dist/index.js"]
