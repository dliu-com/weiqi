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

# Each publish invalidates the edge, so the long edge lifetimes below never serve an old release.
STATIC_CACHE='public, max-age=300, s-maxage=86400, stale-while-revalidate=86400'
# Scripts, styles and data keep fixed names and load together, so browsers revalidate them
# (no mixed releases) while the edge keeps them for a day. HTML pages are never edge-cached long.
MODULE_CACHE='public, max-age=0, must-revalidate, s-maxage=86400'
PAGE_CACHE='public, max-age=0, must-revalidate'

aws s3 cp "$PROJECT_DIR/src/photo-assets/" "s3://$SITE_BUCKET_NAME/photo-assets/" --recursive --cache-control "$STATIC_CACHE" --only-show-errors

invalidate() {
  local id
  id="$(aws cloudfront create-invalidation --distribution-id "$DISTRIBUTION_ID" --paths '/*' --query 'Invalidation.Id' --output text)"
  aws cloudfront wait invalidation-completed --distribution-id "$DISTRIBUTION_ID" --id "$id"
}

# Two passes so a new page never meets an old script: first scripts, styles and data, then the
# edge is cleared, then the HTML pages, then the edge is cleared again. Modules import each
# other by fixed names, so this ordering (not ?v= on one entry script) keeps a release whole.
for pass in assets pages; do
for filename in analysis-position.js position-api.js analysis.js photo.html photo.css stone-placement.mp3 stone-placement-LICENSE.txt stone-sound.js time-control.js board-geometry.js site-time.js site-shell.js move-label.js board-view.js recording-tree.js recording-sequence-edit.js recording-tree-view.js editor.js editor.html home.js play.html site.css cost.html security.html photo-recognition.html health-spec.js documents.js flow-diagram.js report-font.otf report.html report.js report.css board-diagram.js ai-review.js game-result.js analysis-status.js evaluation-chart.js replay-navigation.js sgf.js library-api.js library.html library.js record.html record.js how-to-use.html how-to-use.js benchmarks-data.json benchmarks.html benchmarks.js about.html about.js rules.html rules.js history.html history.js i18n.js engine.js app.js styles.css favicon.svg 404.html robots.txt sitemap.xml; do
  case "$filename" in
    *.mp3) mime='audio/mpeg' cache="$STATIC_CACHE" ;;
    *.otf) mime='font/otf' cache="$STATIC_CACHE" ;;
    *.js) mime='text/javascript; charset=utf-8' cache="$MODULE_CACHE" ;;
    *.css) mime='text/css; charset=utf-8' cache="$MODULE_CACHE" ;;
    *.svg) mime='image/svg+xml' cache="$STATIC_CACHE" ;;
    *.xml) mime='application/xml; charset=utf-8' cache="$STATIC_CACHE" ;;
    *.html) mime='text/html; charset=utf-8' cache="$PAGE_CACHE" ;;
    *.json) mime='application/json; charset=utf-8' cache="$MODULE_CACHE" ;;
    *.txt) mime='text/plain; charset=utf-8' cache="$STATIC_CACHE" ;;
  esac
  case "$pass:$filename" in assets:*.html|pages:*.js|pages:*.css|pages:*.json|pages:*.mp3|pages:*.otf|pages:*.svg|pages:*.txt|pages:*.xml) continue ;; esac
  aws s3 cp "$PROJECT_DIR/src/$filename" "s3://$SITE_BUCKET_NAME/$filename" --content-type "$mime" --cache-control "$cache" --only-show-errors
done
if [ "$pass" = assets ]; then invalidate; fi
done
node "$PROJECT_DIR/scripts/build-health-md.mjs"
aws s3 cp "$PROJECT_DIR/src/health.md" "s3://$SITE_BUCKET_NAME/docs/health.md" --content-type 'text/markdown; charset=utf-8' --cache-control "$PAGE_CACHE" --only-show-errors
aws s3 cp "$PROJECT_DIR/src/index.html" "s3://$SITE_BUCKET_NAME/index.html" --content-type 'text/html; charset=utf-8' --cache-control 'no-cache, max-age=0, must-revalidate' --only-show-errors
invalidate
aws cloudformation describe-stacks --stack-name "$STACK_NAME" --query "Stacks[0].Outputs[?OutputKey=='WebsiteUrl'].OutputValue" --output text
