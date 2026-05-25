FROM node:20-bookworm-slim

ARG FREELLMAPI_REPO=https://github.com/tashfeenahmed/freellmapi.git
ARG FREELLMAPI_REF=main

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates git python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /opt
RUN git clone --depth 1 --branch "${FREELLMAPI_REF}" "${FREELLMAPI_REPO}" freellmapi

WORKDIR /opt/freellmapi
RUN npm install

EXPOSE 3001 5173

CMD ["npx", "concurrently", "npm run dev -w server", "npm run dev -w client -- --host 0.0.0.0"]
