FROM node:22-alpine AS base
WORKDIR /app
ENV CI=true
RUN corepack enable

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/builder-worker/package.json apps/builder-worker/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/codegen/package.json packages/codegen/package.json
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
RUN pnpm --filter @atoms-cp/builder-worker build

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /app /app
CMD ["pnpm", "--filter", "@atoms-cp/builder-worker", "start"]
