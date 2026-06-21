#!/bin/sh
set -e

# Replace build-time placeholders in JS bundles with runtime environment variables
find /usr/share/nginx/html -name '*.js' -exec sed -i \
  -e "s|__RT_ELEVENLABS_AGENT_ID__|${EXPO_PUBLIC_ELEVENLABS_AGENT_ID:-}|g" \
  -e "s|__RT_HAPPY_SERVER_URL__|${EXPO_PUBLIC_HAPPY_SERVER_URL:-}|g" \
  -e "s|__RT_VOICE_PROVIDER__|${EXPO_PUBLIC_VOICE_PROVIDER:-elevenlabs}|g" \
  -e "s|__RT_VOICE_BASE_URL__|${EXPO_PUBLIC_VOICE_BASE_URL:-}|g" \
  -e "s|__RT_VOICE_TOOL_BRIDGE_BASE_URL__|${EXPO_PUBLIC_VOICE_TOOL_BRIDGE_BASE_URL:-}|g" \
  -e "s|__RT_VOICE_PUBLIC_KEY__|${EXPO_PUBLIC_VOICE_PUBLIC_KEY:-}|g" \
  {} +

# The Expo export names JS files with a build-time content hash, but this
# entrypoint mutates them at runtime for Docker env injection. Rename the JS
# files referenced by HTML after substitution so browsers do not keep using an
# immutable cached bundle from a previous container configuration.
find /usr/share/nginx/html -name '*.html' -print | while IFS= read -r html; do
  grep -oE '/_expo/static/js/[^"]+\.js' "$html" | sort -u | while IFS= read -r ref; do
    file="/usr/share/nginx/html${ref}"
    if [ ! -f "$file" ]; then
      continue
    fi

    checksum="$(sha256sum "$file" | awk '{ print substr($1, 1, 12) }')"
    canonical="$(printf '%s' "${file%.js}" | sed 's/\.rt-[0-9a-f]\{12\}$//')"
    renamed="${canonical}.rt-${checksum}.js"
    new_ref="/${renamed#/usr/share/nginx/html/}"

    if [ "$file" != "$renamed" ]; then
      mv "$file" "$renamed"
    fi
    find /usr/share/nginx/html -name '*.html' -exec sed -i "s|$ref|$new_ref|g" {} +
  done
done

exec nginx -g 'daemon off;'
