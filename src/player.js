// Video player using direct mpv spawn
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const net = require('net');

let mpvProcess = null;
let currentMovie = null;
let positionTracker = null;
let positionTrackerWaitInterval = null; // Track the wait-for-socket interval
let trackedVideoPath = null; // The video path being tracked (module-level for updates)
let trackedWatchDataManager = null; // The watch data manager (module-level)
const ipcSocketPath = '/tmp/mpv-socket';

// MPV IPC Command Helper
function sendMPVCommand(command) {
    return new Promise((resolve, reject) => {
        // Check if socket exists
        if (!fs.existsSync(ipcSocketPath)) {
            reject(new Error('MPV socket not found'));
            return;
        }
        
        const client = net.connect(ipcSocketPath, () => {
            const json = JSON.stringify(command) + '\n';
            client.write(json);
        });
        
        let response = '';
        client.on('data', (data) => {
            response += data.toString();
            try {
                const parsed = JSON.parse(response);
                client.end();
                resolve(parsed);
            } catch (e) {
                // Not complete JSON yet, wait for more data
            }
        });
        
        client.on('error', (err) => {
            console.error('MPV IPC error:', err.message);
            reject(err);
        });
        
        client.setTimeout(1000);
        client.on('timeout', () => {
            client.end();
            reject(new Error('MPV command timeout'));
        });
    });
}

// Get current playback position
async function getPlaybackPosition() {
    try {
        const timePos = await sendMPVCommand({ command: ['get_property', 'time-pos'] });
        const duration = await sendMPVCommand({ command: ['get_property', 'duration'] });
        
        return {
            position: timePos.data || 0,
            duration: duration.data || 0
        };
    } catch (err) {
        // Socket not ready yet or mpv closed - this is normal, don't spam errors
        return null;
    }
}

// Start position tracking
function startPositionTracking(videoPath, watchDataManager) {
    // Clear any existing tracking
    if (positionTracker) {
        clearInterval(positionTracker);
        positionTracker = null;
    }
    if (positionTrackerWaitInterval) {
        clearInterval(positionTrackerWaitInterval);
        positionTrackerWaitInterval = null;
    }
    
    // Update module-level tracking variables
    trackedVideoPath = videoPath;
    trackedWatchDataManager = watchDataManager;
    
    console.log('========================================');
    console.log('POSITION TRACKING: Waiting for MPV to start...');
    console.log('Video:', videoPath);
    console.log('========================================');
    
    let attempts = 0;
    const maxAttempts = 30; // Try for 30 seconds
    
    // Wait for socket to be ready
    positionTrackerWaitInterval = setInterval(async () => {
        attempts++;
        
        if (!fs.existsSync(ipcSocketPath)) {
            console.log(`Waiting for MPV socket... (${attempts}/${maxAttempts})`);
            if (attempts >= maxAttempts) {
                clearInterval(positionTrackerWaitInterval);
                positionTrackerWaitInterval = null;
                console.error('MPV socket never appeared - position tracking failed');
            }
            return;
        }
        
        // Socket exists, try to get position
        const pos = await getPlaybackPosition();
        
        if (pos && pos.duration > 0) {
            // Success! Start tracking
            clearInterval(positionTrackerWaitInterval);
            positionTrackerWaitInterval = null;
            
            console.log('========================================');
            console.log('POSITION TRACKING STARTED');
            console.log('Duration:', Math.floor(pos.duration), 'seconds');
            console.log('========================================');
            
            positionTracker = setInterval(async () => {
                const currentPos = await getPlaybackPosition();
                
                if (currentPos && currentPos.position > 0 && currentPos.duration > 0) {
                    // Update position in watch data using MODULE-LEVEL variables
                    // This ensures we always use the current video path, not a stale closure
                    if (trackedWatchDataManager && trackedVideoPath) {
                        trackedWatchDataManager.updatePosition(trackedVideoPath, currentPos.position, currentPos.duration);
                        
                        // Calculate percentage
                        const percentage = (currentPos.position / currentPos.duration) * 100;
                        console.log('========================================');
                        console.log('POSITION UPDATE');
                        console.log(`Video: ${trackedVideoPath}`);
                        console.log(`Time: ${Math.floor(currentPos.position)}s / ${Math.floor(currentPos.duration)}s`);
                        console.log(`Progress: ${percentage.toFixed(1)}%`);
                        console.log('========================================');
                    }
                }
            }, 10000); // Update every 10 seconds
        } else if (attempts >= maxAttempts) {
            clearInterval(positionTrackerWaitInterval);
            positionTrackerWaitInterval = null;
            console.error('Could not get position from MPV - tracking failed');
        }
    }, 1000); // Check every second
}

