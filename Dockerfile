ARG PNPM_VERSION=10.33.2

# Etapa 1: dependencias
FROM node:22-slim AS deps
ARG PNPM_VERSION
WORKDIR /app
RUN npm install -g pnpm@${PNPM_VERSION}
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# Etapa 2: compilacion
FROM deps AS build
COPY tsconfig.json tsconfig.build.json prisma.config.ts ./
COPY prisma ./prisma
COPY src ./src
# La URL es solo de relleno: generar el cliente no abre ninguna conexion
RUN DATABASE_URL=postgresql://build:build@localhost:5432/build pnpm exec prisma generate && pnpm build

# Etapa 3: ejecucion
FROM node:22-slim AS runtime
ARG PNPM_VERSION
WORKDIR /app
ENV NODE_ENV=production
RUN apt-get update -y && apt-get install -y --no-install-recommends openssl ca-certificates curl \
  && rm -rf /var/lib/apt/lists/* \
  && npm install -g pnpm@${PNPM_VERSION}
COPY package.json pnpm-lock.yaml prisma.config.ts ./
RUN pnpm install --frozen-lockfile --prod=false
COPY --from=build /app/dist ./dist
COPY prisma ./prisma
RUN chown -R node:node /app
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
  CMD curl -fsS http://localhost:3000/api/v1/health || exit 1
CMD ["sh", "-c", "pnpm exec prisma migrate deploy && node dist/server.js"]
