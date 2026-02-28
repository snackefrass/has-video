const { app, BrowserWindow, ipcMain, screen } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

// Helper to read config.json
function getConfig() {
    try {
        const configPath = path.join(__dirname, '..', 'config.json');
        if (fs.existsSync(configPath)) {
            return JSON.parse(fs.readFileSync(configPath, 'utf8'));
        }
    } catch (err) {
        console.error('Error reading config:', err);
    }
    return {};
}

let mainWindow;
let osdWindow = null;
let vlcProcess = null;
let unclutterProcess = null; // For cursor hiding

// Start unclutter for cursor hiding (Linux X11)
function startUnclutter() {
    // Kill any existing unclutter process first
    stopUnclutter();
    
    try {
        // Start unclutter with:
        // --timeout 5: hide after 5 seconds of inactivity
        // --start-hidden: start with cursor already hidden
        // --ignore-scrolling: scrolling doesn't unhide cursor
        unclutterProcess = spawn('unclutter', [
            '--timeout', '5',
            '--start-hidden',
            '--ignore-scrolling'
        ], {
            stdio: 'ignore',
            detached: false
        });
        
        unclutterProcess.on('error', (err) => {
            // unclutter not installed - that's okay, cursor hiding just won't work
            console.log('unclutter not available (install with: sudo apt install unclutter-xfixes)');
            unclutterProcess = null;
        });
        
        unclutterProcess.on('close', (code) => {
            console.log('unclutter closed with code:', code);
            unclutterProcess = null;
        });
        
        console.log('Started unclutter for cursor hiding');
    } catch (err) {
        console.log('Could not start unclutter:', err.message);
    }
}

// Stop unclutter process
function stopUnclutter() {
    if (unclutterProcess) {
        try {
            unclutterProcess.kill();
            console.log('Stopped unclutter');
        } catch (err) {
            // Process may have already exited
        }
        unclutterProcess = null;
    }
}

function createWindow() {
    // Check for --no-kiosk flag to disable kiosk mode (for development/tinkering)
    const noKiosk = process.argv.includes('--no-kiosk');
    const kioskMode = !noKiosk;
    
    console.log('Kiosk mode:', kioskMode ? 'enabled' : 'disabled (use --no-kiosk to tinker)');
    
    mainWindow = new BrowserWindow({
        width: 1920,
        height: 1080,
        fullscreen: kioskMode,
        kiosk: kioskMode, // True kiosk mode - no window decorations, can't escape
        backgroundColor: '#1A1A1A',
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
            enableRemoteModule: true
        }
    });

    mainWindow.loadFile('src/index.html');
    
    // Open DevTools for development (only when not in kiosk mode)
    if (noKiosk) {
        // mainWindow.webContents.openDevTools();
    }

    mainWindow.on('closed', () => {
        mainWindow = null;
        if (osdWindow) {
            osdWindow.close();
        }
    });
}

function createOSDWindow(movieData) {
    if (osdWindow) {
        osdWindow.close();
    }
    
    const primaryDisplay = screen.getPrimaryDisplay();
    const { width, height } = primaryDisplay.bounds;
    
    osdWindow = new BrowserWindow({
        width: width,
        height: height,
        x: 0,
        y: 0,
        frame: false,
        transparent: true,
        alwaysOnTop: true,
        skipTaskbar: true,
        resizable: false,
        titleBarStyle: 'hidden',
        hasShadow: false,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
        }
    });
    
    osdWindow.loadFile('src/osd.html');
    osdWindow.setIgnoreMouseEvents(false); // Allow mouse events
    
    // Send movie data to OSD window once loaded
    osdWindow.webContents.on('did-finish-load', () => {
        console.log('OSD window loaded, sending movie data:', movieData);
        osdWindow.webContents.send('movie-data', movieData);
    });
    
    osdWindow.on('closed', () => {
        osdWindow = null;
    });
}

app.whenReady().then(() => {
    createWindow();
    startUnclutter(); // Start cursor hiding for entire app
});

