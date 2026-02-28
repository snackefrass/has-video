// Settings Logic
const fs = require('fs');
const path = require('path');
const { ipcRenderer } = require('electron');

// State
let currentMode = 'settings'; // 'nav', 'settings', 'color-picker'
let navIndex = 4; // Start at Settings nav item
let settingsIndex = 0; // Current settings item
let colorSwatchIndex = 0; // Current color swatch
let navItems = [];
let settingsItems = [];
let colorSwatches = [];
let config = {};

// Subtitle settings state
const subColorOptions = ['White', 'Yellow', 'Cyan', 'Green', 'Magenta'];
const subBackOptions = ['None', 'Light', 'Medium', 'Dark'];
let settingsSubSize = 100;
let settingsSubPos = 100;
let settingsSubColorIndex = 0;
let settingsSubBackIndex = 0;

// Initialize
document.addEventListener('DOMContentLoaded', init);

async function init() {
    console.log('Settings page initializing...');
    
    // Load saved accent color
    loadAccentColor();
    
    // TODO: Implement fullscreen handling later
    // Request fullscreen from main process
    // ipcRenderer.send('settings-request-fullscreen');
    
    // Prevent exiting fullscreen with F11
    // document.addEventListener('keydown', (e) => {
    //     if (e.key === 'F11') {
    //         e.preventDefault();
    //         console.log('F11 blocked - fullscreen locked in settings');
    //     }
    // });
    
    // Load config
    await loadConfig();
    
    // Initialize nav items
    navItems = Array.from(document.querySelectorAll('.nav-item'));
    
    // Initialize settings items
    settingsItems = Array.from(document.querySelectorAll('.settings-item'));
    
    // Load settings into form
    loadSettingsIntoForm();
    
    // Set up keyboard handlers
    document.addEventListener('keydown', handleKeyPress);
    
    // Set up nav handlers
    setupNavHandlers();
    
    // Set up settings item handlers
    setupSettingsHandlers();
    
    // Set up color swatches
    setupColorSwatches();
    
    // Load gradient settings
    loadGradientSettings();
    
    // Update cache status
    updateCacheStatus();
    
    // Start with settings focused - find first visible item
    for (let i = 0; i < settingsItems.length; i++) {
        if (isItemVisible(settingsItems[i])) {
            settingsIndex = i;
            break;
        }
    }
    updateSettingsFocus();
    
    // Start clock
    updateClock();
    setInterval(updateClock, 1000);
    
    console.log('Settings initialized');
}

async function loadConfig() {
    try {
        const configPath = path.join(__dirname, '..', 'config.json');
        const configData = fs.readFileSync(configPath, 'utf8');
        config = JSON.parse(configData);
        console.log('Config loaded:', config);
    } catch (error) {
        console.error('Error loading config:', error);
        config = {
            moviesPath: '',
            tvShowsPath: ''
        };
    }
}

function saveConfig() {
    try {
        const configPath = path.join(__dirname, '..', 'config.json');
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
        console.log('Config saved');
    } catch (error) {
        console.error('Error saving config:', error);
    }
}

function loadSettingsIntoForm() {
    // Movies path
    document.getElementById('moviesPathInput').value = config.moviesPath || '';
    
    // TV Shows path
    document.getElementById('tvShowsPathInput').value = config.tvShowsPath || '';
    
    // Load subtitle settings
    settingsSubSize = config.subtitleSize || 100;
    settingsSubPos = config.subtitlePosition || 100;
    settingsSubColorIndex = config.subtitleColorIndex || 0;
    settingsSubBackIndex = config.subtitleBackgroundIndex || 0;
    
    // Update subtitle display values
    const subSizeEl = document.getElementById('settings-sub-size');
    const subPosEl = document.getElementById('settings-sub-pos');
    const subColorEl = document.getElementById('settings-sub-color');
    const subBackEl = document.getElementById('settings-sub-back');
    
    if (subSizeEl) subSizeEl.textContent = settingsSubSize + '%';
    if (subPosEl) subPosEl.textContent = settingsSubPos + '%';
    if (subColorEl) subColorEl.textContent = subColorOptions[settingsSubColorIndex] || 'White';
    if (subBackEl) subBackEl.textContent = subBackOptions[settingsSubBackIndex] || 'None';
    
    // Load gradient settings
    loadGradientSettings();
}

function setupNavHandlers() {
    navItems.forEach(item => {
        item.addEventListener('click', () => {
            const page = item.dataset.page;
            handleNavClick(page);
        });
    });
}