// Stop position tracking
async function stopPositionTracking() {
    // Capture and immediately clear module-level variables so any new tracking session
    // that starts before this async function completes is not clobbered by our cleanup.
    const localPath = trackedVideoPath;
    const localManager = trackedWatchDataManager;
    trackedVideoPath = null;
    trackedWatchDataManager = null;

    // Clear the wait-for-socket interval if it's running
    if (positionTrackerWaitInterval) {
        clearInterval(positionTrackerWaitInterval);
        positionTrackerWaitInterval = null;
    }

    if (positionTracker) {
        clearInterval(positionTracker);
        positionTracker = null;

        // Save position one final time using local copies (not module vars, which may
        // already belong to a new tracking session started via seamless auto-play)
        if (localManager && localPath) {
            try {
                const finalPos = await getPlaybackPosition();
                if (finalPos && finalPos.position > 0 && finalPos.duration > 0) {
                    localManager.updatePosition(localPath, finalPos.position, finalPos.duration);
                    console.log('========================================');
                    console.log('FINAL POSITION SAVED ON EXIT');
                    console.log(`Video: ${localPath}`);
                    console.log(`Time: ${Math.floor(finalPos.position)}s / ${Math.floor(finalPos.duration)}s`);
                    console.log('========================================');
                }
            } catch (err) {
                console.log('Could not save final position (MPV may have already closed)');
            }
        }

        console.log('Stopped position tracking');
    }
}

// Play a movie
async function playMovie(videoPath, startPosition = 0, movieMetadata = {}, watchDataManager = null) {
    try {
        console.log('========================================');
        console.log('PLAY MOVIE CALLED');
        console.log('Video:', videoPath);
        console.log('Start position:', startPosition);
        console.log('Has watchDataManager:', !!watchDataManager);
        console.log('========================================');
        
        // Stop any existing tracking
        stopPositionTracking();
        
        // Kill existing mpv process if any
        if (mpvProcess) {
            console.log('Killing existing mpv process');
            mpvProcess.kill();
            mpvProcess = null;
        }
        
        // Remove old socket if it exists
        if (fs.existsSync(ipcSocketPath)) {
            fs.unlinkSync(ipcSocketPath);
        }
        
        // Check for forced subtitles (both external and embedded)
        const { checkForForcedSubtitles } = require('./subtitle-detector');
        const forcedInfo = await checkForForcedSubtitles(videoPath);
        
        if (forcedInfo.hasForced) {
            if (forcedInfo.isExternal) {
                console.log('External forced subtitles detected - will auto-enable');
            } else {
                console.log(`Embedded forced subtitles detected on track ${forcedInfo.trackId} - will auto-enable`);
            }
        }
        
        // Build mpv arguments
        const mpvArgs = [
            '--fullscreen',
            '--no-border',
            '--no-osc', // No on-screen controller
            '--no-osd-bar', // No OSD bar
            '--osd-level=0', // No OSD messages
            '--keep-open=yes',
            '--cursor-autohide=1000', // Hide cursor after 1 second of inactivity
            `--input-ipc-server=${ipcSocketPath}`, // IPC for OSD communication
        ];
        
        // Handle subtitle enabling based on forced subtitle detection
        if (forcedInfo.hasForced) {
            if (forcedInfo.isExternal) {
                // External forced subtitle - auto-select first subtitle track
                mpvArgs.push('--sid=auto');
            } else {
                // Embedded forced subtitle - select specific track by ID
                mpvArgs.push(`--sid=${forcedInfo.trackId}`);
            }
        } else {
            // No forced subtitles - disable by default
            mpvArgs.push('--sid=no');
        }
        
        // Explicitly add all external subtitle files so MPV can find them
        try {
            const videoDir = path.dirname(videoPath);
            const videoBasename = path.basename(videoPath, path.extname(videoPath));
            const files = fs.readdirSync(videoDir);
            
            // Find all subtitle files for this video
            const subtitleFiles = files.filter(file => {
                if (!file.endsWith('.srt')) return false;
                const srtBasename = path.basename(file, '.srt');
                
                // Check if subtitle matches this video
                if (srtBasename.startsWith(videoBasename)) return true;
                
                // Also check by episode ID
                const episodeMatch = videoBasename.match(/S\d+E\d+/i);
                if (episodeMatch && srtBasename.includes(episodeMatch[0])) return true;
                
                return false;
            });
            
            // Add each subtitle file explicitly
            subtitleFiles.forEach(subFile => {
                const subPath = path.join(videoDir, subFile);
                mpvArgs.push(`--sub-file=${subPath}`);
                console.log('Adding subtitle file:', subFile);
            });
        } catch (err) {
            console.error('Error adding subtitle files:', err);
        }
        
        // Add start position if provided
        if (startPosition > 0) {
            mpvArgs.push(`--start=${startPosition}`);
            console.log('Resuming from position:', startPosition);
        }
        
        // Add video file
        mpvArgs.push(videoPath);
        
        console.log('Spawning mpv with args:', mpvArgs);
        
        // Spawn mpv process
        mpvProcess = spawn('mpv', mpvArgs, {
            stdio: 'inherit'
        });
        
        mpvProcess.on('error', (err) => {
            console.error('MPV error:', err);
            mpvProcess = null;
            stopPositionTracking();
        });
        
        mpvProcess.on('close', (code) => {
            console.log('MPV closed with code:', code);
            
            // Use currentMovie if available, otherwise use the pending path from closePlayer()
            const closedVideoPath = currentMovie ? currentMovie.videoPath : pendingCloseVideoPath;
            
            // Stop tracking BEFORE nulling currentMovie (so final position can be saved)
            stopPositionTracking();
            
            mpvProcess = null;
            currentMovie = null;
            pendingCloseVideoPath = null; // Clear the pending path
            
            // Clean up socket
            if (fs.existsSync(ipcSocketPath)) {
                fs.unlinkSync(ipcSocketPath);
            }
            
            // Close OSD window
            const { ipcRenderer } = require('electron');
            ipcRenderer.send('close-osd');
            
            // Notify renderer to refresh watch status
            if (closedVideoPath) {
                console.log('Sending playback-ended event for:', closedVideoPath);
                ipcRenderer.send('playback-ended', closedVideoPath);
            } else {
                console.log('No video path to send playback-ended for');
            }
        });
        
        console.log('MPV spawned successfully');
        
        // Store current movie for position tracking
        currentMovie = {
            videoPath: videoPath
        };
        
        // Start position tracking
        if (watchDataManager) {
            startPositionTracking(videoPath, watchDataManager);
        }
        
        // Create OSD overlay window with movie data
        const { ipcRenderer } = require('electron');
        console.log('Sending metadata to OSD:', movieMetadata);
        ipcRenderer.send('create-osd', movieMetadata);
        
        // Send next episode data if available (for TV shows)
        setTimeout(() => {
            if (window.pendingNextEpisodeData) {
                console.log('Sending next episode data to OSD:', window.pendingNextEpisodeData);
                ipcRenderer.send('set-next-episode', window.pendingNextEpisodeData);
                window.pendingNextEpisodeData = null;
            }
            
            // Send nav buttons visibility
            if (window.pendingNavButtons) {
                console.log('Sending nav buttons to OSD:', window.pendingNavButtons);
                ipcRenderer.send('set-nav-buttons', window.pendingNavButtons);
                window.pendingNavButtons = null;
            } else {
                // Hide nav buttons for standalone movies
                ipcRenderer.send('hide-nav-buttons');
            }
        }, 100); // Small delay to ensure OSD window is ready
        
    } catch (error) {
        console.error('Failed to play movie:', error);
        alert('Failed to play video: ' + error.message);
        closePlayer();
    }
}

