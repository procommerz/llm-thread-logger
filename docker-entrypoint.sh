#!/bin/bash
set -e

# If no DISPLAY is forwarded from the host, start a local virtual framebuffer.
# To see the window on your host machine, pass a DISPLAY variable pointing to
# your host X server (see docker-compose.yml and the README for instructions).
if [ -z "$DISPLAY" ]; then
  echo "[entrypoint] No DISPLAY set — starting Xvfb virtual framebuffer on :99"
  rm -f /tmp/.X99-lock
  Xvfb :99 -screen 0 1280x800x24 -ac +extension GLX +render -noreset &
  export DISPLAY=:99
  # Give Xvfb a moment to initialise before Electron tries to connect
  sleep 1
  echo "[entrypoint] Xvfb ready on DISPLAY=:99"
else
  echo "[entrypoint] Using host DISPLAY=$DISPLAY"
fi

exec "$@"
