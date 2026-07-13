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
            spellcheck: false,
        },
        icon: path.join(__dirname, 'icon.ico')
    });

    mainWindow.once('ready-to-show', () => {
        mainWindow.show();
    });

    // --- AD BLOCKING CONFIGURATION (LESS AGGRESSIVE) ---
    
    // 1. Define ad domains to block
    const adDomains = [
        'doubleclick.net',
        'googleadservices.com',
        'googlesyndication.com',
        'adservice.google.com',
        'adnxs.com',
        'adsrvr.org',
        'amazon-adsystem.com',
        'criteo.com',
        'outbrain.com',
        'taboola.com',
        'googleads.g.doubleclick.net',
        'pagead2.googlesyndication.com',
        'partner.googleadservices.com',
        'tpc.googlesyndication.com',
        'ad.doubleclick.net',
        'pubads.g.doubleclick.net'
    ];

    // Block ad requests (only external ad domains)
    session.defaultSession.webRequest.onBeforeRequest({
        urls: adDomains.map(domain => `*://*.${domain}/*`)
    }, (details, callback) => {
        console.log('Blocked ad request:', details.url);
        callback({ cancel: true });
    });

    // 2. Only remove tracking headers, keep CSP relaxed
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
        const headers = details.responseHeaders || {};
        
        // Remove tracking headers
        delete headers['x-amzn-trace-id'];
        delete headers['x-request-id'];
        
        // Only apply CSP to HTML pages - KEEP RELAXED FOR VIDEOS
        if (details.url.includes('.html') || details.url.endsWith('/') || details.url.includes('cineby')) {
            const csp = [
                "default-src * 'unsafe-inline' 'unsafe-eval' data: blob:;",
                "script-src * 'unsafe-inline' 'unsafe-eval' data: blob:;",
                "style-src * 'unsafe-inline' data:;",
                "img-src * data: blob:;",
                "media-src * data: blob:;",
                "connect-src * data: blob:;",
                "frame-src *;",
                "worker-src * blob:;"
            ].join(' ');
            
            headers['Content-Security-Policy'] = [csp];
        }

        callback({ responseHeaders: headers });
    });

    // 3. Block popups
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        const isAdPopup = adDomains.some(domain => url.includes(domain));
        if (isAdPopup) {
            return { action: 'deny' };
        }
        return { action: 'allow' };
    });

    mainWindow.webContents.on('did-create-window', (window) => {
        window.destroy();
    });

    // 4. ONLY remove actual ad elements, keep site banners
    mainWindow.webContents.on('dom-ready', () => {
        mainWindow.webContents.executeJavaScript(`
            // Function to remove ONLY actual ads (not site banners)
            function removeAds() {
                // More specific ad selectors - only target obvious ads
                const adSelectors = [
                    'iframe[src*="doubleclick"]',
                    'iframe[src*="googlead"]',
                    'iframe[src*="ads"]',
                    'iframe[src*="ad.doubleclick"]',
                    'ins.adsbygoogle',
                    '[data-ad]',
                    '[data-ad-slot]',
                    '[data-google-query-id]',
                    // Only remove elements that are clearly ads
                    '.ad-container:not(.site-banner)',
                    '.ad-wrapper:not(.site-banner)',
                    '.google-ads',
                    '.banner-ad:not(.site-banner)',
                    '.video-ads',
                    '.popup-ad',
                    '.overlay-ad'
                ];

                // Remove only if they're from ad domains or have ad attributes
                document.querySelectorAll(adSelectors.join(',')).forEach(el => {
                    // Check if it's actually an ad (has ad-related attributes)
                    const isAd = el.hasAttribute('data-ad') || 
                                el.hasAttribute('data-ad-slot') || 
                                el.hasAttribute('data-google-query-id') ||
                                el.src?.includes('doubleclick') ||
                                el.src?.includes('googlead');
                    
                    if (isAd) {
                        el.remove();
                    }
                });

                // Remove iframes that are clearly ads (with ad domains)
                document.querySelectorAll('iframe').forEach(iframe => {
                    const src = iframe.src || '';
                    const adDomains = ['doubleclick', 'googlead', 'ads', 'ad.doubleclick'];
                    if (adDomains.some(domain => src.includes(domain))) {
                        iframe.remove();
                    }
                });

                // Remove video overlays only if they're from ad services
                document.querySelectorAll('video').forEach(video => {
                    const parent = video.parentElement;
                    if (parent) {
                        const overlays = parent.querySelectorAll('[class*="overlay"], [class*="popup"]');
                        overlays.forEach(overlay => {
                            // Only remove if it has ad-related classes/attributes
                            const isAdOverlay = overlay.className.includes('ad') || 
                                               overlay.className.includes('sponsored') ||
                                               overlay.hasAttribute('data-ad');
                            if (isAdOverlay) {
                                overlay.remove();
                            }
                        });
                    }
                });

                // Don't remove positioned elements unless they're clearly ads
                // This preserves site banners
                document.querySelectorAll('[style*="position: absolute"], [style*="position: fixed"]').forEach(el => {
                    // Only remove if it has ad-specific attributes
                    const isAd = el.hasAttribute('data-ad') || 
                                el.hasAttribute('data-ad-slot') ||
                                el.id?.toLowerCase().includes('ad-') ||
                                (el.className?.toLowerCase().includes('ad-') && 
                                 !el.className.includes('site') && 
                                 !el.className.includes('banner'));
                    
                    if (isAd) {
                        el.remove();
                    }
                });
            }

            // Run immediately
            removeAds();

            // Only run again for new elements that are clearly ads
            const observer = new MutationObserver(() => {
                removeAds();
            });

            observer.observe(document.body, {
                childList: true,
                subtree: true,
                attributes: true,
                attributeFilter: ['src', 'data-ad', 'data-ad-slot']
            });

            console.log('Ad blocker enabled (keeping site banners)');

            // Prefetch video resources
            document.querySelectorAll('video').forEach(video => {
                video.preload = 'auto';
                video.load();
            });
        `).catch(() => {});
    });

    // 5. Clean video URLs without breaking functionality
    session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
        const url = details.url;
        
        // Add cache headers for videos
        if (details.url.includes('.mp4') || details.url.includes('.m3u8') || 
            details.url.includes('.ts') || details.url.includes('video')) {
            
            // Only clean obvious ad parameters, keep other parameters
            const cleanUrl = url.replace(/[?&](ad|ads|advertising|promo)=[^&]*/g, '');
            
            if (cleanUrl !== url) {
                callback({
                    redirectURL: cleanUrl,
                    requestHeaders: {
                        ...details.requestHeaders,
                        'Cache-Control': 'max-age=31536000',
                    }
                });
                return;
            }
            
            callback({
                requestHeaders: {
                    ...details.requestHeaders,
                    'Cache-Control': 'max-age=31536000',
                }
            });
        } else {
            callback({});
        }
    });

    // 6. Block audio ads (keep this)
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
        if (details.url.includes('.mp3') || details.url.includes('.wav')) {
            const isAdAudio = adDomains.some(domain => details.url.includes(domain));
            if (isAdAudio) {
                console.log('Blocked audio ad:', details.url);
                callback({
                    responseHeaders: {},
                    cancel: true
                });
                return;
            }
        }
        callback({ responseHeaders: details.responseHeaders || {} });
    });

    // 7. Show blocked ad count (keep this)
    let adBlockCount = 0;
    session.defaultSession.webRequest.onBeforeRequest({
        urls: adDomains.map(domain => `*://*.${domain}/*`)
    }, (details, callback) => {
        adBlockCount++;
        console.log(`Total ads blocked: ${adBlockCount}`);
        callback({ cancel: true });
    });

    // --- LOAD CINEBY ---
    mainWindow.loadURL('https://cineby.at');

    mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
        console.error('Failed to load:', errorDescription);
    });
}

// --- APP LIFECYCLE ---
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