function setupSettingsHandlers() {
    // Movie library buttons
    const scanNewMoviesBtn = document.getElementById('scanNewMoviesBtn');
    if (scanNewMoviesBtn) {
        scanNewMoviesBtn.addEventListener('click', handleScanNewMovies);
    }
    
    const fullRescanMoviesBtn = document.getElementById('fullRescanMoviesBtn');
    if (fullRescanMoviesBtn) {
        fullRescanMoviesBtn.addEventListener('click', handleFullRescanMovies);
    }
    
    // TV library buttons
    const scanNewTVBtn = document.getElementById('scanNewTVBtn');
    if (scanNewTVBtn) {
        scanNewTVBtn.addEventListener('click', handleScanNewTV);
    }
    
    const fullRescanTVBtn = document.getElementById('fullRescanTVBtn');
    if (fullRescanTVBtn) {
        fullRescanTVBtn.addEventListener('click', handleFullRescanTV);
    }
    
    const clearMovieWatchHistoryBtn = document.getElementById('clearMovieWatchHistoryBtn');
    if (clearMovieWatchHistoryBtn) {
        clearMovieWatchHistoryBtn.addEventListener('click', handleClearMovieWatchHistory);
    }
    
    const clearTVWatchHistoryBtn = document.getElementById('clearTVWatchHistoryBtn');
    if (clearTVWatchHistoryBtn) {
        clearTVWatchHistoryBtn.addEventListener('click', handleClearTVWatchHistory);
    }
    
    const detailGradientToggle = document.getElementById('detailGradientToggle');
    if (detailGradientToggle) {
        detailGradientToggle.addEventListener('click', handleDetailGradientToggle);
    }
    
    const tvDetailGradientToggle = document.getElementById('tvDetailGradientToggle');
    if (tvDetailGradientToggle) {
        tvDetailGradientToggle.addEventListener('click', handleTvDetailGradientToggle);
    }
    
    const homeGradientToggle = document.getElementById('homeGradientToggle');
    if (homeGradientToggle) {
        homeGradientToggle.addEventListener('click', handleHomeGradientToggle);
    }
    
    const osdGradientToggle = document.getElementById('osdGradientToggle');
    if (osdGradientToggle) {
        osdGradientToggle.addEventListener('click', handleOsdGradientToggle);
    }
    
    const autoPlayNextToggle = document.getElementById('autoPlayNextToggle');
    if (autoPlayNextToggle) {
        autoPlayNextToggle.addEventListener('click', handleAutoPlayNextToggle);
    }
    
    const saveBtn = document.getElementById('saveSettingsBtn');
    if (saveBtn) {
        saveBtn.addEventListener('click', handleSaveSettings);
    }
}

function handleNavClick(page) {
    console.log('Nav clicked:', page);
    
    switch(page) {
        case 'search':
            window.location.href = 'search.html';
            break;
        case 'home':
            // Navigate to home screen
            localStorage.setItem('navigateTo', 'home');
            window.location.href = 'index.html';
            break;
        case 'movies':
            // Navigate to movies grid
            localStorage.setItem('navigateTo', 'movies');
            localStorage.setItem('lastLibrary', 'movies');
            window.location.href = 'index.html';
            break;
        case 'tv':
            // Navigate to TV grid
            localStorage.setItem('navigateTo', 'tv');
            localStorage.setItem('lastLibrary', 'tv');
            window.location.href = 'index.html';
            break;
        case 'settings':
            // Already on settings
            break;
    }
}

function handleKeyPress(event) {
    const key = event.key;
    
    // Prevent default for navigation keys
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', 'Escape'].includes(key)) {
        event.preventDefault();
    }
    
    switch(key) {
        case 'ArrowUp':
            handleArrowUp();
            break;
        case 'ArrowDown':
            handleArrowDown();
            break;
        case 'ArrowLeft':
            handleArrowLeft();
            break;
        case 'ArrowRight':
            handleArrowRight();
            break;
        case 'Enter':
            handleEnter();
            break;
        case 'Escape':
        case 'Backspace':
            handleBack();
            break;
    }
}

function handleArrowUp() {
    if (currentMode === 'nav') {
        if (navIndex > 0) {
            navIndex--;
            updateNavFocus();
        }
    } else if (currentMode === 'settings') {
        // Find the next visible item going up
        let newIndex = settingsIndex - 1;
        while (newIndex >= 0) {
            const item = settingsItems[newIndex];
            // Check if item is visible (not hidden via display:none on parent or itself)
            if (isItemVisible(item)) {
                settingsIndex = newIndex;
                updateSettingsFocus();
                break;
            }
            newIndex--;
        }
    }
}

