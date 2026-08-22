const { app, BrowserWindow } = require('electron')

// Demo inspection target for ND-DSH. Launch with a loopback debug port so the
// ND-DSH agent can attach its element picker during development:
//   pnpm exec electron examples/todo-electron --remote-debugging-port=9333
app.whenReady().then(() => {
  const win = new BrowserWindow({
    width: 430,
    height: 560,
    backgroundColor: '#0d1117',
    title: 'Todo (Electron demo)',
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  })
  win.loadFile('index.html')
})
app.on('window-all-closed', () => app.quit())
