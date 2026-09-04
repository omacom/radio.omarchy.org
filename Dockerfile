FROM node:24-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg espeak-ng util-linux && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --chown=node:node . .
RUN mkdir -p /app/var && chown node:node /app/var
USER node
ENV BIND=0.0.0.0 PORT=8787 RADIO_DATA=/app/var
VOLUME /app/var
EXPOSE 8787
CMD ["node", "server/index.mjs"]
