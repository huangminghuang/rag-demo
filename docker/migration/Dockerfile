FROM node:20-alpine

RUN apk add --no-cache bash postgresql-client

WORKDIR /app

COPY drizzle ./drizzle
COPY run-migrations.sh ./run-migrations.sh

CMD ["bash", "run-migrations.sh"]
