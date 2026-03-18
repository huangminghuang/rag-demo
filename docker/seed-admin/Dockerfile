FROM node:20-alpine

RUN apk add --no-cache bash postgresql-client

WORKDIR /app

COPY seed-default-admin.sh ./seed-default-admin.sh

CMD ["bash", "seed-default-admin.sh"]
