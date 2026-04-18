const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const express = require('express');
const expressApp = express();
const port = 9797;
const bind = '0.0.0.0';

let mainWindow;
let encoder = null;

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isInteger(value) {
  return Number.isInteger(value);
}

function normalizeTextContentPart(part) {
  if (!isPlainObject(part) || part.type !== 'text' || typeof part.text !== 'string') {
    return null;
  }

  return {
    type: 'text',
    text: part.text
  };
}

function normalizeStructuredContent(content) {
  if (content === null) {
    return null;
  }

  if (typeof content === 'string') {
    return content;
  }

  if (!Array.isArray(content)) {
    return null;
  }

  const parts = content
    .map(normalizeTextContentPart)
    .filter(Boolean);

  if (parts.length !== content.length) {
    return null;
  }

  return parts;
}

function normalizeJsonValue(value) {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map(item => normalizeJsonValue(item));
  }

  if (isPlainObject(value)) {
    const normalized = {};
    Object.entries(value).forEach(([key, childValue]) => {
      normalized[key] = normalizeJsonValue(childValue);
    });
    return normalized;
  }

  return null;
}

function normalizeFunctionToolDefinition(tool) {
  if (!isPlainObject(tool) || tool.type !== 'function' || !isPlainObject(tool.function)) {
    return null;
  }

  const { name, description, parameters, strict } = tool.function;
  if (
    typeof name !== 'string' ||
    typeof description !== 'string' ||
    typeof strict !== 'boolean' ||
    !isPlainObject(parameters)
  ) {
    return null;
  }

  return {
    type: 'function',
    function: {
      name,
      description,
      parameters: normalizeJsonValue(parameters),
      strict
    }
  };
}

function normalizeToolCall(toolCall) {
  if (
    !isPlainObject(toolCall) ||
    typeof toolCall.id !== 'string' ||
    toolCall.type !== 'function' ||
    !isPlainObject(toolCall.function) ||
    typeof toolCall.function.name !== 'string' ||
    typeof toolCall.function.arguments !== 'string'
  ) {
    return null;
  }

  return {
    id: toolCall.id,
    type: 'function',
    function: {
      name: toolCall.function.name,
      arguments: toolCall.function.arguments
    }
  };
}

function normalizeCompletionMessage(message) {
  if (!isPlainObject(message) || typeof message.role !== 'string') {
    return null;
  }

  if (!['system', 'user', 'assistant', 'tool'].includes(message.role)) {
    return null;
  }

  const normalizedContent = normalizeStructuredContent(message.content);
  if (normalizedContent === null && message.content !== null) {
    return null;
  }

  const normalized = {
    role: message.role,
    content: normalizedContent
  };

  if (message.role === 'assistant' && message.tool_calls !== undefined) {
    if (!Array.isArray(message.tool_calls)) {
      return null;
    }

    const toolCalls = message.tool_calls
      .map(normalizeToolCall)
      .filter(Boolean);

    if (toolCalls.length !== message.tool_calls.length) {
      return null;
    }

    normalized.tool_calls = toolCalls;
  }

  if (message.role === 'tool') {
    if (typeof message.tool_call_id !== 'string') {
      return null;
    }

    normalized.tool_call_id = message.tool_call_id;
  }

  return normalized;
}

function normalizeModelRequestPayload(payload) {
  if (!isPlainObject(payload)) {
    return null;
  }

  const {
    model,
    messages,
    stream,
    store,
    max_completion_tokens: maxCompletionTokens,
    tools
  } = payload;

  if (
    typeof model !== 'string' ||
    !Array.isArray(messages) ||
    typeof stream !== 'boolean' ||
    typeof store !== 'boolean' ||
    !isInteger(maxCompletionTokens) ||
    !Array.isArray(tools)
  ) {
    return null;
  }

  const normalizedMessages = messages
    .map(normalizeCompletionMessage)
    .filter(Boolean);

  if (normalizedMessages.length !== messages.length) {
    return null;
  }

  const normalizedTools = tools
    .map(normalizeFunctionToolDefinition)
    .filter(Boolean);

  if (normalizedTools.length !== tools.length) {
    return null;
  }

  return {
    model,
    messages: normalizedMessages,
    stream,
    store,
    max_completion_tokens: maxCompletionTokens,
    tools: normalizedTools
  };
}

function normalizeBaseEvent(event) {
  if (!isPlainObject(event)) {
    return null;
  }

  const requiredStringFields = ['eventType', 'streamName', 'sessionId', 'sessionKey', 'runId', 'agentId'];
  const requiredIntegerFields = ['ts', 'seq'];

  for (const field of requiredStringFields) {
    if (typeof event[field] !== 'string') {
      return null;
    }
  }

  for (const field of requiredIntegerFields) {
    if (!isInteger(event[field])) {
      return null;
    }
  }

  return {
    eventType: event.eventType,
    ts: event.ts,
    streamName: event.streamName,
    sessionId: event.sessionId,
    sessionKey: event.sessionKey,
    runId: event.runId,
    agentId: event.agentId,
    seq: event.seq
  };
}

