FROM node:22-alpine

WORKDIR /app

# deps first so this layer caches when only source changes
COPY package.json ./
RUN npm install --omit=dev

COPY index.js ./

EXPOSE 3000
CMD ["npm", "start"]
