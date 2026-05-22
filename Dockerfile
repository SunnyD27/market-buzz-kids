FROM node:20-slim

WORKDIR /app

# Copy lockfile too so `npm ci` is deterministic and faster than `npm install`.
COPY package.json package-lock.json ./

# --omit=dev skips devDependencies; equivalent to the older --production flag.
RUN npm ci --omit=dev

# Application code + static assets. .dockerignore should keep node_modules,
# .env, public/index.html, public/digest-data.json, and state/ out of the image.
COPY src/ ./src/
COPY public/ ./public/

# Pre-create the state dir so word/fact history persistence doesn't have to
# mkdir on first write. (Note: Railway containers are ephemeral — state here
# survives restarts within a container but does NOT persist across redeploys.
# For real-world rotation persistence post-deploy we'd want this in Postgres.)
RUN mkdir -p ./state

ENV NODE_ENV=production
# Railway injects $PORT at runtime; the app falls back to 3000 locally.
EXPOSE 3000

CMD ["node", "src/server.js"]
