DEPLOY_NETWORK ?= localhost
HARDHAT_PORT ?= 8545

.PHONY: setup node deploy start frontend stop

setup:
	@if [ ! -f .env ]; then \
		secret=$$(openssl rand -hex 32) && \
		umask 077 && \
		sed "s/^JWT_SECRET=$$/JWT_SECRET=$$secret/" .env.example > .env; \
	fi
	@if [ ! -f swarm.key ]; then \
		key=$$(openssl rand -hex 32) && \
		umask 077 && \
		printf '/key/swarm/psk/1.0.0/\n/base16/\n%s\n' "$$key" > swarm.key; \
	fi
	npm --prefix contracts ci
	npm --prefix frontend ci

node:
	npm --prefix contracts run node -- --port "$(HARDHAT_PORT)"

deploy:
	cd contracts && npx hardhat run scripts/deploy.js --network "$(DEPLOY_NETWORK)"

start:
	docker compose up -d --build

frontend:
	npm --prefix frontend run dev -- --strictPort

stop:
	docker compose down
