# LLM Log Stream Viewer

A real-time multi-tab log stream viewer for LLM completion chats. This Electron application allows you to monitor multiple LLM chat streams simultaneously in different tabs, with a clean and modern interface.

![LLM Log Stream Viewer Recording](https://github.com/procommerz/llm-thread-logger/blob/main/demo-recording.gif?raw=true)


## Features

- Real-time log streaming via HTTP endpoint
- Multi-tab interface for monitoring different chat streams
- Automatic tab creation and focus for new streams
- Clean message display with role-based styling
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


#### Request Format

- `streamName` (required): String identifying the chat stream. This will be used as the tab name.
- `messages` (required): Array of message objects, each containing:
  - `role` (required): String indicating the message sender (e.g., "user", "assistant" - can be anything, but some default roles have built-in color codes)
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
