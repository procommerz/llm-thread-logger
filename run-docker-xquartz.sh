#!/bin/sh
# Launch the Electron app inside Docker with the window forwarded to XQuartz.
#
# Prerequisites (one-time):
#   brew install socat
#   Install XQuartz from https://www.xquartz.org and log out/in once.
#
# Why socat?
#   XQuartz binds its TCP listener to 127.0.0.1 only. Docker containers
#   reach the host via a virtual network adapter (not loopback), so a
#   direct TCP connection to host.docker.internal:6000 is refused.
#   socat re-exposes the XQuartz Unix socket on 0.0.0.0:6000 so the
#   container can reach it through Docker Desktop's host alias.

set -e

if ! command -v socat >/dev/null 2>&1; then
  echo "Error: socat is not installed. Run: brew install socat" >&2
  exit 1
fi

# Kill any leftover socat bridge from a previous run.
pkill -f "socat.*TCP-LISTEN:6000" 2>/dev/null || true

# socat uses ':' as its own parameter separator, so the ':0' suffix in the
# XQuartz socket path (e.g. /private/tmp/.../org.macosforge.xquartz:0) must
# be escaped with a backslash before being passed as a UNIX-CLIENT address.
DISPLAY_ESCAPED=$(printf '%s' "${DISPLAY}" | sed 's/:/\\:/g')

# Bridge: TCP 0.0.0.0:6000 → XQuartz Unix socket.
socat TCP-LISTEN:6000,bind=0.0.0.0,reuseaddr,fork "UNIX-CLIENT:${DISPLAY_ESCAPED}" &
SOCAT_PID=$!
echo "socat bridge started (PID $SOCAT_PID): TCP:6000 → $DISPLAY"

# Allow X11 connections from the Docker network.
xhost + 127.0.0.1

# Tear down the socat bridge when this script exits (Ctrl-C or docker exit).
trap 'echo "Stopping socat..."; kill $SOCAT_PID 2>/dev/null; exit' INT TERM EXIT

docker compose up

kill $SOCAT_PID 2>/dev/null || true
