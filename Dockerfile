# Imagen de producción de ZGZ Desplázate: compila la web y ejecuta el servidor Node (sin dependencias en runtime).
# Los datos (snapshots, subidas, claves de avisos, sugerencias) viven en /app/data: móntalo como volumen persistente.
#   docker build -t zgz-desplazate .
#   docker run -d -p 8080:8080 -v zgz-data:/app/data -e SITE_URL=https://tu-dominio.es zgz-desplazate
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=8080 HOST=0.0.0.0
COPY package.json ./
COPY server ./server
COPY src/geo.js ./src/geo.js
COPY public/data ./public/data
COPY --from=build /app/dist ./dist
RUN mkdir -p /app/data && chown node:node /app/data
USER node
VOLUME /app/data
EXPOSE 8080
HEALTHCHECK --interval=60s --timeout=5s CMD wget -qO- http://127.0.0.1:8080/api/health >/dev/null || exit 1
CMD ["node", "server/index.mjs"]
