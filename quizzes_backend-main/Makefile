SHELL := /bin/sh

COMPOSE := docker compose
SERVICE_APP := app
SERVICE_WORKER := worker

.PHONY: help build rebuild up down start stop restart ps logs logs-app logs-worker pull shell-app shell-worker clean prune

help:
	@echo "Available targets:"
	@echo "  make build        Build Docker images"
	@echo "  make rebuild      Rebuild images without cache"
	@echo "  make up           Start all services in detached mode"
	@echo "  make down         Stop and remove containers"
	@echo "  make start        Start existing containers"
	@echo "  make stop         Stop running containers"
	@echo "  make restart      Restart all services"
	@echo "  make ps           Show running services"
	@echo "  make logs         Tail logs for all services"
	@echo "  make logs-app     Tail logs for app service"
	@echo "  make logs-worker  Tail logs for worker service"
	@echo "  make pull         Pull latest base images"
	@echo "  make shell-app    Open shell in app container"
	@echo "  make shell-worker Open shell in worker container"
	@echo "  make clean        Remove containers, networks, and anonymous volumes"
	@echo "  make prune        Remove unused Docker resources"

build:
	$(COMPOSE) build

rebuild:
	$(COMPOSE) build --no-cache

up:
	$(COMPOSE) up -d --build

down:
	$(COMPOSE) down

start:
	$(COMPOSE) start

stop:
	$(COMPOSE) stop

restart:
	$(COMPOSE) restart

ps:
	$(COMPOSE) ps

logs:
	$(COMPOSE) logs -f

logs-app:
	$(COMPOSE) logs -f $(SERVICE_APP)

logs-worker:
	$(COMPOSE) logs -f $(SERVICE_WORKER)

pull:
	$(COMPOSE) pull

shell-app:
	$(COMPOSE) exec $(SERVICE_APP) sh

shell-worker:
	$(COMPOSE) exec $(SERVICE_WORKER) sh

clean:
	$(COMPOSE) down -v --remove-orphans

prune:
	docker system prune -f
