#!/bin/bash
# Antigravity を CDP デバッグポート付きで起動するランチャー
# 空いているポートを自動検出して使用します

PORTS=(9222 9333 9444 9555 9666)
SELECTED_PORT=""

for port in "${PORTS[@]}"; do
    if ! lsof -i :$port > /dev/null 2>&1; then
        SELECTED_PORT=$port
        break
    fi
done

if [ -z "$SELECTED_PORT" ]; then
    echo "❌ 利用可能なポートが見つかりませんでした (${PORTS[*]})"
    echo "   いずれかのポートを使用しているプロセスを終了してください。"
    read -p "Enterキーで閉じます..."
    exit 1
fi

echo "🚀 Antigravity をポート $SELECTED_PORT で起動します..."
open -a Antigravity --args --remote-debugging-port=$SELECTED_PORT
echo "✅ 起動完了！CDP ポート: $SELECTED_PORT"
sleep 2
exit
