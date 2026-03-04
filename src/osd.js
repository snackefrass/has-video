// OSD Overlay Logic
const net = require('net');
const path = require('path');
const { ipcRenderer } = require('electron');

// State
let mpvSocket = null;
let connected = false;
let hideTimeout = null;
let updateInterval = null;
let currentPosition = 0;
let duration = 0;
let isPaused = false;
let subtitlesEnabled = false;
let subtitlesAvailable = true; // Assume available until checked

// Up Next state
let upNextVisible = false;
let upNextCountdown = 30;
let upNextInterval = null;
let upNextButtonIndex = 0; // 0 = Start Now, 1 = Hide
let upNextHidden = false; // User manually hid the modal
let nextEpisodeData = null;

// Movie metadata (passed from main app)
let movieData = {
    title: '',
    year: '',
    rating: '',
    endTime: '', // This will be recalculated
    resolution: '',
    runtime: 0, // Store runtime in minutes for recalculation
    accentColor: '#39ddd8' // Default cyan
};

// Elements
const osdContainer = document.getElementById('osd-container');
const subtitleToast = document.getElementById('subtitle-toast');
const clock = document.getElementById('osd-clock');
const title = document.getElementById('osd-title');
const metaContainer = document.getElementById('osd-meta');
const resolutionTemplate = document.getElementById('osd-resolution-template');
const progressFilled = document.getElementById('osd-progress-filled');
const progressHandle = document.getElementById('osd-progress-handle');
const timeElapsed = document.getElementById('osd-time-elapsed');
const timeRemaining = document.getElementById('osd-time-remaining');
const playPauseBtn = document.getElementById('osd-play-pause-btn');
const playPauseIcon = document.getElementById('osd-play-pause-icon');
const subtitlesBtn = document.getElementById('osd-subtitles-btn');
const backBtn = document.getElementById('osd-back-btn');
const forwardBtn = document.getElementById('osd-forward-btn');
const previousBtn = document.getElementById('osd-previous-btn');
const nextBtn = document.getElementById('osd-next-btn');
const infoBtn = document.getElementById('osd-info-btn');
const moreBtn = document.getElementById('osd-more-btn');

// More Options panel elements
const moreOptionsPanel = document.getElementById('more-options-panel');
const moreOptionsRows = document.querySelectorAll('.more-options-row');
const speedValue = document.getElementById('speed-value');
const subSizeValue = document.getElementById('sub-size-value');
const subPosValue = document.getElementById('sub-pos-value');
const subColorValue = document.getElementById('sub-color-value');
const subBackValue = document.getElementById('sub-back-value');
const subDelayValue = document.getElementById('sub-delay-value');
const aspectValue = document.getElementById('aspect-value');
const brightnessValue = document.getElementById('brightness-value');
const contrastValue = document.getElementById('contrast-value');
const saturationValue = document.getElementById('saturation-value');
const gammaValue = document.getElementById('gamma-value');

// More Options state
let moreOptionsVisible = false;
let moreOptionsFocusedRow = 0;
let statsVisible = false;

// Speed options
const speedOptions = [0.5, 0.75, 1, 1.25, 1.5, 2];
let currentSpeedIndex = 2; // Default 1x

// Subtitle options
let currentSubSize = 100; // percentage (sub-scale * 100)
let currentSubPos = 100; // percentage (100 = bottom, lower = higher on screen)
let currentSubDelay = 0; // milliseconds
let subtitleIsText = true; // true for text-based subs (can change color/bg), false for bitmap

const subColorOptions = [
    { name: 'White', value: '1.0/1.0/1.0/1.0' },
    { name: 'Yellow', value: '1.0/1.0/0.0/1.0' },
    { name: 'Cyan', value: '0.0/1.0/1.0/1.0' },
    { name: 'Green', value: '0.0/1.0/0.0/1.0' },
    { name: 'Magenta', value: '1.0/0.0/1.0/1.0' }
];
let currentSubColorIndex = 0; // Default White

const subBackOptions = [
    { name: 'None', value: '0.0/0.0/0.0/0.0' },
    { name: 'Light', value: '0.0/0.0/0.0/0.33' },
    { name: 'Medium', value: '0.0/0.0/0.0/0.66' },
    { name: 'Dark', value: '0.0/0.0/0.0/1.0' }
];
let currentSubBackIndex = 0; // Default None

// Video options
const aspectOptions = ['Auto', '16:9', '4:3', '2.35:1', 'Stretch'];
let currentAspectIndex = 0; // Default Auto
let currentBrightness = 0; // -100 to 100
let currentContrast = 0; // -100 to 100
let currentSaturation = 0; // -100 to 100
let currentGamma = 0; // -100 to 100 (MPV uses different scale, we'll convert)

// Up Next elements
const upNextModal = document.getElementById('up-next-modal');
const upNextThumbnail = document.getElementById('up-next-thumbnail');
const upNextTimer = document.getElementById('up-next-timer');
const upNextLabel = document.getElementById('up-next-label');
const upNextTitle = document.getElementById('up-next-title');
const upNextSeasonEpisode = document.getElementById('up-next-season-episode');
const upNextEndsAt = document.getElementById('up-next-ends-at');
const upNextStartBtn = document.getElementById('up-next-start-btn');
const upNextHideBtn = document.getElementById('up-next-hide-btn');
const upNextButtons = [upNextStartBtn, upNextHideBtn];

// Button navigation
let focusedButtonIndex = 1; // Start on play/pause (index 1 in visible buttons)
const allButtons = [previousBtn, backBtn, playPauseBtn, forwardBtn, nextBtn, subtitlesBtn, infoBtn, moreBtn]; // All possible buttons
let focusMode = 'buttons'; // 'scrubbar', 'buttons', or 'upnext'
let isInitialShow = true; // Track if this is the first time OSD is shown

// Get currently visible/navigable buttons
function getVisibleButtons() {
    return allButtons.filter(btn => {
        if (!btn) return false;
        // Check if button is hidden via display:none or style
        if (btn.style.display === 'none') return false;
        // Check computed style
        const computed = window.getComputedStyle(btn);
        return computed.display !== 'none';
    });
}

function updateButtonFocus() {
    const visibleButtons = getVisibleButtons();
    
    // Remove focus from all buttons
    allButtons.forEach(btn => btn?.classList.remove('active'));
    
    // Remove scrubbar focus
    progressHandle.classList.remove('active');
    
    // Add focus based on mode
    if (focusMode === 'buttons' && visibleButtons[focusedButtonIndex]) {
        visibleButtons[focusedButtonIndex].classList.add('active');
    } else if (focusMode === 'scrubbar') {
        progressHandle.classList.add('active');
    }
}

function focusNextButton() {
    const visibleButtons = getVisibleButtons();
    focusedButtonIndex = (focusedButtonIndex + 1) % visibleButtons.length;
    updateButtonFocus();
}

function focusPreviousButton() {
    const visibleButtons = getVisibleButtons();
    focusedButtonIndex = (focusedButtonIndex - 1 + visibleButtons.length) % visibleButtons.length;
    updateButtonFocus();
}

function clickFocusedButton() {
    const visibleButtons = getVisibleButtons();
    if (visibleButtons[focusedButtonIndex]) {
        visibleButtons[focusedButtonIndex].click();
    }
}

function setFocusMode(mode) {
    focusMode = mode;
    if (mode === 'buttons') {
        // When switching to buttons mode, default to play/pause (index 2 in visible buttons)
        // But we need to find the actual index in visible buttons
        const visibleButtons = getVisibleButtons();
        const playPauseIndex = visibleButtons.indexOf(playPauseBtn);
        focusedButtonIndex = playPauseIndex >= 0 ? playPauseIndex : 0;
    }
    updateButtonFocus();
}

