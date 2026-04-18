# LLM Log Stream Viewer

A real-time multi-tab log stream viewer for LLM completion chats. This Electron application allows you to monitor multiple LLM chat streams simultaneously in different tabs, with a clean and modern interface.

![LLM Log Stream Viewer Recording](https://github.com/procommerz/llm-thread-logger/blob/main/demo-recording.gif?raw=true)


## Features

- Real-time log streaming via HTTP endpoint
- Multi-tab interface for monitoring different chat streams
- Automatic tab creation and focus for new streams
- Clean message display with role-based styling
- Structured event-based trace logging with foldable debug panels
- Tab management (create, switch, close)
- No persistence (in-memory only)


## Install and Run

Clone the repository:

```bash
git clone https://github.com/procommerz/llm-thread-logger.git
cd llm-thread-logger
```

### Via Docker + XQuartz (recommended for MacOS)

You need XQuartz for this (must be running). Download from https://www.xquartz.org/ 
or via `brew install --cask xquartz`

Run `defaults write org.xquartz.X11 nolisten_tcp -bool false` and restart XQuartz.

Then run `sh run-docker-xquartz.sh` in the project folder - this should launch the Electron app in a container and show a tunnelled app window on your desktop.


### Directly on Your Host

Install dependencies:
```bash
npm install
```

Start the application in dev mode:
```bash
npm run start
```

The application will start and listen for log messages on `http://localhost:9797`.


## Usage

ℹ️ Usage tip: Press Esc to close a loging tab or Cmd/Ctrl-R to reload the app and clear everything.


### Sending Log Messages

Send log messages to the application using HTTP POST requests to `http://localhost:9797/log`. 

See `send-test-message.sh` for a working example.


#### Request Formats

The `/log` endpoint supports two alternative payload styles:

1. Message-based logging
2. Event-based logging

Both formats use `streamName` as the tab identity in the UI.

#### Message-Based Logging

- `streamName` (required): String identifying the chat stream. This will be used as the tab name.
- `messages` (required): Array of message objects, each containing:
  - `role` (required): String indicating the message sender (e.g. `"user"`, `"assistant"`). Roles can be custom, but some defaults have built-in color codes.
  - `content` (required): String or array of strings containing the message content

### Example Using cURL

```bash
curl -X POST http://localhost:9797/log \
  -H "Content-Type: application/json" \
  -d '{
    "streamName": "chat-1",
    "messages": [
      {
        "role": "user",
        "content": "What is the capital of France?"
      },
      {
        "role": "assistant",
        "content": "The capital of France is Paris."
      }
    ]
  }'
```

#### Event-Based Logging

- `streamName` (required in the request envelope): String identifying the chat stream.
- `event` (required): A single structured trace event object.

This format is intended for richer agent/debug traces where a single event may contain nested data, such as:

- model request metadata
- full completion message chains
- available tool definitions
- tool call arguments and results
- assistant output lifecycle events

The full event schema is documented in [event.schema.json](./event.schema.json).

The UI renders event entries as structured panels. For `model_request` events, nested completion messages and tool definitions are shown in foldable sections so large traces remain navigable.

### Example Event Payload

```bash
curl -X POST http://localhost:9797/log \
  -H "Content-Type: application/json" \
  -d '{
    "streamName": "agent-run-1",
    "event": {
      "eventType": "tool_start",
      "ts": 1776506317599,
      "streamName": "agent-run-1",
      "sessionId": "session-123",
      "sessionKey": "agent:main",
      "runId": "run-123",
      "agentId": "agent-1",
      "seq": 4,
      "toolName": "read",
      "toolCallId": "tool_read_1",
      "args": {
        "path": "README.md"
      }
    }
  }'
```

### Example Event Trace Fixtures

For local testing, see:

- [event.schema.json](./event.schema.json) for the event object schema
- [test-example-events.json](./test-example-events.json) for example event envelopes
- [send-test-events.sh](./send-test-events.sh) for a simple random event replay script


## Interface Usage

- **Tabs**: Each unique `streamName` creates a new tab
- **Switching Tabs**: Click on any tab to switch to that chat stream
- **Closing Tabs**: Click the × button on a tab to close it
- **Auto-Focus**: New messages automatically focus their respective tab
- **Message Display**: Messages are displayed with different styles for user and assistant roles
- **Auto-focus**: The view automatically scrolls to the latest messages


## Notes

- The application does not persist logs to disk
- When a tab is closed, it will be recreated with a fresh log when new messages arrive for that stream
- The application runs on port 9797 by default
- Messages are displayed in real-time as they are received
