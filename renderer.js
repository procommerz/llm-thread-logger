const { ipcRenderer } = require('electron');

class LogManager {
    constructor() {
        this.tabs = new Map();
        this.activeTab = null;
        this.tabsContainer = document.getElementById('tabs');
        this.contentContainer = document.getElementById('content');
        this.messageIdCounter = 0;
        
        // Autoscroll
        this.autoscrollEnabled = true;

        // Token counting properties
        this.tokenCountingEnabled = false;
        this.uncountedMessages = new Set();
        this.tokenCountingInterval = null;
        this.totalTokensIn = 0;
        this.totalTokensOut = 0;

        // Search state
        this.searchQuery = '';
        this._searchDebounce = null;

        // Role filter state
        this.tabRoles = new Map();    // streamName -> Set<role>
        this.disabledRoles = new Map(); // streamName -> Set<role>
        
        this.setupEventListeners();
        this.initializeAutoscroll();
        this.initializeTokenCounting();
        this.initializeSearch();
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
        this.tabs.set(streamName, { tab, content });
        this.tabRoles.set(streamName, new Set());
        this.disabledRoles.set(streamName, new Set());

        // Add to DOM
        this.tabsContainer.appendChild(tab);
        this.contentContainer.appendChild(content);
    }

    addMessagesToTab(streamName, messages) {
        const { content } = this.tabs.get(streamName);
        const tabRolesSet = this.tabRoles.get(streamName);
        let newRoleAdded = false;
        
        messages.forEach(message => {
            const messageElement = document.createElement('div');

            let messageRole = message.role;

            if (['ai'].includes(messageRole)) {
                messageRole = 'assistant';
            } else if (['human'].includes(messageRole)) {
                messageRole = 'user';
            }

            if (!tabRolesSet.has(messageRole)) {
                tabRolesSet.add(messageRole);
                newRoleAdded = true;
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

        // Rebuild role filter bar if a new role appeared in the active tab
        if (newRoleAdded && this.activeTab === streamName) {
            this.rebuildRoleFilterBar(streamName);
        }

        // Apply filters if search is active or any roles are disabled
        const hasDisabledRoles = (this.disabledRoles.get(streamName) || new Set()).size > 0;
        if (this.searchQuery.length > 2 || hasDisabledRoles) {
            this.applyFilter(streamName);
        }

        if (this.autoscrollEnabled) {
            content.scrollTo({
                top: content.scrollHeight,
                behavior: 'smooth'
            });
        }
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

        this.rebuildRoleFilterBar(streamName);

        // Apply current filter to the newly active tab
        const hasDisabledRoles = (this.disabledRoles.get(streamName) || new Set()).size > 0;
        if (this.searchQuery.length > 2 || hasDisabledRoles) {
            this.applyFilter(streamName);
        }
    }

    getRoleColor(role) {
        const colors = {
            system: '#5b89ad',
            assistant: '#8be9fd',
            user: '#50fa7b',
        };
        return colors[role] || '#bd93f9';
    }

    rebuildRoleFilterBar(streamName) {
        const bar = document.getElementById('role-filter-bar');
        bar.innerHTML = '';

        if (!streamName) return;

        const roles = this.tabRoles.get(streamName);
        if (!roles || roles.size === 0) return;

        const disabled = this.disabledRoles.get(streamName);

        const prefix = document.createElement('span');
        prefix.id = 'role-filter-prefix';
        prefix.textContent = 'Roles:';
        bar.appendChild(prefix);

        [...roles].sort().forEach(role => {
            const label = document.createElement('label');
            label.className = 'role-filter-label' + (disabled.has(role) ? ' disabled' : '');

            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.checked = !disabled.has(role);

            const dot = document.createElement('span');
            dot.className = 'role-filter-dot';
            dot.style.background = this.getRoleColor(role);

            label.appendChild(checkbox);
            label.appendChild(dot);
            label.appendChild(document.createTextNode(role));

            checkbox.addEventListener('change', () => {
                if (checkbox.checked) {
                    disabled.delete(role);
                    label.classList.remove('disabled');
                } else {
                    disabled.add(role);
                    label.classList.add('disabled');
                }
                this.applyFilter(streamName);
            });

            bar.appendChild(label);
        });
    }

    initializeSearch() {
        const input = document.getElementById('search-input');
        const clearBtn = document.getElementById('search-clear');

        input.addEventListener('input', () => {
            const value = input.value;
            clearBtn.classList.toggle('visible', value.length > 0);

            clearTimeout(this._searchDebounce);
            this._searchDebounce = setTimeout(() => {
                this.searchQuery = value;
                if (this.activeTab) {
                    this.applyFilter(this.activeTab);
                }
            }, 150);
        });

        clearBtn.addEventListener('click', () => {
            input.value = '';
            clearBtn.classList.remove('visible');
            this.searchQuery = '';
            if (this.activeTab) {
                this.applyFilter(this.activeTab);
            }
            input.focus();
        });
    }

    escapeHtml(text) {
        return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    highlightText(rawText, query) {
        const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const parts = rawText.split(new RegExp(`(${escapedQuery})`, 'gi'));
        return parts.map((part, i) => {
            const escaped = this.escapeHtml(part);
            return i % 2 === 1 ? `<mark class="search-highlight">${escaped}</mark>` : escaped;
        }).join('');
    }

    applyFilter(streamName) {
        const { content } = this.tabs.get(streamName);
        const query = this.searchQuery;
        const active = query.length > 2;
        const messages = content.querySelectorAll('.message');
        const disabled = this.disabledRoles.get(streamName) || new Set();
        let matchCount = 0;

        messages.forEach(message => {
            const contentEl = message.querySelector('.content');
            if (!contentEl) return;

            // Always recover raw text via textContent (works after innerHTML was set)
            const rawText = contentEl.textContent;
            const roleHidden = disabled.has(message.dataset.role);

            if (roleHidden) {
                message.style.display = 'none';
                contentEl.textContent = rawText;
                return;
            }

            if (!active) {
                message.style.display = '';
                contentEl.textContent = rawText;
            } else {
                const matches = rawText.toLowerCase().includes(query.toLowerCase());
                if (matches) {
                    matchCount++;
                    message.style.display = '';
                    contentEl.innerHTML = this.highlightText(rawText, query);
                } else {
                    message.style.display = 'none';
                    contentEl.textContent = rawText;
                }
            }
        });

        const countEl = document.getElementById('search-count');
        if (active) {
            countEl.textContent = `${matchCount} / ${messages.length} messages`;
            countEl.classList.toggle('has-results', matchCount > 0);
        } else {
            countEl.textContent = '';
            countEl.classList.remove('has-results');
        }
    }

    closeTab(streamName) {
        const { tab, content } = this.tabs.get(streamName);
        
        // Remove from DOM
        tab.remove();
        content.remove();
        
        // Remove from storage
        this.tabs.delete(streamName);
        this.tabRoles.delete(streamName);
        this.disabledRoles.delete(streamName);
        
        // If this was the active tab, activate another one
        if (this.activeTab === streamName) {
            this.activeTab = null;
            if (this.tabs.size > 0) {
                const nextStreamName = this.tabs.keys().next().value;
                this.activateTab(nextStreamName);
            } else {
                document.getElementById('role-filter-bar').innerHTML = '';
            }
        }
    }

    initializeAutoscroll() {
        const toggle = document.getElementById('autoscroll-toggle');
        if (toggle) {
            this.autoscrollEnabled = toggle.checked;
            toggle.addEventListener('change', (e) => {
                this.autoscrollEnabled = e.target.checked;
            });
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