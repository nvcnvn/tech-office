# Tech Office — Test Runner
#
# Usage:
#   make dev-backend           Quick dev loop: docker compose up -d + air (hot reload)
#   make dev-web               Quick dev loop: Next.js dev server on :13000
#   make dev-mobile            Quick dev loop: Metro for a physical iPhone
#   make test-backend          Run Go integration tests (requires backend + postgres)
#   make test-frontend         Run Playwright E2E tests  (requires backend + frontend)
#   make test-mobile           Run all Maestro flows on simulator/emulator
#   make test-mobile-one F=auth/signin   Run a single Maestro flow
#   make voice-dev-infra-up    Start local infra with LiveKit voice env defaults
#   make voice-dev-backend     Run backend with matching LiveKit env defaults
#   make test                  Run backend + frontend tests
#   make prod-build            Build backend/web production images with one release tag
#   make prod-publish          Build and push backend/web production images with one release tag
#   make prod-build-mobile     Start an EAS mobile production build with the same release tag
#   make check-servers         Just verify services are reachable
#   make check-tracked-files   Check that no large or binary files are tracked in Git
#
# Prerequisites:
#   - PostgreSQL running (docker compose up postgres)
#   - Backend server running on :8080
#   - Frontend dev server running on :13000 (for E2E only)

BACKEND_URL  ?= http://localhost:18080
FRONTEND_URL ?= http://localhost:13000
PG_PORT      ?= 15432
RELEASE_TAG  ?= $(shell date -u +%Y%m%d%H%M%S)
RELEASE_TAG  := $(RELEASE_TAG)


BACKEND_IMAGE     ?= docker.io/nvcnvn/tech-office-backend
MIGRATE_IMAGE     ?= docker.io/nvcnvn/tech-office-backend-migrate
WEB_IMAGE         ?= docker.io/nvcnvn/tech-office-web
BACKEND_IMAGE_TAG ?= $(RELEASE_TAG)
MIGRATE_IMAGE_TAG ?= $(RELEASE_TAG)
WEB_IMAGE_TAG     ?= $(RELEASE_TAG)

# Multi-arch build defaults (comma-separated platforms)
BUILD_PLATFORMS ?= linux/amd64,linux/arm64
# Buildx command (can be overridden)
DOCKER_BUILDX ?= docker buildx build
# Buildx builder name
BUILDX_BUILDER_NAME ?= techoffice-builder

PROD_WEB_URL     ?= https://transformar.work
PROD_API_URL     ?= https://transformar.api.devguards.com
PROD_LIVEKIT_URL ?= wss://transformar.media.devguards.com
PROD_GOOGLE_CLIENT_ID ?=751712281610-ul8m5aval9208357ljvm31uuutt80o9l.apps.googleusercontent.com
PROD_APPLE_CLIENT_ID  ?=work.transformar.web
MOBILE_PROFILE   ?= production
MOBILE_PLATFORM  ?= all

# ---------------------------------------------------------------------------
# Health checks
# ---------------------------------------------------------------------------

.PHONY: check-backend
check-backend:
	@printf "Checking backend at $(BACKEND_URL)... "
	@curl -sf -o /dev/null --max-time 3 $(BACKEND_URL)/healthz 2>/dev/null \
		&& echo "✓ up" \
		|| (echo "✗ not reachable"; echo "  Start with: make voice-dev-backend"; exit 1)

.PHONY: check-frontend
check-frontend:
	@printf "Checking frontend at $(FRONTEND_URL)... "
	@curl -sf -o /dev/null --max-time 3 $(FRONTEND_URL) 2>/dev/null \
		&& echo "✓ up" \
		|| (echo "✗ not reachable"; echo "  Start with: cd frontend && pnpm --filter web dev"; exit 1)

.PHONY: check-postgres
check-postgres:
	@printf "Checking PostgreSQL on port $(PG_PORT)... "
	@pg_isready -h localhost -p $(PG_PORT) -q 2>/dev/null \
		&& echo "✓ up" \
		|| (nc -z localhost $(PG_PORT) 2>/dev/null \
			&& echo "✓ up" \
			|| (echo "✗ not reachable"; echo "  Start with: cd backend && docker compose up -d postgres"; exit 1))

.PHONY: check-servers
check-servers: check-postgres check-backend check-frontend

.PHONY: check-tracked-files
check-tracked-files:
	@bash scripts/check-tracked-files.sh


