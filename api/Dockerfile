FROM node:20-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
ENV PORT=4000
EXPOSE 4000
CMD ["npx", "tsx", "src/server.ts"]