// Connect to MPV IPC socket
function connectToMPV() {
    const socketPath = '/tmp/mpv-socket';
    
    mpvSocket = net.createConnection(socketPath, () => {
        console.log('Connected to MPV IPC');
        connected = true;
        
        // Request initial state
        sendMPVCommand({ command: ['get_property', 'time-pos'] });
        sendMPVCommand({ command: ['get_property', 'duration'] });
        sendMPVCommand({ command: ['get_property', 'pause'] });
        sendMPVCommand({ command: ['get_property', 'sub-visibility'] });
        
        // Start observing properties
        sendMPVCommand({ command: ['observe_property', 1, 'time-pos'] });
        sendMPVCommand({ command: ['observe_property', 2, 'duration'] });
        sendMPVCommand({ command: ['observe_property', 3, 'pause'] });
        sendMPVCommand({ command: ['observe_property', 4, 'sub-visibility'] });
        sendMPVCommand({ command: ['observe_property', 5, 'sid'] }); // Also observe subtitle track ID
        sendMPVCommand({ command: ['observe_property', 6, 'eof-reached'] }); // Observe end of file
        
        // Get initial subtitle state
        sendMPVCommand({ command: ['get_property', 'sub-visibility'], request_id: 100 });
        sendMPVCommand({ command: ['get_property', 'sid'], request_id: 101 });
        
        // Check if subtitles are available and update button visibility
        checkSubtitlesExist().then(exists => {
            subtitlesAvailable = exists;
            console.log('Subtitles available:', subtitlesAvailable);
            updateSubtitlesButton();
            
            // Apply default subtitle settings from config
            applySubtitleDefaults();
        });
        
        // Start update loop
        startUpdateLoop();
    });
    
    mpvSocket.on('data', (data) => {
        const lines = data.toString().trim().split('\n');
        lines.forEach(line => {
            try {
                const response = JSON.parse(line);
                handleMPVResponse(response);
            } catch (err) {
                console.error('Error parsing MPV response:', err);
            }
        });
    });
    
    mpvSocket.on('error', (err) => {
        console.error('MPV socket error:', err);
        connected = false;
    });
    
    mpvSocket.on('close', () => {
        console.log('MPV socket closed');
        connected = false;
        if (updateInterval) {
            clearInterval(updateInterval);
        }
    });
}

// Send command to MPV
function sendMPVCommand(command) {
    if (connected && mpvSocket) {
        mpvSocket.write(JSON.stringify(command) + '\n');
    }
}

// Handle responses from MPV
function handleMPVResponse(response) {
    // Handle subtitle type check (request_id 200)
    if (response.request_id === 200 && window._subtitleTypeHandler) {
        window._subtitleTypeHandler(response);
        window._subtitleTypeHandler = null;
    }
    
    // Handle get_property responses for initial state
    if (response.request_id === 100 && response.data !== undefined) {
        console.log('Initial sub-visibility:', response.data);
        subtitlesEnabled = response.data;
        updateSubtitlesButton();
    }
    if (response.request_id === 101 && response.data !== undefined) {
        console.log('Initial sid (subtitle track):', response.data);
        // sid is the track ID - false/no means no subs, number means subs enabled
        subtitlesEnabled = (response.data !== false && response.data !== 'no');
        updateSubtitlesButton();
    }
    
    if (response.event === 'property-change') {
        switch (response.id) {
            case 1: // time-pos
                if (response.data !== null) {
                    currentPosition = response.data;
                    updateProgress();
                }
                break;
            case 2: // duration
                if (response.data !== null) {
                    duration = response.data;
                    updateProgress();
                }
                break;
            case 3: // pause
                if (response.data !== null) {
                    isPaused = response.data;
                    updatePlayPauseButton();
                }
                break;
            case 4: // sub-visibility
                console.log('MPV sub-visibility changed:', response.data);
                if (response.data !== null) {
                    subtitlesEnabled = response.data;
                    updateSubtitlesButton();
                }
                break;
            case 5: // sid (subtitle track ID)
                console.log('MPV sid (subtitle track) changed:', response.data);
                if (response.data !== null) {
                    // sid is false/'no' when disabled, or a track number when enabled
                    subtitlesEnabled = (response.data !== false && response.data !== 'no');
                    updateSubtitlesButton();
                }
                break;
            case 6: // eof-reached
                if (response.data === true) {
                    console.log('Video ended (eof-reached)');
                    
                    // Check if we should play next episode
                    const autoPlayEnabled = localStorage.getItem('autoPlayNextEnabled') !== 'false';
                    if (nextEpisodeData && autoPlayEnabled) {
                        console.log('Auto-playing next episode');
                        playNextEpisode();
                    } else {
                        // No next episode or auto-play disabled - return to detail page
                        ipcRenderer.send('close-player-and-return');
                    }
                }
                break;
        }
    }
}

// Apply subtitle defaults from settings
function applySubtitleDefaults() {
    try {
        // Try to get defaults from main app via ipcRenderer
        const defaults = ipcRenderer.sendSync('get-subtitle-defaults');
        if (defaults) {
            console.log('Applying subtitle defaults:', defaults);
            
            // Apply size
            currentSubSize = defaults.size || 100;
            subSizeValue.textContent = currentSubSize + '%';
            sendMPVCommand({ command: ['set_property', 'sub-scale', currentSubSize / 100] });
            
            // Apply position
            currentSubPos = defaults.position || 100;
            subPosValue.textContent = currentSubPos + '%';
            sendMPVCommand({ command: ['set_property', 'sub-pos', currentSubPos] });
            
            // Apply color (only for text subs)
            if (subtitleIsText) {
                currentSubColorIndex = defaults.colorIndex || 0;
                if (currentSubColorIndex < subColorOptions.length) {
                    subColorValue.textContent = subColorOptions[currentSubColorIndex].name;
                    sendMPVCommand({ command: ['set_property', 'sub-color', subColorOptions[currentSubColorIndex].value] });
                }
                
                // Apply background
                currentSubBackIndex = defaults.backgroundIndex || 0;
                if (currentSubBackIndex < subBackOptions.length) {
                    subBackValue.textContent = subBackOptions[currentSubBackIndex].name;
                    sendMPVCommand({ command: ['set_property', 'sub-back-color', subBackOptions[currentSubBackIndex].value] });
                }
            }
        }
    } catch (err) {
        console.log('Could not get subtitle defaults:', err);
    }
}

// Update progress bar
function updateProgress() {
    if (duration > 0) {
        const percent = (currentPosition / duration) * 100;
        progressFilled.style.width = `${percent}%`;
        progressHandle.style.left = `${percent}%`;
        
        // Update time displays
        timeElapsed.textContent = formatTime(currentPosition);
        timeRemaining.textContent = '-' + formatTime(duration - currentPosition);
        
        // Check if we should show Up Next modal (30 seconds remaining)
        const timeLeft = duration - currentPosition;
        if (timeLeft <= 30 && timeLeft > 0 && !upNextVisible && !upNextHidden && nextEpisodeData) {
            showUpNextModal();
        }
        
        // If modal is already visible, sync countdown to actual time remaining
        // This handles cases where user seeks while modal is showing
        if (upNextVisible && !upNextHidden && timeLeft > 0) {
            const actualTimeLeft = Math.ceil(timeLeft);
            // Only update if there's a significant difference (user seeked)
            if (Math.abs(actualTimeLeft - upNextCountdown) > 2) {
                upNextCountdown = actualTimeLeft;
                updateUpNextTimer();
            }
        }
    }
}

// Update play/pause button
function updatePlayPauseButton() {
    if (isPaused) {
        playPauseIcon.src = 'assets/icons/play.svg';
    } else {
        playPauseIcon.src = 'assets/icons/pause.svg';
    }
}

