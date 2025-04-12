import { contextBridge, ipcRenderer } from 'electron';

interface DeviceInfo {
  vendorId: number;
  productId: number;
  path?: string;
  manufacturer?: string;
  product?: string;
}

interface Snippet {
  id: number;
  trigger: string;
  text: string;
}

interface HidAPI {
  // Device operations
  listDevices: () => Promise<any>;
  connectDevice: (deviceInfo: DeviceInfo) => Promise<any>;
  disconnectDevice: () => Promise<any>;
  pingDevice: () => Promise<any>;
  
  // Snippet operations
  readSnippets: () => Promise<any>;
  addSnippet: (snippet: { trigger: string; text: string }) => Promise<any>;
  updateSnippet: (snippet: Snippet) => Promise<any>;
  deleteSnippet: (id: number) => Promise<any>;
}

contextBridge.exposeInMainWorld('hidAPI', {
  // Device operations
  listDevices: () => ipcRenderer.invoke('list-devices'),
  connectDevice: (deviceInfo: DeviceInfo) => ipcRenderer.invoke('connect-device', deviceInfo),
  disconnectDevice: () => ipcRenderer.invoke('disconnect-device'),
  pingDevice: () => ipcRenderer.invoke('ping-device'),
  
  // Snippet operations
  readSnippets: () => ipcRenderer.invoke('read-snippets'),
  addSnippet: (snippet: { trigger: string; text: string }) => ipcRenderer.invoke('add-snippet', snippet),
  updateSnippet: (snippet: Snippet) => ipcRenderer.invoke('update-snippet', snippet),
  deleteSnippet: (id: number) => ipcRenderer.invoke('delete-snippet', id)
} as HidAPI);