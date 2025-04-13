// Define global HidAPI interface injected via preload
interface HidAPI {
  // Device operations
  listDevices: () => Promise<any>;
  connectDevice: (deviceInfo: DeviceInfo) => Promise<any>;
  disconnectDevice: () => Promise<any>;
  pingDevice: () => Promise<any>;
  
  // Snippet operations
  readSnippets: () => Promise<any>;
  addSnippet: (snippet: { trigger: string; text: string; endCode: string }) => Promise<any>;
  updateSnippet: (snippet: Snippet) => Promise<any>;
  deleteSnippet: (id: number) => Promise<any>;
  
  // New operations for local snippet management
  flashSnippetsToKeyboard: () => Promise<any>;
  exportSnippetsToC: (filePath: string) => Promise<any>;
  selectExportDirectory: () => Promise<any>;
  syncSnippets: () => Promise<any>;
}

interface DeviceInfo {
  vendorId: number;
  productId: number;
  path?: string;
  manufacturer?: string;
  product?: string;
  usage?: number;
  usagePage?: number;
  interface?: number;
  release?: number;
  serialNumber?: string;
}

interface Snippet {
  id: number;
  trigger: string;
  text: string;
  endCode: string; // Hex code for QMK keycode
}

// Extend Window interface to include hidAPI and statusTimeout
interface Window {
  hidAPI: HidAPI;
  statusTimeout?: NodeJS.Timeout;
}

// DOM Elements
const deviceListEl = document.getElementById('device-list') as HTMLSelectElement;
const connectBtn = document.getElementById('connect-device') as HTMLButtonElement;
const refreshBtn = document.getElementById('refresh-devices') as HTMLButtonElement;
const disconnectBtn = document.getElementById('disconnect-device') as HTMLButtonElement;
const connectedDeviceEl = document.getElementById('connected-device') as HTMLDivElement;
const deviceDetailsEl = document.getElementById('device-details') as HTMLDivElement;
const snippetManagerEl = document.getElementById('snippet-manager') as HTMLDivElement;
const manageSnippetsBtn = document.getElementById('manage-snippets') as HTMLButtonElement;
const addSnippetBtn = document.getElementById('add-snippet') as HTMLButtonElement;
const exportSnippetsBtn = document.getElementById('export-snippets') as HTMLButtonElement;
const backToHomeBtn = document.getElementById('back-to-home') as HTMLButtonElement;
const snippetTableEl = (document.getElementById('snippet-table') as HTMLTableElement).querySelector('tbody') as HTMLTableSectionElement;
const snippetEditorEl = document.getElementById('snippet-editor') as HTMLDivElement;
const snippetIdEl = document.getElementById('snippet-id') as HTMLInputElement;
const triggerEl = document.getElementById('trigger') as HTMLInputElement;
const snippetTextEl = document.getElementById('snippet-text') as HTMLTextAreaElement;
const endCodeEl = document.getElementById('end-code') as HTMLSelectElement;
const saveSnippetBtn = document.getElementById('save-snippet') as HTMLButtonElement;
const cancelEditBtn = document.getElementById('cancel-edit') as HTMLButtonElement;
const triggerSearchEl = document.getElementById('trigger-search') as HTMLInputElement;
const snippetSearchEl = document.getElementById('snippet-search') as HTMLInputElement;
const clearSearchBtn = document.getElementById('clear-search') as HTMLButtonElement;
const snippetCountEl = document.getElementById('snippet-count') as HTMLParagraphElement;
const storageUsageEl = document.getElementById('storage-usage') as HTMLParagraphElement;
const statusEl = document.getElementById('status') as HTMLDivElement;
const pingDeviceBtn = document.createElement('button') as HTMLButtonElement;

// Store current device and snippets
let currentDevice: DeviceInfo | null = null;
let snippets: Snippet[] = [];
let filteredSnippets: Snippet[] = [];

