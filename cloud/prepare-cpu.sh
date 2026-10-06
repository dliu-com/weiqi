#!/usr/bin/env bash
set -euo pipefail
mkdir -p cloud/assets/cpu/bin
curl -fSL https://github.com/lightvector/KataGo/releases/download/v1.16.5/katago-v1.16.5-eigenavx2-linux-x64.zip -o /private/tmp/weiqi-katago-cpu.zip
unzip -p /private/tmp/weiqi-katago-cpu.zip katago > cloud/assets/cpu/bin/katago
chmod +x cloud/assets/cpu/bin/katago
