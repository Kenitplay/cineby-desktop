const { app, BrowserWindow, session } = require('electron');
const path = require('path');

// Only allow one instance
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
    app.quit();
    process.exit(0);
}

function createWindow() {
    const mainWindow = new BrowserWindow({
        width: 1400,
        height: 900,
        minWidth: 800,
        minHeight: 600,
        show: false,
        autoHideMenuBar: true,
        backgroundColor: '#0a0a0a',
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true,
            webSecurity: true,
            allowRunningInsecureContent: false,
            spellcheck: false, // Just disables spellcheck in app
        },
        icon: path.join(__dirname, 'icon.ico')
    });

    mainWindow.once('ready-to-show', () => {
        mainWindow.show();
    });

    // --- RELAXED CSP FOR FAST VIDEO STREAMING ---
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
        const headers = details.responseHeaders || {};
        
        // Only apply CSP to HTML pages
        if (details.url.includes('.html') || details.url.endsWith('/') || details.url.includes('cineby')) {
            const csp = [
                "default-src * 'unsafe-inline' 'unsafe-eval' data: blob:;",
                "script-src * 'unsafe-inline' 'unsafe-eval' data: blob:;",
                "style-src * 'unsafe-inline' data:;",
                "img-src * data: blob:;",
                "media-src * data: blob:;", // Allows videos from anywhere
                "connect-src * data: blob:;", // Allows API connections
                "frame-src *;",
                "worker-src * blob:;"
            ].join(' ');
            
            headers['Content-Security-Policy'] = [csp];
        }

        callback({ responseHeaders: headers });
    });

    // --- SIMPLE NAVIGATION - Allow everything ---
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        return { action: 'allow' };
    });

    // Block popups only
    mainWindow.webContents.on('did-create-window', (window) => {
        window.destroy();
    });

    // --- INCREASE CACHE SIZE (ELECTRON ONLY) ---
    session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
        // Add cache headers for videos
        if (details.url.includes('.mp4') || details.url.includes('.m3u8') || 
            details.url.includes('.ts') || details.url.includes('video')) {
            callback({
                requestHeaders: {
                    ...details.requestHeaders,
                    'Cache-Control': 'max-age=31536000', // Cache videos longer
                }
            });
        } else {
            callback({});
        }
    });

    // --- PRELOAD VIDEOS FASTER ---
    mainWindow.webContents.on('dom-ready', () => {
        // Preload video resources
        mainWindow.webContents.executeJavaScript(`
            // Prefetch video resources
            document.querySelectorAll('video').forEach(video => {
                video.preload = 'auto';
                video.load();
            });
        `).catch(() => {});
    });

    // --- LOAD CINEBY ---
    mainWindow.loadURL('https://cineby.at');

    mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
        console.error('Failed to load:', errorDescription);
    });
}

// --- APP LIFECYCLE (NO SYSTEM CHANGES) ---
app.whenReady().then(() => {
    createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('second-instance', (event, commandLine, workingDirectory) => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win) {
        if (win.isMinimized()) win.restore();
        win.focus();
    }
});