function handleArrowDown() {
    if (currentMode === 'nav') {
        if (navIndex < navItems.length - 1) {
            navIndex++;
            updateNavFocus();
        }
    } else if (currentMode === 'settings') {
        // Find the next visible item going down
        let newIndex = settingsIndex + 1;
        while (newIndex < settingsItems.length) {
            const item = settingsItems[newIndex];
            // Check if item is visible (not hidden via display:none on parent or itself)
            if (isItemVisible(item)) {
                settingsIndex = newIndex;
                updateSettingsFocus();
                break;
            }
            newIndex++;
        }
    }
}

// Helper function to check if an item is visible
function isItemVisible(item) {
    // Check if the item itself is hidden
    if (item.style.display === 'none') return false;
    
    // Check if any parent has display:none
    let parent = item.parentElement;
    while (parent && parent !== document.body) {
        const display = window.getComputedStyle(parent).display;
        if (display === 'none') return false;
        parent = parent.parentElement;
    }
    
    return true;
}

function handleArrowLeft() {
    if (currentMode === 'settings') {
        // Check if current item is a subtitle setting with arrows
        const item = settingsItems[settingsIndex];
        if (item && item.classList.contains('settings-item-arrows')) {
            adjustSubtitleSetting(item, 'left');
            return;
        }
        
        // Move to nav
        currentMode = 'nav';
        updateSettingsFocus();
        updateNavFocus();
    } else if (currentMode === 'color-picker') {
        // Navigate left through color swatches
        if (colorSwatchIndex > 0) {
            colorSwatchIndex--;
            updateColorSwatchFocus();
        } else {
            // Exit color picker mode
            currentMode = 'settings';
            updateColorSwatchFocus();
            updateSettingsFocus();
        }
    }
}

function handleArrowRight() {
    if (currentMode === 'nav') {
        // Move to settings - focus on first visible item
        currentMode = 'settings';
        
        // Find first visible settings item
        for (let i = 0; i < settingsItems.length; i++) {
            if (isItemVisible(settingsItems[i])) {
                settingsIndex = i;
                break;
            }
        }
        
        updateNavFocus();
        updateSettingsFocus();
    } else if (currentMode === 'settings') {
        // Check if current item is a subtitle setting with arrows
        const item = settingsItems[settingsIndex];
        if (item && item.classList.contains('settings-item-arrows')) {
            adjustSubtitleSetting(item, 'right');
            return;
        }
        
        // Check if current item is the accent color picker
        if (item && item.id === 'accentColorItem') {
            // Enter color picker mode
            currentMode = 'color-picker';
            colorSwatchIndex = findSelectedSwatchIndex();
            updateColorSwatchFocus();
        }
    } else if (currentMode === 'color-picker') {
        // Navigate right through color swatches
        if (colorSwatchIndex < colorSwatches.length - 1) {
            colorSwatchIndex++;
            updateColorSwatchFocus();
        }
    }
}

function adjustSubtitleSetting(item, direction) {
    const setting = item.dataset.setting;
    
    // Flash the arrow button
    const arrows = item.querySelectorAll('.settings-arrow-btn');
    const arrow = direction === 'left' ? arrows[0] : arrows[1];
    if (arrow) {
        arrow.classList.add('arrow-flash');
        setTimeout(() => arrow.classList.remove('arrow-flash'), 150);
    }
    
    switch (setting) {
        case 'sub-size':
            if (direction === 'left' && settingsSubSize > 50) {
                settingsSubSize -= 10;
            } else if (direction === 'right' && settingsSubSize < 200) {
                settingsSubSize += 10;
            }
            document.getElementById('settings-sub-size').textContent = settingsSubSize + '%';
            config.subtitleSize = settingsSubSize;
            saveConfig();
            break;
            
        case 'sub-pos':
            if (direction === 'left' && settingsSubPos > 0) {
                settingsSubPos -= 5;
            } else if (direction === 'right' && settingsSubPos < 100) {
                settingsSubPos += 5;
            }
            document.getElementById('settings-sub-pos').textContent = settingsSubPos + '%';
            config.subtitlePosition = settingsSubPos;
            saveConfig();
            break;
            
        case 'sub-color':
            if (direction === 'left') {
                settingsSubColorIndex = (settingsSubColorIndex - 1 + subColorOptions.length) % subColorOptions.length;
            } else if (direction === 'right') {
                settingsSubColorIndex = (settingsSubColorIndex + 1) % subColorOptions.length;
            }
            document.getElementById('settings-sub-color').textContent = subColorOptions[settingsSubColorIndex];
            config.subtitleColorIndex = settingsSubColorIndex;
            saveConfig();
            break;
            
        case 'sub-back':
            if (direction === 'left') {
                settingsSubBackIndex = (settingsSubBackIndex - 1 + subBackOptions.length) % subBackOptions.length;
            } else if (direction === 'right') {
                settingsSubBackIndex = (settingsSubBackIndex + 1) % subBackOptions.length;
            }
            document.getElementById('settings-sub-back').textContent = subBackOptions[settingsSubBackIndex];
            config.subtitleBackgroundIndex = settingsSubBackIndex;
            saveConfig();
            break;
    }
}

