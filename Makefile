.DEFAULT_GOAL := deploy
AWS_REGION ?= eu-west-1
STACK_NAME := WeiqiSite

.PHONY: install serve test synth diff deploy-infra publish deploy ai-status ai-resume ai-check build-local-analysis prepare-position-runtime set-secrets

install:
	npm ci
	npm ci --prefix backend/report-renderer
	cd cdk && npm ci

serve:
	npm start

# Private administrator commands; require your normal AWS CLI credentials.
ai-status:
	node scripts/ai-control.mjs status

ai-resume:
	node scripts/ai-control.mjs resume

ai-check:
	node scripts/ai-control.mjs dryRun

# Prompts for the weiqi Entra app's client ID and secret and stores them in SSM under /weiqi/.
set-secrets:
	AWS_REGION=$(AWS_REGION) bash scripts/set-secrets.sh

test:
	python3 -m unittest discover -s tests/cloud
	npm test
	cd cdk && npm test -- --runInBand

synth:
	cd cdk && AWS_REGION=$(AWS_REGION) npm run synth

diff:
	cd cdk && AWS_REGION=$(AWS_REGION) npm run diff

deploy-infra:
	cd cdk && AWS_REGION=$(AWS_REGION) npm run deploy
	aws cloudformation set-stack-policy --region $(AWS_REGION) --stack-name WeiqiStorage --stack-policy-body file://cloud/storage-stack-policy.json

prepare-position-runtime:
	python3 scripts/build-position-runtime.py --upload --bucket $$(node -p "require('./cloud/deployment-config.json').libraryBucket") --region $(AWS_REGION)

build-local-analysis:
	node scripts/build-photo-analysis.mjs

publish: build-local-analysis
	AWS_REGION=$(AWS_REGION) STACK_NAME=$(STACK_NAME) bash scripts/publish-site.sh

# Recursive calls preserve deployment order even when make is run with -j.
deploy:
	$(MAKE) install
	$(MAKE) test
	$(MAKE) deploy-infra
	$(MAKE) publish
