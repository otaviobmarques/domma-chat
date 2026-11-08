# Imagem única para API e workers. A variável PAPEL escolhe o que roda:
#   PAPEL=api (padrão)  ou  PAPEL=workers
FROM node:22-alpine
WORKDIR /app
COPY . .
RUN npm ci --no-audit --no-fund
ENV NODE_ENV=production
EXPOSE 3333
CMD ["sh", "-c", "npm run start:${PAPEL:-api}"]
