# build stage: node toolchain produces the static bundle
FROM node:22-alpine AS build
WORKDIR /app

COPY package.json ./
RUN npm install

COPY vite.config.js index.html ./
COPY src ./src
RUN npm run build

# run stage: only the built assets ship, no node_modules
FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80