// Helper functions
function showStatus(message: string, isError = false): void {
  // Clear any existing timeout
  if (window.statusTimeout) {
    clearTimeout(window.statusTimeout);
  }
  
  // Format the message with an icon
  const icon = isError ? '❌' : '✅';
  statusEl.innerHTML = `${icon} ${message}`;
  
  // Set the appropriate class
  statusEl.className = `status ${isError ? 'error' : 'success'}`;
  
  // Fade in the status message
  statusEl.style.opacity = '0';
  statusEl.style.display = 'block';
  
  // Force a reflow to ensure the transition works
  void statusEl.offsetWidth;
  
  // Fade in
  statusEl.style.opacity = '1';
  
  // Hide after 5 seconds with fade out
  window.statusTimeout = setTimeout(() => {
    statusEl.style.opacity = '0';
    
    // After the fade out completes, hide the element
    setTimeout(() => {
      statusEl.style.display = 'none';
    }, 300);
  }, 5000);
}

function filterKeyboardDevices(devices: DeviceInfo[]): DeviceInfo[] {
  // Filter for QMK keyboards using the QMK-specific Raw HID usage page 0xFF60
  return devices.filter(device => {
    return (
      // Only show devices with QMK Raw HID usage page 0xFF60
      device.usagePage === 0xFF60
    );
  });
}

async function refreshDeviceList(): Promise<void> {
  try {
    const devices = await window.hidAPI.listDevices();
    
    // Clear the device list
    deviceListEl.innerHTML = '';
    
    if ('error' in devices) {
      showStatus(`Error listing devices: ${devices.error}`, true);
      return;
    }
    
    // Filter for potential keyboard devices
    const keyboardDevices = filterKeyboardDevices(devices);
    
    if (keyboardDevices.length === 0) {
      const option = document.createElement('option');
      option.textContent = 'No compatible keyboards found';
      deviceListEl.appendChild(option);
      connectBtn.disabled = true;
    } else {
      keyboardDevices.forEach(device => {
        const option = document.createElement('option');
        option.value = device.path || '';
        
        // Format usage info for display
        const usageInfo = device.usagePage !== undefined && device.usage !== undefined 
          ? `UsagePage: 0x${device.usagePage.toString(16).padStart(4, '0')}, Usage: 0x${device.usage.toString(16).padStart(2, '0')}` 
          : 'Usage info not available';
        
        const interfaceInfo = device.interface !== undefined 
          ? `Interface: ${device.interface}` 
          : '';
        
        option.textContent = `${device.manufacturer || 'Unknown'} ${device.product || 'Device'} (${device.vendorId.toString(16)}:${device.productId.toString(16)}) - ${usageInfo} ${interfaceInfo}`;
        
        (option as any).device = device; // Store the device object for later use
        deviceListEl.appendChild(option);
      });
      connectBtn.disabled = false;
    }
  } catch (error) {
    showStatus(`Error listing devices: ${(error as Error).message}`, true);
  }
}

async function connectToDevice(): Promise<void> {
  try {
    const selectedOption = deviceListEl.options[deviceListEl.selectedIndex];
    if (!selectedOption || !(selectedOption as any).device) {
      showStatus('No device selected', true);
      return;
    }
    
    const deviceInfo = (selectedOption as any).device as DeviceInfo;
    const result = await window.hidAPI.connectDevice(deviceInfo);
    
    if ('error' in result) {
      showStatus(`Failed to connect: ${result.error}`, true);
      return;
    }
    
    // Store current device and update UI
    currentDevice = deviceInfo;
    showConnectedDeviceInfo(deviceInfo);
    showStatus('Connected to device successfully');
  } catch (error) {
    showStatus(`Error connecting to device: ${(error as Error).message}`, true);
  }
}

