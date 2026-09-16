FROM node:24-alpine AS build
WORKDIR /app
COPY package.json pnpm-lock.yaml* yarn.lock* package-lock.json* pnpm-workspace.yaml* .npmrc* ./
RUN corepack enable && pnpm install --frozen-lockfile
COPY . .
RUN pnpm run build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
