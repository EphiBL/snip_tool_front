import { app, BrowserWindow, ipcMain } from 'electron';
import * as path from 'path';
import * as HID from 'node-hid';

let mainWindow: BrowserWindow | null;

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
}

interface ConnectedDevice {
  device: HID.HID;
  info: DeviceInfo;
}

// Create a global variable for the connected device
let connectedDevice: ConnectedDevice | null = null;

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

const PACKET_SIZE = 32;
const HEADER_SIZE = 3;
const DATA_SIZE = PACKET_SIZE - HEADER_SIZE - 1; // -1 for the checksum byte
const SEQ = {
  START: 0x01,
  CONTINUE: 0x02,
  END: 0x03,
  SINGLE: 0x04
};

// Read snippets from keyboard
// Example code from claude non-final
ipcMain.handle('read-snippets', async (): Promise<{ snippets: Snippet[] } | { error: string }> => {
  try {
    if (!connectedDevice || !connectedDevice.device) {
      return { error: 'No device connected' };
    }
    
    // Send command to read snippets
    // Example: [command_id]
    connectedDevice.device.write([QMK_CMD.READ_SNIPPETS]);
    
    try {
      // Read response - this will be specific to your keyboard's protocol
      const response = connectedDevice.device.readTimeout(2000); // 2 second timeout
      
      // Parse the response into snippets
      // This is just an example - actual parsing would depend on your keyboard's protocol
      const snippets: Snippet[] = parseSnippetsFromResponse(response);
      
      return { snippets };
    } catch (readError) {
      console.warn('No response from device or timeout:', readError);
      return { error: 'No response from device or timeout' };
    }
  } catch (error) {
    console.error('Error reading snippets:', error);
    return { error: (error as Error).message };
  }
});

// Add a new snippet to keyboard
// Example code from claude non-final
ipcMain.handle('add-snippet', async (_, snippet: { trigger: string; text: string }): Promise<{ success: boolean; id?: number } | { error: string }> => {
  try {
    if (!connectedDevice || !connectedDevice.device) {
      return { error: 'No device connected' };
    }
    
    const { trigger, text } = snippet;
    
    // Convert strings to byte arrays
    const triggerBytes = encodeString(trigger);
    const textBytes = encodeString(text);
    
    // Create command: [command_id, trigger_length, ...trigger_bytes, text_length, ...text_bytes]
    const command = [
      QMK_CMD.ADD_SNIPPET,
      triggerBytes.length,
      ...triggerBytes,
      textBytes.length,
      ...textBytes
    ];
    
    // Send command
    connectedDevice.device.write(command);
    
    try {
      // Read response - expecting snippet ID in the response
      const response = connectedDevice.device.readTimeout(1000); // 1 second timeout
      
      // Parse response - assuming first byte is success/fail code, and next 2 bytes are the snippet ID (if success)
      if (response && response.length >= 3 && response[0] === 0x01) {
        // Success - extract ID (16-bit value from bytes 1-2)
        const id = (response[1] << 8) | response[2];
        return { success: true, id };
      } else {
        return { error: 'Failed to add snippet' };
      }
    } catch (readError) {
      console.warn('No response from device or timeout:', readError);
      return { error: 'No response from device or timeout' };
    }
  } catch (error) {
    console.error('Error adding snippet:', error);
    return { error: (error as Error).message };
  }
});

// Update an existing snippet
// Example code from claude non-final
ipcMain.handle('update-snippet', async (_, snippet: Snippet): Promise<{ success: boolean } | { error: string }> => {
  try {
    if (!connectedDevice || !connectedDevice.device) {
      return { error: 'No device connected' };
    }
    
    const { id, trigger, text } = snippet;
    
    // Convert strings to byte arrays
    const triggerBytes = encodeString(trigger);
    const textBytes = encodeString(text);
    
    // Create ID bytes (16-bit value split into 2 bytes)
    const idBytes = [(id >> 8) & 0xFF, id & 0xFF];
    
    // Create command: [command_id, ...id_bytes, trigger_length, ...trigger_bytes, text_length, ...text_bytes]
    const command = [
      QMK_CMD.UPDATE_SNIPPET,
      ...idBytes,
      triggerBytes.length,
      ...triggerBytes,
      textBytes.length,
      ...textBytes
    ];
    
    // Send command
    connectedDevice.device.write(command);
    
    try {
      // Read response
      const response = connectedDevice.device.readTimeout(1000); // 1 second timeout
      
      // Check if successful
      if (response && response.length >= 1 && response[0] === 0x01) {
        return { success: true };
      } else {
        return { error: 'Failed to update snippet' };
      }
    } catch (readError) {
      console.warn('No response from device or timeout:', readError);
      return { error: 'No response from device or timeout' };
    }
  } catch (error) {
    console.error('Error updating snippet:', error);
    return { error: (error as Error).message };
  }
});

// Delete a snippet
// Example code from claude non-final
ipcMain.handle('delete-snippet', async (_, id: number): Promise<{ success: boolean } | { error: string }> => {
  try {
    if (!connectedDevice || !connectedDevice.device) {
      return { error: 'No device connected' };
    }
    
    // Create ID bytes (16-bit value split into 2 bytes)
    const idBytes = [(id >> 8) & 0xFF, id & 0xFF];
    
    // Create command: [command_id, ...id_bytes]
    const command = [
      QMK_CMD.DELETE_SNIPPET,
      ...idBytes
    ];
    
    // Send command
    connectedDevice.device.write(command);
    
    try {
      // Read response
      const response = connectedDevice.device.readTimeout(1000); // 1 second timeout
      
      // Check if successful
      if (response && response.length >= 1 && response[0] === 0x01) {
        return { success: true };
      } else {
        return { error: 'Failed to delete snippet' };
      }
    } catch (readError) {
      console.warn('No response from device or timeout:', readError);
      return { error: 'No response from device or timeout' };
    }
  } catch (error) {
    console.error('Error deleting snippet:', error);
    return { error: (error as Error).message };
  }
});

