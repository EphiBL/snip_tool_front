import { app, BrowserWindow, ipcMain } from 'electron';
import * as path from 'path';
import * as HID from 'node-hid';
import * as fs from 'fs';
import * as electron from 'electron';

let mainWindow: BrowserWindow | null;
// Store snippets.json in the project directory
const snippetsFilePath = path.join(__dirname, '../snippets.json');

interface DeviceInfo {
  vendorId: number;
  productId: number;
  path?: string;
  manufacturer?: string;
  product?: string;
  serialNumber?: string;
  release: number;
  interface: number;
  usagePage?: number;
  usage?: number;
}

interface Snippet {
  id: number;
  trigger: string;
  text: string;
  endCode: string; // Hex code for QMK keycode
}

interface ConnectedDevice {
  device: HID.HID;
  info: DeviceInfo;
}

// Create a global variable for the connected device
let connectedDevice: ConnectedDevice | null = null;

// Local storage for snippets
let localSnippets: Snippet[] = [];
let nextSnippetId = 1;

// Load snippets from local storage
function loadSnippetsFromDisk(): void {
  try {
    if (fs.existsSync(snippetsFilePath)) {
      const data = fs.readFileSync(snippetsFilePath, 'utf8');
      const parsed = JSON.parse(data);
      localSnippets = parsed.snippets || [];
      
      // Ensure all snippets have an endCode property
      localSnippets = localSnippets.map(snippet => {
        if (!snippet.endCode) {
          console.log(`Adding missing endCode to snippet ${snippet.id}`);
          return { ...snippet, endCode: '0x0000' };
        }
        return snippet;
      });
      
      nextSnippetId = localSnippets.length > 0 
        ? Math.max(0, ...localSnippets.map(s => s.id)) + 1 
        : 1;
      console.log(`Loaded ${localSnippets.length} snippets from ${snippetsFilePath}`);
    } else {
      console.log(`No snippets file found at ${snippetsFilePath}, starting with empty collection`);
      localSnippets = [];
      nextSnippetId = 1;
    }
  } catch (error) {
    console.error(`Error loading snippets from ${snippetsFilePath}:`, error);
    localSnippets = [];
    nextSnippetId = 1;
  }
}

// Save snippets to local storage
function saveSnippetsToDisk(): void {
  try {
    fs.writeFileSync(snippetsFilePath, JSON.stringify({ snippets: localSnippets }, null, 2), 'utf8');
    console.log(`Saved ${localSnippets.length} snippets to ${snippetsFilePath}`);
  } catch (error) {
    console.error('Error saving snippets to disk:', error);
  }
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 700,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  mainWindow.loadFile(path.join(__dirname, '../index.html'));
  
  // Open DevTools in development mode
  // Comment/uncomment the next line to toggle DevTools
  // mainWindow.webContents.openDevTools();
}

app.whenReady().then(() => {
  // Load snippets before creating the window
  loadSnippetsFromDisk();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  // Close any open device connection before quitting
  if (connectedDevice && connectedDevice.device) {
    try {
      connectedDevice.device.close();
      connectedDevice = null;
      console.log('Device connection closed on application exit');
    } catch (error) {
      console.error('Error closing device on exit:', error);
    }
  }
  
  if (process.platform !== 'darwin') app.quit();
});

// Also ensure we close the device if the app is about to quit
app.on('before-quit', () => {
  if (connectedDevice && connectedDevice.device) {
    try {
      connectedDevice.device.close();
      connectedDevice = null;
      console.log('Device connection closed before quit');
    } catch (error) {
      console.error('Error closing device before quit:', error);
    }
  }
});

// HID Device Communication
ipcMain.handle('list-devices', async (): Promise<HID.Device[] | { error: string }> => {
  try {
    const devices = HID.devices();
    return devices;
  } catch (error) {
    console.error('Error listing HID devices:', error);
    return { error: (error as Error).message };
  }
});

ipcMain.handle('connect-device', async (_, deviceInfo: DeviceInfo): Promise<{ success: boolean; message: string } | { error: string }> => {
  try {
    // First, close any existing device connection
    if (connectedDevice && connectedDevice.device) {
      try {
        connectedDevice.device.close();
        console.log('Closed previous device connection');
      } catch (closeError) {
        console.warn('Error closing previous device:', closeError);
        // Continue anyway to try the new connection
      }
    }
    
    const { vendorId, productId, path: devicePath } = deviceInfo;
    
    // We can connect either by vendorId/productId or by path
    const device = devicePath 
      ? new HID.HID(devicePath) 
      : new HID.HID(vendorId, productId);
    
    // Store device info for later use
    connectedDevice = { device, info: deviceInfo };
    
    return { success: true, message: 'Connected to device' };
  } catch (error) {
    console.error('Error connecting to HID device:', error);
    return { error: (error as Error).message };
  }
});

