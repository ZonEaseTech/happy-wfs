/**
 * POSIX-sh installer served at GET /enroll.sh.
 *
 * Installs a private Node runtime under the Happy home dir so target machines
 * need nothing preinstalled and nothing system-wide is touched, then runs
 * `happy device enroll <token>`, which links the machine and installs the
 * daemon service (launchd on macOS, systemd on Linux).
 */

const NODE_VERSION = 'v22.20.0';

export function buildEnrollScript(serverUrl: string, webappUrl: string | null): string {
    return `#!/bin/sh
set -eu

TOKEN="\${1:-}"
if [ -z "$TOKEN" ]; then
  echo "Usage: curl -fsSL ${serverUrl}/enroll.sh | sh -s -- <token>" >&2
  exit 1
fi

HAPPY_SERVER_URL="\${HAPPY_SERVER_URL:-${serverUrl}}"
${webappUrl ? `HAPPY_WEBAPP_URL="\${HAPPY_WEBAPP_URL:-${webappUrl}}"\nexport HAPPY_WEBAPP_URL` : ''}
HAPPY_HOME_DIR="\${HAPPY_HOME_DIR:-$HOME/.happy}"
export HAPPY_SERVER_URL HAPPY_HOME_DIR

RUNTIME_DIR="$HAPPY_HOME_DIR/runtime"
NODE_VERSION="${NODE_VERSION}"

fail() { echo "happy-enroll: $1" >&2; exit 1; }

case "$(uname -s)" in
  Linux) NODE_OS=linux ;;
  Darwin) NODE_OS=darwin ;;
  *) fail "unsupported OS: $(uname -s)" ;;
esac

case "$(uname -m)" in
  x86_64|amd64) NODE_ARCH=x64 ;;
  aarch64|arm64) NODE_ARCH=arm64 ;;
  *) fail "unsupported architecture: $(uname -m)" ;;
esac

fetch() {
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL "$1" -o "$2"
  elif command -v wget >/dev/null 2>&1; then
    wget -qO "$2" "$1"
  else
    fail "need curl or wget"
  fi
}

if [ ! -x "$RUNTIME_DIR/bin/node" ]; then
  echo "happy-enroll: installing private Node runtime ($NODE_VERSION $NODE_OS-$NODE_ARCH)"
  TMP_DIR="$(mktemp -d)"
  trap 'rm -rf "$TMP_DIR"' EXIT
  NODE_PKG="node-$NODE_VERSION-$NODE_OS-$NODE_ARCH"
  fetch "https://nodejs.org/dist/$NODE_VERSION/$NODE_PKG.tar.gz" "$TMP_DIR/node.tar.gz"
  mkdir -p "$RUNTIME_DIR"
  tar -xzf "$TMP_DIR/node.tar.gz" -C "$TMP_DIR"
  # Copy contents so re-runs replace the runtime in place.
  (cd "$TMP_DIR/$NODE_PKG" && tar -cf - .) | (cd "$RUNTIME_DIR" && tar -xf -)
  rm -rf "$TMP_DIR"
  trap - EXIT
fi

PATH="$RUNTIME_DIR/bin:$PATH"
export PATH

echo "happy-enroll: installing Happy CLI"
"$RUNTIME_DIR/bin/npm" install -g --prefix "$RUNTIME_DIR" --no-fund --no-audit @zonease/happy@latest >/dev/null

echo "happy-enroll: enrolling device"
"$RUNTIME_DIR/bin/happy" device enroll "$TOKEN"

echo "happy-enroll: done — this machine should now appear in Happy"
`;
}