function showConnectedDeviceInfo(deviceInfo: DeviceInfo): void {
  // Update UI to show connected device with more details
  deviceDetailsEl.innerHTML = `
    <p><strong>Manufacturer:</strong> ${deviceInfo.manufacturer || 'Unknown'}</p>
    <p><strong>Product:</strong> ${deviceInfo.product || 'Unknown Device'}</p>
    <p><strong>VID/PID:</strong> ${deviceInfo.vendorId.toString(16).padStart(4, '0')}:${deviceInfo.productId.toString(16).padStart(4, '0')}</p>
    <p><strong>Usage Page:</strong> ${deviceInfo.usagePage !== undefined ? '0x' + deviceInfo.usagePage.toString(16).padStart(4, '0') : 'N/A'}</p>
    <p><strong>Usage:</strong> ${deviceInfo.usage !== undefined ? '0x' + deviceInfo.usage.toString(16).padStart(2, '0') : 'N/A'}</p>
    <p><strong>Interface:</strong> ${deviceInfo.interface !== undefined ? deviceInfo.interface : 'N/A'}</p>
    <p><strong>Path:</strong> ${deviceInfo.path || 'N/A'}</p>
    ${deviceInfo.serialNumber ? `<p><strong>Serial:</strong> ${deviceInfo.serialNumber}</p>` : ''}
    <p><strong>Release:</strong> ${deviceInfo.release !== undefined ? deviceInfo.release : 'N/A'}</p>
  `;
  
  // Show note about RAW_ENABLE
  deviceDetailsEl.innerHTML += `
    <p class="note" style="color: var(--secondary-color); margin-top: 15px; border-top: 1px solid var(--divider-color); padding-top: 10px;">
      <strong>Important:</strong> For QMK snippet functionality, ensure your keyboard firmware has RAW_ENABLE=yes in rules.mk
    </p>
  `;
  
  // Show/hide relevant sections with smooth transition
  connectedDeviceEl.style.display = 'block';
  // Only show connected device, not the snippet manager
  snippetManagerEl.style.display = 'none';
  
  // Hide device selection with a small delay for a better transition
  const deviceSelection = document.getElementById('device-selection') as HTMLDivElement;
  deviceSelection.style.opacity = '0';
  setTimeout(() => {
    deviceSelection.style.display = 'none';
    deviceSelection.style.opacity = '1';
  }, 300);

  // Add ping button to the device action row
  const actionRow = connectedDeviceEl.querySelector('.action-row') as HTMLDivElement;
  
  // Configure ping button
  pingDeviceBtn.id = 'ping-device';
  pingDeviceBtn.textContent = 'Ping Device';
  pingDeviceBtn.addEventListener('click', pingConnectedDevice);
  
  // Create sync snippets button
  const syncSnippetsBtn = document.createElement('button') as HTMLButtonElement;
  syncSnippetsBtn.id = 'sync-snippets';
  syncSnippetsBtn.textContent = 'Sync Snippets';
  syncSnippetsBtn.addEventListener('click', syncSnippets);
  
  // Add the buttons before the disconnect button
  actionRow.insertBefore(pingDeviceBtn, disconnectBtn);
  actionRow.insertBefore(syncSnippetsBtn, disconnectBtn);
}

