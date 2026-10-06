.DEFAULT_GOAL := deploy
AWS_REGION ?= eu-west-1
STACK_NAME := WeiqiSite

.PHONY: install serve test synth diff deploy-infra publish deploy

install:
	npm ci
	cd cdk && npm ci

serve:
	npm start

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

publish:
	AWS_REGION=$(AWS_REGION) STACK_NAME=$(STACK_NAME) bash scripts/publish-site.sh

# Recursive calls preserve deployment order even when make is run with -j.
deploy:
	$(MAKE) install
	$(MAKE) test
	$(MAKE) deploy-infra
	$(MAKE) publish