app.on('window-all-closed', () => {
    stopUnclutter(); // Stop cursor hiding
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('activate', () => {
    if (mainWindow === null) {
        createWindow();
    }
});

// Handle play-video request from renderer
ipcMain.on('play-video', (event, data) => {
    const { videoPath, startPosition } = data;
    
    console.log('Playing video:', videoPath);
    console.log('Start position:', startPosition);

    // VLC command line arguments for TV viewing
    const vlcArgs = [
        '--fullscreen',
        '--no-video-title-show',
        '--play-and-exit',
        '--qt-minimal-view',
        
        // Disable volume and fullscreen controls
        '--key-toggle-fullscreen=Unset',   // Disable F key
        '--key-leave-fullscreen=Unset',    // Disable Esc from exiting fullscreen
        '--key-vol-up=Unset',              // Disable + key
        '--key-vol-down=Unset',            // Disable - key
        '--key-vol-mute=Unset',            // Disable M key (mute)
        
        // Remap down arrow to show time (up arrow disabled)
        '--key-jump+short=Unset',          // Disable up arrow
        '--key-position=Down',             // Down arrow = show time
        
        // Remap Esc to quit
        '--key-quit=Esc',                  // Esc = quit/stop playback
        
        '--mouse-hide-timeout=1000'        // Hide mouse after 1 second
    ];

    // Add start position if resuming
    if (startPosition && startPosition > 0) {
        vlcArgs.push(`--start-time=${startPosition}`);
    }

    vlcArgs.push(videoPath);

    // Launch VLC
    vlcProcess = spawn('vlc', vlcArgs);

    vlcProcess.on('error', (err) => {
        console.error('VLC error:', err);
        event.reply('vlc-error', err.message);
    });

    vlcProcess.on('close', (code) => {
        console.log('VLC closed with code:', code);
        vlcProcess = null;
        
        // Bring app back to focus
        if (mainWindow) {
            mainWindow.show();
            mainWindow.focus();
        }
        
        // Notify renderer that playback ended
        event.reply('playback-ended', { videoPath });
    });

    // Hide main window while playing (optional)
    // mainWindow.minimize();
});

// Handle stop-video request
ipcMain.on('stop-video', () => {
    if (vlcProcess) {
        vlcProcess.kill();
        vlcProcess = null;
    }
});

// Handle hide/show window for mpv player
ipcMain.on('hide-window', () => {
    if (mainWindow) {
        mainWindow.hide();
    }
});

ipcMain.on('show-window', () => {
    if (mainWindow) {
        mainWindow.show();
        mainWindow.focus();
    }
});

// Handle OSD window creation
ipcMain.on('create-osd', (event, movieData) => {
    console.log('Main process received create-osd with data:', movieData);
    createOSDWindow(movieData);
});

// Send next episode data to OSD
ipcMain.on('set-next-episode', (event, nextEpisodeData) => {
    console.log('Setting next episode data:', nextEpisodeData);
    if (osdWindow && osdWindow.webContents) {
        osdWindow.webContents.send('set-next-episode', nextEpisodeData);
    }
});

// Handle nav buttons visibility
ipcMain.on('set-nav-buttons', (event, navData) => {
    console.log('Setting nav buttons:', navData);
    if (osdWindow && osdWindow.webContents) {
        osdWindow.webContents.send('set-nav-buttons', navData);
    }
});

ipcMain.on('hide-nav-buttons', () => {
    console.log('Hiding nav buttons');
    if (osdWindow && osdWindow.webContents) {
        osdWindow.webContents.send('hide-nav-buttons');
    }
});

// Handle play next/previous from OSD - request data from renderer
ipcMain.on('request-next-item', () => {
    console.log('Request next item');
    if (mainWindow && mainWindow.webContents) {
        mainWindow.webContents.send('request-next-item');
    }
});

ipcMain.on('request-previous-item', () => {
    console.log('Request previous item');
    if (mainWindow && mainWindow.webContents) {
        mainWindow.webContents.send('request-previous-item');
    }
});

// Send item data to OSD for seamless playback
ipcMain.on('play-item-seamless', (event, itemData) => {
    console.log('Sending item to OSD for seamless playback:', itemData.osdMetadata?.title);
    if (osdWindow && osdWindow.webContents) {
        osdWindow.webContents.send('play-item-seamless', itemData);
    }
});

// Handle item started seamless - forward to renderer for tracking
ipcMain.on('item-started-seamless', (event, itemData) => {
    console.log('Item started seamless:', itemData.osdMetadata?.title);
    if (mainWindow && mainWindow.webContents) {
        mainWindow.webContents.send('item-started-seamless', itemData);
    }
});

// Handle episode started (from OSD when auto-playing next episode)
ipcMain.on('episode-started', (event, episodeData) => {
    console.log('Episode started:', episodeData);
    if (mainWindow && mainWindow.webContents) {
        mainWindow.webContents.send('episode-started', episodeData);
    }
});

// Handle OSD window close
ipcMain.on('close-osd', () => {
    if (osdWindow) {
        osdWindow.close();
        osdWindow = null;
    }
});

// Handle playback ended - forward to renderer to refresh watch status
ipcMain.on('playback-ended', (event, videoPath) => {
    console.log('Playback ended for:', videoPath);
    if (mainWindow && mainWindow.webContents) {
        mainWindow.webContents.send('playback-ended', videoPath);
    }
});

// TODO: Implement settings fullscreen handling later
// Handle settings fullscreen request
// ipcMain.on('settings-request-fullscreen', () => {
//     console.log('Settings requesting fullscreen');
//     if (mainWindow && !mainWindow.isFullScreen()) {
//         mainWindow.setFullScreen(true);
//     }
// });

// Handle close player and return (when movie ends)
ipcMain.on('close-player-and-return', () => {
    console.log('Movie ended - closing player and returning to detail page');
    
    // Close OSD window
    if (osdWindow) {
        osdWindow.close();
        osdWindow = null;
    }
    
    // Show and focus main window
    if (mainWindow) {
        mainWindow.show();
        mainWindow.focus();
    }
    
    // Tell renderer to close player
    if (mainWindow && mainWindow.webContents) {
        mainWindow.webContents.send('close-player');
    }
});

// Handle play next episode request from OSD
ipcMain.on('play-next-episode', (event, nextEpisodeData) => {
    console.log('Playing next episode:', nextEpisodeData);
    
    // Tell renderer to play the next episode
    if (mainWindow && mainWindow.webContents) {
        mainWindow.webContents.send('play-next-episode', nextEpisodeData);
    }
});

// Handle config requests from renderer
ipcMain.on('get-config', (event) => {
    const config = getConfig();
    event.returnValue = {
        moviesPath: config.moviesPath,
        tvPath: config.tvPath
    };
});

ipcMain.on('get-subtitle-defaults', (event) => {
    const config = getConfig();
    event.returnValue = {
        size: config.subtitleSize || 100,
        position: config.subtitlePosition || 100,
        colorIndex: config.subtitleColorIndex || 0,
        backgroundIndex: config.subtitleBackgroundIndex || 0
    };
});