// Update subtitles button icon and visibility
function updateSubtitlesButton() {
    console.log('Updating subtitles button, enabled:', subtitlesEnabled, 'available:', subtitlesAvailable);
    
    // Hide button if no subtitles available
    if (!subtitlesAvailable) {
        subtitlesBtn.style.display = 'none';
        return;
    }
    
    subtitlesBtn.style.display = 'flex';
    const btnIcon = subtitlesBtn.querySelector('.osd-button-icon');
    if (subtitlesEnabled) {
        subtitlesBtn.classList.add('subtitle-enabled');
        if (btnIcon) btnIcon.src = 'assets/icons/subtitles.svg';
    } else {
        subtitlesBtn.classList.remove('subtitle-enabled');
        if (btnIcon) btnIcon.src = 'assets/icons/subtitles-off.svg';
    }
}

// Show subtitle toast notification
let toastTimeout = null;
function showSubtitleToast(message) {
    const toastText = document.getElementById('subtitle-toast-text');
    const toastIcon = document.getElementById('subtitle-toast-icon');
    
    if (toastText) toastText.textContent = message;
    
    // Set appropriate icon based on message
    if (toastIcon) {
        if (message === 'Subtitles On') {
            toastIcon.src = 'assets/icons/subtitles.svg';
        } else if (message === 'Subtitles Off') {
            toastIcon.src = 'assets/icons/subtitles-off.svg';
        }
        // For "No Subtitles Found", keep whatever icon is there (or could use subtitles-off)
    }
    
    subtitleToast.classList.add('show');
    
    // Clear existing timeout
    if (toastTimeout) {
        clearTimeout(toastTimeout);
    }
    
    // Hide after 2 seconds
    toastTimeout = setTimeout(() => {
        subtitleToast.classList.remove('show');
    }, 2000);
}

// More Options Panel functions
function showMoreOptions() {
    moreOptionsVisible = true;
    moreOptionsPanel.classList.remove('more-options-hidden');
    
    // Hide/show subtitle section based on availability
    const subtitlesSection = document.getElementById('subtitles-section');
    if (subtitlesSection) {
        if (subtitlesAvailable) {
            subtitlesSection.classList.remove('hidden');
        } else {
            subtitlesSection.classList.add('hidden');
        }
    }
    
    // Hide/show color and background options based on subtitle type
    const textSubOnlyRows = document.querySelectorAll('.more-options-row.text-sub-only');
    textSubOnlyRows.forEach(row => {
        if (subtitleIsText) {
            row.classList.remove('hidden');
        } else {
            row.classList.add('hidden');
        }
    });
    
    // Re-query rows after visibility changes
    refreshMoreOptionsRows();
    
    moreOptionsFocusedRow = 0;
    updateMoreOptionsFocus();
    // Keep OSD visible while panel is open
    clearTimeout(hideTimeout);
}

function refreshMoreOptionsRows() {
    const visibleRows = [];
    Array.from(document.querySelector('.more-options-content').children).forEach(child => {
        if (child.classList.contains('more-options-row') && !child.classList.contains('hidden')) {
            // Direct row (Speed)
            visibleRows.push(child);
        } else if (child.classList.contains('more-options-section') && !child.classList.contains('hidden')) {
            // Section header first if reset is available (matches visual position at top)
            const header = child.querySelector('.more-options-section-header[data-option]');
            if (header && header.classList.contains('reset-active')) {
                visibleRows.push(header);
            }
            // Section rows
            child.querySelectorAll('.more-options-row').forEach(row => {
                if (!row.classList.contains('hidden')) visibleRows.push(row);
            });
        }
    });
    window.visibleMoreOptionsRows = visibleRows;
}

function hideMoreOptions() {
    moreOptionsVisible = false;
    moreOptionsPanel.classList.add('more-options-hidden');
    // Resume normal OSD behavior
    resetHideTimer();
}

function toggleMoreOptions() {
    if (moreOptionsVisible) {
        hideMoreOptions();
    } else {
        showMoreOptions();
    }
}

function updateMoreOptionsFocus() {
    // Clear focused from all possible targets (rows + section headers)
    document.querySelectorAll('.more-options-row.focused, .more-options-section-header.focused').forEach(el => {
        el.classList.remove('focused');
    });
    const rows = window.visibleMoreOptionsRows || moreOptionsRows;
    if (rows[moreOptionsFocusedRow]) {
        rows[moreOptionsFocusedRow].classList.add('focused');
    }
}

function flashArrow(direction) {
    const rows = window.visibleMoreOptionsRows || moreOptionsRows;
    const row = rows[moreOptionsFocusedRow];
    if (!row) return;
    
    const arrows = row.querySelectorAll('.more-options-arrow');
    const arrow = direction === 'left' ? arrows[0] : arrows[1];
    
    if (arrow) {
        arrow.classList.add('arrow-flash');
        setTimeout(() => {
            arrow.classList.remove('arrow-flash');
        }, 150);
    }
}

function adjustOption(direction) {
    const rows = window.visibleMoreOptionsRows || moreOptionsRows;
    const row = rows[moreOptionsFocusedRow];
    const option = row?.dataset.option;
    
    // Flash the arrow
    flashArrow(direction);
    
    switch (option) {
        case 'speed':
            if (direction === 'left' && currentSpeedIndex > 0) {
                currentSpeedIndex--;
            } else if (direction === 'right' && currentSpeedIndex < speedOptions.length - 1) {
                currentSpeedIndex++;
            }
            const speed = speedOptions[currentSpeedIndex];
            speedValue.textContent = speed + 'x';
            sendMPVCommand({ command: ['set_property', 'speed', speed] });
            break;
            
        case 'sub-size':
            if (direction === 'left' && currentSubSize > 50) {
                currentSubSize -= 10;
            } else if (direction === 'right' && currentSubSize < 200) {
                currentSubSize += 10;
            }
            subSizeValue.textContent = currentSubSize + '%';
            sendMPVCommand({ command: ['set_property', 'sub-scale', currentSubSize / 100] });
            break;
            
        case 'sub-pos':
            if (direction === 'left' && currentSubPos > 0) {
                currentSubPos -= 5;
            } else if (direction === 'right' && currentSubPos < 100) {
                currentSubPos += 5;
            }
            subPosValue.textContent = currentSubPos + '%';
            sendMPVCommand({ command: ['set_property', 'sub-pos', currentSubPos] });
            break;
            
        case 'sub-color':
            if (direction === 'left') {
                currentSubColorIndex = (currentSubColorIndex - 1 + subColorOptions.length) % subColorOptions.length;
            } else if (direction === 'right') {
                currentSubColorIndex = (currentSubColorIndex + 1) % subColorOptions.length;
            }
            subColorValue.textContent = subColorOptions[currentSubColorIndex].name;
            sendMPVCommand({ command: ['set_property', 'sub-color', subColorOptions[currentSubColorIndex].value] });
            break;
            
        case 'sub-back':
            if (direction === 'left') {
                currentSubBackIndex = (currentSubBackIndex - 1 + subBackOptions.length) % subBackOptions.length;
            } else if (direction === 'right') {
                currentSubBackIndex = (currentSubBackIndex + 1) % subBackOptions.length;
            }
            subBackValue.textContent = subBackOptions[currentSubBackIndex].name;
            sendMPVCommand({ command: ['set_property', 'sub-back-color', subBackOptions[currentSubBackIndex].value] });
            break;
            
        case 'sub-delay':
            if (direction === 'left') {
                currentSubDelay -= 100;
            } else if (direction === 'right') {
                currentSubDelay += 100;
            }
            subDelayValue.textContent = currentSubDelay + 'ms';
            sendMPVCommand({ command: ['set_property', 'sub-delay', currentSubDelay / 1000] });
            break;
            
        case 'aspect':
            if (direction === 'left') {
                currentAspectIndex = (currentAspectIndex - 1 + aspectOptions.length) % aspectOptions.length;
            } else if (direction === 'right') {
                currentAspectIndex = (currentAspectIndex + 1) % aspectOptions.length;
            }
            aspectValue.textContent = aspectOptions[currentAspectIndex];
            // Set aspect ratio in MPV
            const aspectMap = {
                'Auto': '-1',
                '16:9': '16:9',
                '4:3': '4:3',
                '2.35:1': '2.35:1',
                'Stretch': '-1' // Will use panscan for stretch
            };
            if (aspectOptions[currentAspectIndex] === 'Stretch') {
                sendMPVCommand({ command: ['set_property', 'video-aspect-override', '-1'] });
                sendMPVCommand({ command: ['set_property', 'panscan', 1.0] });
            } else {
                sendMPVCommand({ command: ['set_property', 'panscan', 0] });
                sendMPVCommand({ command: ['set_property', 'video-aspect-override', aspectMap[aspectOptions[currentAspectIndex]]] });
            }
            break;
            
        case 'brightness':
            if (direction === 'left' && currentBrightness > -100) {
                currentBrightness -= 5;
            } else if (direction === 'right' && currentBrightness < 100) {
                currentBrightness += 5;
            }
            brightnessValue.textContent = currentBrightness;
            sendMPVCommand({ command: ['set_property', 'brightness', currentBrightness] });
            break;
            
        case 'contrast':
            if (direction === 'left' && currentContrast > -100) {
                currentContrast -= 5;
            } else if (direction === 'right' && currentContrast < 100) {
                currentContrast += 5;
            }
            contrastValue.textContent = currentContrast;
            sendMPVCommand({ command: ['set_property', 'contrast', currentContrast] });
            break;
            
        case 'saturation':
            if (direction === 'left' && currentSaturation > -100) {
                currentSaturation -= 5;
            } else if (direction === 'right' && currentSaturation < 100) {
                currentSaturation += 5;
            }
            saturationValue.textContent = currentSaturation;
            sendMPVCommand({ command: ['set_property', 'saturation', currentSaturation] });
            break;
            
        case 'gamma':
            if (direction === 'left' && currentGamma > -100) {
                currentGamma -= 5;
            } else if (direction === 'right' && currentGamma < 100) {
                currentGamma += 5;
            }
            gammaValue.textContent = currentGamma;
            sendMPVCommand({ command: ['set_property', 'gamma', currentGamma] });
            break;
    }
    updateResetButtons();
}