# ---------------------------------------------------------------------------
# Backend integration tests
# ---------------------------------------------------------------------------

.PHONY: test-backend
test-backend: check-postgres check-backend
	@echo "\n=== Running backend integration tests ==="
	cd backend && go test -v -count=1 -timeout 120s ./integration/...

# Run a single backend test by name: make test-backend-one T=TestTaskLifecycle
.PHONY: test-backend-one
test-backend-one: check-postgres check-backend
	@echo "\n=== Running backend test: $(T) ==="
	cd backend && go test -v -count=1 -timeout 120s -run "$(T)" ./integration/...

# ---------------------------------------------------------------------------
# Frontend E2E tests (Playwright)
# ---------------------------------------------------------------------------

.PHONY: test-frontend
test-frontend: check-backend check-frontend
	@echo "\n=== Running frontend E2E tests ==="
	cd frontend && pnpm --filter web e2e

# Run a single spec file: make test-frontend-one F=project-team
.PHONY: test-frontend-one
test-frontend-one: check-backend check-frontend
	@echo "\n=== Running frontend E2E: $(F).spec.ts ==="
	cd frontend && pnpm --filter web exec playwright test --config=apps/web/e2e/playwright.config.ts "$(F)"

# Run with headed browser for debugging
.PHONY: test-frontend-headed
test-frontend-headed: check-backend check-frontend
	cd frontend && pnpm --filter web e2e:headed

# Run with Playwright UI mode
.PHONY: test-frontend-ui
test-frontend-ui: check-backend check-frontend
	cd frontend && pnpm --filter web e2e:ui

# Run with screenshots enabled
.PHONY: test-frontend-screenshots
test-frontend-screenshots: check-backend check-frontend
	E2E_SCREENSHOTS=1 cd frontend && pnpm --filter web e2e

# ---------------------------------------------------------------------------
# All tests
# ---------------------------------------------------------------------------

.PHONY: test
test: check-postgres check-backend check-frontend
	@echo "\n=== Running ALL tests ===\n"
	$(MAKE) test-backend
	$(MAKE) test-frontend

# ---------------------------------------------------------------------------
# Maestro mobile UI tests
# ---------------------------------------------------------------------------
#
# Prerequisites:
#   - Maestro CLI installed (brew tap mobile-dev-inc/tap && brew install maestro)
#   - App installed on simulator/emulator (pnpm ios / pnpm android)
#   - Metro bundler running (pnpm expo start)
#   - Backend server running on :8080
#   - Copy .maestro/.env.example to .maestro/.env and fill in credentials
#
# The .env file provides: MAESTRO_TEST_SUBDOMAIN, MAESTRO_TEST_EMAIL,
# MAESTRO_TEST_PASSWORD, MAESTRO_TEST_PIN

MAESTRO_DIR ?= frontend/apps/mobile/.maestro
MAESTRO_ENV ?= $(MAESTRO_DIR)/.env

export MAESTRO_CLI_NO_ANALYTICS := 1

# Auto-detect maestro binary (Homebrew keg or PATH)
MAESTRO_BIN := $(shell command -v maestro 2>/dev/null \
	|| echo /opt/homebrew/Cellar/maestro/2.3.0/libexec/bin/maestro)

# Build -e KEY=VALUE flags from .env file
MAESTRO_ENV_FLAGS = $(shell test -f $(MAESTRO_ENV) && \
	grep -v '^\#' $(MAESTRO_ENV) | grep '=' | sed 's/^/-e /' | tr '\n' ' ')

.PHONY: check-maestro
check-maestro:
	@$(MAESTRO_BIN) --version >/dev/null 2>&1 \
		|| (echo "✗ maestro not found. Install: brew tap mobile-dev-inc/tap && brew install maestro"; exit 1)
	@echo "✓ maestro ($$($(MAESTRO_BIN) --version 2>&1 | head -1))"

.PHONY: check-maestro-env
check-maestro-env:
	@test -f $(MAESTRO_ENV) \
		|| (echo "✗ $(MAESTRO_ENV) not found. Copy from .env.example and fill in credentials."; exit 1)
	@echo "✓ maestro env loaded"

