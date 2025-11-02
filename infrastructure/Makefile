.PHONY: help clean-layer build-layer deploy-layer cleanup-layer build-lambda package-lambda deploy-lambda deploy-all

APP_PREFIX ?= Mnemosyne
FUNCTIONS = message-listener file-processor oauth-callback
SCRIPTS_DIR = scripts

help: ## Show this help message
	@echo "Available targets:"
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-20s\033[0m %s\n", $$1, $$2}'

clean-layer: ## Clean up old Lambda Layer versions (keep last 5)
	@$(SCRIPTS_DIR)/cleanup-layer.sh $(APP_PREFIX)

build-layer: ## Build and package slack-shared as Lambda Layer
	@$(SCRIPTS_DIR)/build-layer.sh

deploy-layer: build-layer ## Deploy Lambda Layer
	@$(SCRIPTS_DIR)/deploy-layer.sh $(APP_PREFIX)

layer: clean-layer deploy-layer ## Clean, build, and deploy Lambda Layer

build-lambda: ## Build a Lambda function (usage: make build-lambda FUNCTION=message-listener)
	@if [ -z "$(FUNCTION)" ]; then \
		echo "ERROR: FUNCTION is required (e.g., make build-lambda FUNCTION=message-listener)"; \
		exit 1; \
	fi
	@$(SCRIPTS_DIR)/build-lambda.sh $(FUNCTION)

package-lambda: ## Package a Lambda function (usage: make package-lambda FUNCTION=message-listener)
	@if [ -z "$(FUNCTION)" ]; then \
		echo "ERROR: FUNCTION is required (e.g., make package-lambda FUNCTION=message-listener)"; \
		exit 1; \
	fi
	@$(SCRIPTS_DIR)/package-lambda.sh $(FUNCTION)

deploy-lambda: ## Deploy a Lambda function (usage: make deploy-lambda FUNCTION=message-listener)
	@if [ -z "$(FUNCTION)" ]; then \
		echo "ERROR: FUNCTION is required (e.g., make deploy-lambda FUNCTION=message-listener)"; \
		exit 1; \
	fi
	@$(SCRIPTS_DIR)/deploy-lambda.sh $(FUNCTION) $(APP_PREFIX)

build-all: ## Build all Lambda functions
	@for func in $(FUNCTIONS); do \
		echo "Building $$func..."; \
		$(SCRIPTS_DIR)/build-lambda.sh $$func || exit 1; \
	done

package-all: build-all ## Package all Lambda functions
	@for func in $(FUNCTIONS); do \
		echo "Packaging $$func..."; \
		$(SCRIPTS_DIR)/package-lambda.sh $$func || exit 1; \
	done

deploy-all: package-all deploy-layer ## Deploy all Lambda functions with layer
	@for func in $(FUNCTIONS); do \
		echo "Deploying $$func..."; \
		$(SCRIPTS_DIR)/deploy-lambda.sh $$func $(APP_PREFIX) || exit 1; \
	done

# Individual function targets
message-listener: ## Build, package, and deploy message-listener
	@$(SCRIPTS_DIR)/build-lambda.sh message-listener
	@$(SCRIPTS_DIR)/package-lambda.sh message-listener
	@$(SCRIPTS_DIR)/deploy-lambda.sh message-listener $(APP_PREFIX)

file-processor: ## Build, package, and deploy file-processor
	@$(SCRIPTS_DIR)/build-lambda.sh file-processor
	@$(SCRIPTS_DIR)/package-lambda.sh file-processor
	@$(SCRIPTS_DIR)/deploy-lambda.sh file-processor $(APP_PREFIX)

oauth-callback: ## Build, package, and deploy oauth-callback
	@$(SCRIPTS_DIR)/build-lambda.sh oauth-callback
	@$(SCRIPTS_DIR)/package-lambda.sh oauth-callback
	@$(SCRIPTS_DIR)/deploy-lambda.sh oauth-callback $(APP_PREFIX)

clean: ## Clean build artifacts
	@rm -f *.zip
	@rm -rf build-layer
	@rm -f layer-arn.env
	@echo "✓ Cleaned build artifacts"

