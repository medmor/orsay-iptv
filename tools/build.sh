#!/usr/bin/env bash
#
# Build the Orsay widget package and a widgetlist.xml for sideloading.
#
# Usage: ./tools/build.sh
#        PORT=8080 ./tools/build.sh   # non-default port
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST="$ROOT/dist"
APP_ID="IptvPlayer"
APP_TITLE="IPTV Player"
PORT="${PORT:-80}"

# Keep the dist directory itself so an HTTP server already serving it keeps
# working; only replace the generated files.
mkdir -p "$DIST"
rm -f "$DIST"/*.zip "$DIST"/widgetlist.xml

cd "$ROOT"
zip -r -X "$DIST/$APP_ID.zip" \
    config.xml \
    index.html \
    icon.png \
    icon \
    css \
    js >/dev/null

# Icon URL used by the Orsay App Sync widgetlist.
cp "$ROOT/icon/icon_106x87.png" "$DIST/icon.png"

SIZE="$(stat -c%s "$DIST/$APP_ID.zip" 2>/dev/null || wc -c < "$DIST/$APP_ID.zip")"

IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
if [ -z "$IP" ]; then
    IP="127.0.0.1"
fi

if [ "$PORT" = "80" ]; then
    BASE_URL="http://$IP"
    HOST_LABEL="$IP"
else
    BASE_URL="http://$IP:$PORT"
    HOST_LABEL="$IP:$PORT"
fi

cat > "$DIST/widgetlist.xml" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<rsp stat="ok">
    <list>
        <widget id="$APP_ID">
            <title>$APP_TITLE</title>
            <compression size="$SIZE" type="zip"/>
            <description>IPTV Player for Samsung Orsay</description>
            <icon>$BASE_URL/icon.png</icon>
            <download>$BASE_URL/$APP_ID.zip</download>
        </widget>
    </list>
</rsp>
EOF

echo "Built: $DIST/$APP_ID.zip ($SIZE bytes)"
echo "Sideload list: $DIST/widgetlist.xml (host $HOST_LABEL)"
echo
echo "Serve it to the TV with:"
if [ "$PORT" = "80" ]; then
    echo "  cd \"$DIST\" && sudo python3 -m http.server 80"
else
    echo "  cd \"$DIST\" && python3 -m http.server $PORT"
fi
echo
echo "Then on the TV: Apps > More Apps > Options > IP Setting, enter $IP"
echo "and choose Start App Sync."
