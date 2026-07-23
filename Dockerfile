FROM node:20-slim

WORKDIR /app

COPY server/package*.json ./
RUN npm install --production

COPY server ./

EXPOSE 3001
ENV PORT=3001
CMD ["node", "server.js"]
