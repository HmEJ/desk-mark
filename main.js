const { app, BrowserWindow, screen, Tray, Menu, ipcMain, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
let tray = null;
let trayMenu = null;

const DEFAULT_CONFIG = {
    text: 'CONFIDENTIAL ${date}',
    angle: -45,
    fontSize: 28,
    gap: 180,
    opacity: 0.15,
    color: '#D8D8D8',
    fontFamily: 'SimSun',
    stretchX: 1,
    stretchY: 1,
    topMostMode: 'balanced'
};

const watermarkWindows = new Map();
let settingsWindow = null;
let configPathInUse = '';
let watermarkEnabled = true;
let currentConfig = { ...DEFAULT_CONFIG };
let topMostRefreshTimer = null;

function readJsonIfExists(filePath) {
    if (!filePath || !fs.existsSync(filePath)) {
        return null;
    }

    try {
        return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    } catch (e) {
        return null;
    }
}

function normalizeConfig(input) {
    const merged = {
        ...DEFAULT_CONFIG,
        ...(input || {})
    };

    const safeNumber = (value, fallback, min, max) => {
        const n = Number(value);
        if (!Number.isFinite(n)) {
            return fallback;
        }

        return Math.min(max, Math.max(min, n));
    };

    const safeTopMostMode = ['strong', 'balanced', 'light'].includes(merged.topMostMode)
        ? merged.topMostMode
        : DEFAULT_CONFIG.topMostMode;

    return {
        ...merged,
        angle: safeNumber(merged.angle, DEFAULT_CONFIG.angle, -180, 180),
        fontSize: safeNumber(merged.fontSize, DEFAULT_CONFIG.fontSize, 8, 240),
        gap: safeNumber(merged.gap, DEFAULT_CONFIG.gap, 20, 1000),
        opacity: safeNumber(merged.opacity, DEFAULT_CONFIG.opacity, 0.01, 1),
        stretchX: safeNumber(merged.stretchX, DEFAULT_CONFIG.stretchX, 0.5, 3),
        stretchY: safeNumber(merged.stretchY, DEFAULT_CONFIG.stretchY, 0.5, 3),
        topMostMode: safeTopMostMode
    };
}

function getConfigCandidates() {
    const devCandidates = [
        process.env.DESK_MARK_CONFIG,
        path.join(process.cwd(), 'config.json'),
        path.join(app.getAppPath(), 'config.json'),
        path.join(app.getPath('userData'), 'config.json'),
        path.join(process.resourcesPath, 'config.json')
    ];

    const packagedCandidates = [
        process.env.DESK_MARK_CONFIG,
        path.join(path.dirname(process.execPath), 'config.json'),
        path.join(app.getPath('userData'), 'config.json'),
        path.join(process.resourcesPath, 'config.json')
    ];

    const candidates = (app.isPackaged ? packagedCandidates : devCandidates).filter(Boolean);

    return [...new Set(candidates)];
}

function getWritableConfigPath() {
    if (app.isPackaged) {
        return path.join(app.getPath('userData'), 'config.json');
    }

    return path.join(process.cwd(), 'config.json');
}

function loadConfig() {
    const candidates = getConfigCandidates();

    for (const candidate of candidates) {
        const config = readJsonIfExists(candidate);
        if (config) {
            configPathInUse = candidate;
            return normalizeConfig(config);
        }
    }

    configPathInUse = candidates[0] || getWritableConfigPath();
    return { ...DEFAULT_CONFIG };
}

function saveConfig(config) {
    const targetPath = getWritableConfigPath();

    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.writeFileSync(targetPath, `${JSON.stringify(normalizeConfig(config), null, 2)}\n`, 'utf-8');
    configPathInUse = targetPath;
}

function iconPath() {
    const localIcon = path.join(__dirname, 'icon.ico');
    if (fs.existsSync(localIcon)) {
        return localIcon;
    }

    return nativeImage.createEmpty();
}

function applyTopMost(windowRef, syncWorkspaces = false) {
    if (!windowRef || windowRef.isDestroyed()) {
        return;
    }

    const mode = currentConfig.topMostMode || DEFAULT_CONFIG.topMostMode;

    if (mode === 'strong') {
        windowRef.setAlwaysOnTop(true, 'screen-saver');
    } else if (mode === 'light') {
        windowRef.setAlwaysOnTop(true, 'normal');
    } else {
        windowRef.setAlwaysOnTop(true, 'pop-up-menu');
    }

    if (syncWorkspaces || mode === 'strong') {
        windowRef.setVisibleOnAllWorkspaces(true, {
            visibleOnFullScreen: true,
            skipTransformProcessType: true
        });
    } else {
        windowRef.setVisibleOnAllWorkspaces(false);
    }
}

function dropTopMostTemporarily() {
    for (const windowRef of watermarkWindows.values()) {
        if (!windowRef.isDestroyed()) {
            windowRef.setAlwaysOnTop(false);
        }
    }
}

function requestTopMostRefresh(delay = 120) {
    if (topMostRefreshTimer) {
        clearTimeout(topMostRefreshTimer);
    }

    topMostRefreshTimer = setTimeout(() => {
        for (const windowRef of watermarkWindows.values()) {
            if (!windowRef.isDestroyed()) {
                applyTopMost(windowRef);
            }
        }

        topMostRefreshTimer = null;
    }, delay);
}

function broadcastConfig() {
    for (const windowRef of watermarkWindows.values()) {
        if (!windowRef.isDestroyed()) {
            windowRef.webContents.send('config-updated', currentConfig);
        }
    }
}

function setWatermarkVisible(visible) {
    watermarkEnabled = !!visible;

    for (const windowRef of watermarkWindows.values()) {
        if (!windowRef.isDestroyed()) {
            windowRef.webContents.send('watermark-visibility', watermarkEnabled);
        }
    }

    if (watermarkEnabled) {
        requestTopMostRefresh(0);
    }

    updateTrayMenu();
}

function reloadConfigAndEnableWatermark() {
    currentConfig = loadConfig();
    broadcastConfig();
    setWatermarkVisible(true);
}

function createWatermarkWindowForDisplay(display) {
    if (!display || watermarkWindows.has(display.id)) {
        return;
    }

    const { x, y, width, height } = display.bounds;

    const windowRef = new BrowserWindow({
        x,
        y,
        width,
        height,
        show: false,
        frame: false,
        transparent: true,
        alwaysOnTop: true,
        skipTaskbar: true,
        focusable: false,
        resizable: false,
        movable: false,
        hasShadow: false,
        fullscreenable: false,
        minimizable: false,
        maximizable: false,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js')
        }
    });

    windowRef.setIgnoreMouseEvents(true, { forward: true });
    applyTopMost(windowRef, true);
    windowRef.loadFile('index.html');

    watermarkWindows.set(display.id, windowRef);

    windowRef.once('ready-to-show', () => {
        windowRef.showInactive();
        applyTopMost(windowRef);
    });

    windowRef.webContents.on('did-finish-load', () => {
        windowRef.webContents.send('config-updated', currentConfig);
        windowRef.webContents.send('watermark-visibility', watermarkEnabled);
    });

    windowRef.on('closed', () => {
        watermarkWindows.delete(display.id);
    });
}

