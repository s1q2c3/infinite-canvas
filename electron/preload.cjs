const { contextBridge, ipcRenderer } = require("electron");

// 渲染进程通过 window.electronAPI 访问便携文件存储后端。
// 路径一律为相对 app 数据根的相对路径（正斜杠），主进程做沙箱校验。
contextBridge.exposeInMainWorld("electronAPI", {
    isElectron: true,
    readText: (relPath) => ipcRenderer.invoke("sqc:readText", relPath),
    writeText: (relPath, text) => ipcRenderer.invoke("sqc:writeText", relPath, text),
    readBlob: (relPath) => ipcRenderer.invoke("sqc:readBlob", relPath),
    writeBlob: (relPath, buffer) => ipcRenderer.invoke("sqc:writeBlob", relPath, buffer),
    remove: (relPath) => ipcRenderer.invoke("sqc:remove", relPath),
    exists: (relPath) => ipcRenderer.invoke("sqc:exists", relPath),
    list: (relPath) => ipcRenderer.invoke("sqc:list", relPath),
    stat: (relPath) => ipcRenderer.invoke("sqc:stat", relPath),
    getPaths: () => ipcRenderer.invoke("sqc:getPaths"),
});

// 导演台：把已生成的分镜视频拼成一条成片（调用随包分发的 ffmpeg），以及在文件管理器里定位成片。
contextBridge.exposeInMainWorld("sqcStudio", {
    concatVideos: (clips) => ipcRenderer.invoke("sqc:concatVideos", clips),
    openPath: (target) => ipcRenderer.invoke("sqc:openPath", target),
});