ipcMain.handle('disconnect-device', async (): Promise<{ success: boolean; message: string } | { error: string }> => {
  try {
    if (connectedDevice && connectedDevice.device) {
      connectedDevice.device.close();
      connectedDevice = null;
      return { success: true, message: 'Disconnected from device' };
    }
    return { success: false, message: 'No device connected' };
  } catch (error) {
    console.error('Error disconnecting HID device:', error);
    return { error: (error as Error).message };
  }
});

// QMK Snippet Protocol Handlers
// These would need to be adapted to match your actual keyboard's protocol

// Command constants (example)
const QMK_CMD = {
  READ_SNIPPETS: 0x01,
  ADD_SNIPPET: 0x02,
  UPDATE_SNIPPET: 0x03,
  DELETE_SNIPPET: 0x04
};

const PACKET_SIZE = 32; // 1 report id added by node-hid but stripped by qmk when received + 32 data bytes
const HEADER_SIZE = 3;
const DATA_SIZE = PACKET_SIZE - HEADER_SIZE - 1; // -1 for the checksum byte
const SEQ = {
  START: 0x01,
  CONTINUE: 0x02,
  END: 0x03,
  SINGLE: 0x04
};

// Ping device to test the connection
ipcMain.handle('ping-device', async (): Promise<{ success: boolean; message: string } | { error: string }> => {
  try {
    if (!connectedDevice || !connectedDevice.device) {
      return { error: 'No device connected' };
    }
    
    const packet = new Array(PACKET_SIZE).fill(0);

    // Packet[0] is the report ID added by node-hid when .write() is called, qmk strips this leaving 32 data bytes
    packet[1] = 0x01; 
    packet[2] = 0x02;     
    packet[3] = 0x03;
    packet[4] = 0x04;
    packet[5] = 0x05;
    packet[10] = 0xFF; 
    packet[30] = 0x30;
    
    console.log('Sending packet:', packet);
    console.log('Packet hex:', packet.map(b => b.toString(16).padStart(2, '0')).join(' '));
    
    // Send the formatted packet
    connectedDevice.device.write(packet);
    
    try {
      // Try to read a response with timeout
      const response = connectedDevice.device.readTimeout(1000); // 1 second timeout
      
      // Check if we got a valid response
      if (response && response.length > 0) {
        // Log the response for debugging
        console.log('Ping response received:', response);
        // Convert to hex for clearer output
        const hexResponse = Array.from(response)
          .map(byte => byte.toString(16).padStart(2, '0'))
          .join(' ');
        console.log('Ping response (hex):', hexResponse);
        
        // Typically you'd validate the response here according to your protocol
        return { success: true, message: 'Device responded to ping' };
      } else {
        return { error: 'No response received from device' };
      }
    } catch (readError) {
      console.warn('Ping timeout or error:', readError);
      return { error: 'Device did not respond to ping' };
    }
  } catch (error) {
    console.error('Error pinging device:', error);
    return { error: (error as Error).message };
  }
});




// Utility function to encode string to byte array
function encodeString(str: string): number[] {
  // Simple implementation - can be expanded based on requirements
  return Array.from(Buffer.from(str, 'utf8'));
}

// Function to parse the HID response into snippets
function parseSnippetsFromResponse(response: number[] | Buffer): Snippet[] {
  // Empty template implementation
  return [];
}

// Get all snippets from local storage
ipcMain.handle('read-snippets', async (): Promise<{ snippets: Snippet[] } | { error: string }> => {
  try {
    return { snippets: localSnippets };
  } catch (error) {
    console.error('Error reading snippets:', error);
    return { error: (error as Error).message };
  }
});

// Add a new snippet to local storage
ipcMain.handle('add-snippet', async (_, snippet: { trigger: string; text: string; endCode: string }): Promise<{ success: boolean; id?: number } | { error: string }> => {
  try {
    const { trigger, text, endCode } = snippet;
    
    // Validate input
    if (!trigger || !text) {
      return { error: 'Trigger and text are required' };
    }
    
    if (trigger.length > 7) {
      return { error: 'Trigger must be 7 characters or less' };
    }
    
    if (text.length > 100) {
      return { error: 'Snippet text must be 100 characters or less' };
    }
    
    // Check if trigger already exists
    if (localSnippets.some(s => s.trigger === trigger)) {
      return { error: 'A snippet with this trigger already exists' };
    }
    
    // Create new snippet
    const newSnippet: Snippet = {
      id: nextSnippetId++,
      trigger,
      text,
      endCode: endCode || '0x0000' // Default to 0x0000 for no end code
    };
    
    // Add to collection
    localSnippets.push(newSnippet);
    
    // Save to disk
    saveSnippetsToDisk();
    
    return { success: true, id: newSnippet.id };
  } catch (error) {
    console.error('Error adding snippet:', error);
    return { error: (error as Error).message };
  }
});