function createWatermarkWindowsForAllDisplays() {
    const displays = screen.getAllDisplays();
    displays.forEach((display, index) => {
        setTimeout(() => {
            createWatermarkWindowForDisplay(display);
        }, index * 30);
    });
}

function removeWatermarkWindowForDisplay(displayId) {
    const windowRef = watermarkWindows.get(displayId);
    if (!windowRef) {
        return;
    }

    watermarkWindows.delete(displayId);
    if (!windowRef.isDestroyed()) {
        windowRef.destroy();
    }
}

function syncWatermarkWindowsWithDisplays() {
    const displays = screen.getAllDisplays();
    const displayIds = new Set(displays.map(d => d.id));

    for (const display of displays) {
        if (!watermarkWindows.has(display.id)) {
            createWatermarkWindowForDisplay(display);
            continue;
        }

        const windowRef = watermarkWindows.get(display.id);
        if (windowRef && !windowRef.isDestroyed()) {
            const { x, y, width, height } = display.bounds;
            windowRef.setBounds({ x, y, width, height });
            applyTopMost(windowRef);
        }
    }

    for (const [displayId] of watermarkWindows) {
        if (!displayIds.has(displayId)) {
            removeWatermarkWindowForDisplay(displayId);
        }
    }

    requestTopMostRefresh(0);
}