function handleMoreOptionsKey(e) {
    const rows = window.visibleMoreOptionsRows || moreOptionsRows;
    
    switch (e.key) {
        case 'ArrowUp':
            e.preventDefault();
            if (moreOptionsFocusedRow > 0) {
                moreOptionsFocusedRow--;
                updateMoreOptionsFocus();
            }
            break;
        case 'ArrowDown':
            e.preventDefault();
            if (moreOptionsFocusedRow < rows.length - 1) {
                moreOptionsFocusedRow++;
                updateMoreOptionsFocus();
            }
            break;
        case 'ArrowLeft':
            e.preventDefault();
            adjustOption('left');
            break;
        case 'ArrowRight':
            e.preventDefault();
            adjustOption('right');
            break;
        case 'Enter':
        case ' ': {
            e.preventDefault();
            const focusedItem = rows[moreOptionsFocusedRow];
            if (focusedItem?.dataset.option === 'reset-subtitles') {
                resetSubtitles();
            } else if (focusedItem?.dataset.option === 'reset-video') {
                resetVideo();
            }
            break;
        }
        case 'Escape':
        case 'Backspace':
            e.preventDefault();
            hideMoreOptions();
            break;
    }
}

// Format time in HH:MM:SS or MM:SS
function formatTime(seconds) {
    if (isNaN(seconds) || seconds < 0) return '0:00';
    
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    
    if (hours > 0) {
        return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    } else {
        return `${minutes}:${String(secs).padStart(2, '0')}`;
    }
}

// Update clock
function updateClock() {
    const now = new Date();
    const hours = now.getHours();
    const minutes = String(now.getMinutes()).padStart(2, '0');
    clock.textContent = `${hours}:${minutes}`;
}

// Show OSD
function showOSD(startFocusMode = 'buttons') {
    const wasHidden = osdContainer.classList.contains('osd-hidden');
    osdContainer.classList.remove('osd-hidden');
    
    // Only change focus mode if OSD was hidden, or if explicitly changing modes
    if (wasHidden) {
        // First time showing OSD - focus scrub bar
        if (isInitialShow) {
            focusMode = 'scrubbar';
            isInitialShow = false; // Not initial anymore
        } else {
            // Subsequent shows - use provided mode (default buttons)
            focusMode = startFocusMode;
            if (focusMode === 'buttons') {
                const visibleButtons = getVisibleButtons();
                const playPauseIndex = visibleButtons.indexOf(playPauseBtn);
                focusedButtonIndex = playPauseIndex >= 0 ? playPauseIndex : 0;
            }
        }
    } else if (startFocusMode !== focusMode) {
        // Switching modes while OSD is visible
        focusMode = startFocusMode;
        if (focusMode === 'buttons') {
            const visibleButtons = getVisibleButtons();
            const playPauseIndex = visibleButtons.indexOf(playPauseBtn);
            focusedButtonIndex = playPauseIndex >= 0 ? playPauseIndex : 0;
        }
    }
    // If OSD is already visible and we're staying in the same mode, don't change focus
    
    updateButtonFocus();
    resetHideTimer();
}

// Hide OSD
function hideOSD() {
    osdContainer.classList.add('osd-hidden');
    // Remove all focus when hiding
    buttons.forEach(btn => btn.classList.remove('active'));
    progressHandle.classList.remove('active');
}

// Reset hide timer
function resetHideTimer() {
    if (hideTimeout) {
        clearTimeout(hideTimeout);
    }
    hideTimeout = setTimeout(() => {
        hideOSD();
    }, 5000); // Hide after 5 seconds
}

// Start update loop for clock
function startUpdateLoop() {
    updateClock();
    updateInterval = setInterval(() => {
        updateClock();
    }, 1000);
}

// Button handlers
playPauseBtn.addEventListener('click', () => {
    sendMPVCommand({ command: ['cycle', 'pause'] });
    showOSD();
});

backBtn.addEventListener('click', () => {
    sendMPVCommand({ command: ['seek', -10] });
    showOSD();
});

// Helper function to check if subtitle files exist (external or embedded)
async function checkSubtitlesExist() {
    const fs = require('fs');
    const path = require('path');
    
    if (!movieData.videoPath) {
        return true; // Assume they exist if we can't check
    }
    
    // First check for external subtitle files
    try {
        const movieDir = path.dirname(movieData.videoPath);
        const files = fs.readdirSync(movieDir);
        const subtitleExtensions = ['.srt', '.sub', '.ass', '.ssa', '.vtt'];
        const hasExternalSubs = files.some(file => {
            const ext = path.extname(file).toLowerCase();
            return subtitleExtensions.includes(ext);
        });
        
        if (hasExternalSubs) {
            subtitleIsText = true; // External subs are text-based
            return true;
        }
    } catch (err) {
        console.error('Error checking for external subtitles:', err);
    }
    
    // Check for embedded subtitles using player's track list
    try {
        const player = require('./player');
        if (player.getSubtitleTracks) {
            const tracks = await player.getSubtitleTracks();
            if (tracks && tracks.length > 0) {
                // Check the codec of the first subtitle track
                await checkSubtitleType();
                return true;
            }
        }
    } catch (err) {
        console.error('Error checking for embedded subtitles:', err);
    }
    
    return false; // No subtitles found
}

