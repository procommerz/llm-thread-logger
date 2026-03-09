const { ipcRenderer } = require('electron');

class LogManager {
    constructor() {
        this.tabs = new Map();
        this.activeTab = null;
        this.tabsContainer = document.getElementById('tabs');
        this.contentContainer = document.getElementById('content');
        this.messageIdCounter = 0;
        
        // Token counting properties
        this.tokenCountingEnabled = false;
        this.uncountedMessages = new Set();
        this.tokenCountingInterval = null;
        this.totalTokensIn = 0;
        this.totalTokensOut = 0;
        
        this.setupEventListeners();
        this.initializeTokenCounting();
    }

    setupEventListeners() {
        ipcRenderer.on('new-log', (event, data) => {
            this.handleNewLog(data);
        });

        // Add keyboard event listener for escape key
        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape' && this.activeTab) {
                this.closeTab(this.activeTab);
            }
        });
    }

    handleNewLog(data) {
        const { streamName, messages } = data;
        
        if (!this.tabs.has(streamName)) {
            this.createNewTab(streamName);
        }
        
        this.addMessagesToTab(streamName, messages);
        this.activateTab(streamName);
    }

    createNewTab(streamName) {
        // Create tab element
        const tab = document.createElement('div');
        tab.className = 'tab';
        tab.dataset.streamName = streamName;
        tab.innerHTML = `
            ${streamName}
            <span class="close-btn">X</span>
        `;

        // Create content container
        const content = document.createElement('div');
        content.className = 'log-container';
        content.dataset.streamName = streamName;
        content.style.paddingBottom = '48px';  // Add bottom padding

        // Add event listeners
        tab.addEventListener('click', (e) => {
            console.log(e.button, e.which);
            if (e.button !== 1 && !e.target.classList.contains('close-btn')) {
                this.activateTab(streamName);
            } else if (e.button === 2 || e.button === 3 || e.button === 4 || e.which == 2) {
                // Middle click will close the tab
                this.closeTab(streamName);
            }
        });

        tab.querySelector('.close-btn').addEventListener('click', () => {
            this.closeTab(streamName);
        });

        

        // Store references
        this.tabs.set(streamName, {
            tab,
            content
        });

        // Add to DOM
        this.tabsContainer.appendChild(tab);
        this.contentContainer.appendChild(content);
    }

    addMessagesToTab(streamName, messages) {
        const { content } = this.tabs.get(streamName);
        
        messages.forEach(message => {
            const messageElement = document.createElement('div');

            let messageRole = message.role;

            if (['ai'].includes(messageRole)) {
                messageRole = 'assistant';
            } else if (['human'].includes(messageRole)) {
                messageRole = 'user';
            }

            // Generate unique message ID
            const messageId = `msg-${Date.now()}-${this.messageIdCounter++}`;
            
            messageElement.className = `message ${messageRole}`;
            messageElement.dataset.messageId = messageId;
            messageElement.dataset.counted = 'false';
            messageElement.dataset.role = messageRole;
            
            const roleElement = document.createElement('div');
            roleElement.className = 'role';
            roleElement.textContent = message.role;
            
            const contentElement = document.createElement('div');
            contentElement.className = 'content';
            const messageContent = Array.isArray(message.content) 
                ? message.content.join('\n') 
                : message.content;
            contentElement.textContent = messageContent;
            
            // Create footer with character count and token count placeholder
            const footerElement = document.createElement('div');
            footerElement.className = 'message-footer';
            
            const charCount = messageContent.length;
            const charCountSpan = document.createElement('span');
            charCountSpan.className = 'char-count';
            charCountSpan.textContent = `${charCount.toLocaleString()} chars`;
            
            const tokenCountSpan = document.createElement('span');
            tokenCountSpan.className = 'token-count';
            tokenCountSpan.textContent = '0 tokens';
            
            // Show token count if token counting is enabled
            if (this.tokenCountingEnabled) {
                tokenCountSpan.classList.add('visible');
            }
            
            footerElement.appendChild(charCountSpan);
            footerElement.appendChild(tokenCountSpan);
            
            messageElement.appendChild(roleElement);
            messageElement.appendChild(contentElement);
            messageElement.appendChild(footerElement);
            content.appendChild(messageElement);
            
            // Add to uncounted messages if token counting is enabled
            if (this.tokenCountingEnabled) {
                this.uncountedMessages.add(messageId);
            }
        });

        // Scroll to bottom using a more reliable method
        content.scrollTo({
            top: content.scrollHeight,
            behavior: 'smooth'
        });
    }

    activateTab(streamName) {
        // Deactivate current tab
        if (this.activeTab) {
            const currentTab = this.tabs.get(this.activeTab);
            currentTab.tab.classList.remove('active');
            currentTab.content.classList.remove('active');
        }

        // Activate new tab
        const newTab = this.tabs.get(streamName);
        newTab.tab.classList.add('active');
        newTab.content.classList.add('active');
        this.activeTab = streamName;
    }

    closeTab(streamName) {
        const { tab, content } = this.tabs.get(streamName);
        
        // Remove from DOM
        tab.remove();
        content.remove();
        
        // Remove from storage
        this.tabs.delete(streamName);
        
        // If this was the active tab, activate another one
        if (this.activeTab === streamName) {
            this.activeTab = null;
            if (this.tabs.size > 0) {
                const nextStreamName = this.tabs.keys().next().value;
                this.activateTab(nextStreamName);
            }
        }
    }

    initializeTokenCounting() {
        const toggleCheckbox = document.getElementById('token-counting-toggle');
        if (toggleCheckbox) {
            toggleCheckbox.addEventListener('change', (e) => {
                this.toggleTokenCounting(e.target.checked);
            });            
        }
    }

    toggleTokenCounting(enabled) {
        this.tokenCountingEnabled = enabled;
        
        const tokenTotals = document.getElementById('token-totals');
        const tokenCountElements = document.querySelectorAll('.message-footer .token-count');
        
        if (enabled) {
            // Show token counts and totals
            tokenCountElements.forEach(el => el.classList.add('visible'));
            if (tokenTotals) tokenTotals.style.display = 'inline';
            
            // Collect all uncounted messages
            const allMessages = document.querySelectorAll('.message[data-counted="false"]');
            allMessages.forEach(msg => {
                this.uncountedMessages.add(msg.dataset.messageId);
            });
            
            this.contentContainer.classList.add('token-counting-enabled');            

            // Start interval for batch processing
            this.startTokenCountingInterval();
        } else {
            // Hide token counts and totals
            tokenCountElements.forEach(el => el.classList.remove('visible'));
            if (tokenTotals) tokenTotals.style.display = 'none';
            
            this.contentContainer.classList.remove('token-counting-enabled');            

            // Stop interval
            this.stopTokenCountingInterval();
        }
    }

    startTokenCountingInterval() {
        // Clear any existing interval
        this.stopTokenCountingInterval();
        
        // Process immediately, then every 5 seconds
        this.processUncountedMessages();
        this.tokenCountingInterval = setInterval(() => {
            this.processUncountedMessages();
        }, 5000);
    }

    stopTokenCountingInterval() {
        if (this.tokenCountingInterval) {
            clearInterval(this.tokenCountingInterval);
            this.tokenCountingInterval = null;
        }
    }

    async processUncountedMessages() {
        if (this.uncountedMessages.size === 0) {
            return;
        }

        // Collect messages to process
        const messagesToProcess = [];
        this.uncountedMessages.forEach(messageId => {
            const messageElement = document.querySelector(`[data-message-id="${messageId}"]`);
            if (messageElement) {
                const contentElement = messageElement.querySelector('.content');
                if (contentElement) {
                    messagesToProcess.push({
                        id: messageId,
                        content: contentElement.textContent,
                        role: messageElement.dataset.role
                    });
                }
            }
        });

        if (messagesToProcess.length === 0) {
            return;
        }

        try {
            // Send IPC request to main process
            const results = await ipcRenderer.invoke('count-tokens', messagesToProcess);
            
            // Update UI with results
            results.forEach(result => {
                this.updateMessageTokenCount(result.id, result.tokenCount, result.role);
                this.uncountedMessages.delete(result.id);
            });
            
            // Update totals
            this.updateTotalTokens();
        } catch (error) {
            console.error('Error counting tokens:', error);
        }
    }

    updateMessageTokenCount(messageId, tokenCount, role) {
        const messageElement = document.querySelector(`[data-message-id="${messageId}"]`);
        if (messageElement) {
            messageElement.dataset.counted = 'true';
            messageElement.dataset.tokens = tokenCount;
            
            const tokenCountSpan = messageElement.querySelector('.token-count');
            if (tokenCountSpan) {
                tokenCountSpan.textContent = `${tokenCount.toLocaleString()} tokens`;
            }
        }
    }

    updateTotalTokens() {
        let tokensIn = 0;
        let tokensOut = 0;
        
        // Categorize roles
        const inRoles = ['system', 'user'];
        const outRoles = ['assistant', 'tool', 'ai'];
        
        const countedMessages = document.querySelectorAll('.message[data-counted="true"]');
        countedMessages.forEach(msg => {
            const tokens = parseInt(msg.dataset.tokens) || 0;
            const role = msg.dataset.role;
            
            if (inRoles.includes(role)) {
                tokensIn += tokens;
            } else if (outRoles.includes(role)) {
                tokensOut += tokens;
            }
        });
        
        this.totalTokensIn = tokensIn;
        this.totalTokensOut = tokensOut;
        
        // Update UI
        const tokensInElement = document.getElementById('tokens-in');
        const tokensOutElement = document.getElementById('tokens-out');
        
        if (tokensInElement) {
            tokensInElement.textContent = tokensIn.toLocaleString();
        }
        if (tokensOutElement) {
            tokensOutElement.textContent = tokensOut.toLocaleString();
        }
    }
}

// Initialize the log manager when the page loads
window.addEventListener('DOMContentLoaded', () => {
    new LogManager();
}); 