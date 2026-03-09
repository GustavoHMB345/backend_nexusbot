# Estágio de execução: Imagem leve baseada em Alpine Linux
FROM node:22-alpine

# Definir diretório de trabalho
WORKDIR /app

# Copiar apenas os manifestos de pacotes primeiro
# Isso permite que o Docker use o cache se as dependências não mudarem
COPY package*.json ./

# Instalar apenas dependências de produção
RUN npm install --omit=dev

# Copiar o restante do código (respeitando o .dockerignore)
COPY . .

# A porta que o seu index.js usa (process.env.PORT || 8080)
EXPOSE 8080

# Forçar o Node a rodar em modo de produção para melhor performance
ENV NODE_ENV=production

# Comando para iniciar o servidor conforme definido no seu package.json
CMD ["npm", "start"]