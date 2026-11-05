const { contextBridge, ipcRenderer } = require("electron");
const on = ch => cb => { const f = (e, v) => cb(v); ipcRenderer.on(ch, f); return () => ipcRenderer.removeListener(ch, f); };
const inv = ch => (...a) => ipcRenderer.invoke(ch, ...a);
contextBridge.exposeInMainWorld("lh", {
  state: inv("state"), refresh: inv("refresh"), save: inv("save"), test: inv("test"),
  open: inv("open"), closeApp: inv("closeApp"), cover: inv("cover"), appNav: inv("appNav"), win: inv("win"),
  signIn: inv("signIn"), signOut: inv("signOut"),
  checkUpdate: inv("checkUpdate"), installUpdate: inv("installUpdate"), pickUpdateFolder: inv("pickUpdateFolder"), openFolder: inv("openFolder"),
  seenAlerts: inv("seenAlerts"), clearAlerts: inv("clearAlerts"),
  pickCover: inv("pickCover"), resetCover: inv("resetCover"), openData: inv("openData"),
  onSummaries: on("summaries"), onAlerts: on("alerts"), onNav: on("nav"), onToast: on("toast"), onApp: on("app"), onMaximized: on("maximized"), onUpdate: on("update")
});