async function disconnectFromDevice(): Promise<void> {
  try {
    const result = await window.hidAPI.disconnectDevice();
    
    if ('error' in result) {
      showStatus(`Error disconnecting: ${result.error}`, true);
      return;
    }
    
    // Reset UI with transitions
    currentDevice = null;
    
    // Clean up dynamically created buttons
    const actionRow = connectedDeviceEl.querySelector('.action-row') as HTMLDivElement;
    const pingBtn = document.getElementById('ping-device');
    const syncBtn = document.getElementById('sync-snippets');
    
    if (pingBtn) {
      pingBtn.remove();
    }
    
    if (syncBtn) {
      syncBtn.remove();
    }
    
    // Fade out the current views
    connectedDeviceEl.style.opacity = '0';
    snippetManagerEl.style.opacity = '0';
    
    setTimeout(() => {
      // Hide the elements
      connectedDeviceEl.style.display = 'none';
      snippetManagerEl.style.display = 'none';
      
      // Reset opacity for next connection cycle
      connectedDeviceEl.style.opacity = '1';
      
      // Show the device selection with fade in
      const deviceSelection = document.getElementById('device-selection') as HTMLDivElement;
      deviceSelection.style.opacity = '0';
      deviceSelection.style.display = 'block';
      
      // Force reflow
      void deviceSelection.offsetWidth;
      
      // Fade in
      deviceSelection.style.opacity = '1';
      
      // Refresh device list
      refreshDeviceList();
      
      showStatus('Disconnected from device');
    }, 300);
  } catch (error) {
    showStatus(`Error disconnecting: ${(error as Error).message}`, true);
  }
}

// Read snippets from the keyboard using the dedicated API
async function readSnippetsFromDevice(): Promise<void> {
  try {
    showStatus('Reading snippets from device...');
    
    const result = await window.hidAPI.readSnippets();
    
    if ('error' in result) {
      showStatus(`Failed to read snippets: ${result.error}`, true);
      return;
    }
    
    if ('snippets' in result) {
      snippets = result.snippets;
      renderSnippetTable();
      showStatus(`${snippets.length} snippets loaded successfully`);
    } else {
      showStatus('No snippet data received from device', true);
    }
  } catch (error) {
    showStatus(`Error reading snippets: ${(error as Error).message}`, true);
  }
}

// Apply search filters and update filtered snippets
function applySearchFilters(): void {
  const triggerQuery = triggerSearchEl.value.toLowerCase();
  const snippetQuery = snippetSearchEl.value.toLowerCase();
  
  // If both search fields are empty, use all snippets
  if (!triggerQuery && !snippetQuery) {
    filteredSnippets = [...snippets];
  } else {
    // Filter based on search criteria
    filteredSnippets = snippets.filter(snippet => {
      const triggerMatch = !triggerQuery || snippet.trigger.toLowerCase().includes(triggerQuery);
      const snippetMatch = !snippetQuery || snippet.text.toLowerCase().includes(snippetQuery);
      return triggerMatch && snippetMatch;
    });
  }
  
  // Re-render the table with the filtered snippets
  renderSnippetTable();
}

// Clear search filters
function clearSearchFilters(): void {
  triggerSearchEl.value = '';
  snippetSearchEl.value = '';
  filteredSnippets = [...snippets];
  renderSnippetTable();
}

