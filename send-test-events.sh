#!/bin/sh

EVENTS_FILE="$(dirname "$0")/test-example-events.json"
LOG_ENDPOINT="${LOG_ENDPOINT:-http://localhost:9797/log}"
NUM_REQUESTS="${1:-256}"
DELAY="${2:-2}"

if [ ! -f "$EVENTS_FILE" ]; then
  echo "Missing events file: $EVENTS_FILE" >&2
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "This script requires node to read $EVENTS_FILE" >&2
  exit 1
fi

i=0
while [ "$i" -lt "$NUM_REQUESTS" ]; do
  payload=$(node -e '
const fs = require("fs");
const file = process.argv[1];
const items = JSON.parse(fs.readFileSync(file, "utf8"));
if (!Array.isArray(items) || items.length === 0) {
  console.error("No events found in " + file);
  process.exit(1);
}
const picked = items[Math.floor(Math.random() * items.length)];
process.stdout.write(JSON.stringify(picked));
' "$EVENTS_FILE") || exit 1

  stream_name=$(printf '%s' "$payload" | node -e '
let data = "";
process.stdin.on("data", chunk => { data += chunk; });
process.stdin.on("end", () => {
  const parsed = JSON.parse(data);
  process.stdout.write(parsed.streamName || (parsed.event && parsed.event.streamName) || "unknown-stream");
});
') || exit 1

  event_type=$(printf '%s' "$payload" | node -e '
let data = "";
process.stdin.on("data", chunk => { data += chunk; });
process.stdin.on("end", () => {
  const parsed = JSON.parse(data);
  process.stdout.write((parsed.event && parsed.event.eventType) || "unknown-event");
});
') || exit 1

  curl -s -X POST "$LOG_ENDPOINT" \
    -H "Content-Type: application/json" \
    -d "$payload" > /dev/null

  echo "[$stream_name] event: $event_type"

  sleep "$DELAY"
  i=$((i + 1))
done
