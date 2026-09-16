FROM node:24-alpine
WORKDIR /app
COPY package.json pnpm-lock.yaml* yarn.lock* package-lock.json* pnpm-workspace.yaml* .npmrc* ./
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable && if [ -f pnpm-lock.yaml ]; then pnpm install --frozen-lockfile; else pnpm install; fi
COPY . .
RUN pnpm run build
ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000
CMD ["pnpm", "run", "start"]
