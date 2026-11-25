# Image unique : l'API Express sert aussi la PWA construite (même origine).
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci --ignore-scripts
COPY . .
RUN npx --workspace apps/api prisma generate \
 && npm run build --workspace apps/web \
 && npm run build --workspace apps/api

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app /app
RUN npm prune --omit=dev --ignore-scripts || true
EXPOSE 3000
# Applique les migrations puis démarre (le programme de fond tourne dans le même processus).
CMD ["sh", "-c", "npx --workspace apps/api prisma migrate deploy && node apps/api/dist/server.js"]