function normalizeEvent(event) {
  const baseEvent = normalizeBaseEvent(event);
  if (!baseEvent) {
    return null;
  }

  switch (baseEvent.eventType) {
    case 'assistant_message_start':
      return baseEvent;
    case 'assistant_message_end':
      if (typeof event.rawText !== 'string' || typeof event.rawThinking !== 'string') {
        return null;
      }
      return {
        ...baseEvent,
        rawText: event.rawText,
        rawThinking: event.rawThinking
      };
    case 'tool_start':
      if (
        typeof event.toolName !== 'string' ||
        typeof event.toolCallId !== 'string' ||
        !isPlainObject(event.args)
      ) {
        return null;
      }
      return {
        ...baseEvent,
        toolName: event.toolName,
        toolCallId: event.toolCallId,
        args: normalizeJsonValue(event.args)
      };
    case 'tool_end':
      if (
        typeof event.toolName !== 'string' ||
        typeof event.toolCallId !== 'string' ||
        typeof event.isError !== 'boolean'
      ) {
        return null;
      }
      return {
        ...baseEvent,
        toolName: event.toolName,
        toolCallId: event.toolCallId,
        isError: event.isError,
        result: normalizeJsonValue(event.result)
      };
    case 'model_request': {
      const payload = normalizeModelRequestPayload(event.payload);
      if (
        !isInteger(event.requestIndex) ||
        typeof event.provider !== 'string' ||
        typeof event.modelId !== 'string' ||
        typeof event.modelApi !== 'string' ||
        !payload
      ) {
        return null;
      }

      return {
        ...baseEvent,
        requestIndex: event.requestIndex,
        provider: event.provider,
        modelId: event.modelId,
        modelApi: event.modelApi,
        payload
      };
    }
    default:
      return null;
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  mainWindow.loadFile('index.html');
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// Express server setup
expressApp.use(express.json({ limit: '4mb' }));

expressApp.post('/log', (req, res) => {
  const { streamName, messages, event } = req.body;
  const resolvedStreamName = typeof streamName === 'string' ? streamName : event && event.streamName;

  // Debug arriving logs:
  // console.log(JSON.stringify(req.body, null, 2));
  
  if (!resolvedStreamName || (!messages && !event)) {
    console.log("Missing required fields", JSON.stringify(req.body, null, 2));
    return res.status(400).json({ error: 'Missing required fields' });
  }

  if (messages) {
    if (!Array.isArray(messages)) {
      return res.status(400).json({ error: 'Messages must be an array' });
    }

    const strippedMessages = messages.map(message => {
      return {
        role: message.role,
        content: message.content
      };
    });
  
    // Send the log data to the renderer process
    mainWindow.webContents.send('new-log', { streamName: resolvedStreamName, messages: strippedMessages });
  } else if (event) {
    const normalizedEvent = normalizeEvent(event);
    if (!normalizedEvent) {
      console.log("Invalid event payload", JSON.stringify(req.body, null, 2));
      return res.status(400).json({ error: 'Invalid event payload' });
    }

    if (normalizedEvent.streamName !== resolvedStreamName) {
      return res.status(400).json({ error: 'streamName does not match event.streamName' });
    }

    mainWindow.webContents.send('new-log', {
      streamName: normalizedEvent.streamName,
      events: [normalizedEvent]
    });
  }
  
  res.json({ success: true });
});

expressApp.listen(port, bind, () => {
  console.log(`Log server listening at http://0.0.0.0:${port}`);
});

// IPC handler for token counting
ipcMain.handle('count-tokens', async (event, messages) => {
  try {
    // Lazy load tiktoken encoder
    if (!encoder) {
      const { encoding_for_model } = require('tiktoken');
      encoder = encoding_for_model('gpt-4');
    }

    const results = messages.map(msg => {
      try {
        const content = Array.isArray(msg.content) 
          ? msg.content.join('\n') 
          : msg.content;
        const tokens = encoder.encode(content);
        return {
          id: msg.id,
          tokenCount: tokens.length,
          role: msg.role
        };
      } catch (error) {
        console.error(`Error encoding message ${msg.id}:`, error);
        return {
          id: msg.id,
          tokenCount: 0,
          role: msg.role
        };
      }
    });

    return results;
  } catch (error) {
    console.error('Error in count-tokens handler:', error);
    throw error;
  }
}); 