function renderSnippetTable(): void {
  // Clear the table
  snippetTableEl.innerHTML = '';
  
  // Get the snippets to display (either all or filtered)
  const displaySnippets = filteredSnippets.length > 0 || 
    (triggerSearchEl.value || snippetSearchEl.value) ? filteredSnippets : snippets;
  
  if (displaySnippets.length === 0) {
    const row = document.createElement('tr');
    row.innerHTML = `<td colspan="4">No snippets found</td>`;
    snippetTableEl.appendChild(row);
    
    // Update stats
    if (triggerSearchEl.value || snippetSearchEl.value) {
      snippetCountEl.textContent = `No matches (${snippets.length} total)`;
    } else {
      snippetCountEl.textContent = 'No snippets';
    }
    
    storageUsageEl.textContent = '0/0 bytes used';
    return;
  }
  
  // Add each snippet to the table
  displaySnippets.forEach(snippet => {
    const row = document.createElement('tr');
    
    // Escape HTML in text to prevent XSS
    const escapedTrigger = escapeHtml(snippet.trigger);
    const escapedText = escapeHtml(snippet.text);
    
    // Get human-readable end code name
    console.log(`Snippet ${snippet.id} has end code: "${snippet.endCode}"`);
    const endCodeName = getEndCodeName(snippet.endCode || '0x0000');
    
    // Check for leading and trailing whitespace
    const hasLeadingWS = snippet.text.length > 0 && /^\s/.test(snippet.text);
    const hasTrailingWS = snippet.text.length > 0 && /\s$/.test(snippet.text);
    
    // Create tooltip text explaining whitespace
    let tooltipText = '';
    if (hasLeadingWS || hasTrailingWS) {
      tooltipText = 'Contains ';
      if (hasLeadingWS) tooltipText += 'leading';
      if (hasLeadingWS && hasTrailingWS) tooltipText += ' and ';
      if (hasTrailingWS) tooltipText += 'trailing';
      tooltipText += ' whitespace';
    }
    
    // Build whitespace classes
    let wsClasses = 'snippet-text';
    if (hasLeadingWS) wsClasses += ' has-leading-ws';
    if (hasTrailingWS) wsClasses += ' has-trailing-ws';
    
    row.innerHTML = `
      <td>${escapedTrigger}</td>
      <td><span class="${wsClasses}" ${tooltipText ? `title="${tooltipText}"` : ''}>${escapedText}</span></td>
      <td>${endCodeName}</td>
      <td>
        <button class="edit-btn" data-id="${snippet.id}">Edit</button>
        <button class="delete-btn" data-id="${snippet.id}">Delete</button>
      </td>
    `;
    snippetTableEl.appendChild(row);
    
    // Add event listeners to buttons
    const editBtn = row.querySelector('.edit-btn') as HTMLButtonElement;
    const deleteBtn = row.querySelector('.delete-btn') as HTMLButtonElement;
    
    editBtn.addEventListener('click', () => editSnippet(snippet.id));
    deleteBtn.addEventListener('click', () => deleteSnippet(snippet.id));
  });
  
  // Update stats
  updateSnippetStats(displaySnippets);
}