// Update an existing snippet in local storage
ipcMain.handle('update-snippet', async (_, snippet: Snippet): Promise<{ success: boolean } | { error: string }> => {
  try {
    const { id, trigger, text } = snippet;
    
    // Validate input
    if (!trigger || !text) {
      return { error: 'Trigger and text are required' };
    }
    
    if (trigger.length > 7) {
      return { error: 'Trigger must be 7 characters or less' };
    }
    
    if (text.length > 100) {
      return { error: 'Snippet text must be 100 characters or less' };
    }
    
    // Find snippet index
    const index = localSnippets.findIndex(s => s.id === id);
    if (index === -1) {
      return { error: 'Snippet not found' };
    }
    
    // Check if trigger already exists (but not for this snippet)
    if (localSnippets.some(s => s.trigger === trigger && s.id !== id)) {
      return { error: 'A snippet with this trigger already exists' };
    }
    
    // Update snippet
    localSnippets[index] = { ...snippet };
    
    // Save to disk
    saveSnippetsToDisk();
    
    return { success: true };
  } catch (error) {
    console.error('Error updating snippet:', error);
    return { error: (error as Error).message };
  }
});

// Delete a snippet from local storage
ipcMain.handle('delete-snippet', async (_, id: number): Promise<{ success: boolean } | { error: string }> => {
  try {
    // Find snippet index
    const index = localSnippets.findIndex(s => s.id === id);
    if (index === -1) {
      return { error: 'Snippet not found' };
    }
    
    // Remove snippet
    localSnippets.splice(index, 1);
    
    // Save to disk
    saveSnippetsToDisk();
    
    return { success: true };
  } catch (error) {
    console.error('Error deleting snippet:', error);
    return { error: (error as Error).message };
  }
});

// Send snippets to the keyboard
ipcMain.handle('flash-snippets-to-keyboard', async (): Promise<{ success: boolean } | { error: string }> => {
  try {
    if (!connectedDevice || !connectedDevice.device) {
      return { error: 'No device connected' };
    }
    
    if (localSnippets.length === 0) {
      return { error: 'No snippets to flash' };
    }
    
    // Here you would implement the logic to send all snippets to the keyboard
    // This is a placeholder for the actual implementation
    console.log('Would flash snippets to keyboard:', localSnippets);
    
    return { success: true };
  } catch (error) {
    console.error('Error flashing snippets to keyboard:', error);
    return { error: (error as Error).message };
  }
});

// Export snippets to C file for direct firmware inclusion
//  WARNING: DO NOT USE, NOT SET UP
ipcMain.handle('export-snippets-to-c', async (_, filePath: string): Promise<{ success: boolean } | { error: string }> => {
  try {
    if (localSnippets.length === 0) {
      return { error: 'No snippets to export' };
    }
    
    const timestamp = new Date().toISOString();
    const cFileContent = `/* 
 * Exported QMK Snippets
 * Generated on: ${timestamp}
 * Number of snippets: ${localSnippets.length}
 */

#include "quantum.h"
#include "raw_hid.h"

// Snippet structure definition
typedef struct {
    char trigger[8];    // Max 7 chars + null terminator
    char text[101];     // Max 100 chars + null terminator
    uint16_t end_code;  // QMK keycode to send after the snippet
} qmk_snippet_t;

// Exported snippets array
const qmk_snippet_t QMK_SNIPPETS[] = {
${localSnippets.map(s => {
  // Escape special characters in the strings
  const escapedTrigger = s.trigger.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const escapedText = s.text.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  // Default to 0x0000 if end code not present
  const endCode = s.endCode || '0x0000';
  return `    {"${escapedTrigger}", "${escapedText}", ${endCode}}`;
}).join(',\n')}
};

// Number of snippets
const uint8_t QMK_SNIPPET_COUNT = ${localSnippets.length};
`;
    
    fs.writeFileSync(filePath, cFileContent, 'utf8');
    
    return { success: true };
  } catch (error) {
    console.error('Error exporting snippets to C file:', error);
    return { error: (error as Error).message };
  }
});

// Allow selecting export directory using system dialog
ipcMain.handle('select-export-directory', async (): Promise<{ filePath?: string; canceled?: boolean } | { error: string }> => {
  try {
    if (!mainWindow) {
      return { error: 'Main window not available' };
    }
    
    const result = await electron.dialog.showSaveDialog(mainWindow, {
      title: 'Export Snippets to C File',
      defaultPath: path.join(app.getPath('documents'), 'qmk_snippets.c'),
      filters: [
        { name: 'C Source Files', extensions: ['c'] }
      ]
    });
    
    return {
      filePath: result.filePath,
      canceled: result.canceled
    };
  } catch (error) {
    console.error('Error selecting export directory:', error);
    return { error: (error as Error).message };
  }
});

