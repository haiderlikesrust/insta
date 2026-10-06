# syntax=docker/dockerfile:1
FROM node:22-bookworm-slim AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM dependencies AS web-build
COPY . .
RUN npm run build:dokploy

FROM node:22-bookworm-slim AS web
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000
COPY --from=web-build --chown=node:node /app/dist/standalone/ ./
COPY --chown=node:node drizzle ./drizzle
USER node
EXPOSE 3000
CMD ["node", "server.js"]

FROM nginx:1.28-alpine AS gateway
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
