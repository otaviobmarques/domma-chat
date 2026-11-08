# Imagem única para API e workers. O comando escolhe o papel:
#   npm run start:api      (padrão)
#   npm run start:workers
FROM node:22-alpine
WORKDIR /app
COPY . .
RUN npm ci --no-audit --no-fund
ENV NODE_ENV=production
EXPOSE 3333
CMD ["npm", "run", "start:api"]