// Check if current subtitle track is text-based or bitmap-based
async function checkSubtitleType() {
    return new Promise((resolve) => {
        // Bitmap subtitle codecs
        const bitmapCodecs = ['hdmv_pgs_subtitle', 'pgssub', 'dvd_subtitle', 'dvdsub', 'xsub'];
        
        // Request track list from MPV
        const requestId = 200;
        
        // Set up one-time handler for this request
        const handleResponse = (response) => {
            if (response.request_id === requestId && response.data) {
                const tracks = response.data;
                // Find the current subtitle track
                const subTracks = tracks.filter(t => t.type === 'sub');
                
                if (subTracks.length > 0) {
                    // Check the selected/first sub track
                    const activeSub = subTracks.find(t => t.selected) || subTracks[0];
                    const codec = (activeSub.codec || '').toLowerCase();
                    
                    subtitleIsText = !bitmapCodecs.some(bc => codec.includes(bc));
                    console.log('Subtitle codec:', codec, 'isText:', subtitleIsText);
                } else {
                    subtitleIsText = true; // Default to text if we can't determine
                }
                resolve(subtitleIsText);
            }
        };
        
        // Store the handler temporarily
        window._subtitleTypeHandler = handleResponse;
        
        // Request track list
        sendMPVCommand({ command: ['get_property', 'track-list'], request_id: requestId });
        
        // Timeout after 1 second
        setTimeout(() => {
            resolve(subtitleIsText);
        }, 1000);
    });
}

forwardBtn.addEventListener('click', () => {
    sendMPVCommand({ command: ['seek', 30] });
    showOSD();
});

// Previous button - go to previous item in queue
let pendingNavButtonFocus = null; // Track which nav button to focus after seamless load

previousBtn.addEventListener('click', () => {
    console.log('Previous button clicked');
    pendingNavButtonFocus = 'previous';
    ipcRenderer.send('request-previous-item');
});

// Next button - go to next item in queue
nextBtn.addEventListener('click', () => {
    console.log('Next button clicked');
    pendingNavButtonFocus = 'next';
    ipcRenderer.send('request-next-item');
});

// Handle playing previous/next item seamlessly
ipcRenderer.on('play-item-seamless', (event, itemData) => {
    console.log('Playing item seamlessly:', itemData);
    playItemSeamlessly(itemData);
});

function playItemSeamlessly(itemData) {
    if (!itemData || !itemData.videoPath) return;
    
    console.log('Loading video seamlessly:', itemData.videoPath);
    
    // Use MPV's loadfile command to seamlessly load the video
    sendMPVCommand({ command: ['loadfile', itemData.videoPath, 'replace'] });
    
    // Seek to start position after a short delay
    setTimeout(() => {
        const startPos = itemData.startPosition || 0;
        if (startPos > 0) {
            sendMPVCommand({ command: ['seek', startPos, 'absolute'] });
        } else {
            sendMPVCommand({ command: ['seek', 0, 'absolute'] });
        }
    }, 100);
    
    // Reset position tracking
    currentPosition = itemData.startPosition || 0;
    duration = 0;
    
    // Update OSD metadata
    if (itemData.osdMetadata) {
        const meta = itemData.osdMetadata;
        movieData.title = meta.title || '';
        movieData.year = meta.year || '';
        movieData.rating = meta.rating || '';
        movieData.resolution = meta.resolution || '';
        movieData.runtime = meta.runtime || 0;
        movieData.accentColor = meta.accentColor || '#39ddd8';
        movieData.videoPath = itemData.videoPath;
        
        // Apply accent color
        if (meta.accentColor) {
            const osdGradientEnabled = localStorage.getItem('osdGradientEnabled') !== 'false';
            const accentGradient = document.querySelector('.osd-gradient-accent');
            if (osdGradientEnabled && accentGradient) {
                const hex = meta.accentColor.replace('#', '');
                const r = parseInt(hex.substr(0, 2), 16);
                const g = parseInt(hex.substr(2, 2), 16);
                const b = parseInt(hex.substr(4, 2), 16);
                accentGradient.style.background = `linear-gradient(to top, rgba(${r}, ${g}, ${b}, 0.25), transparent)`;
                accentGradient.style.display = '';
            }
        }
        
        // Update OSD display
        title.textContent = movieData.title;
        
        const leftMetaItems = [];
        if (movieData.year) leftMetaItems.push(`<span>${movieData.year}</span>`);
        if (movieData.rating) leftMetaItems.push(`<span>${movieData.rating}</span>`);
        
        let metaHTML = '';
        if (leftMetaItems.length > 0) {
            metaHTML = `<div class="osd-meta-left">${leftMetaItems.join('<span class="osd-divider">|</span>')}</div>`;
        }
        
        if (movieData.resolution) {
            metaHTML += `<div class="osd-resolution">${movieData.resolution}</div>`;
        }
        
        metaContainer.innerHTML = metaHTML;
    }
    
    // Update nav buttons visibility
    if (itemData.navButtons) {
        if (itemData.navButtons.hasPrevious) {
            previousBtn.classList.remove('osd-hidden');
        } else {
            previousBtn.classList.add('osd-hidden');
        }
        if (itemData.navButtons.hasNext) {
            nextBtn.classList.remove('osd-hidden');
        } else {
            nextBtn.classList.add('osd-hidden');
        }
    }
    
    // Tell renderer to update tracking
    ipcRenderer.send('item-started-seamless', itemData);
    
    // Show OSD and preserve focus on the nav button that was pressed
    if (pendingNavButtonFocus) {
        const visibleButtons = getVisibleButtons();
        const targetBtn = pendingNavButtonFocus === 'previous' ? previousBtn : nextBtn;
        const targetIndex = visibleButtons.indexOf(targetBtn);
        
        if (targetIndex >= 0) {
            focusMode = 'buttons';
            focusedButtonIndex = targetIndex;
            showOSD('buttons');
        } else {
            // Button is no longer visible (e.g., reached end), fall back to scrubbar
            showOSD('scrubbar');
        }
        pendingNavButtonFocus = null;
    } else {
        showOSD('scrubbar');
    }
}

subtitlesBtn.addEventListener('click', async () => {
    const exists = await checkSubtitlesExist();
    if (!exists) {
        showSubtitleToast('No Subtitles Found');
        showOSD();
        return;
    }
    
    // Toggle subtitles
    showSubtitleToast(subtitlesEnabled ? 'Subtitles Off' : 'Subtitles On');
    sendMPVCommand({ command: ['cycle', 'sub'] });
    showOSD();
});

// More options button click
moreBtn.addEventListener('click', () => {
    toggleMoreOptions();
});

function toggleStats() {
    statsVisible = !statsVisible;
    infoBtn.classList.toggle('active', statsVisible);
    sendMPVCommand({ command: ['script-binding', 'stats/display-stats-toggle'] });
    if (statsVisible) {
        // Ensure page 1 (File & Codec Info) is shown
        sendMPVCommand({ command: ['script-message-to', 'stats', 'display-stats', '1'] });
    }
}

function hideStats() {
    if (!statsVisible) return;
    statsVisible = false;
    infoBtn.classList.remove('active');
    sendMPVCommand({ command: ['script-binding', 'stats/display-stats-toggle'] });
}

infoBtn.addEventListener('click', () => {
    toggleStats();
});

function isSubtitlesDirty() {
    return currentSubSize !== 100 || currentSubPos !== 100 || currentSubDelay !== 0 ||
           currentSubColorIndex !== 0 || currentSubBackIndex !== 0;
}

function isVideoDirty() {
    return currentAspectIndex !== 0 || currentBrightness !== 0 || currentContrast !== 0 ||
           currentSaturation !== 0 || currentGamma !== 0;
}

