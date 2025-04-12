// Define global HidAPI interface injected via preload
interface HidAPI {
  // Device operations
  listDevices: () => Promise<any>;
  connectDevice: (deviceInfo: DeviceInfo) => Promise<any>;
  disconnectDevice: () => Promise<any>;
  sendData: (data: number | number[]) => Promise<any>;
  
  // Snippet operations
  readSnippets: () => Promise<any>;
  addSnippet: (snippet: { trigger: string; text: string }) => Promise<any>;
  updateSnippet: (snippet: Snippet) => Promise<any>;
  deleteSnippet: (id: number) => Promise<any>;
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
const readSnippetsBtn = document.getElementById('read-snippets') as HTMLButtonElement;
const addSnippetBtn = document.getElementById('add-snippet') as HTMLButtonElement;
const snippetTableEl = (document.getElementById('snippet-table') as HTMLTableElement).querySelector('tbody') as HTMLTableSectionElement;
const snippetEditorEl = document.getElementById('snippet-editor') as HTMLDivElement;
const snippetIdEl = document.getElementById('snippet-id') as HTMLInputElement;
const triggerEl = document.getElementById('trigger') as HTMLInputElement;
const snippetTextEl = document.getElementById('snippet-text') as HTMLTextAreaElement;
const saveSnippetBtn = document.getElementById('save-snippet') as HTMLButtonElement;
const cancelEditBtn = document.getElementById('cancel-edit') as HTMLButtonElement;
const statusEl = document.getElementById('status') as HTMLDivElement;

// Store current device and snippets
let currentDevice: DeviceInfo | null = null;
let snippets: Snippet[] = [];

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
  // This is a basic filter for keyboard devices
  // You may need to adjust this based on your specific keyboard's details
  return devices.filter(device => {
    // Filter for ZSA Voyager keyboard - adjust vendor/product IDs as needed
    // ZSA Voyager likely has specific vendorId (common ZSA vendorId might be 0x3297)
    return (
      // Check for known keyboard-related usage pages
      (device.usagePage === 1 && device.usage === 6) || // Keyboard
      // Check for ZSA-specific identifiers if known
      device.manufacturer?.includes('ZSA') ||
      device.product?.includes('Voyager') ||
      // Add any specific vendorId/productId combinations you know
      // Example: device.vendorId === 0x3297
      false
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
  
  // Show a note about Raw HID
  if (deviceInfo.usagePage === 0xFF00 || deviceInfo.usagePage === 0xFFAB) {
    deviceDetailsEl.innerHTML += `
      <p class="note" style="color: var(--secondary-color); margin-top: 15px;">
        <strong>Note:</strong> This appears to be a Raw HID interface which is likely what you want for QMK custom features.
      </p>
    `;
  } else if (deviceInfo.usagePage === 1 && deviceInfo.usage === 6) {
    deviceDetailsEl.innerHTML += `
      <p class="note" style="color: var(--primary-color); margin-top: 15px;">
        <strong>Note:</strong> This appears to be a standard keyboard interface, which may not support custom commands.
      </p>
    `;
  }
  
  // Show note about RAW_ENABLE
  deviceDetailsEl.innerHTML += `
    <p class="note" style="color: var(--secondary-color); margin-top: 15px; border-top: 1px solid var(--divider-color); padding-top: 10px;">
      <strong>Important:</strong> For QMK snippet functionality, ensure your keyboard firmware has RAW_ENABLE=yes in rules.mk
    </p>
  `;
  
  // Show/hide relevant sections with smooth transition
  connectedDeviceEl.style.display = 'block';
  snippetManagerEl.style.display = 'block';
  
  // Hide device selection with a small delay for a better transition
  const deviceSelection = document.getElementById('device-selection') as HTMLDivElement;
  deviceSelection.style.opacity = '0';
  setTimeout(() => {
    deviceSelection.style.display = 'none';
    deviceSelection.style.opacity = '1';
  }, 300);
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
    
    // Fade out the current views
    connectedDeviceEl.style.opacity = '0';
    snippetManagerEl.style.opacity = '0';
    
    setTimeout(() => {
      // Hide the elements
      connectedDeviceEl.style.display = 'none';
      snippetManagerEl.style.display = 'none';
      
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

function renderSnippetTable(): void {
  // Clear the table
  snippetTableEl.innerHTML = '';
  
  if (snippets.length === 0) {
    const row = document.createElement('tr');
    row.innerHTML = `<td colspan="3">No snippets found</td>`;
    snippetTableEl.appendChild(row);
    return;
  }
  
  // Add each snippet to the table
  snippets.forEach(snippet => {
    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${snippet.trigger}</td>
      <td>${snippet.text}</td>
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
}

function showSnippetEditor(snippet: Snippet | null = null): void {
  // If editing existing snippet, populate form
  if (snippet) {
    snippetIdEl.value = snippet.id.toString();
    triggerEl.value = snippet.trigger;
    snippetTextEl.value = snippet.text;
  } else {
    // Clear form for new snippet
    snippetIdEl.value = '';
    triggerEl.value = '';
    snippetTextEl.value = '';
  }
  
  // Show editor
  snippetEditorEl.style.display = 'block';
}

function hideSnippetEditor(): void {
  snippetEditorEl.style.display = 'none';
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
    const trigger = triggerEl.value.trim();
    const text = snippetTextEl.value.trim();
    
    if (!trigger || !text) {
      showStatus('Trigger and snippet text are required', true);
      return;
    }
    
    const isNewSnippet = id === null;
    showStatus(`${isNewSnippet ? 'Adding' : 'Updating'} snippet...`);
    
    let result;
    if (isNewSnippet) {
      // Add new snippet
      result = await window.hidAPI.addSnippet({ trigger, text });
      
      if ('error' in result) {
        showStatus(`Failed to add snippet: ${result.error}`, true);
        return;
      }
      
      if ('success' in result && result.success && 'id' in result) {
        // Add to local data with the returned ID
        snippets.push({ id: result.id, trigger, text });
        showStatus('Snippet added successfully');
      } else {
        showStatus('Failed to add snippet: Unknown error', true);
        return;
      }
    } else {
      // Update existing snippet
      const snippetToUpdate = { id: id as number, trigger, text };
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

// Event Listeners
refreshBtn.addEventListener('click', refreshDeviceList);
connectBtn.addEventListener('click', connectToDevice);
disconnectBtn.addEventListener('click', disconnectFromDevice);
readSnippetsBtn.addEventListener('click', readSnippetsFromDevice);
addSnippetBtn.addEventListener('click', () => showSnippetEditor());
saveSnippetBtn.addEventListener('click', saveSnippet);
cancelEditBtn.addEventListener('click', hideSnippetEditor);

// Initialize the device list when the page loads
document.addEventListener('DOMContentLoaded', refreshDeviceList);