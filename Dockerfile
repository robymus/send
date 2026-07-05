FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
COPY migrations ./migrations
COPY public ./public
EXPOSE 3000
# dokku chowns storage mounts to 32767:32767 — run as that uid so /data is writable
RUN addgroup -g 32767 app && adduser -D -G app -u 32767 app
USER app
CMD ["node", "dist/server.js"]
