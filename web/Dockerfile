FROM node:20-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npx next build
EXPOSE 3000
CMD ["npx", "next", "start", "-p", "3000"]
