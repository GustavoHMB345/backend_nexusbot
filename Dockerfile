# Estágio 1: Usar uma imagem leve do Node.js 22 (Alpine Linux)
FROM node:22-alpine

# Definir o diretório de trabalho dentro do container
WORKDIR /app

# Copiar apenas os arquivos de dependências primeiro (otimiza o cache do Docker)
COPY package*.json ./

# Instalar apenas dependências de produção para manter a imagem leve
RUN npm install --omit=dev

# Copiar o restante do código do backend
COPY . .

# Informar ao Railway a porta que o container utiliza (default 8080)
EXPOSE 8080

# Variável de ambiente para garantir que o Node rode em modo produção
ENV NODE_ENV=production

# Comando para iniciar o servidor
CMD ["node", "index.js"]