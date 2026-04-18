const { ipcRenderer } = require('electron');

class LogManager {
    constructor() {
        this.tabs = new Map();
        this.activeTab = null;
        this.tabsContainer = document.getElementById('tabs');
        this.contentContainer = document.getElementById('content');
        this.messageIdCounter = 0;

        this.autoscrollEnabled = true;

        this.tokenCountingEnabled = false;
        this.uncountedMessages = new Set();
        this.tokenCountingInterval = null;
        this.totalTokensIn = 0;
        this.totalTokensOut = 0;

        this.searchQuery = '';
        this._searchDebounce = null;

        this.tabRoles = new Map();
        this.disabledRoles = new Map();

        this.setupEventListeners();
        this.initializeAutoscroll();
        this.initializeTokenCounting();
        this.initializeSearch();
    }

    setupEventListeners() {
        ipcRenderer.on('new-log', (event, data) => {
            this.handleNewLog(data);
        });

        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape' && this.activeTab) {
                this.closeTab(this.activeTab);
            }
        });
    }

    handleNewLog(data) {
        const { streamName, messages, events } = data;

        if (!this.tabs.has(streamName)) {
            this.createNewTab(streamName);
        }

        if (Array.isArray(messages) && messages.length > 0) {
            this.addMessagesToTab(streamName, messages);
        }

        if (Array.isArray(events) && events.length > 0) {
            this.addEventsToTab(streamName, events);
        }

        if (this.autoscrollEnabled) {
            this.activateTab(streamName);
        }
    }

    createNewTab(streamName) {
        const tab = document.createElement('div');
        tab.className = 'tab';
        tab.dataset.streamName = streamName;
        tab.innerHTML = `
            ${streamName}
            <span class="close-btn">X</span>
        `;

        const content = document.createElement('div');
        content.className = 'log-container';
        content.dataset.streamName = streamName;
        content.style.paddingBottom = '48px';

        tab.addEventListener('click', (e) => {
            if (e.button !== 1 && !e.target.classList.contains('close-btn')) {
                this.activateTab(streamName);
            } else if (e.button === 2 || e.button === 3 || e.button === 4 || e.which === 2) {
                this.closeTab(streamName);
            }
        });

        tab.querySelector('.close-btn').addEventListener('click', () => {
            this.closeTab(streamName);
        });

        this.tabs.set(streamName, { tab, content });
        this.tabRoles.set(streamName, new Set());
        this.disabledRoles.set(streamName, new Set());

        this.tabsContainer.appendChild(tab);
        this.contentContainer.appendChild(content);
    }

    createEntryId(prefix) {
        return `${prefix}-${Date.now()}-${this.messageIdCounter++}`;
    }

    normalizeRole(role) {
        if (role === 'ai') {
            return 'assistant';
        }

        if (role === 'human') {
            return 'user';
        }

        return role;
    }

    addMessagesToTab(streamName, messages) {
        const { content } = this.tabs.get(streamName);
        const tabRolesSet = this.tabRoles.get(streamName);
        let newRoleAdded = false;

        messages.forEach(message => {
            const messageRole = this.normalizeRole(message.role);

            if (!tabRolesSet.has(messageRole)) {
                tabRolesSet.add(messageRole);
                newRoleAdded = true;
            }

            const messageId = this.createEntryId('msg');
            const messageElement = this.createMessageElement(message, messageRole, messageId);
            content.appendChild(messageElement);

            if (this.tokenCountingEnabled) {
                this.uncountedMessages.add(messageId);
            }
        });

        this.afterEntriesAdded(streamName, newRoleAdded);
    }

    addEventsToTab(streamName, events) {
        const { content } = this.tabs.get(streamName);
        const tabRolesSet = this.tabRoles.get(streamName);
        let newRoleAdded = false;

        events.forEach(event => {
            const role = event.eventType;

            if (!tabRolesSet.has(role)) {
                tabRolesSet.add(role);
                newRoleAdded = true;
            }

            const eventElement = this.createEventElement(event);
            content.appendChild(eventElement);
        });

        this.afterEntriesAdded(streamName, newRoleAdded);
    }

    afterEntriesAdded(streamName, newRoleAdded) {
        if (newRoleAdded && this.activeTab === streamName) {
            this.rebuildRoleFilterBar(streamName);
        }

        const hasDisabledRoles = (this.disabledRoles.get(streamName) || new Set()).size > 0;
        if (this.searchQuery.length > 2 || hasDisabledRoles) {
            this.applyFilter(streamName);
        }

        if (this.autoscrollEnabled) {
            const { content } = this.tabs.get(streamName);
            content.scrollTo({
                top: content.scrollHeight,
                behavior: 'smooth'
            });
        }
    }

    createMessageElement(message, messageRole, messageId) {
        const messageElement = document.createElement('div');
        const messageContent = this.formatMessageContent(message.content);

        messageElement.className = `message entry ${messageRole}`;
        messageElement.dataset.entryType = 'message';
        messageElement.dataset.messageId = messageId;
        messageElement.dataset.counted = 'false';
        messageElement.dataset.role = messageRole;
        messageElement.dataset.searchText = `${message.role || ''}\n${messageContent}`.toLowerCase();

        const roleElement = document.createElement('div');
        roleElement.className = 'role searchable-text';
        this.setSearchableText(roleElement, message.role || messageRole);

        const contentElement = document.createElement('div');
        contentElement.className = 'content searchable-text';
        this.setSearchableText(contentElement, messageContent);

        const footerElement = document.createElement('div');
        footerElement.className = 'message-footer';

        const charCountSpan = document.createElement('span');
        charCountSpan.className = 'char-count';
        charCountSpan.textContent = `${messageContent.length.toLocaleString()} chars`;

        const tokenCountSpan = document.createElement('span');
        tokenCountSpan.className = 'token-count';
        tokenCountSpan.textContent = '0 tokens';

        if (this.tokenCountingEnabled) {
            tokenCountSpan.classList.add('visible');
        }

        footerElement.appendChild(charCountSpan);
        footerElement.appendChild(tokenCountSpan);

        messageElement.appendChild(roleElement);
        messageElement.appendChild(contentElement);
        messageElement.appendChild(footerElement);

        return messageElement;
    }

    createEventElement(eventData) {
        const role = eventData.eventType;
        const entry = document.createElement('div');
        entry.className = `event-panel entry ${role}`;
        entry.dataset.entryType = 'event';
        entry.dataset.role = role;
        entry.dataset.searchText = this.collectSearchText(eventData).toLowerCase();

        const header = document.createElement('div');
        header.className = 'event-header';

        const title = document.createElement('div');
        title.className = 'event-title';
        this.setSearchableText(title, eventData.eventType);

        const meta = document.createElement('div');
        meta.className = 'event-header-meta';
        this.setSearchableText(meta, this.formatEventHeaderMeta(eventData));

        header.appendChild(title);
        header.appendChild(meta);
        entry.appendChild(header);

        const summary = this.createMetaGrid([
            ['agent', eventData.agentId],
            ['session', eventData.sessionKey],
            ['run', eventData.runId],
            ['stream', eventData.streamName]
        ]);
        entry.appendChild(summary);

        const body = this.createEventBody(eventData);
        if (body) {
            entry.appendChild(body);
        }

        return entry;
    }

    createEventBody(eventData) {
        switch (eventData.eventType) {
            case 'assistant_message_start':
                return this.createEventSection('State', [
                    this.createKeyValueLine('status', 'assistant response started')
                ]);
            case 'assistant_message_end':
                return this.createAssistantMessageEndBody(eventData);
            case 'tool_start':
                return this.createToolStartBody(eventData);
            case 'tool_end':
                return this.createToolEndBody(eventData);
            case 'model_request':
                return this.createModelRequestBody(eventData);
            default:
                return this.createJsonBlock(eventData);
        }
    }

    createAssistantMessageEndBody(eventData) {
        const section = document.createElement('div');
        section.className = 'event-body';

        section.appendChild(this.createMetaGrid([
            ['status', 'assistant response finished'],
            ['text length', String((eventData.rawText || '').length)],
            ['thinking length', String((eventData.rawThinking || '').length)]
        ]));

        section.appendChild(this.createCollapsibleTextBlock('Output Text', eventData.rawText || '', true));
        section.appendChild(this.createCollapsibleTextBlock('Raw Thinking', eventData.rawThinking || '', false));

        return section;
    }

    createToolStartBody(eventData) {
        const section = document.createElement('div');
        section.className = 'event-body';

        section.appendChild(this.createMetaGrid([
            ['tool', eventData.toolName],
            ['tool call id', eventData.toolCallId]
        ]));

        section.appendChild(this.createCollapsibleJsonBlock('Arguments', eventData.args, true));
        return section;
    }

    createToolEndBody(eventData) {
        const section = document.createElement('div');
        section.className = 'event-body';

        section.appendChild(this.createMetaGrid([
            ['tool', eventData.toolName],
            ['tool call id', eventData.toolCallId],
            ['is error', String(eventData.isError)]
        ]));

        section.appendChild(this.createCollapsibleJsonBlock('Result', eventData.result, false));
        return section;
    }

    createModelRequestBody(eventData) {
        const payload = eventData.payload || {};
        const section = document.createElement('div');
        section.className = 'event-body';

        section.appendChild(this.createMetaGrid([
            ['request index', String(eventData.requestIndex)],
            ['provider', eventData.provider],
            ['model id', eventData.modelId],
            ['model api', eventData.modelApi],
            ['payload model', payload.model],
            ['stream', String(payload.stream)],
            ['store', String(payload.store)],
            ['max completion tokens', String(payload.max_completion_tokens)],
            ['completion messages', String((payload.messages || []).length)],
            ['available tools', String((payload.tools || []).length)]
        ]));

        section.appendChild(this.createFoldableMessagesBlock(payload.messages || []));
        section.appendChild(this.createFoldableToolsBlock(payload.tools || []));

        return section;
    }

    createFoldableMessagesBlock(messages) {
        const items = messages.map((message, index) => {
            const wrapper = document.createElement('div');
            wrapper.className = 'nested-body';

            wrapper.appendChild(this.createMetaGrid([
                ['role', message.role],
                ['tool call id', message.tool_call_id || ''],
                ['tool calls', String((message.tool_calls || []).length)]
            ]));

            wrapper.appendChild(this.createCollapsibleTextBlock('Content', this.formatStructuredContent(message.content), true));

            if (Array.isArray(message.tool_calls) && message.tool_calls.length > 0) {
                const toolCallsContainer = document.createElement('div');
                toolCallsContainer.className = 'nested-list';

                message.tool_calls.forEach((toolCall, toolIndex) => {
                    const item = document.createElement('div');
                    item.className = 'nested-subcard';
                    item.appendChild(this.createMetaGrid([
                        ['tool call', `${toolIndex + 1}`],
                        ['id', toolCall.id],
                        ['name', toolCall.function && toolCall.function.name]
                    ]));
                    item.appendChild(this.createCollapsibleTextBlock(
                        'Arguments',
                        toolCall.function && toolCall.function.arguments ? toolCall.function.arguments : '',
                        false
                    ));
                    toolCallsContainer.appendChild(item);
                });

                wrapper.appendChild(this.createEventSection('Tool Calls', [toolCallsContainer]));
            }

            return this.createNestedDetails(`Message ${index + 1} · ${message.role}`, wrapper, index < 2);
        });

        return this.createEventSection('Completion Messages', [
            this.createNestedCollection(items, messages.length === 0 ? 'No completion messages.' : '')
        ]);
    }

    createFoldableToolsBlock(tools) {
        const items = tools.map((tool, index) => {
            const fn = tool.function || {};
            const wrapper = document.createElement('div');
            wrapper.className = 'nested-body';

            wrapper.appendChild(this.createMetaGrid([
                ['type', tool.type],
                ['name', fn.name],
                ['strict', String(fn.strict)]
            ]));

            wrapper.appendChild(this.createCollapsibleTextBlock('Description', fn.description || '', true));
            wrapper.appendChild(this.createCollapsibleJsonBlock('Parameters', fn.parameters || {}, false));

            return this.createNestedDetails(`Tool ${index + 1} · ${fn.name || 'function'}`, wrapper, index < 2);
        });

        return this.createEventSection('Available Tools', [
            this.createNestedCollection(items, tools.length === 0 ? 'No tools.' : '')
        ]);
    }

    createNestedCollection(items, emptyText) {
        const container = document.createElement('div');
        container.className = 'nested-list';

        if (items.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'event-empty';
            this.setSearchableText(empty, emptyText);
            container.appendChild(empty);
            return container;
        }

        items.forEach(item => container.appendChild(item));
        return container;
    }

    createNestedDetails(title, bodyContent, open) {
        const details = document.createElement('details');
        details.className = 'nested-details';
        details.open = open;

        const summary = document.createElement('summary');
        summary.className = 'nested-summary searchable-text';
        this.setSearchableText(summary, title);

        details.appendChild(summary);
        details.appendChild(bodyContent);
        return details;
    }

    createEventSection(title, children) {
        const section = document.createElement('div');
        section.className = 'event-section';

        const heading = document.createElement('div');
        heading.className = 'event-section-title searchable-text';
        this.setSearchableText(heading, title);
        section.appendChild(heading);

        children.forEach(child => {
            if (child) {
                section.appendChild(child);
            }
        });

        return section;
    }

    createKeyValueLine(key, value) {
        const line = document.createElement('div');
        line.className = 'event-inline-kv';

        const keyEl = document.createElement('span');
        keyEl.className = 'event-inline-key';
        keyEl.textContent = `${key}:`;

        const valueEl = document.createElement('span');
        valueEl.className = 'searchable-text';
        this.setSearchableText(valueEl, value == null ? '' : String(value));

        line.appendChild(keyEl);
        line.appendChild(valueEl);
        return line;
    }

    createMetaGrid(rows) {
        const grid = document.createElement('div');
        grid.className = 'event-meta-grid';

        rows.forEach(([label, value]) => {
            if (value == null || value === '') {
                return;
            }

            const row = document.createElement('div');
            row.className = 'event-meta-row';

            const labelEl = document.createElement('div');
            labelEl.className = 'event-meta-label';
            labelEl.textContent = label;

            const valueEl = document.createElement('div');
            valueEl.className = 'event-meta-value searchable-text';
            this.setSearchableText(valueEl, String(value));

            row.appendChild(labelEl);
            row.appendChild(valueEl);
            grid.appendChild(row);
        });

        return grid;
    }

    createCollapsibleTextBlock(title, text, open) {
        const details = document.createElement('details');
        details.className = 'event-details';
        details.open = open;

        const summary = document.createElement('summary');
        summary.className = 'event-details-summary searchable-text';
        const safeText = text || '';
        this.setSearchableText(summary, `${title} (${safeText.length.toLocaleString()} chars)`);

        const pre = document.createElement('pre');
        pre.className = 'event-pre searchable-text';
        this.setSearchableText(pre, safeText);

        details.appendChild(summary);
        details.appendChild(pre);
        return details;
    }

    createCollapsibleJsonBlock(title, value, open) {
        const details = document.createElement('details');
        details.className = 'event-details';
        details.open = open;

        const summary = document.createElement('summary');
        summary.className = 'event-details-summary searchable-text';
        this.setSearchableText(summary, title);

        const pre = document.createElement('pre');
        pre.className = 'event-pre searchable-text';
        this.setSearchableText(pre, this.stringifyJson(value));

        details.appendChild(summary);
        details.appendChild(pre);
        return details;
    }

    createJsonBlock(value) {
        const pre = document.createElement('pre');
        pre.className = 'event-pre searchable-text';
        this.setSearchableText(pre, this.stringifyJson(value));
        return pre;
    }

    formatEventHeaderMeta(eventData) {
        const parts = [];

        if (Number.isFinite(eventData.seq)) {
            parts.push(`seq ${eventData.seq}`);
        }

        if (Number.isFinite(eventData.ts)) {
            parts.push(this.formatTimestamp(eventData.ts));
        }

        return parts.join(' · ');
    }

    formatTimestamp(ts) {
        try {
            return new Date(ts).toLocaleString();
        } catch (error) {
            return String(ts);
        }
    }

    formatMessageContent(content) {
        if (Array.isArray(content)) {
            return content.join('\n');
        }

        if (content == null) {
            return '';
        }

        return String(content);
    }

    formatStructuredContent(content) {
        if (content == null) {
            return '';
        }

        if (typeof content === 'string') {
            return content;
        }

        if (Array.isArray(content)) {
            return content.map(item => {
                if (item && typeof item === 'object' && item.type === 'text') {
                    return item.text || '';
                }

                return this.stringifyJson(item);
            }).join('\n');
        }

        return this.stringifyJson(content);
    }

    stringifyJson(value) {
        return JSON.stringify(value, null, 2);
    }

    collectSearchText(value) {
        if (value == null) {
            return '';
        }

        if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
            return String(value);
        }

        if (Array.isArray(value)) {
            return value.map(item => this.collectSearchText(item)).join('\n');
        }

        if (typeof value === 'object') {
            return Object.entries(value).map(([key, childValue]) => {
                return `${key}\n${this.collectSearchText(childValue)}`;
            }).join('\n');
        }

        return '';
    }

    setSearchableText(element, text) {
        const safeText = text == null ? '' : String(text);
        element.dataset.rawText = safeText;
        element.textContent = safeText;
    }

    activateTab(streamName) {
        if (this.activeTab) {
            const currentTab = this.tabs.get(this.activeTab);
            currentTab.tab.classList.remove('active');
            currentTab.content.classList.remove('active');
        }

        const newTab = this.tabs.get(streamName);
        newTab.tab.classList.add('active');
        newTab.content.classList.add('active');
        this.activeTab = streamName;

        this.rebuildRoleFilterBar(streamName);

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
            tool: '#ffb86c',
            ai: '#8be9fd',
            assistant_message_start: '#74c0fc',
            assistant_message_end: '#8be9fd',
            tool_start: '#ffb86c',
            tool_end: '#ff9e64',
            model_request: '#7ee787'
        };

        return colors[role] || '#bd93f9';
    }

    rebuildRoleFilterBar(streamName) {
        const bar = document.getElementById('role-filter-bar');
        bar.innerHTML = '';

        if (!streamName) {
            return;
        }

        const roles = this.tabRoles.get(streamName);
        if (!roles || roles.size === 0) {
            return;
        }

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
        const query = this.searchQuery.trim();
        const active = query.length > 2;
        const entries = content.querySelectorAll('.entry');
        const disabled = this.disabledRoles.get(streamName) || new Set();
        let matchCount = 0;

        entries.forEach(entry => {
            const searchables = entry.querySelectorAll('.searchable-text');
            searchables.forEach(node => {
                const rawText = node.dataset.rawText || '';
                node.textContent = rawText;
            });

            const roleHidden = disabled.has(entry.dataset.role);
            const rawSearchText = entry.dataset.searchText || '';
            const matches = !active || rawSearchText.includes(query.toLowerCase());

            if (roleHidden || !matches) {
                entry.style.display = 'none';
                return;
            }

            entry.style.display = '';
            matchCount++;

            if (active) {
                searchables.forEach(node => {
                    const rawText = node.dataset.rawText || '';
                    if (rawText.toLowerCase().includes(query.toLowerCase())) {
                        node.innerHTML = this.highlightText(rawText, query);
                    }
                });
            }
        });

        const countEl = document.getElementById('search-count');
        if (active) {
            countEl.textContent = `${matchCount} / ${entries.length} entries`;
            countEl.classList.toggle('has-results', matchCount > 0);
        } else {
            countEl.textContent = '';
            countEl.classList.remove('has-results');
        }
    }

    closeTab(streamName) {
        const { tab, content } = this.tabs.get(streamName);

        tab.remove();
        content.remove();

        this.tabs.delete(streamName);
        this.tabRoles.delete(streamName);
        this.disabledRoles.delete(streamName);

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
            tokenCountElements.forEach(el => el.classList.add('visible'));
            if (tokenTotals) {
                tokenTotals.style.display = 'inline';
            }

            const allMessages = document.querySelectorAll('.message[data-counted="false"]');
            allMessages.forEach(msg => {
                this.uncountedMessages.add(msg.dataset.messageId);
            });

            this.contentContainer.classList.add('token-counting-enabled');
            this.startTokenCountingInterval();
        } else {
            tokenCountElements.forEach(el => el.classList.remove('visible'));
            if (tokenTotals) {
                tokenTotals.style.display = 'none';
            }

            this.contentContainer.classList.remove('token-counting-enabled');
            this.stopTokenCountingInterval();
        }
    }

    startTokenCountingInterval() {
        this.stopTokenCountingInterval();

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

        const messagesToProcess = [];
        this.uncountedMessages.forEach(messageId => {
            const messageElement = document.querySelector(`[data-message-id="${messageId}"]`);
            if (messageElement) {
                const contentElement = messageElement.querySelector('.content');
                if (contentElement) {
                    messagesToProcess.push({
                        id: messageId,
                        content: contentElement.dataset.rawText || '',
                        role: messageElement.dataset.role
                    });
                }
            }
        });

        if (messagesToProcess.length === 0) {
            return;
        }

        try {
            const results = await ipcRenderer.invoke('count-tokens', messagesToProcess);

            results.forEach(result => {
                this.updateMessageTokenCount(result.id, result.tokenCount, result.role);
                this.uncountedMessages.delete(result.id);
            });

            this.updateTotalTokens();
        } catch (error) {
            console.error('Error counting tokens:', error);
        }
    }

    updateMessageTokenCount(messageId, tokenCount) {
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

        const inRoles = ['system', 'user'];
        const outRoles = ['assistant', 'tool', 'ai'];

        const countedMessages = document.querySelectorAll('.message[data-counted="true"]');
        countedMessages.forEach(msg => {
            const tokens = parseInt(msg.dataset.tokens, 10) || 0;
            const role = msg.dataset.role;

            if (inRoles.includes(role)) {
                tokensIn += tokens;
            } else if (outRoles.includes(role)) {
                tokensOut += tokens;
            }
        });

        this.totalTokensIn = tokensIn;
        this.totalTokensOut = tokensOut;

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

window.addEventListener('DOMContentLoaded', () => {
    new LogManager();
});