function updateResetButtons() {
    // Remember which element is focused so we can restore after array changes
    const focusedEl = (window.visibleMoreOptionsRows || [])[moreOptionsFocusedRow];

    document.querySelector('#subtitles-section .more-options-section-header').classList.toggle('reset-active', isSubtitlesDirty());
    document.querySelector('#video-section .more-options-section-header').classList.toggle('reset-active', isVideoDirty());

    refreshMoreOptionsRows();

    // Restore focus to the same element at its new index
    const newIdx = focusedEl ? window.visibleMoreOptionsRows.indexOf(focusedEl) : -1;
    if (newIdx >= 0) {
        moreOptionsFocusedRow = newIdx;
    } else if (moreOptionsFocusedRow >= window.visibleMoreOptionsRows.length) {
        moreOptionsFocusedRow = window.visibleMoreOptionsRows.length - 1;
    }
    updateMoreOptionsFocus();
}

function resetSubtitles() {
    currentSubSize = 100;
    subSizeValue.textContent = '100%';
    sendMPVCommand({ command: ['set_property', 'sub-scale', 1] });

    currentSubPos = 100;
    subPosValue.textContent = '100%';
    sendMPVCommand({ command: ['set_property', 'sub-pos', 100] });

    currentSubColorIndex = 0;
    subColorValue.textContent = subColorOptions[0].name;
    sendMPVCommand({ command: ['set_property', 'sub-color', subColorOptions[0].value] });

    currentSubBackIndex = 0;
    subBackValue.textContent = subBackOptions[0].name;
    sendMPVCommand({ command: ['set_property', 'sub-back-color', subBackOptions[0].value] });

    currentSubDelay = 0;
    subDelayValue.textContent = '0ms';
    sendMPVCommand({ command: ['set_property', 'sub-delay', 0] });

    updateResetButtons();
    // Focus first row of subtitles section
    const firstSubRow = document.querySelector('#subtitles-section .more-options-row:not(.hidden)');
    const subIdx = window.visibleMoreOptionsRows.indexOf(firstSubRow);
    if (subIdx >= 0) {
        moreOptionsFocusedRow = subIdx;
        updateMoreOptionsFocus();
    }
}

function resetVideo() {
    currentAspectIndex = 0;
    aspectValue.textContent = aspectOptions[0];
    sendMPVCommand({ command: ['set_property', 'video-aspect-override', '0'] });

    currentBrightness = 0;
    brightnessValue.textContent = '0';
    sendMPVCommand({ command: ['set_property', 'brightness', 0] });

    currentContrast = 0;
    contrastValue.textContent = '0';
    sendMPVCommand({ command: ['set_property', 'contrast', 0] });

    currentSaturation = 0;
    saturationValue.textContent = '0';
    sendMPVCommand({ command: ['set_property', 'saturation', 0] });

    currentGamma = 0;
    gammaValue.textContent = '0';
    sendMPVCommand({ command: ['set_property', 'gamma', 0] });

    updateResetButtons();
    // Focus first row of video section
    const firstVidRow = document.querySelector('#video-section .more-options-row:not(.hidden)');
    const vidIdx = window.visibleMoreOptionsRows.indexOf(firstVidRow);
    if (vidIdx >= 0) {
        moreOptionsFocusedRow = vidIdx;
        updateMoreOptionsFocus();
    }
}

document.getElementById('reset-subtitles-btn').addEventListener('click', resetSubtitles);
document.getElementById('reset-video-btn').addEventListener('click', resetVideo);

// Mouse move shows OSD
document.addEventListener('mousemove', () => {
    showOSD();
});

// Key press handling
document.addEventListener('keydown', (e) => {
    const osdVisible = !osdContainer.classList.contains('osd-hidden');
    
    // Handle More Options panel keyboard navigation first
    if (moreOptionsVisible) {
        handleMoreOptionsKey(e);
        return;
    }
    
    // Handle Up Next modal keyboard navigation first
    if (upNextVisible && !upNextModal.classList.contains('up-next-hidden')) {
        switch (e.key) {
            case 'ArrowLeft':
                e.preventDefault();
                upNextButtonIndex = 0;
                updateUpNextButtonFocus();
                return;
            case 'ArrowRight':
                e.preventDefault();
                upNextButtonIndex = 1;
                updateUpNextButtonFocus();
                return;
            case 'Enter':
            case ' ':
                e.preventDefault();
                if (upNextButtonIndex === 0) {
                    // Start Now
                    playNextEpisode();
                } else {
                    // Hide
                    hideUpNextModal();
                }
                return;
            case 'Escape':
            case 'Backspace':
                e.preventDefault();
                hideUpNextModal();
                return;
        }
        // Don't process other keys when up-next modal is visible
        return;
    }
    
    // Escape or Backspace: dismiss stats first, then quit
    if (e.key === 'Escape' || e.key === 'Backspace') {
        e.preventDefault();
        if (statsVisible) {
            hideStats();
        } else {
            sendMPVCommand({ command: ['quit'] });
        }
        return;
    }
    
    // If OSD is visible
    if (osdVisible) {
        if (focusMode === 'scrubbar') {
            // Focus on scrub bar
            switch (e.key) {
                case 'ArrowLeft':
                    e.preventDefault();
                    sendMPVCommand({ command: ['seek', -10] });
                    resetHideTimer();
                    return;
                case 'ArrowRight':
                    e.preventDefault();
                    sendMPVCommand({ command: ['seek', 30] });
                    resetHideTimer();
                    return;
                case 'ArrowDown':
                    e.preventDefault();
                    setFocusMode('buttons');
                    resetHideTimer();
                    return;
                case ' ':
                case 'Enter':
                    e.preventDefault();
                    sendMPVCommand({ command: ['cycle', 'pause'] });
                    resetHideTimer();
                    return;
                case 's':
                case 'S':
                    e.preventDefault();
                    checkSubtitlesExist().then(exists => {
                        if (!exists) {
                            showSubtitleToast('No Subtitles Found');
                            resetHideTimer();
                            return;
                        }
                        // Toggle subtitles
                        
                        showSubtitleToast(subtitlesEnabled ? 'Subtitles Off' : 'Subtitles On');
                        sendMPVCommand({ command: ['cycle', 'sub'] });
                        resetHideTimer();
                    });
                    return;
            }
        } else {
            // Focus on buttons
            switch (e.key) {
                case 'ArrowLeft':
                    e.preventDefault();
                    focusPreviousButton();
                    resetHideTimer();
                    return;
                case 'ArrowRight':
                    e.preventDefault();
                    focusNextButton();
                    resetHideTimer();
                    return;
                case 'ArrowUp':
                    e.preventDefault();
                    setFocusMode('scrubbar');
                    resetHideTimer();
                    return;
                case 'Enter':
                case ' ':
                    e.preventDefault();
                    clickFocusedButton();
                    return;
                case 's':
                case 'S':
                    e.preventDefault();
                    checkSubtitlesExist().then(exists => {
                        if (!exists) {
                            showSubtitleToast('No Subtitles Found');
                            resetHideTimer();
                            return;
                        }
                        // Toggle subtitles
                        
                        showSubtitleToast(subtitlesEnabled ? 'Subtitles Off' : 'Subtitles On');
                        sendMPVCommand({ command: ['cycle', 'sub'] });
                        resetHideTimer();
                    });
                    return;
            }
        }
    } else {
        // OSD is hidden
        switch (e.key) {
            case ' ':
            case 'Enter':
                // Play/pause and show OSD
                e.preventDefault();
                sendMPVCommand({ command: ['cycle', 'pause'] });
                showOSD('buttons');
                break;
            case 'ArrowDown':
                // Down arrow shows OSD with button focus
                e.preventDefault();
                showOSD('buttons');
                break;
            case 'ArrowLeft':
                // Seek back and show OSD with scrubbar focus
                e.preventDefault();
                sendMPVCommand({ command: ['seek', -10] });
                showOSD('scrubbar');
                break;
            case 'ArrowRight':
                // Seek forward and show OSD with scrubbar focus
                e.preventDefault();
                sendMPVCommand({ command: ['seek', 30] });
                showOSD('scrubbar');
                break;
            case 's':
            case 'S':
                e.preventDefault();
                checkSubtitlesExist().then(exists => {
                    if (!exists) {
                        showSubtitleToast('No Subtitles Found');
                        return;
                    }
                    // Toggle subtitles
                    
                    sendMPVCommand({ command: ['cycle', 'sub'] });
                    showSubtitleToast(subtitlesEnabled ? 'Subtitles Off' : 'Subtitles On');
                    // Don't show OSD on subtitle toggle
                });
                break;
        }
    }
});