// Store the video path for the close event (since closePlayer nulls currentMovie before the event fires)
let pendingCloseVideoPath = null;

// Close player
function closePlayer() {
    // Stop position tracking
    stopPositionTracking();
    
    // Save video path before nulling currentMovie - the 'close' event needs it
    pendingCloseVideoPath = currentMovie ? currentMovie.videoPath : null;
    
    if (mpvProcess) {
        console.log('Closing mpv');
        mpvProcess.kill();
        mpvProcess = null;
    }
    
    currentMovie = null;
    
    // Clean up socket
    if (fs.existsSync(ipcSocketPath)) {
        fs.unlinkSync(ipcSocketPath);
    }
}

// Toggle play/pause (via IPC - placeholder for now)
function togglePlayPause() {
    // TODO: Send IPC command to mpv
    console.log('togglePlayPause - IPC not yet implemented');
}

// Seek (via IPC - placeholder for now)
function seek(seconds) {
    // TODO: Send IPC command to mpv
    console.log('seek - IPC not yet implemented');
}

// Cleanup on app close
function cleanup() {
    closePlayer();
}

// Export functions
// Get available subtitle tracks
async function getSubtitleTracks() {
    try {
        const result = await sendMPVCommand({ command: ['get_property', 'track-list'] });
        if (result.data) {
            return result.data
                .filter(track => track.type === 'sub')
                .map(track => ({
                    id: track.id,
                    title: track.title || `Subtitle ${track.id}`,
                    lang: track.lang || 'und',
                    external: track.external || false,
                    selected: track.selected || false
                }));
        }
        return [];
    } catch (err) {
        console.error('Error getting subtitle tracks:', err);
        return [];
    }
}

// Set subtitle track by ID
async function setSubtitleTrack(trackId) {
    try {
        await sendMPVCommand({ command: ['set_property', 'sid', trackId] });
        return true;
    } catch (err) {
        console.error('Error setting subtitle track:', err);
        return false;
    }
}

// Disable subtitles
async function disableSubtitles() {
    try {
        await sendMPVCommand({ command: ['set_property', 'sid', 'no'] });
        return true;
    } catch (err) {
        console.error('Error disabling subtitles:', err);
        return false;
    }
}

// Get current video path
function getCurrentVideoPath() {
    return currentMovie ? currentMovie.videoPath : null;
}

// Set current video path (for seamless episode transitions)
function setCurrentVideoPath(videoPath) {
    if (!currentMovie) {
        currentMovie = {};
    }
    currentMovie.videoPath = videoPath;
    
    // Also update the tracked video path for position tracking
    trackedVideoPath = videoPath;
    
    console.log('Updated current video path to:', videoPath);
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        playMovie,
        closePlayer,
        togglePlayPause,
        seek,
        cleanup,
        getSubtitleTracks,
        setSubtitleTrack,
        disableSubtitles,
        startPositionTracking,
        stopPositionTracking,
        getCurrentVideoPath,
        setCurrentVideoPath
    };
}
