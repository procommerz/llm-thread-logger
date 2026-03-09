const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const express = require('express');
const expressApp = express();
const port = 9797;
const bind = '0.0.0.0';

let mainWindow;
let encoder = null;

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
  const { streamName, messages } = req.body;

  // Debug arriving logs:
//   console.log("Log Body", req.body);
  
  if (!streamName || !messages) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const strippedMessages = messages.map(message => {
    return {
      role: message.role,
      content: message.content
    };
  });

  // Send the log data to the renderer process
  mainWindow.webContents.send('new-log', { streamName, messages: strippedMessages });
  
  res.json({ success: true });
});

expressApp.listen(port, bind, () => {
  console.log(`Log server listening at http://localhost:${port}`);
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