// Receive movie data from main process
ipcRenderer.on('movie-data', (event, data) => {
    console.log('OSD received movie data:', data);
    movieData = data;
    console.log('OSD movieData updated:', movieData);
    
    // Get the main app accent color from localStorage for buttons and toast
    // (NOT for the gradient - that uses movieData.accentColor)
    const appAccentHex = localStorage.getItem('accentHex') || '#39ddd8';
    const appAccentRgb = localStorage.getItem('accentRgb') || '57, 221, 216';
    
    // Apply app accent color to CSS variables (for buttons and toast)
    document.documentElement.style.setProperty('--accent', appAccentHex);
    document.documentElement.style.setProperty('--accent-rgb', appAccentRgb);
    console.log('Applied app accent color to OSD UI:', appAccentHex, `RGB: ${appAccentRgb}`);
    
    // Reset initial show flag for new movie
    isInitialShow = true;
    
    // Update title
    title.textContent = movieData.title;
    
    // Apply black gradient (editable here)
    const blackGradient = document.querySelector('.osd-gradient');
    console.log('Black gradient element:', blackGradient);
    if (blackGradient) {
        blackGradient.style.background = `linear-gradient(to top, rgba(0, 0, 0, 0.95), transparent)`;
        //                                                                    ↑ EDIT THIS OPACITY (0.0 to 1.0)
        console.log('Black gradient applied:', blackGradient.style.background);
    }
    
    // Apply accent color to gradient if enabled
    const osdGradientEnabled = localStorage.getItem('osdGradientEnabled') !== 'false'; // Default true
    const accentGradient = document.querySelector('.osd-gradient-accent');
    console.log('Accent gradient element:', accentGradient);
    console.log('OSD gradient enabled:', osdGradientEnabled);
    
    if (osdGradientEnabled && accentGradient && movieData.accentColor) {
        // Parse hex color and add alpha
        const hex = movieData.accentColor.replace('#', '');
        const r = parseInt(hex.substr(0, 2), 16);
        const g = parseInt(hex.substr(2, 2), 16);
        const b = parseInt(hex.substr(4, 2), 16);
        accentGradient.style.background = `linear-gradient(to top, rgba(${r}, ${g}, ${b}, 0.25), transparent)`;
        //                                                                                    ↑ EDIT THIS OPACITY
        console.log('Accent gradient applied:', accentGradient.style.background);
    } else if (accentGradient) {
        // Hide accent gradient if disabled
        accentGradient.style.display = 'none';
    }
    
    // Build metadata line conditionally (like detail page)
    const leftMetaItems = [];
    
    if (movieData.year) {
        leftMetaItems.push(`<span>${movieData.year}</span>`);
    }
    
    if (movieData.rating) {
        leftMetaItems.push(`<span>${movieData.rating}</span>`);
    }
    
    // Note: "Ends at" removed as it cannot be dynamically updated
    
    // Build left side with dividers
    let metaHTML = '';
    if (leftMetaItems.length > 0) {
        metaHTML = `<div class="osd-meta-left">${leftMetaItems.join('<span class="osd-divider">|</span>')}</div>`;
    }
    
    // Add resolution badge on right side if present
    if (movieData.resolution) {
        const badge = resolutionTemplate.cloneNode(true);
        badge.style.display = 'flex';
        badge.querySelector('.osd-badge-text').textContent = movieData.resolution;
        metaHTML += badge.outerHTML;
    }
    
    // Update meta container
    metaContainer.innerHTML = metaHTML;
});

// ========================================
// Up Next Episode Functions
// ========================================

// Receive next episode data from main app
ipcRenderer.on('set-next-episode', (event, data) => {
    console.log('Received next episode data:', data);
    nextEpisodeData = data;
    
    // Check if auto-play is enabled
    const autoPlayEnabled = localStorage.getItem('autoPlayNextEnabled') !== 'false'; // Default true
    if (!autoPlayEnabled) {
        console.log('Auto-play next episode is disabled');
        nextEpisodeData = null;
    }
});

// Show/hide previous and next buttons based on queue availability
ipcRenderer.on('set-nav-buttons', (event, data) => {
    console.log('Received nav buttons config:', data);
    
    if (data.hasPrevious) {
        previousBtn.classList.remove('osd-hidden');
    } else {
        previousBtn.classList.add('osd-hidden');
    }
    
    if (data.hasNext) {
        nextBtn.classList.remove('osd-hidden');
    } else {
        nextBtn.classList.add('osd-hidden');
    }
});

// Hide nav buttons (when playing a standalone movie)
ipcRenderer.on('hide-nav-buttons', () => {
    console.log('Hiding nav buttons');
    previousBtn.classList.add('osd-hidden');
    nextBtn.classList.add('osd-hidden');
});

function showUpNextModal() {
    if (!nextEpisodeData || upNextVisible) return;
    
    console.log('Showing Up Next modal');
    upNextVisible = true;
    upNextHidden = false;
    upNextButtonIndex = 0; // Focus on Start Now
    
    // Reset thumbnail display
    upNextThumbnail.style.display = '';
    
    // Populate modal with item data
    if (nextEpisodeData.isPlaylistItem) {
        // For playlist items, use poster path if available
        if (nextEpisodeData.posterPath) {
            upNextThumbnail.src = `file://${nextEpisodeData.posterPath}`;
            upNextThumbnail.classList.add('up-next-poster');
        } else {
            // Fallback to thumbnail
            const thumbPath = nextEpisodeData.videoPath.replace(/\.[^.]+$/, '.jpg');
            upNextThumbnail.src = `file://${thumbPath}`;
            upNextThumbnail.classList.remove('up-next-poster');
        }
        upNextThumbnail.onerror = () => {
            upNextThumbnail.style.display = 'none';
        };
    } else {
        // For TV shows, use episode thumbnail
        upNextThumbnail.classList.remove('up-next-poster');
        const thumbPath = nextEpisodeData.videoPath.replace(/\.[^.]+$/, '.jpg');
        upNextThumbnail.src = `file://${thumbPath}`;
        upNextThumbnail.onerror = () => {
            upNextThumbnail.style.display = 'none';
        };
    }
    
    // Clamp title to ~24 characters
    let displayTitle = nextEpisodeData.title || 'Next';
    if (displayTitle.length > 24) {
        displayTitle = displayTitle.substring(0, 23) + '…';
    }
    upNextTitle.textContent = displayTitle;
    
    // Format position info - different for playlists vs TV
    if (nextEpisodeData.isPlaylistItem) {
        // For playlists, show year and rating (e.g., "2009 | PG-13")
        const metaParts = [];
        if (nextEpisodeData.year) {
            metaParts.push(nextEpisodeData.year);
        }
        if (nextEpisodeData.rating) {
            metaParts.push(nextEpisodeData.rating);
        }
        if (metaParts.length > 0) {
            upNextSeasonEpisode.textContent = metaParts.join(' | ');
        } else {
            // Fallback to position in queue
            const total = nextEpisodeData.queueTotal || '?';
            upNextSeasonEpisode.textContent = `${nextEpisodeData.queueIndex + 1} of ${total}`;
        }
    } else {
        // For TV shows, show season/episode
        const seasonNum = String(nextEpisodeData.seasonNumber).padStart(2, '0');
        const episodeNum = String(nextEpisodeData.episodeNumber).padStart(2, '0');
        upNextSeasonEpisode.textContent = `S${seasonNum} E${episodeNum}`;
    }
    
    // Set the label text based on type
    if (nextEpisodeData.isPlaylistItem) {
        upNextLabel.textContent = 'Next Up in ';
    } else {
        upNextLabel.textContent = 'Next Episode in ';
    }
    
    // Calculate "Ends at" time
    const now = new Date();
    const runtimeMinutes = nextEpisodeData.runtime || 30; // Default 30 min if not provided
    const endsAt = new Date(now.getTime() + runtimeMinutes * 60 * 1000);
    const endsAtHours = endsAt.getHours();
    const endsAtMinutes = String(endsAt.getMinutes()).padStart(2, '0');
    upNextEndsAt.textContent = `Ends at ${endsAtHours}:${endsAtMinutes}`;
    
    // Show modal
    upNextModal.classList.remove('up-next-hidden');
    updateUpNextButtonFocus();
    
    // Start countdown
    upNextCountdown = Math.ceil(duration - currentPosition);
    if (upNextCountdown > 30) upNextCountdown = 30;
    updateUpNextTimer();
    
    upNextInterval = setInterval(() => {
        upNextCountdown--;
        updateUpNextTimer();
        
        if (upNextCountdown <= 0) {
            clearInterval(upNextInterval);
            playNextEpisode();
        }
    }, 1000);
}

