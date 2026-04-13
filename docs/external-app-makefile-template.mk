# ==============================================================================
# Makefile template for external apps deploying to the homelab cluster
#
# Copy this file into your app repo as "Makefile" and customize the variables
# below. This template implements a minimal local CD workflow using Pulumi.
#
# Prerequisites:
#   - Node.js + npm installed
#   - Pulumi CLI installed  (https://www.pulumi.com/docs/install/)
#   - PULUMI_ACCESS_TOKEN exported in your shell (or set in CI secrets)
#   - KUBECONFIG pointing to the homelab cluster (or set in CI secrets)
#
# Workflow:
#   1. make init     — first-time setup: install deps and create your stack
#   2. make preview  — dry-run: see what Pulumi would change
#   3. make deploy   — apply changes to the cluster
#   4. make destroy  — tear everything down (asks for confirmation)
# ==============================================================================

# === CUSTOMIZE THESE ===========================================================
STACK_NAME      ?= dev
# Pulumi Cloud stack reference for the homelab base stack.
# Format: <org>/<project>/<stack>  (matches the value in your src/index.ts)
HOMELAB_STACK   ?= mrsimpson/homelab/dev
# Container image for your app (overridable via environment variable in CI)
APP_IMAGE       ?= ghcr.io/your-org/your-app:latest
# ===============================================================================

.PHONY: init preview deploy destroy logs help

# Default target: show available commands
help:
	@echo ""
	@echo "Available targets:"
	@echo "  init     Install dependencies and create Pulumi stack (run once)"
	@echo "  preview  Dry-run: show what would change without applying"
	@echo "  deploy   Apply changes to the homelab cluster"
	@echo "  destroy  Tear down all resources (asks for confirmation)"
	@echo "  logs     Show recent Pulumi activity log for this stack"
	@echo ""
	@echo "Active stack : $(STACK_NAME)"
	@echo "Homelab stack: $(HOMELAB_STACK)"
	@echo "App image    : $(APP_IMAGE)"
	@echo ""

# ------------------------------------------------------------------------------
# init — first-time setup
#
# Run this once after cloning the repo.
# It installs npm dependencies and creates a new Pulumi stack for this
# environment. After running, set any required config values:
#
#   pulumi config set image $(APP_IMAGE)
#
# If the stack already exists you can select it instead:
#   pulumi stack select $(STACK_NAME)
# ------------------------------------------------------------------------------
init:
	npm install
	pulumi stack init $(STACK_NAME) || pulumi stack select $(STACK_NAME)
	@echo ""
	@echo "Stack '$(STACK_NAME)' is ready."
	@echo "Next steps:"
	@echo "  1. Edit Pulumi.$(STACK_NAME).yaml to import the ESC environment:"
	@echo "     environment:"
	@echo "       - homelab/shared"
	@echo "  2. Set any app-specific config:"
	@echo "     pulumi config set image $(APP_IMAGE)"
	@echo "  3. Run: make preview"
	@echo ""

# ------------------------------------------------------------------------------
# preview — dry-run
#
# Shows a detailed diff of every resource that would be created, updated, or
# deleted. Use this before every deploy to catch surprises.
# ------------------------------------------------------------------------------
preview:
	pulumi preview --stack $(STACK_NAME) --diff

# ------------------------------------------------------------------------------
# deploy — apply changes
#
# Runs `pulumi up` non-interactively (--yes). In CI this is the command to call.
# Locally you can omit --yes and Pulumi will ask for confirmation:
#   pulumi up --stack $(STACK_NAME)
# ------------------------------------------------------------------------------
deploy:
	pulumi up --stack $(STACK_NAME) --yes

# ------------------------------------------------------------------------------
# destroy — tear down all resources
#
# Destroys every resource managed by this stack. Asks for confirmation before
# proceeding to prevent accidental data loss.
# ------------------------------------------------------------------------------
destroy:
	@echo "WARNING: This will PERMANENTLY destroy all resources in stack '$(STACK_NAME)'."
	@echo "         This cannot be undone."
	@printf "Type the stack name to confirm [$(STACK_NAME)]: " && read ans && [ "$$ans" = "$(STACK_NAME)" ] || (echo "Aborted." && exit 1)
	pulumi destroy --stack $(STACK_NAME)

# ------------------------------------------------------------------------------
# logs — recent Pulumi activity
#
# Prints the last 50 lines of the Pulumi activity log for the current stack.
# Useful for quickly checking what the last deployment changed.
# ------------------------------------------------------------------------------
logs:
	pulumi stack history --stack $(STACK_NAME) --page-size 10