// Helper function to escape HTML
function escapeHtml(str: string): string {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// Helper function to get human-readable end code name
function getEndCodeName(hexCode: string): string {
  const endCodeMap: Record<string, string> = {
    '0x0000': '-',
    '0x0050': 'Left',
    '0x004F': 'Right',
    '0x0052': 'Up',
    '0x0051': 'Down',
    '0x0028': 'Enter',
    '0x002B': 'Tab',
    '0x004A': 'Home',
    '0x004D': 'End'
  };
  
  return endCodeMap[hexCode] || hexCode;
}

// Update snippet statistics
function updateSnippetStats(displaySnippets: Snippet[] = snippets): void {
  const isFiltered = displaySnippets !== snippets && displaySnippets.length !== snippets.length;
  
  if (isFiltered) {
    snippetCountEl.textContent = `${displaySnippets.length} of ${snippets.length} snippet${snippets.length !== 1 ? 's' : ''}`;
  } else {
    snippetCountEl.textContent = `${snippets.length} snippet${snippets.length !== 1 ? 's' : ''}`;
  }
  
  // Calculate storage usage (approximate)
  let totalBytes = 0;
  snippets.forEach(snippet => {
    // Each trigger char is 1 byte + null terminator
    const triggerBytes = snippet.trigger.length + 1;
    // Each text char is 1 byte + null terminator
    const textBytes = snippet.text.length + 1;
    // Total bytes for this snippet (including struct overhead)
    totalBytes += triggerBytes + textBytes;
  });
  
  // EEPROM size (user space) is typically around 1KB on many QMK boards
  const totalEEPROM = 2048;
  storageUsageEl.textContent = `${totalBytes}/${totalEEPROM} bytes used (${Math.round(totalBytes/totalEEPROM*100)}%)`;
}

function showSnippetEditor(snippet: Snippet | null = null): void {
  // If editing existing snippet, populate form
  if (snippet) {
    snippetIdEl.value = snippet.id.toString();
    triggerEl.value = snippet.trigger;
    snippetTextEl.value = snippet.text;
    endCodeEl.value = snippet.endCode || '0x0000';
  } else {
    // Clear form for new snippet
    snippetIdEl.value = '';
    triggerEl.value = '';
    snippetTextEl.value = '';
    endCodeEl.value = '0x0000'; // Default to None
  }
  
  // Show editor with fade-in effect
  snippetEditorEl.style.opacity = '0';
  snippetEditorEl.style.display = 'block';
  
  // Force reflow then fade in
  void snippetEditorEl.offsetWidth;
  snippetEditorEl.style.opacity = '1';
  
  // Focus the trigger input
  setTimeout(() => triggerEl.focus(), 100);
}

function hideSnippetEditor(): void {
  // Fade out before hiding
  snippetEditorEl.style.opacity = '0';
  
  setTimeout(() => {
    snippetEditorEl.style.display = 'none';
    // Reset opacity for next time
    snippetEditorEl.style.opacity = '1';
  }, 300);
}

function editSnippet(id: number): void {
  const snippet = snippets.find(s => s.id === id);
  if (snippet) {
    showSnippetEditor(snippet);
  }
}

async function saveSnippet(): Promise<void> {
  try {
    const id = snippetIdEl.value ? parseInt(snippetIdEl.value) : null;
    const trigger = triggerEl.value.trim(); // Trim trigger as it's typically a keyword
    const text = snippetTextEl.value; // Preserve all whitespace in the snippet text
    const endCode = endCodeEl.value || '0x0000'; // Get selected end code or default to 0x0000
    
    console.log(`Saving snippet with end code: "${endCode}"`); // Debug log
    
    if (!trigger || !text) {
      showStatus('Trigger and snippet text are required', true);
      return;
    }
    
    const isNewSnippet = id === null;
    showStatus(`${isNewSnippet ? 'Adding' : 'Updating'} snippet...`);
    
    let result;
    if (isNewSnippet) {
      // Add new snippet
      result = await window.hidAPI.addSnippet({ trigger, text, endCode });
      
      if ('error' in result) {
        showStatus(`Failed to add snippet: ${result.error}`, true);
        return;
      }
      
      if ('success' in result && result.success && 'id' in result) {
        // Add to local data with the returned ID
        snippets.push({ id: result.id, trigger, text, endCode });
        showStatus('Snippet added successfully');
      } else {
        showStatus('Failed to add snippet: Unknown error', true);
        return;
      }
    } else {
      // Update existing snippet
      const snippetToUpdate = { id: id as number, trigger, text, endCode };
      result = await window.hidAPI.updateSnippet(snippetToUpdate);
      
      if ('error' in result) {
        showStatus(`Failed to update snippet: ${result.error}`, true);
        return;
      }
      
      if ('success' in result && result.success) {
        // Update local data
        const index = snippets.findIndex(s => s.id === id);
        if (index !== -1) {
          snippets[index] = snippetToUpdate;
        }
        showStatus('Snippet updated successfully');
      } else {
        showStatus('Failed to update snippet: Unknown error', true);
        return;
      }
    }
    
    // Update UI
    renderSnippetTable();
    hideSnippetEditor();
  } catch (error) {
    showStatus(`Error saving snippet: ${(error as Error).message}`, true);
  }
}

async function deleteSnippet(id: number): Promise<void> {
  try {
    if (!confirm('Are you sure you want to delete this snippet?')) {
      return;
    }
    
    showStatus('Deleting snippet...');
    const result = await window.hidAPI.deleteSnippet(id);
    
    if ('error' in result) {
      showStatus(`Failed to delete snippet: ${result.error}`, true);
      return;
    }
    
    if ('success' in result && result.success) {
      // Update local data
      snippets = snippets.filter(s => s.id !== id);
      
      // Update UI
      renderSnippetTable();
      showStatus('Snippet deleted successfully');
    } else {
      showStatus('Failed to delete snippet: Unknown error', true);
    }
  } catch (error) {
    showStatus(`Error deleting snippet: ${(error as Error).message}`, true);
  }
}

// Ping device function
async function pingConnectedDevice(): Promise<void> {
  try {
    showStatus('Pinging device...');
    
    const result = await window.hidAPI.pingDevice();
    
    if ('error' in result) {
      showStatus(`Ping failed: ${result.error}`, true);
      return;
    }
    
    if ('success' in result && result.success) {
      showStatus('Device ping successful!');
    } else {
      showStatus('Ping failed: Unknown error', true);
    }
  } catch (error) {
    showStatus(`Error pinging device: ${(error as Error).message}`, true);
  }
}

// Sync snippets function
async function syncSnippets(): Promise<void> {
  try {
    showStatus('Syncing snippets with keyboard...');
    
    const result = await window.hidAPI.syncSnippets();
    
    if ('error' in result) {
      showStatus(`Failed to sync snippets: ${result.error}`, true);
      return;
    }
    
    if ('success' in result && result.success) {
      showStatus('Snippets synced successfully!');
    } else {
      showStatus('Failed to sync snippets: Unknown error', true);
    }
  } catch (error) {
    showStatus(`Error syncing snippets: ${(error as Error).message}`, true);
  }
}

// Show snippet manager from home page
function showSnippetManager(): void {
  // Hide device selection with smooth transition
  const deviceSelection = document.getElementById('device-selection') as HTMLDivElement;
  deviceSelection.style.opacity = '0';
  
  setTimeout(() => {
    deviceSelection.style.display = 'none';
    
    // Show snippet manager
    snippetManagerEl.style.display = 'block';
    
    // Force reflow then fade in
    void snippetManagerEl.offsetWidth;
    snippetManagerEl.style.opacity = '1';
    
    // Load snippets
    loadSnippets();
  }, 300);
}

// Return to home page from snippet manager
function returnToHome(): void {
  // Hide snippet manager with smooth transition
  snippetManagerEl.style.opacity = '0';
  
  setTimeout(() => {
    snippetManagerEl.style.display = 'none';
    
    // Show device selection
    const deviceSelection = document.getElementById('device-selection') as HTMLDivElement;
    deviceSelection.style.display = 'block';
    
    // Force reflow then fade in
    void deviceSelection.offsetWidth;
    deviceSelection.style.opacity = '1';
  }, 300);
}

// Load snippets from local storage
async function loadSnippets(): Promise<void> {
  try {
    showStatus('Loading snippets...');
    
    const result = await window.hidAPI.readSnippets();
    
    if ('error' in result) {
      showStatus(`Failed to load snippets: ${result.error}`, true);
      return;
    }
    
    if ('snippets' in result) {
      snippets = result.snippets;
      
      // Ensure all snippets have an endCode property
      snippets = snippets.map(snippet => {
        if (!snippet.endCode) {
          console.log(`Adding missing endCode to snippet ${snippet.id}`);
          return { ...snippet, endCode: '0x0000' };
        }
        return snippet;
      });
      
      filteredSnippets = [...snippets]; // Initialize filtered snippets
      renderSnippetTable();
      showStatus(`${snippets.length} snippet${snippets.length !== 1 ? 's' : ''} loaded successfully`);
    } else {
      showStatus('No snippet data received', true);
    }
  } catch (error) {
    showStatus(`Error loading snippets: ${(error as Error).message}`, true);
  }
}

// Flash snippets to keyboard
async function flashSnippetsToKeyboard(): Promise<void> {
  try {
    if (snippets.length === 0) {
      showStatus('No snippets to flash to keyboard', true);
      return;
    }
    
    showStatus('Flashing snippets to keyboard...');
    
    const result = await window.hidAPI.flashSnippetsToKeyboard();
    
    if ('error' in result) {
      showStatus(`Failed to flash snippets: ${result.error}`, true);
      return;
    }
    
    if ('success' in result && result.success) {
      showStatus('Snippets flashed to keyboard successfully!');
    } else {
      showStatus('Failed to flash snippets: Unknown error', true);
    }
  } catch (error) {
    showStatus(`Error flashing snippets: ${(error as Error).message}`, true);
  }
}

// Export snippets to C file
async function exportSnippetsToC(): Promise<void> {
  try {
    if (snippets.length === 0) {
      showStatus('No snippets to export', true);
      return;
    }
    
    // Show file dialog
    showStatus('Selecting export location...');
    
    const result = await window.hidAPI.selectExportDirectory();
    
    if ('error' in result) {
      showStatus(`Export failed: ${result.error}`, true);
      return;
    }
    
    if ('canceled' in result && result.canceled) {
      showStatus('Export canceled');
      return;
    }
    
    if (!result.filePath) {
      showStatus('No file path selected', true);
      return;
    }
    
    // Export to selected path
    showStatus(`Exporting snippets to ${result.filePath}...`);
    
    const exportResult = await window.hidAPI.exportSnippetsToC(result.filePath);
    
    if ('error' in exportResult) {
      showStatus(`Failed to export snippets: ${exportResult.error}`, true);
      return;
    }
    
    if ('success' in exportResult && exportResult.success) {
      showStatus(`Snippets exported successfully to ${result.filePath}!`);
    } else {
      showStatus('Failed to export snippets: Unknown error', true);
    }
  } catch (error) {
    showStatus(`Error exporting snippets: ${(error as Error).message}`, true);
  }
}

// Event Listeners
refreshBtn.addEventListener('click', refreshDeviceList);
connectBtn.addEventListener('click', connectToDevice);
disconnectBtn.addEventListener('click', disconnectFromDevice);
manageSnippetsBtn.addEventListener('click', showSnippetManager);
addSnippetBtn.addEventListener('click', () => showSnippetEditor());
saveSnippetBtn.addEventListener('click', saveSnippet);
cancelEditBtn.addEventListener('click', hideSnippetEditor);
exportSnippetsBtn.addEventListener('click', exportSnippetsToC);
backToHomeBtn.addEventListener('click', returnToHome);

// Search functionality
triggerSearchEl.addEventListener('input', applySearchFilters);
snippetSearchEl.addEventListener('input', applySearchFilters);
clearSearchBtn.addEventListener('click', clearSearchFilters);

// Handle keyboard shortcuts
function setupKeyboardShortcuts(): void {
  document.addEventListener('keydown', (event) => {
    // Get active element to check if we're in an input or textarea
    const activeElement = document.activeElement;
    const isInInput = activeElement && (activeElement.tagName === 'INPUT' || activeElement.tagName === 'TEXTAREA');
    
    // Get the key pressed (case insensitive)
    const key = event.key.toLowerCase();
    
    // M key for Manage Snippets (only when not in an input)
    if (key === 'm' && !isInInput) {
      // Only if the button is visible
      if (manageSnippetsBtn.offsetParent !== null) {
        manageSnippetsBtn.click();
        event.preventDefault();
      }
    }
    
    // C key for Add New Snippet (only when not in an input)
    if (key === 'c' && !isInInput) {
      // Only if the button is visible
      if (addSnippetBtn.offsetParent !== null) {
        addSnippetBtn.click();
        // Focus the trigger box
        setTimeout(() => triggerEl.focus(), 100);
        event.preventDefault();
      }
    }
    
    // Handle Enter in the snippet text area
    if (activeElement && activeElement === snippetTextEl) {
      if (event.key === 'Enter') {
        if (event.shiftKey) {
          // Shift+Enter adds a newline (default behavior)
          return;
        } else {
          // Regular Enter saves the snippet
          saveSnippetBtn.click();
          event.preventDefault();
        }
      }
    }
  });
}

// Initialize the device list when the page loads
document.addEventListener('DOMContentLoaded', () => {
  refreshDeviceList();
  setupKeyboardShortcuts();
});