.PHONY: check-maestro-canonical-env
check-maestro-canonical-env: check-maestro-env
	@missing_vars=""; \
	for var in \
		MAESTRO_CANONICAL_TASK_LINK \
		MAESTRO_CANONICAL_TASK_OPEN_LINK \
		MAESTRO_CANONICAL_ACCESS_DENIED_OPEN_LINK \
		MAESTRO_CANONICAL_NOT_FOUND_OPEN_LINK \
		MAESTRO_CANONICAL_TASK_READY_TEXT \
		MAESTRO_CANONICAL_PREVIEW_CHANNEL_ID; do \
			grep -q "^$$var=" $(MAESTRO_ENV) || missing_vars="$$missing_vars $$var"; \
	done; \
	if [ -n "$$missing_vars" ]; then \
		echo "✗ Missing canonical Maestro vars in $(MAESTRO_ENV):$$missing_vars"; \
		exit 1; \
	fi
	@echo "✓ canonical Maestro vars loaded"

.PHONY: test-mobile
## Run all Maestro flows on the connected simulator/emulator.
test-mobile: check-backend check-maestro check-maestro-env
	@echo "\n=== Running all Maestro flows ==="
	frontend/apps/mobile/scripts/run-maestro-coverage.sh

.PHONY: test-mobile-one
## Run a single Maestro flow. Usage: make test-mobile-one F=auth/signin
test-mobile-one: check-backend check-maestro check-maestro-env
	@if [ "$(F)" = "canonical-resource-links" ]; then \
		$(MAKE) check-maestro-canonical-env; \
	fi
	@echo "\n=== Running Maestro flow: $(F).yaml ==="
	$(MAESTRO_BIN) test $(MAESTRO_ENV_FLAGS) $(MAESTRO_DIR)/$(F).yaml

# ---------------------------------------------------------------------------
# Quick development loop
# ---------------------------------------------------------------------------
#
# make dev-infra           Start ALL local services (postgres, livekit, clamav,
#                          gotenberg, whisper) via docker compose
# make dev-backend         Hot-reload backend with air (installs infra first)
# make dev-web             Next.js dev server on :13000
# make dev-mobile          Metro dev server for a physical iPhone (LAN IP)
# make dev-mobile-device DEVICE=<name-or-udid>   Build & install on the phone

.PHONY: dev-infra
dev-infra:
	cd backend && docker compose up -d

.PHONY: dev-backend
dev-backend: dev-infra
	@command -v air >/dev/null 2>&1 \
		|| (echo "✗ air not found. Install: go install github.com/air-verse/air@latest"; exit 1)
	@test -f backend/.env \
		|| (echo "backend/.env not found — creating from .env.example"; cp backend/.env.example backend/.env)
	cd backend && air

.PHONY: dev-web
dev-web:
	cd frontend && pnpm -F web dev

.PHONY: dev-mobile
dev-mobile:
	cd frontend/apps/mobile && pnpm start:ios

.PHONY: dev-mobile-device
dev-mobile-device:
	@test -n "$(DEVICE)" \
		|| (echo "Usage: make dev-mobile-device DEVICE=<name-or-udid>"; exit 1)
	cd frontend/apps/mobile && pnpm ios:device --device "$(DEVICE)"

# ---------------------------------------------------------------------------
# Infrastructure helpers
# ---------------------------------------------------------------------------

.PHONY: voice-dev-print-env
voice-dev-print-env:
	@bash backend/scripts/dev/voice-env.sh

.PHONY: voice-dev-infra-up
voice-dev-infra-up:
	@echo "Starting local voice infra..."
	@eval "$$(bash backend/scripts/dev/voice-env.sh)"; \
		echo "  PUBLIC_LIVEKIT_URL=$$PUBLIC_LIVEKIT_URL"; \
		cd backend && docker compose up -d postgres livekit clamav gotenberg

.PHONY: voice-dev-backend
voice-dev-backend:
	@eval "$$(bash backend/scripts/dev/voice-env.sh)"; \
		echo "Starting backend with local voice env..."; \
		echo "  PUBLIC_LIVEKIT_URL=$$PUBLIC_LIVEKIT_URL"; \
		cd backend && go run ./cmd server

.PHONY: infra-up
infra-up:
	@echo "Starting PostgreSQL + supporting services..."
	cd backend && docker compose up -d postgres clamav gotenberg

.PHONY: infra-down
infra-down:
	cd backend && docker compose down

# ---------------------------------------------------------------------------
# Production images and builds
# ---------------------------------------------------------------------------

