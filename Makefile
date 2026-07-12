.PHONY: help setup up down restart logs ps clean start update reload-alerts setup-slack remove-slack

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
	  awk 'BEGIN {FS = ":.*?## "}; {printf "  make %-14s %s\n", $$1, $$2}'

setup: ## Configure Claude Code to export telemetry (merges into ~/.claude/settings.json)
	@bash setup.sh

up: ## Start the observability stack
	docker compose up -d
	@echo ""
	@echo "  Grafana (dashboard): http://localhost:3300"
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
	@echo "  Updated. Dashboard/config changes are live at http://localhost:3300"

logs: ## Tail stack logs
	docker compose logs -f

ps: ## Show stack status
	docker compose ps

clean: ## Stop and DELETE all stored telemetry (removes volumes)
	docker compose down -v

reload-alerts: ## Reload alert rules after editing grafana-alerting/*.yaml
	# The provisioning reload API needs Grafana-Admin, which anonymous auth never has; restart instead.
	docker compose restart lgtm
	@echo "Alert rules reloaded."

setup-slack: ## Enable Slack notifications for alerts (prompts for a webhook URL, stays local)
	# printf+read instead of `read -p`: dash (Linux /bin/sh) has no -p flag.
	@printf "Slack webhook URL (stored locally in grafana-alerting/notifications.yaml, never committed): "; \
	read url; \
	if [ -z "$$url" ]; then echo "No URL entered — aborting, nothing changed."; exit 1; fi; \
	case "$$url" in https://hooks.slack.com/*) ;; *) echo "That doesn't look like a Slack webhook URL (https://hooks.slack.com/...) — aborting."; exit 1;; esac; \
	sed "s#<YOUR_SLACK_WEBHOOK_URL>#$$url#" grafana-alerting/notifications.yaml.example > grafana-alerting/notifications.yaml
	@$(MAKE) reload-alerts
	@echo ""
	@echo "Slack notifications enabled. Test it: Grafana -> Alerting -> Contact points -> cc-slack -> Test."

remove-slack: ## Disable Slack notifications (alerts revert to UI-only)
	# Removing the file alone doesn't retract already-provisioned Grafana state; explicitly delete it first.
	@printf 'apiVersion: 1\ndeleteContactPoints:\n  - orgId: 1\n    uid: cc-slack\ndeleteTemplates:\n  - orgId: 1\n    name: claude-code-slack\nresetPolicies:\n  - 1\n' > grafana-alerting/notifications.yaml
	@$(MAKE) reload-alerts
	@i=0; while [ $$i -lt 20 ]; do curl -sf http://localhost:3300/api/health >/dev/null 2>&1 && break; i=$$((i+1)); sleep 1; done
	# Only delete the cleanup file once Grafana has provably read it; otherwise the retraction never applies.
	@if curl -sf http://localhost:3300/api/health >/dev/null 2>&1; then \
	  rm -f grafana-alerting/notifications.yaml; \
	  echo "Slack notifications removed — alerts are UI-only again."; \
	else \
	  echo "Grafana didn't come back within 20s — cleanup file left in place; run 'make remove-slack' again once the stack is up."; \
	fi

start: setup up ## One-shot: configure telemetry + start the stack
	@echo ""
	@echo "All set. Run Claude Code in any project, then open http://localhost:3300"