function handleEnter() {
    if (currentMode === 'nav') {
        const page = navItems[navIndex].dataset.page;
        handleNavClick(page);
    } else if (currentMode === 'settings') {
        // Activate current settings item
        const item = settingsItems[settingsIndex];
        if (item.id === 'scanNewMoviesBtn') {
            handleScanNewMovies();
        } else if (item.id === 'fullRescanMoviesBtn') {
            handleFullRescanMovies();
        } else if (item.id === 'scanNewTVBtn') {
            handleScanNewTV();
        } else if (item.id === 'fullRescanTVBtn') {
            handleFullRescanTV();
        } else if (item.id === 'clearMovieWatchHistoryBtn') {
            handleClearMovieWatchHistory();
        } else if (item.id === 'clearTVWatchHistoryBtn') {
            handleClearTVWatchHistory();
        } else if (item.id === 'detailGradientToggle') {
            handleDetailGradientToggle();
        } else if (item.id === 'tvDetailGradientToggle') {
            handleTvDetailGradientToggle();
        } else if (item.id === 'homeGradientToggle') {
            handleHomeGradientToggle();
        } else if (item.id === 'osdGradientToggle') {
            handleOsdGradientToggle();
        } else if (item.id === 'autoPlayNextToggle') {
            handleAutoPlayNextToggle();
        } else if (item.id === 'saveSettingsBtn') {
            handleSaveSettings();
        } else if (item.id === 'accentColorItem') {
            // Enter color picker mode
            currentMode = 'color-picker';
            colorSwatchIndex = findSelectedSwatchIndex();
            updateColorSwatchFocus();
        }
    } else if (currentMode === 'color-picker') {
        // Select the focused color swatch
        const swatch = colorSwatches[colorSwatchIndex];
        if (swatch) {
            changeAccentColor(swatch.dataset.hex, swatch.dataset.rgb, swatch.dataset.color);
            
            // Update selected state
            colorSwatches.forEach(s => s.classList.remove('selected'));
            swatch.classList.add('selected');
            
            // Exit color picker mode
            currentMode = 'settings';
            updateColorSwatchFocus();
            updateSettingsFocus();
        }
    }
}

async function handleSaveSettings() {
    const saveBtn = document.getElementById('saveSettingsBtn');
    
    console.log('Saving settings...');
    
    // Add loading state
    saveBtn.classList.add('loading');
    
    // Get values from form
    config.moviesPath = document.getElementById('moviesPathInput').value;
    config.tvShowsPath = document.getElementById('tvShowsPathInput').value;
    
    // Save config
    saveConfig();
    
    // Clear cache to force reload with new settings
    localStorage.removeItem('allMoviesCache');
    localStorage.removeItem('allMoviesCacheTimestamp');
    localStorage.removeItem('allShowsCache');
    localStorage.removeItem('allShowsCacheTimestamp');
    
    // Show success briefly
    saveBtn.classList.remove('loading');
    saveBtn.classList.add('success');
    
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Navigate to index to reload
    window.location.href = 'index.html';
}

function handleBack() {
    // Go back to index
    window.location.href = 'index.html';
}

function updateNavFocus() {
    const sideNav = document.querySelector('.side-nav');
    
    // Expand nav when in nav mode
    if (currentMode === 'nav') {
        sideNav.classList.add('expanded');
    } else {
        sideNav.classList.remove('expanded');
    }
    
    navItems.forEach((item, i) => {
        item.classList.toggle('focused', i === navIndex && currentMode === 'nav');
    });
}