.PHONY: docker-build-migrate
docker-build-migrate:
	@echo "\n=== Building migration image $(MIGRATE_IMAGE):$(MIGRATE_IMAGE_TAG) ==="
	@docker build -f backend/Dockerfile.migrate -t $(MIGRATE_IMAGE):$(MIGRATE_IMAGE_TAG) backend

.PHONY: docker-build-migrate-multi
docker-build-migrate-multi: ensure-buildx
	@echo "\n=== Building multi-arch migration image $(MIGRATE_IMAGE):$(MIGRATE_IMAGE_TAG) ==="
	@$(DOCKER_BUILDX) --builder $(BUILDX_BUILDER_NAME) --platform=$(BUILD_PLATFORMS) -f backend/Dockerfile.migrate -t $(MIGRATE_IMAGE):$(MIGRATE_IMAGE_TAG) backend --push

.PHONY: docker-build-backend
docker-build-backend:
	@echo "\n=== Building backend image $(BACKEND_IMAGE):$(BACKEND_IMAGE_TAG) ==="
	@docker build -f backend/Dockerfile -t $(BACKEND_IMAGE):$(BACKEND_IMAGE_TAG) backend

.PHONY: docker-build-backend-multi
docker-build-backend-multi: ensure-buildx
	@echo "\n=== Building multi-arch backend image $(BACKEND_IMAGE):$(BACKEND_IMAGE_TAG) ==="
	@$(DOCKER_BUILDX) --builder $(BUILDX_BUILDER_NAME) --platform=$(BUILD_PLATFORMS) -f backend/Dockerfile -t $(BACKEND_IMAGE):$(BACKEND_IMAGE_TAG) backend --push

.PHONY: docker-build-web
docker-build-web:
	@echo "\n=== Building web image $(WEB_IMAGE):$(WEB_IMAGE_TAG) ==="
	@docker build -f frontend/Dockerfile \
		--build-arg RELEASE_TAG=$(RELEASE_TAG) \
		--build-arg NEXT_PUBLIC_BASE_URL=$(PROD_WEB_URL) \
		--build-arg NEXT_PUBLIC_API_URL=$(PROD_API_URL) \
		--build-arg NEXT_PUBLIC_API_BASE_URL=$(PROD_API_URL) \
		--build-arg NEXT_PUBLIC_GOOGLE_CLIENT_ID=$(PROD_GOOGLE_CLIENT_ID) \
		--build-arg NEXT_PUBLIC_APPLE_CLIENT_ID=$(PROD_APPLE_CLIENT_ID) \
		-t $(WEB_IMAGE):$(WEB_IMAGE_TAG) frontend

.PHONY: docker-build-web-multi
docker-build-web-multi: ensure-buildx
	@echo "\n=== Building multi-arch web image $(WEB_IMAGE):$(WEB_IMAGE_TAG) ==="
	@$(DOCKER_BUILDX) --builder $(BUILDX_BUILDER_NAME) --platform=$(BUILD_PLATFORMS) -f frontend/Dockerfile \
		--build-arg RELEASE_TAG=$(RELEASE_TAG) \
		--build-arg NEXT_PUBLIC_BASE_URL=$(PROD_WEB_URL) \
		--build-arg NEXT_PUBLIC_API_URL=$(PROD_API_URL) \
		--build-arg NEXT_PUBLIC_API_BASE_URL=$(PROD_API_URL) \
		--build-arg NEXT_PUBLIC_GOOGLE_CLIENT_ID=$(PROD_GOOGLE_CLIENT_ID) \
		--build-arg NEXT_PUBLIC_APPLE_CLIENT_ID=$(PROD_APPLE_CLIENT_ID) \
		-t $(WEB_IMAGE):$(WEB_IMAGE_TAG) frontend --push

