# Cloudflare Worker + Durable Object live room, run locally with wrangler (workerd/miniflare under the hood).
FROM node:22-bookworm-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ENV WRANGLER_SEND_METRICS=false
EXPOSE 8787
# --var lets docker-compose inject the shared secret; state lives in .wrangler/ inside the container.
CMD ["sh", "-c", "npx wrangler dev --local --ip 0.0.0.0 --port 8787 --var REALTIME_SECRET:${REALTIME_SECRET:-dev-realtime-secret}"]
