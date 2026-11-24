#!/bin/zsh
# Runs make-demo.py with Sona's own voice environment (installed by the app's voice feature).
set -e
PY="$HOME/Library/Application Support/Sona/envs/voice-mlx/bin/python"
[ -x "$PY" ] || { echo "先在 Sona 裡安裝「複製我的聲音」，這支腳本借用它的執行環境"; exit 1 }
HF_HUB_OFFLINE=1 exec "$PY" "${0:A:h}/make-demo.py" "$@"
