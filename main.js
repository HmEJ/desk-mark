const { app, BrowserWindow, screen, Tray, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
let tray = null;

let win;

function loadConfig() {
    const configPath = path.join(path.dirname(app.getPath('exe')), 'config.json');

    try {
        return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    } catch (e) {
        return {};
    }
}

function createWindow() {
    const { width, height } = screen.getPrimaryDisplay().workAreaSize;

    win = new BrowserWindow({
        width,
        height,
        frame: false,
        transparent: true,
        alwaysOnTop: true,
        skipTaskbar: true,
        focusable: false,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js')
        }
    });

    win.setIgnoreMouseEvents(true);
    win.loadFile('index.html');

    win.webContents.on('did-finish-load', () => {
        win.webContents.send('config', loadConfig());
    });
}

function createTray() {
    tray = new Tray(path.join(__dirname, 'icon.ico'));

    const menu = Menu.buildFromTemplate([
        {
            label: '重新加载配置',
            click: () => {
                win.webContents.send('reload-config');
            }
        },
        { type: 'separator' },
        {
            label: '退出',
            click: () => {
                app.quit();
            }
        }
    ]);

    tray.setToolTip('桌面水印');
    tray.setContextMenu(menu);
}


app.whenReady().then(()=>{
    createWindow()
    createTray()
});