function createSettingsWindow() {
    if (settingsWindow && !settingsWindow.isDestroyed()) {
        settingsWindow.show();
        settingsWindow.focus();
        return;
    }

    settingsWindow = new BrowserWindow({
        width: 540,
        height: 620,
        title: '水印参数配置',
        resizable: false,
        autoHideMenuBar: true,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js')
        }
    });

    settingsWindow.loadFile('settings.html');
    settingsWindow.on('closed', () => {
        settingsWindow = null;
    });
}

function updateTrayMenu() {
    if (!tray) {
        return;
    }

    trayMenu = Menu.buildFromTemplate([
        {
            label: watermarkEnabled ? '关闭水印' : '开启水印',
            click: () => {
                setWatermarkVisible(!watermarkEnabled);
            }
        },
        {
            label: '参数配置',
            click: () => {
                createSettingsWindow();
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

}

function createTray() {
    tray = new Tray(iconPath());

    tray.setToolTip('桌面水印');
    updateTrayMenu();

    tray.on('right-click', () => {
        if (!trayMenu) {
            return;
        }

        // Temporarily lower watermark z-order to avoid blocking tray menu popup.
        dropTopMostTemporarily();
        tray.popUpContextMenu(trayMenu);
        requestTopMostRefresh(120);
    });
}

function registerIpc() {
    ipcMain.handle('settings:get-config', () => ({
        ...currentConfig,
        enabled: watermarkEnabled,
        configPath: configPathInUse || getWritableConfigPath()
    }));

    ipcMain.handle('settings:save-config', (_, nextConfig) => {
        currentConfig = normalizeConfig(nextConfig);
        saveConfig(currentConfig);
        broadcastConfig();
        requestTopMostRefresh(0);
        setWatermarkVisible(true);
        return {
            ok: true,
            configPath: configPathInUse
        };
    });

    ipcMain.handle('settings:toggle-watermark', (_, enabled) => {
        setWatermarkVisible(enabled);
        return {
            ok: true,
            enabled: watermarkEnabled
        };
    });

    ipcMain.handle('settings:reload-config', () => {
        reloadConfigAndEnableWatermark();
        return {
            ok: true,
            configPath: configPathInUse
        };
    });
}

app.whenReady().then(() => {
    currentConfig = loadConfig();
    createWatermarkWindowsForAllDisplays();
    createTray();
    registerIpc();

    screen.on('display-added', () => {
        syncWatermarkWindowsWithDisplays();
    });

    screen.on('display-removed', () => {
        syncWatermarkWindowsWithDisplays();
    });

    screen.on('display-metrics-changed', () => {
        syncWatermarkWindowsWithDisplays();
    });

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWatermarkWindowsForAllDisplays();
        }

        requestTopMostRefresh(0);
    });
});

app.on('window-all-closed', () => {
    // Keep the app running in tray on all platforms.
});

app.on('before-quit', () => {
    if (topMostRefreshTimer) {
        clearTimeout(topMostRefreshTimer);
        topMostRefreshTimer = null;
    }
});
