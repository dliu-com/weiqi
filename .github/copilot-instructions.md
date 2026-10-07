# Weiqi development instructions

Before changing this project, read [`../HANDOVER.md`](../HANDOVER.md) from this directory (repository-root `HANDOVER.md`) and repository-root `AGENTS.md`. The handover describes the user's latest goals, completed work, outstanding photo-recognition problem, commands and deployment constraints.

- Start from the current working tree. Preserve manual edits and unrelated modified/untracked files; recent deployed features are not all committed.
- Keep work focused, reuse the site's existing components/layout, and preserve Chinese/English support and mobile usability.
- Saved library games are immutable. Temporary sequence edits stay in page memory; the cloud validates the full sequence before atomically saving it.
- Keep cloud analysis idempotent and bounded. Use `configs.yml`; preserve the ten-game quota, quick-feature request/concurrency limits (the two-lease concurrency cap is in `backend/position-handler.cjs`), $15/day and $50/month spending shutdowns, and separate $30 development allowance. Billing is delayed; do not describe these as exact instant AWS bill ceilings.
- Never commit private training photos, production SGFs, weights, credentials or personal email addresses. Preserve `.gitignore`. Do not transmit private photos to a new third-party service without authorization.
- Recognition is experimental. Report real-photo errors and failures separately from generated-board accuracy; provisional assistant labels are not independently verified ground truth.
- Follow `AGENTS.md` for proportionate testing. Use representative affected positions for routine changes and full-game replay only for final pre-production validation.
- Provision infrastructure with CDK/CloudFormation in `eu-west-1`, tag supported resources `Project=Weiqi`, and preserve the protected `WeiqiStorage` stack.
- Create or change AWS resources only through CloudFormation (CDK-generated); no CLI/console-created resources. Assume extremely low traffic: every cost must be usage-billed, and idle fixed monthly cost (storage, images, schedules, logs) must stay at or below US$2. No always-on compute, NAT gateway, interface endpoint, provisioned capacity, customer KMS key, WAF, paid alarm/dashboard or action-enabled budget without explicit approval. Give Lambdas CloudFormation-managed log groups with retention instead of `logRetention`; `cdk/test/usage-billing.test.ts` guards this.
- Push commits to `origin` by default after committing.
- Plain `make` deploys; `make publish` changes the live site. Use local build/test commands intentionally. Do not launch paid experiments or change production simply to inspect the project.
- Prefer concrete implementation and verification over repeated approval questions for already-authorized routine work. Ask before destructive actions, new spending commitments or work outside the request. Do not use the signed-in AWS console unless explicitly requested.

For this takeover, prioritize reliable automatic recognition on the user's real phone/photos. Neither tested alternative model proved a better real-photo replacement, so the live detector remains Moku with the grid fix.
