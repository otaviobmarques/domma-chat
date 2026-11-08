# Imagem única para API e workers (escolha com o comando). Ex.: docker run ... npm run start:api
FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/workers/package.json apps/workers/
COPY apps/web/package.json apps/web/
COPY packages/db/package.json packages/db/
COPY packages/core/package.json packages/core/
COPY packages/ia/package.json packages/ia/
COPY packages/shared/package.json packages/shared/
COPY packages/whatsapp/package.json packages/whatsapp/
COPY packages/pagamentos/package.json packages/pagamentos/
RUN npm ci --omit=dev --workspaces --include-workspace-root && npm i --no-save tsx@4.19.2
COPY . .
ENV NODE_ENV=production
EXPOSE 3333
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://localhost:3333/saude || exit 1
CMD ["npm", "run", "start:api"]
