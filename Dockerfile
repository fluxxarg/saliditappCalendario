FROM node:20-slim AS builder

WORKDIR /app/client
COPY client/package*.json ./
RUN npm install
COPY client ./
RUN npm run build

FROM node:20-slim AS runtime

WORKDIR /app

COPY server/package*.json ./server/
RUN npm install --production --prefix server

COPY server ./server
COPY --from=builder /app/client/dist ./client/dist

EXPOSE 3001
ENV PORT=3001
CMD ["node", "server/server.js"]
