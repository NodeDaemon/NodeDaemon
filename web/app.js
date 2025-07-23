let ws = null;
let processes = [];
let logs = [];
let selectedProcessId = null;

// Initialize WebSocket connection
function initWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;
    
    ws = new WebSocket(wsUrl);
    
    ws.onopen = () => {
        console.log('WebSocket connected');
        updateConnectionStatus('connected');
        refreshProcesses();
    };
    
    ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        handleWebSocketMessage(data);
    };
    
    ws.onclose = () => {
        console.log('WebSocket disconnected');
        updateConnectionStatus('disconnected');
        setTimeout(initWebSocket, 3000); // Reconnect after 3 seconds
    };
    
    ws.onerror = (error) => {
        console.error('WebSocket error:', error);
    };
}

function handleWebSocketMessage(data) {
    switch (data.type) {
        case 'connected':
            console.log('Connected with client ID:', data.clientId);
            break;
        case 'process_update':
            updateProcess(data.data);
            break;
        case 'log':
            addLog(data.data);
            break;
        case 'metric':
            updateMetrics(data.data);
            break;
        case 'response':
            handleCommandResponse(data);
            break;
    }
}

function updateConnectionStatus(status) {
    const indicator = document.getElementById('connectionStatus');
    const statusText = document.getElementById('daemonStatus');
    
    indicator.className = `status-indicator ${status}`;
    statusText.textContent = status === 'connected' ? 'Connected' : 'Disconnected';
}

async function refreshProcesses() {
    try {
        const response = await fetch('/api/processes');
        processes = await response.json();
        renderProcesses();
        updateLogFilter();
    } catch (error) {
        console.error('Failed to fetch processes:', error);
    }
}

function renderProcesses() {
    const tbody = document.getElementById('processesTable');
    
    if (processes.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" class="loading">No processes running</td></tr>';
        return;
    }
    
    tbody.innerHTML = processes.map(process => {
        const mainInstance = process.instances[0] || {};
        const cpu = mainInstance.cpu || 0;
        const memory = mainInstance.memory || 0;
        
        return `
            <tr>
                <td><strong>${process.name}</strong></td>
                <td><span class="status-badge status-${process.status}">${process.status}</span></td>
                <td>${mainInstance.pid || '-'}</td>
                <td class="metric-value ${getCpuClass(cpu)}">${cpu.toFixed(1)}%</td>
                <td class="metric-value ${getMemoryClass(memory)}">${formatMemory(memory)}</td>
                <td>${formatUptime(process.uptime)}</td>
                <td>${process.restarts}</td>
                <td>
                    <div class="actions">
                        ${renderActions(process)}
                    </div>
                </td>
            </tr>
        `;
    }).join('');
}

function renderActions(process) {
    const actions = [];
    
    if (['stopped', 'errored', 'crashed'].includes(process.status)) {
        actions.push(`<button class="btn btn-success" onclick="startProcess('${process.id}')">Start</button>`);
    }
    
    if (['running', 'starting'].includes(process.status)) {
        actions.push(`<button class="btn btn-danger" onclick="stopProcess('${process.id}')">Stop</button>`);
        actions.push(`<button class="btn btn-warning" onclick="restartProcess('${process.id}')">Restart</button>`);
    }
    
    if (process.status === 'running' && process.config.instances > 1) {
        actions.push(`<button class="btn btn-primary" onclick="reloadProcess('${process.id}')">Reload</button>`);
    }
    
    return actions.join('');
}

function getCpuClass(cpu) {
    if (cpu > 80) return 'metric-high';
    if (cpu > 50) return 'metric-medium';
    return 'metric-low';
}

function getMemoryClass(memory) {
    const mb = memory / (1024 * 1024);
    if (mb > 512) return 'metric-high';
    if (mb > 256) return 'metric-medium';
    return 'metric-low';
}

function formatMemory(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function formatUptime(seconds) {
    if (!seconds) return '-';
    
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    
    const parts = [];
    if (days > 0) parts.push(`${days}d`);
    if (hours > 0) parts.push(`${hours}h`);
    if (minutes > 0) parts.push(`${minutes}m`);
    if (secs > 0 || parts.length === 0) parts.push(`${secs}s`);
    
    return parts.join(' ');
}

async function startProcess(processId) {
    await sendCommand('start', processId);
}

async function stopProcess(processId) {
    await sendCommand('stop', processId);
}

async function restartProcess(processId) {
    await sendCommand('restart', processId);
}

async function reloadProcess(processId) {
    await sendCommand('reload', processId);
}

async function sendCommand(action, processId) {
    try {
        const response = await fetch(`/api/process/${action}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ processId })
        });
        
        const result = await response.json();
        if (result.error) {
            console.error('Command failed:', result.error);
        } else {
            refreshProcesses();
        }
    } catch (error) {
        console.error('Failed to send command:', error);
    }
}

function updateProcess(processInfo) {
    const index = processes.findIndex(p => p.id === processInfo.id);
    if (index !== -1) {
        processes[index] = processInfo;
        renderProcesses();
    }
}

function updateMetrics(data) {
    const process = processes.find(p => p.id === data.processId);
    if (process && process.instances[0]) {
        process.instances[0].cpu = data.cpu;
        process.instances[0].memory = data.memory;
        renderProcesses();
    }
}

function addLog(logEntry) {
    logs.push(logEntry);
    if (logs.length > 1000) {
        logs.shift(); // Keep only last 1000 logs
    }
    
    if (!selectedProcessId || selectedProcessId === logEntry.processId) {
        appendLogToView(logEntry);
    }
}

function appendLogToView(logEntry) {
    const logsContent = document.getElementById('logsContent');
    const logDiv = document.createElement('div');
    logDiv.className = 'log-entry';
    
    const timestamp = new Date(logEntry.timestamp).toLocaleTimeString();
    const level = logEntry.level || 'info';
    const processName = logEntry.processName || 'daemon';
    
    logDiv.innerHTML = `
        <span class="log-timestamp">${timestamp}</span>
        <span class="log-level ${level}">${level.toUpperCase()}</span>
        <span class="log-process">[${processName}]</span>
        <span class="log-message">${escapeHtml(logEntry.message)}</span>
    `;
    
    logsContent.appendChild(logDiv);
    logsContent.scrollTop = logsContent.scrollHeight;
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function updateLogFilter() {
    const select = document.getElementById('logFilter');
    select.innerHTML = '<option value="">All Processes</option>';
    
    processes.forEach(process => {
        const option = document.createElement('option');
        option.value = process.id;
        option.textContent = process.name;
        select.appendChild(option);
    });
}

function filterLogs() {
    const select = document.getElementById('logFilter');
    selectedProcessId = select.value || null;
    
    const logsContent = document.getElementById('logsContent');
    logsContent.innerHTML = '';
    
    const filteredLogs = selectedProcessId 
        ? logs.filter(log => log.processId === selectedProcessId)
        : logs;
    
    filteredLogs.forEach(log => appendLogToView(log));
}

function clearLogs() {
    logs = [];
    document.getElementById('logsContent').innerHTML = '';
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
    initWebSocket();
    
    // Refresh processes every 5 seconds
    setInterval(refreshProcesses, 5000);
});