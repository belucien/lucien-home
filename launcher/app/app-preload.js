/* Preload for the Planner and Budget screens: a small, fixed bridge to the launcher. */
const { contextBridge, ipcRenderer } = require("electron");
const APP = /\/apps\/budget\//.test(location.pathname.replace(/\\/g, "/")) ? "budget" : "planner";
contextBridge.exposeInMainWorld("lhApp", {
  app: APP,
  rpc: (fn, args) => ipcRenderer.invoke("rpc", APP, String(fn), JSON.parse(JSON.stringify(args || []))),
  location: () => ipcRenderer.invoke("appLocation", APP)
});
