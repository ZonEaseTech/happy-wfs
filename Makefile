.PHONY: help prod-up prod-down prod-restart prod-pull prod-logs prod-ps prod-init prod-migrate prod-minio-init prod-backup prod-update dev-up dev-down dev-logs

# Default
help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-20s\033[0m %s\n", $$1, $$2}'

# ============================================================
# Production (pre-built images from Docker Hub)
# ============================================================

PROD_COMPOSE = docker compose -f docker-compose.prod.yml --env-file .env -p happy-ai

prod-pull: ## Pull latest images from Docker Hub
	$(PROD_COMPOSE) pull

prod-up: ## Start production services
	$(PROD_COMPOSE) up -d

prod-down: ## Stop production services
	$(PROD_COMPOSE) down

prod-restart: ## Restart production services
	$(PROD_COMPOSE) restart

prod-logs: ## Tail production logs
	$(PROD_COMPOSE) logs -f --tail=100

prod-ps: ## Show production service status
	$(PROD_COMPOSE) ps

prod-init: prod-migrate prod-minio-init ## First-time setup: run migrations + create MinIO bucket

prod-migrate: ## Run database migrations
	$(PROD_COMPOSE) exec happy-server yarn --cwd packages/happy-server prisma migrate deploy

prod-minio-init: ## Create MinIO bucket and set public access
	$(PROD_COMPOSE) exec minio mc alias set local http://localhost:9000 $$(grep S3_ACCESS_KEY .env | cut -d= -f2) $$(grep S3_SECRET_KEY .env | cut -d= -f2)
	$(PROD_COMPOSE) exec minio mc mb local/$$(grep S3_BUCKET .env | cut -d= -f2) --ignore-existing
	$(PROD_COMPOSE) exec minio mc anonymous set download local/$$(grep S3_BUCKET .env | cut -d= -f2)

prod-update: prod-pull ## Pull latest images and restart
	$(PROD_COMPOSE) up -d --remove-orphans
	@echo "✅ Updated to latest images"

prod-backup: ## Backup PostgreSQL database
	@mkdir -p backups
	$(PROD_COMPOSE) exec postgres pg_dump -U $$(grep POSTGRES_USER .env | cut -d= -f2) $$(grep POSTGRES_DB .env | cut -d= -f2) | gzip > backups/happy-$$(date +%Y%m%d_%H%M%S).sql.gz
	@echo "✅ Backup saved to backups/"

# ============================================================
# Development (local build)
# ============================================================

DEV_COMPOSE = docker compose -f docker-compose.yml --env-file .env -p happy-ai-dev

dev-up: ## Start dev services (local build)
	$(DEV_COMPOSE) up -d --build

dev-down: ## Stop dev services
	$(DEV_COMPOSE) down

dev-logs: ## Tail dev logs
	$(DEV_COMPOSE) logs -f --tail=100
