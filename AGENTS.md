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


## Architecture 

This project is a small Electron desktop app with two main runtime layers:

1. `main.js` runs the Electron main process and the embedded Express server.
2. `renderer.js` runs in the browser window and owns all UI state.
3. `index.html` defines the full UI shell and inlined styles.

### Runtime Components

#### Electron Main Process (`main.js`)

- Creates the application window and loads `index.html`.
- Starts an Express server on `0.0.0.0:9797`.
- Accepts `POST /log` requests containing `streamName` and `messages`.
- Strips each incoming message down to `{ role, content }`.
- Forwards new logs into the renderer with `mainWindow.webContents.send('new-log', ...)`.
- Exposes an IPC handler, `count-tokens`, that lazily loads `tiktoken` and returns per-message token counts.

The main process is intentionally thin. It does not store stream history or own tab state. Its job is transport and background work.

#### Renderer Process (`renderer.js`)

`renderer.js` defines a single `LogManager` class that owns the entire UI model:

- `tabs`: maps `streamName` to the DOM nodes for that stream.
- `activeTab`: tracks the currently visible stream.
- `tabRoles`: tracks which roles have appeared in each stream.
- `disabledRoles`: tracks per-stream role filters.
- `searchQuery`: global search term applied to the active tab.
- `uncountedMessages`: tracks messages that still need token counts.

The renderer is responsible for:

- creating tabs on demand
- appending message DOM nodes
- normalizing some role names (`ai -> assistant`, `human -> user`)
- search and inline highlighting
- per-role filtering
- auto-focus / auto-scroll behavior
- token count display and totals

All state is in memory only. Reloading the app clears every stream and every tab.

#### UI Shell (`index.html`)

`index.html` contains:

- the search bar
- the per-tab role filter bar
- the tab strip
- token controls
- the log content area
- all CSS styling

There is no separate stylesheet or frontend build step. UI changes usually mean editing `index.html` and `renderer.js` together.


### Receiving Log Messages

The ingest flow is:

1. An external client sends `POST /log` to port `9797`.
2. `main.js` validates that `streamName` and `messages` exist.
3. The payload is reduced to only `role` and `content`.
4. The main process emits `new-log` to the renderer.
5. `renderer.js` creates a tab if this `streamName` has not been seen before.
6. Each message is rendered into the stream's log container.
7. If auto-focus is enabled, the new stream becomes the active tab and scrolls to the bottom.

Important details:

- `streamName` is the tab identity. Reusing the same name appends to the existing tab.
- `content` may be a string or an array. Arrays are joined with newlines before display and token counting.
- Unknown roles are allowed. They render successfully and get the default fallback role color in the filter bar.
- Closed tabs are not archived. If a later log arrives for the same `streamName`, a fresh tab is created.

### Token Counting

Token counting is opt-in from the UI:

- Enabling `Count Tokens` makes the renderer collect all uncounted messages.
- The renderer batches them and calls `ipcRenderer.invoke('count-tokens', messages)`.
- The main process encodes message content with `tiktoken` using `encoding_for_model('gpt-4')`.
- Results are returned per message and written back into the DOM.
- Totals are then recomputed by scanning counted messages.

Current token totals are grouped as:

- input: `system`, `user`
- output: `assistant`, `tool`, `ai`

If you add new semantic roles, update this grouping in `renderer.js` if they should affect totals differently.


## Main Principles

### Keep the Main Process Minimal

Use `main.js` for:

- Electron lifecycle
- HTTP ingestion
- IPC handlers
- work that should not block the renderer

Avoid pushing UI state into the main process unless you are intentionally introducing persistence or background orchestration.

### Keep UI State in `LogManager`

Most feature work belongs in `renderer.js`. If you add a new control, filter, summary, or tab-level behavior, prefer storing it as explicit `LogManager` state and updating the DOM from there.

### Preserve the Stream Model

The app assumes one tab per `streamName`. Before changing that model, check all code paths that depend on it:

- tab creation
- activation
- filtering
- role tracking
- close/reopen behavior

### Prefer Incremental Rendering Features

This app already appends messages incrementally. New features should fit into that model instead of rebuilding the whole log view on every update.

### Treat Search Highlighting Carefully

Search works by switching `.content` between `textContent` and `innerHTML`. If you add richer message rendering, preserve access to the original raw text so filters and highlighting stay correct and safe.


### Performance Notes

The current implementation is simple and should work well for moderate volumes, but these are the first scaling pressure points:

- one DOM node tree per message
- token totals recomputed by scanning all counted messages
- search/filter iterating over every message in the active tab

If the logger grows, likely improvements are virtualization, cached aggregates, and scoped re-filtering.