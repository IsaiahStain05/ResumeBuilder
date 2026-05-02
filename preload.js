const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  exportDocx: (resumeData) => ipcRenderer.invoke('export-docx', resumeData)
})