.PHONY: ensure-buildx
ensure-buildx:
	@echo "Checking docker buildx builder '$(BUILDX_BUILDER_NAME)'..."
	@set -e; \
	# Try to register qemu emulators (may require privileged docker)
	(docker run --rm --privileged tonistiigi/binfmt --install all >/dev/null 2>&1 || true); \
	if docker buildx inspect $(BUILDX_BUILDER_NAME) >/dev/null 2>&1; then \
		echo "✓ builder exists: $(BUILDX_BUILDER_NAME)"; \
	else \
		echo "Creating buildx builder '$(BUILDX_BUILDER_NAME)' using driver 'docker-container'..."; \
		docker buildx create --name $(BUILDX_BUILDER_NAME) --driver docker-container --use || exit 1; \
		docker buildx inspect --bootstrap >/dev/null || true; \
	fi; \
	# Ensure builder is selected and bootstrapped
	(docker buildx use $(BUILDX_BUILDER_NAME) >/dev/null 2>&1 || true); \
	docker buildx inspect --bootstrap >/dev/null 2>&1 || true; \
	# Check reported platforms
	if docker buildx inspect $(BUILDX_BUILDER_NAME) --format '{{range .Platforms}}{{.}} {{end}}' 2>/dev/null | grep -q 'linux/arm64'; then \
		echo "✓ builder supports target platforms"; \
	else \
		echo "Warning: builder does not list required platforms; multi-arch build may still work if qemu is available." >&2; \
		true; \
	fi

.PHONY: docker-push-migrate
docker-push-migrate:
	@echo "\n=== Pushing migration image $(MIGRATE_IMAGE):$(MIGRATE_IMAGE_TAG) ==="
	docker push $(MIGRATE_IMAGE):$(MIGRATE_IMAGE_TAG)

.PHONY: docker-push-backend
docker-push-backend:
	@echo "\n=== Pushing backend image $(BACKEND_IMAGE):$(BACKEND_IMAGE_TAG) ==="
	docker push $(BACKEND_IMAGE):$(BACKEND_IMAGE_TAG)

.PHONY: docker-push-web
docker-push-web:
	@echo "\n=== Pushing web image $(WEB_IMAGE):$(WEB_IMAGE_TAG) ==="
	docker push $(WEB_IMAGE):$(WEB_IMAGE_TAG)

.PHONY: docker-publish-migrate
# Use buildx multi-arch build-and-push by default
docker-publish-migrate: docker-build-migrate-multi

.PHONY: docker-publish-backend
# Use buildx multi-arch build-and-push by default
docker-publish-backend: docker-build-backend-multi

.PHONY: docker-publish-web
# Use buildx multi-arch build-and-push by default
docker-publish-web: docker-build-web-multi

.PHONY: prod-print-env
prod-print-env:
	@echo "RELEASE_TAG=$(RELEASE_TAG)"
	@echo "MIGRATE_IMAGE=$(MIGRATE_IMAGE):$(MIGRATE_IMAGE_TAG)"
	@echo "BACKEND_IMAGE=$(BACKEND_IMAGE):$(BACKEND_IMAGE_TAG)"
	@echo "WEB_IMAGE=$(WEB_IMAGE):$(WEB_IMAGE_TAG)"
	@echo "PROD_WEB_URL=$(PROD_WEB_URL)"
	@echo "PROD_API_URL=$(PROD_API_URL)"
	@echo "PROD_LIVEKIT_URL=$(PROD_LIVEKIT_URL)"
	@echo "PROD_GOOGLE_CLIENT_ID=$(PROD_GOOGLE_CLIENT_ID)"
	@echo "PROD_APPLE_CLIENT_ID=$(PROD_APPLE_CLIENT_ID)"

.PHONY: prod-build
prod-build: prod-print-env docker-build-migrate docker-build-backend docker-build-web

.PHONY: prod-publish
prod-publish: prod-print-env docker-publish-migrate docker-publish-backend docker-publish-web

.PHONY: prod-preflight-mobile
prod-preflight-mobile:
	@echo "\n=== Checking mobile TypeScript for release $(RELEASE_TAG) ==="
	cd frontend && pnpm run typecheck:mobile

.PHONY: prod-build-mobile
prod-build-mobile: prod-preflight-mobile
	@echo "\n=== Starting mobile EAS build $(RELEASE_TAG) ($(MOBILE_PROFILE), $(MOBILE_PLATFORM)) ==="
	cd frontend/apps/mobile && \
		EXPO_PUBLIC_API_URL=$(PROD_API_URL) \
		EXPO_PUBLIC_WEB_URL=$(PROD_WEB_URL) \
		EXPO_PUBLIC_RELEASE_TAG=$(RELEASE_TAG) \
		pnpm dlx eas-cli build --profile $(MOBILE_PROFILE) --platform $(MOBILE_PLATFORM) --non-interactive

.PHONY: k8s-render-prod
k8s-render-prod:
	kubectl kustomize backend/k8s/overlays/prod
