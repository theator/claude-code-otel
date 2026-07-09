.PHONY: help setup up down restart logs ps clean start update

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
	  awk 'BEGIN {FS = ":.*?## "}; {printf "  make %-10s %s\n", $$1, $$2}'

setup: ## Configure Claude Code to export telemetry (merges into ~/.claude/settings.json)
	@bash setup.sh

up: ## Start the observability stack
	docker compose up -d
	@echo ""
	@echo "  Grafana (dashboard): http://localhost:3200"
	@echo "  Phoenix (LLM traces): http://localhost:6006"

down: ## Stop the stack (keeps data)
	docker compose down

restart: ## Recreate the stack (picks up dashboard/compose edits)
	docker compose up -d --force-recreate

update: ## Update to latest: git pull, pull pinned images, recreate (keeps your stored telemetry)
	git pull --ff-only
	docker compose pull
	docker compose up -d --force-recreate
	@echo ""
	@echo "  Updated. Dashboard/config changes are live at http://localhost:3200"

logs: ## Tail stack logs
	docker compose logs -f

ps: ## Show stack status
	docker compose ps

clean: ## Stop and DELETE all stored telemetry (removes volumes)
	docker compose down -v

start: setup up ## One-shot: configure telemetry + start the stack
	@echo ""
	@echo "All set. Run Claude Code in any project, then open http://localhost:3200"
