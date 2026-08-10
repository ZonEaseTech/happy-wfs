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
# Installed as a project rather than with -g: npm 10 ignores --omit=optional for
# a package named on the command line, and installs its optional dependencies
# anyway. Only a package.json-driven install honours it.
#
# What that omits is the platform tool packages (difftastic, ripgrep, ~143MB).
# They exist for agent sessions, and an enrolled device refuses to host those —
# see the deviceMode guard on spawn-happy-session. A machine promoted to hosting
# sessions later needs a plain "npm install -g @zonease/happy" to pull them in.
CLI_DIR="$HAPPY_HOME_DIR/cli"
mkdir -p "$CLI_DIR"
cat > "$CLI_DIR/package.json" <<'HAPPY_PKG_JSON'
{
  "name": "happy-device-install",
  "private": true,
  "dependencies": { "@zonease/happy": "latest" }
}
HAPPY_PKG_JSON
"$RUNTIME_DIR/bin/npm" install --prefix "$CLI_DIR" --no-fund --no-audit --omit=optional >/dev/null

# --omit=optional is all-or-nothing, and node-pty is optional too — skipping it
# leaves the device with no terminal, which is most of what a device is for. Add
# it back explicitly, reading the range from the CLI that was just installed so
# the two cannot drift.
PTY_RANGE=$("$RUNTIME_DIR/bin/node" -p "require('$CLI_DIR/node_modules/@zonease/happy/package.json').optionalDependencies['node-pty']" 2>/dev/null)
if [ -n "$PTY_RANGE" ] && [ "$PTY_RANGE" != "undefined" ]; then
  "$RUNTIME_DIR/bin/npm" install --prefix "$CLI_DIR" --no-fund --no-audit --omit=optional "node-pty@$PTY_RANGE" >/dev/null
else
  echo "happy-enroll: warning — could not determine the node-pty range; the terminal may be unavailable" >&2
fi

# The rest of this script, and the daemon service file the CLI writes, both go
# through $RUNTIME_DIR/bin — keep that entry point regardless of layout.
ln -sf "$CLI_DIR/node_modules/.bin/happy" "$RUNTIME_DIR/bin/happy"
ln -sf "$CLI_DIR/node_modules/.bin/happy-mcp" "$RUNTIME_DIR/bin/happy-mcp"

# Older CLI builds treat an unknown subcommand as "start an interactive
# session", which fails noisily when piped from curl (no TTY). Verify support
# before running, and feed /dev/null so nothing can wait on stdin.
if ! "$RUNTIME_DIR/bin/happy" device </dev/null 2>/dev/null | grep -q "device enroll"; then
  fail "installed Happy CLI does not support device enrollment yet — upgrade the CLI and retry"
fi

echo "happy-enroll: enrolling device"
"$RUNTIME_DIR/bin/happy" device enroll "$TOKEN" </dev/null

echo "happy-enroll: done — this machine should now appear in Happy"
`;
}
