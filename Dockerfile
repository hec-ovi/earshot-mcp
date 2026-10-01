FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY bin bin
COPY bus bus
COPY server server
ENV EARSHOT_DIR=/bus
ENTRYPOINT ["node", "bin/earshot.mjs"]
