FROM node:20-slim AS builder

WORKDIR /app/client
COPY client/package*.json ./
RUN npm install
COPY client ./
RUN npm run build

FROM node:20-slim AS runtime

WORKDIR /app
# Development DB defaults (override with --build-arg or runtime env)
ARG MONGODB_URI="mongodb://localhost:27017/saliditapp-calendar"
ARG MONGODB_NAME="saliditapp-calendar"
ENV MONGODB_URI=$MONGODB_URI
ENV MONGODB_NAME=$MONGODB_NAME

COPY server/package*.json ./server/
RUN npm install --production --prefix server

COPY server ./server
COPY --from=builder /app/client/dist ./client/dist

EXPOSE 3001
ENV PORT=3001
CMD ["node", "server/server.js"]