function hideUpNextModal() {
    console.log('Hiding Up Next modal');
    upNextVisible = false;
    upNextHidden = true; // User manually hid it
    upNextModal.classList.add('up-next-hidden');
    
    if (upNextInterval) {
        clearInterval(upNextInterval);
        upNextInterval = null;
    }
}

function updateUpNextTimer() {
    upNextTimer.textContent = `${upNextCountdown}s`;
}

function updateUpNextButtonFocus() {
    upNextButtons.forEach((btn, idx) => {
        if (idx === upNextButtonIndex) {
            btn.classList.add('focused');
        } else {
            btn.classList.remove('focused');
        }
    });
}

function playNextEpisode() {
    if (!nextEpisodeData) return;
    
    console.log('Playing next episode seamlessly:', nextEpisodeData.videoPath);
    
    // Hide modal
    upNextModal.classList.add('up-next-hidden');
    upNextVisible = false;
    upNextHidden = false; // Reset for next episode
    
    if (upNextInterval) {
        clearInterval(upNextInterval);
        upNextInterval = null;
    }
    
    // Use MPV's loadfile command to seamlessly load the next video
    // The 'replace' option starts fresh, but we also seek to 0 to be sure
    sendMPVCommand({ command: ['loadfile', nextEpisodeData.videoPath, 'replace'] });
    
    // Seek to beginning after a short delay to ensure file is loaded
    setTimeout(() => {
        sendMPVCommand({ command: ['seek', 0, 'absolute'] });
    }, 100);
    
    // Reset position tracking
    currentPosition = 0;
    duration = 0;
    
    // Update OSD metadata for the new item
    if (nextEpisodeData.isPlaylistItem && nextEpisodeData.osdMetadata) {
        // For playlist items, use the full OSD metadata (same as movie detail)
        const meta = nextEpisodeData.osdMetadata;
        movieData.title = meta.title;
        movieData.year = meta.year || '';
        movieData.rating = meta.rating || '';  // MPAA rating (PG, PG-13, etc.)
        movieData.resolution = meta.resolution || '';
        movieData.runtime = meta.runtime || 0;
        movieData.accentColor = meta.accentColor;
        movieData.videoPath = nextEpisodeData.videoPath;
        
        // Apply accent color to gradient if enabled
        if (meta.accentColor) {
            const osdGradientEnabled = localStorage.getItem('osdGradientEnabled') !== 'false';
            const accentGradient = document.querySelector('.osd-gradient-accent');
            if (osdGradientEnabled && accentGradient) {
                const hex = meta.accentColor.replace('#', '');
                const r = parseInt(hex.substr(0, 2), 16);
                const g = parseInt(hex.substr(2, 2), 16);
                const b = parseInt(hex.substr(4, 2), 16);
                accentGradient.style.background = `linear-gradient(to top, rgba(${r}, ${g}, ${b}, 0.25), transparent)`;
                accentGradient.style.display = '';
                console.log('Updated accent gradient for playlist item:', meta.accentColor);
            }
        }
        
        // Update OSD display - same format as movie-data handler
        title.textContent = movieData.title;
        
        // Build metadata line with resolution badge (same as movie-data handler)
        const leftMetaItems = [];
        if (movieData.year) {
            leftMetaItems.push(`<span>${movieData.year}</span>`);
        }
        if (movieData.rating) {
            leftMetaItems.push(`<span>${movieData.rating}</span>`);
        }
        
        let metaHTML = '';
        if (leftMetaItems.length > 0) {
            metaHTML = `<div class="osd-meta-left">${leftMetaItems.join('<span class="osd-divider">|</span>')}</div>`;
        }
        
        // Add resolution badge on right side if present
        if (movieData.resolution && resolutionTemplate) {
            const badge = resolutionTemplate.cloneNode(true);
            badge.style.display = 'flex';
            badge.querySelector('.osd-badge-text').textContent = movieData.resolution;
            metaHTML += badge.outerHTML;
        }
        
        metaContainer.innerHTML = metaHTML;
    } else if (nextEpisodeData.isPlaylistItem) {
        // Fallback for playlist items without full metadata
        movieData.title = nextEpisodeData.title;
        movieData.year = nextEpisodeData.year || '';
        movieData.rating = nextEpisodeData.rating || '';
        movieData.videoPath = nextEpisodeData.videoPath;
        
        title.textContent = movieData.title;
        const metaItems = [];
        if (movieData.year) metaItems.push(`<span>${movieData.year}</span>`);
        if (movieData.rating) metaItems.push(`<span>${movieData.rating}</span>`);
        let metaHTML = '';
        if (metaItems.length > 0) {
            metaHTML = `<div class="osd-meta-left">${metaItems.join('<span class="osd-divider">|</span>')}</div>`;
        }
        metaContainer.innerHTML = metaHTML;
    } else {
        // For TV episodes, show TV format: Show Name, S00 E00, Episode Title
        const seasonEp = `S${String(nextEpisodeData.seasonNumber).padStart(2, '0')} E${String(nextEpisodeData.episodeNumber).padStart(2, '0')}`;
        movieData.title = nextEpisodeData.showTitle;
        movieData.year = seasonEp;
        movieData.rating = nextEpisodeData.title;
        movieData.videoPath = nextEpisodeData.videoPath;
        
        title.textContent = movieData.title;
        const metaItems = [];
        if (movieData.year) metaItems.push(`<span>${movieData.year}</span>`);
        if (movieData.rating) metaItems.push(`<span>${movieData.rating}</span>`);
        let metaHTML = '';
        if (metaItems.length > 0) {
            metaHTML = `<div class="osd-meta-left">${metaItems.join('<span class="osd-divider">|</span>')}</div>`;
        }
        metaContainer.innerHTML = metaHTML;
    }
    
    // Tell renderer to update watch tracking and get next episode data
    ipcRenderer.send('episode-started', nextEpisodeData);
    
    // Clear current next episode data - renderer will send new one
    nextEpisodeData = null;
    
    // Show OSD briefly for the new episode
    showOSD('scrubbar');
}

// Button click handlers for Up Next modal
if (upNextStartBtn) {
    upNextStartBtn.addEventListener('click', () => {
        playNextEpisode();
    });
}

if (upNextHideBtn) {
    upNextHideBtn.addEventListener('click', () => {
        hideUpNextModal();
    });
}

// Initialize
setTimeout(() => {
    connectToMPV();
    showOSD('scrubbar'); // Show initially with scrubbar focus
}, 500);
