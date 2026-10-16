# syntax=docker/dockerfile:1
# ShelfWise UI: build with Node, serve the static files with unprivileged nginx.
# Base images are pinned by tag and digest so a rebuild is reproducible.

# --- build ------------------------------------------------------------------
FROM node:24.22.0-alpine3.24@sha256:44fce696f38ba8c987c4db89954051000bbd05ffd8d8659ba15ed4a8602e937f AS build
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
ARG APP_VERSION=dev
ENV VITE_APP_VERSION=${APP_VERSION}
RUN npm run build

# --- runtime ----------------------------------------------------------------
FROM nginxinc/nginx-unprivileged:1.31.7-alpine3.24@sha256:378d0c32f6562f7fd9629170797f57d2b953aa09be983b3daaf4809bb039ca00 AS runtime
ARG APP_VERSION=dev
LABEL org.opencontainers.image.title="shelfwise-frontend" \
      org.opencontainers.image.description="ShelfWise library lending UI (React, served by nginx)" \
      org.opencontainers.image.source="https://github.com/shubhamkumar9199/devops-heros" \
      org.opencontainers.image.version="${APP_VERSION}"

# The image ships optional modules we never load; they drag in libraries (libgd,
# libtiff, libxml2, ...) that only add CVEs. Remove them and patch what's left.
USER root
RUN apk del --no-cache nginx-module-image-filter nginx-module-xslt nginx-module-geoip nginx-module-njs \
 && apk upgrade --no-cache \
 && rm -f /etc/nginx/conf.d/default.conf
USER 101

# The entrypoint renders templates/*.template into conf.d/ with envsubst at start,
# filling in BACKEND_URL (compose: http://backend:8000, Kubernetes: the Service).
COPY --chown=101:101 nginx/default.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build --chown=101:101 /src/dist /usr/share/nginx/html
ENV BACKEND_URL=http://backend:8000
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 \
  CMD ["wget", "-q", "-O", "/dev/null", "http://127.0.0.1:8080/healthz"]
