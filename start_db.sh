#!/bin/bash
# export DOCKER_HOST="unix:///var/folders/mw/h0ss1nvj50n1ht5p92vcz_300000gp/T/podman/podman-machine-default-api.sock"
# docker-compose down -v
docker-compose up -d db 
docker-compose --env-file .env --env-file .env.local run --rm migration
docker-compose --env-file .env --env-file .env.local run --rm seed_admin