#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STACK_NAME="${STACK_NAME:-WeiqiSite}"
AWS_REGION="${AWS_REGION:-eu-west-1}"
export AWS_REGION

# Resolve only this application's stack outputs; never write to a shared bucket.
SITE_BUCKET_NAME="$(aws cloudformation describe-stacks --stack-name "$STACK_NAME" --query "Stacks[0].Outputs[?OutputKey=='SiteBucketName'].OutputValue" --output text)"
DISTRIBUTION_ID="$(aws cloudformation describe-stacks --stack-name "$STACK_NAME" --query "Stacks[0].Outputs[?OutputKey=='DistributionId'].OutputValue" --output text)"
if [[ -z "$SITE_BUCKET_NAME" || "$SITE_BUCKET_NAME" == "None" || -z "$DISTRIBUTION_ID" || "$DISTRIBUTION_ID" == "None" ]]; then
  echo "The Weiqi stack must be deployed before publishing its files." >&2
  exit 1
fi

node --check "$PROJECT_DIR/src/app.js"
node --check "$PROJECT_DIR/src/engine.js"

# Upload dependencies first and the entrypoint last. Assets are revalidated on reload.
for filename in board-geometry.js site-time.js site-shell.js board-view.js recording-tree.js editor.js editor.html home.js play.html site.css cost.html security.html documents.js report-font.otf report.html report.js report.css board-diagram.js ai-review.js game-result.js analysis-status.js evaluation-chart.js replay-navigation.js sgf.js library-api.js library.html library.js record.html record.js how-to-use.html how-to-use.js benchmarks-data.json benchmarks.html benchmarks.js about.html about.js rules.html rules.js history.html history.js i18n.js engine.js app.js styles.css favicon.svg 404.html; do
  case "$filename" in
    *.otf) mime='font/otf' ;;
    *.js) mime='text/javascript; charset=utf-8' ;;
    *.css) mime='text/css; charset=utf-8' ;;
    *.svg) mime='image/svg+xml' ;;
    *.html) mime='text/html; charset=utf-8' ;;
    *.json) mime='application/json; charset=utf-8' ;;
    *.txt) mime='text/plain; charset=utf-8' ;;
  esac
  aws s3 cp "$PROJECT_DIR/src/$filename" "s3://$SITE_BUCKET_NAME/$filename" --content-type "$mime" --cache-control 'public, max-age=0, must-revalidate' --only-show-errors
done
aws s3 cp "$PROJECT_DIR/src/index.html" "s3://$SITE_BUCKET_NAME/index.html" --content-type 'text/html; charset=utf-8' --cache-control 'no-cache, max-age=0, must-revalidate' --only-show-errors
INVALIDATION_ID="$(aws cloudfront create-invalidation --distribution-id "$DISTRIBUTION_ID" --paths '/*' --query 'Invalidation.Id' --output text)"
aws cloudfront wait invalidation-completed --distribution-id "$DISTRIBUTION_ID" --id "$INVALIDATION_ID"
aws cloudformation describe-stacks --stack-name "$STACK_NAME" --query "Stacks[0].Outputs[?OutputKey=='WebsiteUrl'].OutputValue" --output text