function updateSettingsFocus() {
    settingsItems.forEach((item, i) => {
        const isFocused = i === settingsIndex && currentMode === 'settings';
        const wasFocused = item.classList.contains('focused');
        
        item.classList.toggle('focused', isFocused);
        
        // Add clear-history class to the Clear Watch History buttons when focused
        if (item.id === 'clearMovieWatchHistoryBtn' || item.id === 'clearTVWatchHistoryBtn') {
            item.classList.toggle('clear-history', isFocused);
        }
        
        // Restore state when navigating away from a success item
        if (wasFocused && !isFocused && item.restoreState) {
            item.restoreState();
        }
        
        // Scroll focused item into view
        if (isFocused) {
            item.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    });
}

// Incremental scan for new movies
async function handleScanNewMovies() {
    const scanBtn = document.getElementById('scanNewMoviesBtn');
    const cacheStatus = document.getElementById('movieCacheStatus');
    
    console.log('Scanning for new movies (incremental)...');
    
    // Add loading state
    scanBtn.classList.add('loading');
    cacheStatus.textContent = 'Scanning for new movies...';
    
    // Set flag for incremental update (instead of clearing cache)
    localStorage.setItem('incrementalUpdateMovies', 'true');
    
    // Wait a moment for visual feedback
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // Navigate to index to trigger incremental update
    localStorage.setItem('navigateTo', 'movies');
    window.location.href = 'index.html';
}

// Full rescan for movies (clears cache)
async function handleFullRescanMovies() {
    const rescanBtn = document.getElementById('fullRescanMoviesBtn');
    
    console.log('Full rescan of movie library...');
    
    // Add loading state
    rescanBtn.classList.add('loading');
    
    // Clear movie cache to force full rescan
    localStorage.removeItem('allMoviesCache');
    localStorage.removeItem('allMoviesCacheTimestamp');
    
    // Wait a moment for visual feedback
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // Navigate to index to trigger full rescan
    localStorage.setItem('navigateTo', 'movies');
    window.location.href = 'index.html';
}

// Incremental scan for new TV shows
async function handleScanNewTV() {
    const scanBtn = document.getElementById('scanNewTVBtn');
    const cacheStatus = document.getElementById('tvCacheStatus');
    
    console.log('Scanning for new TV shows (incremental)...');
    
    // Add loading state
    scanBtn.classList.add('loading');
    cacheStatus.textContent = 'Scanning for new TV shows...';
    
    // Set flag for incremental update (instead of clearing cache)
    localStorage.setItem('incrementalUpdateTV', 'true');
    
    // Wait a moment for visual feedback
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // Navigate to index to trigger incremental update
    localStorage.setItem('navigateTo', 'tv');
    localStorage.setItem('lastLibrary', 'tv');
    window.location.href = 'index.html';
}

// Full rescan for TV shows (clears cache)
async function handleFullRescanTV() {
    const rescanBtn = document.getElementById('fullRescanTVBtn');
    
    console.log('Full rescan of TV library...');
    
    // Add loading state
    rescanBtn.classList.add('loading');
    
    // Clear TV cache to force full rescan
    localStorage.removeItem('allShowsCache');
    localStorage.removeItem('allShowsCacheTimestamp');
    
    // Wait a moment for visual feedback
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // Navigate to index to trigger full rescan
    localStorage.setItem('navigateTo', 'tv');
    localStorage.setItem('lastLibrary', 'tv');
    window.location.href = 'index.html';
}

async function handleClearMovieWatchHistory() {
    const settingsItem = document.getElementById('clearMovieWatchHistoryBtn');
    const description = settingsItem.querySelector('.settings-item-description');
    const button = settingsItem.querySelector('.settings-button');
    
    // Store original values for restoration
    const originalDescription = description.textContent;
    const originalButtonHtml = button.innerHTML;
    
    console.log('Clearing movie watch history...');
    
    // Load watch data, filter out movie entries, save back
    const watchDataPath = path.join(__dirname, '..', 'watch-data.json');
    try {
        if (fs.existsSync(watchDataPath)) {
            const data = JSON.parse(fs.readFileSync(watchDataPath, 'utf8'));
            
            // Keep only TV show entries (paths containing '/Season ' or '\Season ')
            // AND keep special keys like _activeShows and _excludedFromContinueWatching
            const filteredData = {};
            for (const [videoPath, watchInfo] of Object.entries(data)) {
                if (videoPath.startsWith('_') || 
                    videoPath.includes('/Season ') || 
                    videoPath.includes('\\Season ')) {
                    filteredData[videoPath] = watchInfo;
                }
            }
            
            // Save filtered data back
            fs.writeFileSync(watchDataPath, JSON.stringify(filteredData, null, 2));
            console.log('Movie watch history deleted');
        }
    } catch (error) {
        console.error('Error deleting movie watch history:', error);
    }
    
    // No need to clear cache - renderer will refresh watch status from watch-data.json
    
    // Show success state
    settingsItem.classList.add('success-state');
    description.textContent = 'Movie watch history cleared!';
    button.innerHTML = '<img src="assets/icons/check.svg" class="settings-button-icon" alt=""> Success!';
    
    // Store restore function to be called when user navigates away
    settingsItem.restoreState = () => {
        settingsItem.classList.remove('success-state');
        description.textContent = originalDescription;
        button.innerHTML = originalButtonHtml;
        delete settingsItem.restoreState;
    };
}

async function handleClearTVWatchHistory() {
    const settingsItem = document.getElementById('clearTVWatchHistoryBtn');
    const description = settingsItem.querySelector('.settings-item-description');
    const button = settingsItem.querySelector('.settings-button');
    
    // Store original values for restoration
    const originalDescription = description.textContent;
    const originalButtonHtml = button.innerHTML;
    
    console.log('Clearing TV show watch history...');
    
    // Load watch data, filter out TV entries, save back
    const watchDataPath = path.join(__dirname, '..', 'watch-data.json');
    try {
        if (fs.existsSync(watchDataPath)) {
            const data = JSON.parse(fs.readFileSync(watchDataPath, 'utf8'));
            
            // Keep only movie entries (paths NOT containing '/Season ' or '\Season ')
            // Also remove _activeShows (TV continue watching tracking)
            // But keep _excludedFromContinueWatching as it may contain movies too
            const filteredData = {};
            for (const [videoPath, watchInfo] of Object.entries(data)) {
                // Skip TV episode entries
                if (videoPath.includes('/Season ') || videoPath.includes('\\Season ')) {
                    continue;
                }
                // Skip _activeShows (TV continue watching)
                if (videoPath === '_activeShows') {
                    continue;
                }
                // Keep everything else (movies and other special keys)
                filteredData[videoPath] = watchInfo;
            }
            
            // Filter _excludedFromContinueWatching to remove TV shows
            if (filteredData._excludedFromContinueWatching) {
                filteredData._excludedFromContinueWatching = filteredData._excludedFromContinueWatching.filter(
                    path => !path.includes('/Season ') && !path.includes('\\Season ')
                );
            }
            
            // Save filtered data back
            fs.writeFileSync(watchDataPath, JSON.stringify(filteredData, null, 2));
            console.log('TV show watch history deleted');
        }
    } catch (error) {
        console.error('Error deleting TV show watch history:', error);
    }
    
    // No need to clear cache - renderer will refresh watch status from watch-data.json
    
    // Show success state
    settingsItem.classList.add('success-state');
    description.textContent = 'TV show watch history cleared!';
    button.innerHTML = '<img src="assets/icons/check.svg" class="settings-button-icon" alt=""> Success!';
    
    // Store restore function to be called when user navigates away
    settingsItem.restoreState = () => {
        settingsItem.classList.remove('success-state');
        description.textContent = originalDescription;
        button.innerHTML = originalButtonHtml;
        delete settingsItem.restoreState;
    };
}

// Legacy function - kept for reference but no longer used
async function handleClearWatchHistory() {
    const clearBtn = document.getElementById('clearWatchHistoryBtn');
    const cacheStatus = document.getElementById('cacheStatus');
    
    console.log('Clearing watch history...');
    
    // Add loading state
    if (clearBtn) clearBtn.classList.add('loading');
    if (cacheStatus) cacheStatus.textContent = 'Clearing watch history...';
    
    // Delete watch-data.json file
    const watchDataPath = path.join(__dirname, '..', 'watch-data.json');
    try {
        if (fs.existsSync(watchDataPath)) {
            fs.unlinkSync(watchDataPath);
            console.log('Watch history deleted');
        }
    } catch (error) {
        console.error('Error deleting watch history:', error);
    }
    
    // Clear cached movie data so it reloads without watch status
    localStorage.removeItem('allMoviesCache');
    localStorage.removeItem('allMoviesCacheTimestamp');
    
    // Wait a moment for visual feedback
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // Navigate to index to reload
    window.location.href = 'index.html';
}

function updateCacheStatus() {
    // Update movie cache status
    const movieCacheStatus = document.getElementById('movieCacheStatus');
    const movieCacheTimestamp = localStorage.getItem('allMoviesCacheTimestamp');
    
    if (movieCacheStatus) {
        if (movieCacheTimestamp) {
            movieCacheStatus.textContent = formatCacheAge(movieCacheTimestamp);
        } else {
            movieCacheStatus.textContent = 'No movie cache found';
        }
    }
    
    // Update TV cache status
    const tvCacheStatus = document.getElementById('tvCacheStatus');
    const tvCacheTimestamp = localStorage.getItem('allShowsCacheTimestamp');
    
    if (tvCacheStatus) {
        if (tvCacheTimestamp) {
            tvCacheStatus.textContent = formatCacheAge(tvCacheTimestamp);
        } else {
            tvCacheStatus.textContent = 'No TV cache found';
        }
    }
}

function formatCacheAge(timestamp) {
    const cacheAge = Date.now() - parseInt(timestamp);
    const ageMinutes = Math.floor(cacheAge / 60000);
    const ageHours = Math.floor(ageMinutes / 60);
    const ageDays = Math.floor(ageHours / 24);
    
    if (ageDays > 0) {
        return `Last cached ${ageDays} day${ageDays > 1 ? 's' : ''} ago`;
    } else if (ageHours > 0) {
        return `Last cached ${ageHours} hour${ageHours > 1 ? 's' : ''} ago`;
    } else if (ageMinutes > 0) {
        return `Last cached ${ageMinutes} minute${ageMinutes > 1 ? 's' : ''} ago`;
    } else {
        return 'Last cached just now';
    }
}

function updateClock() {
    const now = new Date();
    const hours = now.getHours().toString().padStart(2, '0');
    const minutes = now.getMinutes().toString().padStart(2, '0');
    const timeElement = document.getElementById('topBarTime');
    if (timeElement) {
        timeElement.textContent = `${hours}:${minutes}`;
    }
}

function setupColorSwatches() {
    const swatches = document.querySelectorAll('.color-swatch');
    colorSwatches = Array.from(swatches);
    
    // Load saved accent color from localStorage
    const savedColor = localStorage.getItem('accentColor') || 'cyan';
    
    // Mark the selected swatch
    swatches.forEach(swatch => {
        if (swatch.dataset.color === savedColor) {
            swatch.classList.add('selected');
        }
        
        // Add click handler
        swatch.addEventListener('click', () => {
            changeAccentColor(swatch.dataset.hex, swatch.dataset.rgb, swatch.dataset.color);
            
            // Update selected state
            swatches.forEach(s => s.classList.remove('selected'));
            swatch.classList.add('selected');
        });
    });
}

function updateColorSwatchFocus() {
    colorSwatches.forEach((swatch, i) => {
        const isFocused = i === colorSwatchIndex && currentMode === 'color-picker';
        swatch.classList.toggle('focused-swatch', isFocused);
    });
}

function findSelectedSwatchIndex() {
    for (let i = 0; i < colorSwatches.length; i++) {
        if (colorSwatches[i].classList.contains('selected')) {
            return i;
        }
    }
    return 0; // Default to first swatch
}

function changeAccentColor(hex, rgb, colorName) {
    // Update CSS variables in the document
    document.documentElement.style.setProperty('--accent', hex);
    document.documentElement.style.setProperty('--accent-rgb', rgb);
    
    // Save to localStorage
    localStorage.setItem('accentColor', colorName);
    localStorage.setItem('accentHex', hex);
    localStorage.setItem('accentRgb', rgb);
    
    console.log(`Accent color changed to ${colorName}: ${hex}`);
}

function loadAccentColor() {
    const savedHex = localStorage.getItem('accentHex');
    const savedRgb = localStorage.getItem('accentRgb');
    
    if (savedHex && savedRgb) {
        document.documentElement.style.setProperty('--accent', savedHex);
        document.documentElement.style.setProperty('--accent-rgb', savedRgb);
        console.log(`Loaded accent color: ${savedHex}`);
    }
}

function loadGradientSettings() {
    // Load detail gradient setting (default: on)
    const detailGradient = localStorage.getItem('detailGradientEnabled');
    const detailEnabled = detailGradient === null ? true : detailGradient === 'true';
    updateDetailGradientToggle(detailEnabled);
    
    // Load TV detail gradient setting (default: on)
    const tvDetailGradient = localStorage.getItem('tvDetailGradientEnabled');
    const tvDetailEnabled = tvDetailGradient === null ? true : tvDetailGradient === 'true';
    updateTvDetailGradientToggle(tvDetailEnabled);
    
    // Load home gradient setting (default: on)
    const homeGradient = localStorage.getItem('homeGradientEnabled');
    const homeEnabled = homeGradient === null ? true : homeGradient === 'true';
    updateHomeGradientToggle(homeEnabled);
    
    // Load OSD gradient setting (default: on)
    const osdGradient = localStorage.getItem('osdGradientEnabled');
    const osdEnabled = osdGradient === null ? true : osdGradient === 'true';
    updateOsdGradientToggle(osdEnabled);
    
    // Load auto-play next episode setting (default: on)
    const autoPlayNext = localStorage.getItem('autoPlayNextEnabled');
    const autoPlayEnabled = autoPlayNext === null ? true : autoPlayNext === 'true';
    updateAutoPlayNextToggle(autoPlayEnabled);
}

function handleDetailGradientToggle() {
    const currentState = localStorage.getItem('detailGradientEnabled');
    const newState = currentState === 'true' ? false : true;
    
    localStorage.setItem('detailGradientEnabled', newState);
    updateDetailGradientToggle(newState);
    
    console.log(`Detail gradient ${newState ? 'enabled' : 'disabled'}`);
}

function handleTvDetailGradientToggle() {
    const currentState = localStorage.getItem('tvDetailGradientEnabled');
    const newState = currentState === 'true' || currentState === null ? false : true;
    
    localStorage.setItem('tvDetailGradientEnabled', newState);
    updateTvDetailGradientToggle(newState);
    
    console.log(`TV detail gradient ${newState ? 'enabled' : 'disabled'}`);
}

function handleHomeGradientToggle() {
    const currentState = localStorage.getItem('homeGradientEnabled');
    const newState = currentState === 'true' || currentState === null ? false : true;
    
    localStorage.setItem('homeGradientEnabled', newState);
    updateHomeGradientToggle(newState);
    
    console.log(`Home gradient ${newState ? 'enabled' : 'disabled'}`);
}

function handleOsdGradientToggle() {
    const currentState = localStorage.getItem('osdGradientEnabled');
    const newState = currentState === 'true' ? false : true;
    
    localStorage.setItem('osdGradientEnabled', newState);
    updateOsdGradientToggle(newState);
    
    console.log(`OSD gradient ${newState ? 'enabled' : 'disabled'}`);
}

function updateDetailGradientToggle(enabled) {
    const toggle = document.getElementById('detailGradientToggleSwitch');
    const toggleText = document.getElementById('detailGradientToggleText');
    
    if (toggle && toggleText) {
        if (enabled) {
            toggle.classList.add('active');
            toggleText.textContent = 'On';
        } else {
            toggle.classList.remove('active');
            toggleText.textContent = 'Off';
        }
    }
}

function updateTvDetailGradientToggle(enabled) {
    const toggle = document.getElementById('tvDetailGradientToggleSwitch');
    const toggleText = document.getElementById('tvDetailGradientToggleText');
    
    if (toggle && toggleText) {
        if (enabled) {
            toggle.classList.add('active');
            toggleText.textContent = 'On';
        } else {
            toggle.classList.remove('active');
            toggleText.textContent = 'Off';
        }
    }
}

function updateHomeGradientToggle(enabled) {
    const toggle = document.getElementById('homeGradientToggleSwitch');
    const toggleText = document.getElementById('homeGradientToggleText');
    
    if (toggle && toggleText) {
        if (enabled) {
            toggle.classList.add('active');
            toggleText.textContent = 'On';
        } else {
            toggle.classList.remove('active');
            toggleText.textContent = 'Off';
        }
    }
}

function updateOsdGradientToggle(enabled) {
    const toggle = document.getElementById('osdGradientToggleSwitch');
    const toggleText = document.getElementById('osdGradientToggleText');
    
    if (toggle && toggleText) {
        if (enabled) {
            toggle.classList.add('active');
            toggleText.textContent = 'On';
        } else {
            toggle.classList.remove('active');
            toggleText.textContent = 'Off';
        }
    }
}

function handleAutoPlayNextToggle() {
    const currentState = localStorage.getItem('autoPlayNextEnabled') !== 'false'; // Default true
    const newState = !currentState;
    
    localStorage.setItem('autoPlayNextEnabled', newState.toString());
    updateAutoPlayNextToggle(newState);
    
    console.log(`Auto-play next episode ${newState ? 'enabled' : 'disabled'}`);
}

function updateAutoPlayNextToggle(enabled) {
    const toggle = document.getElementById('autoPlayNextToggleSwitch');
    const toggleText = document.getElementById('autoPlayNextToggleText');
    
    if (toggle && toggleText) {
        if (enabled) {
            toggle.classList.add('active');
            toggleText.textContent = 'On';
        } else {
            toggle.classList.remove('active');
            toggleText.textContent = 'Off';
        }
    }
}
