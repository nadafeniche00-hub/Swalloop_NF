const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('swalloop', {
  exportFreeCAD: (payload) => ipcRenderer.invoke('freecad:export', payload),
});
