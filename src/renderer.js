const { ipcRenderer } = require('electron');
const fs = require('fs');
const path = require('path');
const { loadMovies } = require('./movie-scanner');
const tvScanner = require('./tv-scanner');
const WatchDataManager = require('./watch-data');
const playlistManager = require('./playlist-manager');
const player = require('./player');
const ContextMenu = require('./context-menu');

// Helper function to format runtime
function formatRuntime(minutes) {
    if (!minutes || minutes === 0) return '';
    
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    
    if (hours > 0 && mins > 0) {
        return `${hours}h ${mins}m`;
    } else if (hours > 0) {
        return `${hours}h`;
    } else {
        return `${mins}m`;
    }
}

// Helper function to format aired date (YYYY-MM-DD -> "Mon DD, YYYY")
function formatAirDate(dateString) {
    if (!dateString) return '';
    
    try {
        const date = new Date(dateString);
        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const month = months[date.getMonth()];
        const day = date.getDate();
        const year = date.getFullYear();
        
        return `${month} ${day}, ${year}`;
    } catch (err) {
        return '';
    }
}

// State
let allMovies = [];
let allShows = [];
let currentLibrary = 'movies'; // Track current library view: 'movies' or 'tv'
let watchDataManager = null;
let config = {};
let currentlyPlayingVideoPath = null; // Track the video currently playing (for focus on return)

// Home screen state
let homeCarousels = []; // Array of carousel data
let currentCarouselIndex = 0; // Which carousel is focused
let currentCardIndex = 0; // Which card in the focused carousel
let carouselCardIndices = []; // Track card index for each carousel
let isHomeActive = false; // Is home screen currently showing
let homeStateBeforeDetail = null; // Saved state when leaving for detail page

// Subtitle default settings (stored in config)
const subColorOptions = ['White', 'Yellow', 'Cyan', 'Green', 'Magenta'];
const subBackOptions = ['None', 'Light', 'Medium', 'Dark'];
let settingsSubSize = 100;
let settingsSubPos = 100;
let settingsSubColorIndex = 0;
let settingsSubBackIndex = 0;
let settingsFocusedRow = -1; // -1 means not focused on settings rows

// Initialize context menu
const contextMenu = new ContextMenu();
window.contextMenu = contextMenu;

// Expose currentLibrary globally for keyboard-nav
window.currentLibrary = currentLibrary;

// Load configuration
function loadConfig() {
    try {
        const configPath = path.join(__dirname, '../config.json');
        console.log('Loading config from:', configPath);
        if (fs.existsSync(configPath)) {
            const configContent = fs.readFileSync(configPath, 'utf8');
            console.log('Config file contents:', configContent);
            config = JSON.parse(configContent);
            console.log('Parsed config:', config);
        } else {
            console.log('Config file does not exist, using defaults');
            // Default config
            config = {
                moviesPath: '',
                tvShowsPath: ''
            };
        }
        return config;
    } catch (error) {
        console.error('Error loading config:', error);
        return {};
    }
}

// Save configuration
function saveConfig() {
    try {
        const configPath = path.join(__dirname, '../config.json');
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    } catch (error) {
        console.error('Error saving config:', error);
    }
}

// Check if we should open a movie detail (returning from search page)
function checkForMovieToOpen() {
    console.log('========================================');
    console.log('INDEX: Checking for movie to open');
    console.log('========================================');
    
    const movieToOpen = localStorage.getItem('openMovieDetail');
    console.log('INDEX: localStorage openMovieDetail:', movieToOpen ? 'FOUND' : 'NOT FOUND');
    
    if (movieToOpen) {
        try {
            const movie = JSON.parse(movieToOpen);
            console.log('INDEX: Parsed movie:', {
                title: movie.metadata?.title,
                videoPath: movie.videoPath
            });
            localStorage.removeItem('openMovieDetail');
            
            // Find the movie in allMovies by video path
            const foundMovie = allMovies.find(m => m.videoPath === movie.videoPath);
            console.log('INDEX: Found movie in allMovies:', foundMovie ? 'YES' : 'NO');
            
            if (foundMovie) {
                console.log('INDEX: Opening detail for:', foundMovie.metadata.title);
                // Small delay to ensure grid is rendered
                setTimeout(() => {
                    openDetail(foundMovie, false);
                }, 100);
            } else {
                console.log('INDEX: ERROR - Movie not found in allMovies');
            }
        } catch (err) {
            console.error('INDEX: Error opening saved movie:', err);
            localStorage.removeItem('openMovieDetail');
        }
    }
}

function checkForTVShowToOpen() {
    console.log('========================================');
    console.log('INDEX: Checking for TV show to open');
    console.log('========================================');
    
    const showToOpen = localStorage.getItem('openTVShowDetail');
    console.log('INDEX: localStorage openTVShowDetail:', showToOpen ? 'FOUND' : 'NOT FOUND');
    
    if (showToOpen) {
        try {
            const show = JSON.parse(showToOpen);
            console.log('INDEX: Parsed TV show:', {
                title: show.title,
                showPath: show.showPath
            });
            localStorage.removeItem('openTVShowDetail');
            
            // Find the show in allShows by show path
            const foundShow = allShows.find(s => s.showPath === show.showPath);
            console.log('INDEX: Found TV show in allShows:', foundShow ? 'YES' : 'NO');
            
            if (foundShow) {
                console.log('INDEX: Opening detail for:', foundShow.title);
                // Small delay to ensure grid is rendered
                setTimeout(() => {
                    openTVShowDetail(foundShow);
                }, 100);
            } else {
                console.log('INDEX: ERROR - TV show not found in allShows');
            }
        } catch (err) {
            console.error('INDEX: Error opening saved TV show:', err);
            localStorage.removeItem('openTVShowDetail');
        }
    }
}

// Initialize app
async function init() {
    loadConfig();
    
    // Load saved accent color
    loadAccentColor();
    
    // Initialize watch data manager
    watchDataManager = new WatchDataManager();
    window.watchDataManager = watchDataManager; // Expose globally
    
    // Expose playlist manager globally (already initialized on require)
    window.playlistManager = playlistManager;
    
    // Check early if we're opening from search - don't show any grids
    const openingFromSearch = localStorage.getItem('openMovieDetail') || localStorage.getItem('openTVShowDetail');
    
    // Setup time display
    updateTime();
    setInterval(updateTime, 60000); // Update every minute
    
    // Setup nav expand/collapse
    setupNavigation();
    
    // Setup alphabet navigation
    setupAlphabetNav();
    
    // Check if we should navigate to a specific page (from search or other page)
    const navigateTo = localStorage.getItem('navigateTo');
    localStorage.removeItem('navigateTo'); // Clear after reading
    
    // Check for incremental update flags
    const incrementalUpdateMovies = localStorage.getItem('incrementalUpdateMovies');
    const incrementalUpdateTV = localStorage.getItem('incrementalUpdateTV');
    localStorage.removeItem('incrementalUpdateMovies');
    localStorage.removeItem('incrementalUpdateTV');
    
    // Check if we should start with a specific library
    const lastLibrary = localStorage.getItem('lastLibrary');
    
    // Load movies if path is configured
    if (config.moviesPath) {
        await loadMoviesData();
        
        // Run incremental update if requested
        if (incrementalUpdateMovies) {
            console.log('Running incremental movie update...');
            const loading = document.getElementById('loading');
            loading.style.display = 'flex';
            loading.innerHTML = '<p>Scanning for new movies...</p>';
            
            try {
                const result = await window.incrementalUpdateMovies((status) => {
                    loading.innerHTML = `<p>${status}</p>`;
                });
                console.log('Incremental update complete:', result);
                
                // Hide home screen and show movie grid
                hideHomeScreen();
                
                // Re-render grid with updated data
                const grid = document.getElementById('movieGrid');
                grid.innerHTML = '';
                renderMovieGrid(allMovies);
                grid.style.display = 'grid';
                
                // Update nav and focus
                switchToLibrary('movies');
                
                // Hide loading element AFTER switchToLibrary (in case it shows it)
                loading.style.display = 'none';
                loading.innerHTML = '';
                
                // Mark that we've handled navigation
                openingFromSearch = true; // Prevent default navigation logic
            } catch (err) {
                console.error('Incremental update error:', err);
                loading.style.display = 'none';
                loading.innerHTML = '';
            }
        }
    } else {
        // Open settings via nav
        console.log('No movies path configured');
    }
    
    // Load TV shows in background if path is configured
    // Don't await - let it load asynchronously
    if (config.tvShowsPath) {
        loadTVShowsFromConfig().then(async () => {
            console.log('TV shows loaded in background');
            
            // Run incremental TV update if requested
            if (incrementalUpdateTV) {
                console.log('Running incremental TV update...');
                const loading = document.getElementById('loading');
                loading.style.display = 'flex';
                loading.innerHTML = '<p>Scanning for new TV shows...</p>';
                
                try {
                    const result = await window.incrementalUpdateTVShows((status) => {
                        loading.innerHTML = `<p>${status}</p>`;
                    });
                    console.log('Incremental TV update complete:', result);
                    
                    // Hide home screen and show TV grid
                    hideHomeScreen();
                    
                    // Re-render grid with updated data
                    const tvGrid = document.getElementById('tvGrid');
                    tvGrid.innerHTML = '';
                    renderTVShowGrid(allShows);
                    tvGrid.style.display = 'grid';
                    
                    // Update nav and focus
                    switchToLibrary('tv');
                    
                    // Hide loading element AFTER switchToLibrary (in case it shows it)
                    loading.style.display = 'none';
                    loading.innerHTML = '';
                    
                    // Mark that we've handled navigation - skip default logic
                    return;
                } catch (err) {
                    console.error('Incremental TV update error:', err);
                    loading.style.display = 'none';
                    loading.innerHTML = '';
                }
            }
            
            // Check if we should open a TV show detail (from search page)
            checkForTVShowToOpen();
            
            // Handle navigation target after TV data loads
            if (!openingFromSearch && !isHomeActive) {
                const detailPage = document.getElementById('detailPage');
                if (!detailPage || detailPage.style.display === 'none') {
                    if (navigateTo === 'tv') {
                        // Go directly to TV grid
                        hideHomeScreen();
                        switchToLibrary('tv');
                    } else if (navigateTo === 'movies') {
                        // Go directly to movies grid
                        hideHomeScreen();
                        switchToLibrary('movies');
                    } else if (navigateTo === 'playlists') {
                        // Go directly to playlists
                        hideHomeScreen();
                        switchToLibrary('playlists');
                    } else {
                        // Default to home screen
                        showHomeScreen();
                    }
                }
            }
        }).catch(err => {
            console.error('Error loading TV shows:', err);
        });
    }
    
    // If no TV shows path, handle navigation now
    if (!config.tvShowsPath && !openingFromSearch) {
        setTimeout(() => {
            if (!isHomeActive) {
                const detailPage = document.getElementById('detailPage');
                if (!detailPage || detailPage.style.display === 'none') {
                    if (navigateTo === 'movies') {
                        hideHomeScreen();
                        switchToLibrary('movies');
                    } else if (navigateTo === 'playlists') {
                        hideHomeScreen();
                        switchToLibrary('playlists');
                    } else {
                        showHomeScreen();
                    }
                }
            }
        }, 100);
    }
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

// =====================================================
// HOME SCREEN FUNCTIONS
// =====================================================

/**
 * Show the home screen
 * @param {boolean} restoreState - If true, restore previous state instead of rebuilding
 */
function showHomeScreen(restoreState = false) {
    console.log('Showing home screen, restoreState:', restoreState);
    isHomeActive = true;
    
    // Clear any continue watching navigation flags since we've returned home
    localStorage.removeItem('cameFromHome');
    window.cameToSeasonFromHome = false;
    
    // Clear saved grid position so next detail open saves fresh position
    if (window.keyboardNav) {
        window.keyboardNav.savedDetailReturnIndex = undefined;
    }
    
    // Hide other views
    document.getElementById('movieGrid').style.display = 'none';
    document.getElementById('tvGrid').style.display = 'none';
    const detailPage = document.getElementById('detailPage');
    detailPage.style.display = 'none';
    detailPage.style.opacity = '1'; // Reset opacity in case it was set to 0
    document.getElementById('loading').style.display = 'none';
    document.querySelector('.content-wrapper').style.display = 'none';
    
    // Ensure contentArea is visible (homeView is inside it)
    document.getElementById('contentArea').style.display = 'block';
    
    // Hide alphabet nav
    const alphabetNav = document.querySelector('.alphabet-nav');
    if (alphabetNav) {
        alphabetNav.style.display = 'none';
    }
    
    // Show home view
    const homeView = document.getElementById('homeView');
    homeView.style.display = 'block';
    
    if (restoreState && homeStateBeforeDetail) {
        // Restore saved state - DON'T rebuild all carousels, keep genre carousels as they were
        console.log('Restoring home state, homeStateBeforeDetail:', homeStateBeforeDetail);
        const savedCarouselIndex = homeStateBeforeDetail.carouselIndex;
        const savedCardIndex = homeStateBeforeDetail.cardIndex;
        const savedVideoPath = homeStateBeforeDetail.videoPath;
        const savedCarouselId = homeStateBeforeDetail.carouselId;
        const savedScrollPositions = homeStateBeforeDetail.scrollPositions;
        
        console.log('Saved videoPath:', savedVideoPath);
        console.log('Saved carouselId:', savedCarouselId);
        
        let didRebuild = false;
        if (homeCarousels && homeCarousels.length > 0) {
            // Refresh Continue Watching carousel to show updated Up Next
            didRebuild = refreshContinueWatchingCarousel();
            
            if (didRebuild) {
                // Carousels were rebuilt - try to find the item by videoPath
                currentCarouselIndex = window.continueWatchingIndex || 1;
                currentCardIndex = 0;
                
                // If we have a saved videoPath and we were in continue watching, find the item
                if (savedVideoPath && savedCarouselId === 'continue-watching') {
                    const continueWatchingCarousel = homeCarousels[currentCarouselIndex];
                    if (continueWatchingCarousel && continueWatchingCarousel.items) {
                        const foundIndex = continueWatchingCarousel.items.findIndex(item => {
                            if (item.type === 'movie' && item.data) {
                                return item.data.videoPath === savedVideoPath;
                            } else if (item.type === 'tv' && item.data && item.data.episode) {
                                return item.data.episode.videoPath === savedVideoPath;
                            }
                            return false;
                        });
                        if (foundIndex !== -1) {
                            currentCardIndex = foundIndex;
                            console.log('Found item by videoPath at index:', foundIndex);
                        }
                    }
                }
            } else {
                // Refresh watch status badges on all other cards
                refreshHomeCardsWatchStatus();
                
                // Restore position
                currentCarouselIndex = savedCarouselIndex;
                
                // If we were in continue watching, find the item by videoPath (items may have reordered)
                if (savedVideoPath && savedCarouselId === 'continue-watching') {
                    const continueWatchingCarousel = homeCarousels[currentCarouselIndex];
                    if (continueWatchingCarousel && continueWatchingCarousel.items) {
                        const foundIndex = continueWatchingCarousel.items.findIndex(item => {
                            if (item.type === 'movie' && item.data) {
                                return item.data.videoPath === savedVideoPath;
                            } else if (item.type === 'tv' && item.data && item.data.episode) {
                                return item.data.episode.videoPath === savedVideoPath;
                            }
                            return false;
                        });
                        if (foundIndex !== -1) {
                            currentCardIndex = foundIndex;
                            console.log('Found item by videoPath at index:', foundIndex);
                        } else {
                            // Item not found (maybe removed from continue watching), use saved index
                            currentCardIndex = savedCardIndex;
                        }
                    } else {
                        currentCardIndex = savedCardIndex;
                    }
                } else {
                    // Not continue watching - just use saved index
                    currentCardIndex = savedCardIndex;
                }
                
                // Verify the carousel and index are still valid
                if (currentCarouselIndex >= homeCarousels.length) {
                    currentCarouselIndex = window.continueWatchingIndex || 1;
                    currentCardIndex = 0;
                } else if (homeCarousels[currentCarouselIndex] && 
                           currentCardIndex >= homeCarousels[currentCarouselIndex].items.length) {
                    currentCardIndex = Math.max(0, homeCarousels[currentCarouselIndex].items.length - 1);
                }
            }
        } else {
            // Carousels don't exist - need to rebuild
            buildHomeCarousels();
            renderHomeCarousels();
            currentCarouselIndex = window.continueWatchingIndex || 1;
            currentCardIndex = 0;
            didRebuild = true;
        }
        
        // Check if the item moved to a different position (need to scroll to it)
        const itemMoved = savedCarouselId === 'continue-watching' && currentCardIndex !== savedCardIndex;
        
        // Disable transition for instant positioning
        const track = document.getElementById('homeCarouselTrack');
        if (track) {
            track.style.transition = 'none';
        }
        
        // Update track position and focus
        updateCarouselTrackPosition();
        updateHomeFocus();
        
        // Restore scroll positions (only if we didn't rebuild and item didn't move)
        if (!didRebuild && savedScrollPositions) {
            savedScrollPositions.forEach((scrollLeft, index) => {
                const scrollContainer = document.getElementById(`homeCarouselScroll-${index}`);
                if (scrollContainer) {
                    scrollContainer.style.scrollBehavior = 'auto';
                    // If this is the continue watching carousel and item moved, scroll to the new position
                    if (itemMoved && index === currentCarouselIndex) {
                        // Scroll to the focused card
                        scrollHomeCardIntoView(currentCarouselIndex, currentCardIndex);
                    } else {
                        scrollContainer.scrollLeft = scrollLeft;
                    }
                }
            });
        }
        
        // Re-enable transitions after positioning
        setTimeout(() => {
            if (track) {
                track.style.transition = '';
            }
            if (!didRebuild && savedScrollPositions) {
                savedScrollPositions.forEach((_, index) => {
                    const scrollContainer = document.getElementById(`homeCarouselScroll-${index}`);
                    if (scrollContainer) {
                        scrollContainer.style.scrollBehavior = '';
                    }
                });
            }
            homeStateBeforeDetail = null;
        }, 50);
    } else {
        // Fresh visit - build new carousels
        buildHomeCarousels();
        console.log('Built', homeCarousels.length, 'home carousels');
        renderHomeCarousels();
        
        // Focus Continue Watching (after the top duplicate)
        currentCarouselIndex = window.continueWatchingIndex || 1;
        currentCardIndex = 0;
        
        // Disable transitions for instant positioning
        const track = document.getElementById('homeCarouselTrack');
        const scrollContainer = document.getElementById(`homeCarouselScroll-${currentCarouselIndex}`);
        
        if (track) {
            track.style.transition = 'none';
        }
        if (scrollContainer) {
            scrollContainer.style.scrollBehavior = 'auto';
        }
        
        // Reset carousel track position to show Continue Watching
        updateCarouselTrackPosition();
        
        // Reset scroll position for Continue Watching carousel
        if (scrollContainer) {
            scrollContainer.scrollLeft = 0;
        }
        
        updateHomeFocus();
        
        // Re-enable transitions after positioning
        setTimeout(() => {
            if (track) {
                track.style.transition = '';
            }
            if (scrollContainer) {
                scrollContainer.style.scrollBehavior = '';
            }
        }, 50);
    }
    
    // Update nav active state
    document.querySelectorAll('.nav-item').forEach(item => {
        item.classList.remove('nav-item-active');
        if (item.dataset.page === 'home') {
            item.classList.add('nav-item-active');
        }
    });
}

/**
 * Hide the home screen
 */
function hideHomeScreen() {
    isHomeActive = false;
    document.getElementById('homeView').style.display = 'none';
    document.querySelector('.content-wrapper').style.display = 'flex';
    
    // Show alphabet nav
    const alphabetNav = document.querySelector('.alphabet-nav');
    if (alphabetNav) {
        alphabetNav.style.display = 'flex';
    }
}

/**
 * Build the home carousels data
 */
function buildHomeCarousels() {
    homeCarousels = [];
    carouselCardIndices = []; // Reset card indices
    
    // Build Continue Watching
    const continueWatchingItems = buildContinueWatchingCarousel();
    
    // Build Random Movies
    const randomMovies = buildRandomMoviesCarousel();
    
    // Build Genre carousels
    const genres = [
        'Action', 'Adventure', 'Animation', 'Comedy', 'Crime', 
        'Documentary', 'Drama', 'Family', 'Fantasy', 'History', 
        'Horror', 'Music', 'Mystery', 'Romance', 'Science Fiction', 
        'Thriller', 'War', 'Western'
    ];
    
    const genreCarousels = [];
    for (const genre of genres) {
        const genreMovies = buildGenreCarousel(genre);
        if (genreMovies.length > 0) {
            genreCarousels.push({
                id: `genre-${genre.toLowerCase().replace(/\s+/g, '-')}`,
                title: genre,
                items: genreMovies
            });
        }
    }
    
    // Shuffle the genre carousels
    for (let i = genreCarousels.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [genreCarousels[i], genreCarousels[j]] = [genreCarousels[j], genreCarousels[i]];
    }
    
    // Get the last genre carousel for the top duplicate
    const lastGenreCarousel = genreCarousels.length > 0 ? genreCarousels[genreCarousels.length - 1] : null;
    
    // 1. Add duplicate of last genre at the TOP for upward looping
    if (lastGenreCarousel) {
        homeCarousels.push({
            id: `${lastGenreCarousel.id}-loop-top`,
            title: lastGenreCarousel.title,
            items: lastGenreCarousel.items,
            isLoopDuplicateTop: true
        });
        carouselCardIndices.push(0);
    }
    
    // 2. Continue Watching carousel (if items exist)
    if (continueWatchingItems.length > 0) {
        homeCarousels.push({
            id: 'continue-watching',
            title: 'Continue Watching',
            items: continueWatchingItems
        });
        carouselCardIndices.push(0);
    }
    
    // 3. Random Movies carousel
    if (randomMovies.length > 0) {
        homeCarousels.push({
            id: 'random-movies',
            title: 'Random Movies',
            items: randomMovies
        });
        carouselCardIndices.push(0);
    }
    
    // 4. Add shuffled genre carousels
    for (const carousel of genreCarousels) {
        homeCarousels.push(carousel);
        carouselCardIndices.push(0);
    }
    
    // 5. Add duplicate at the END for downward looping
    // Use Continue Watching if it exists, otherwise use Random Movies
    if (continueWatchingItems.length > 0) {
        homeCarousels.push({
            id: 'continue-watching-loop',
            title: 'Continue Watching',
            items: continueWatchingItems,
            isLoopDuplicateBottom: true
        });
        carouselCardIndices.push(0);
    } else if (randomMovies.length > 0) {
        // No Continue Watching - use Random Movies as the loop point
        homeCarousels.push({
            id: 'random-movies-loop',
            title: 'Random Movies',
            items: randomMovies,
            isLoopDuplicateBottom: true
        });
        carouselCardIndices.push(0);
    }
    
    // Track where the first real content carousel is (after the top duplicate)
    // This is Continue Watching if it exists, otherwise Random Movies
    window.continueWatchingIndex = lastGenreCarousel ? 1 : 0;
    window.firstContentIndex = window.continueWatchingIndex; // Alias for clarity
    window.hasContinueWatching = continueWatchingItems.length > 0;
    
    // Track where the last real genre carousel is
    window.lastGenreIndex = homeCarousels.length - 2; // Before the bottom duplicate
    
    console.log('Built', homeCarousels.length, 'home carousels, first content at index', window.continueWatchingIndex, 'hasContinueWatching:', window.hasContinueWatching);
}

/**
 * Build Continue Watching carousel items
 */
function buildContinueWatchingCarousel() {
    const continueItems = watchDataManager.getContinueWatchingItems();
    console.log('Continue watching items from watch data:', continueItems.length);
    const items = [];
    
    for (const item of continueItems) {
        if (item.type === 'movie') {
            // Find the movie
            const movie = allMovies.find(m => m.videoPath === item.videoPath);
            if (movie) {
                items.push({
                    type: 'movie',
                    data: movie,
                    title: movie.metadata.title,
                    year: movie.metadata.year,
                    posterPath: movie.posterPath,
                    fanartPath: movie.fanartPath,
                    progress: item.percentage,
                    position: item.position,
                    duration: item.duration
                });
            } else {
                console.log('Movie not found for continue watching:', item.videoPath);
            }
        } else {
            // Find the TV episode
            let episodeFound = false;
            for (const show of allShows) {
                if (episodeFound) break;
                for (const season of show.seasons) {
                    const episode = season.episodes.find(ep => ep.videoPath === item.videoPath);
                    if (episode) {
                        items.push({
                            type: 'tv',
                            data: { show, season, episode },
                            title: show.title,
                            year: show.year,
                            posterPath: show.posterPath,
                            fanartPath: show.fanartPath,
                            episodeTitle: episode.title,
                            seasonNumber: season.number,
                            episodeNumber: episode.episode,
                            progress: item.percentage,
                            position: item.position,
                            duration: item.duration,
                            isUpNext: item.isUpNext || false // Flag for "up next" episodes
                        });
                        episodeFound = true;
                        break;
                    }
                }
            }
            if (!episodeFound) {
                console.log('TV episode not found for continue watching:', item.videoPath, 'isUpNext:', item.isUpNext);
            }
        }
    }
    
    console.log('Built continue watching items:', items.length);
    return items;
}

/**
 * Build Random Movies carousel
 */
function buildRandomMoviesCarousel() {
    if (allMovies.length === 0) return [];
    
    // Shuffle and take up to 20
    const shuffled = [...allMovies].sort(() => Math.random() - 0.5);
    const selected = shuffled.slice(0, 20);
    
    return selected.map(movie => ({
        type: 'movie',
        data: movie,
        title: movie.metadata.title,
        year: movie.metadata.year,
        posterPath: movie.posterPath,
        fanartPath: movie.fanartPath
    }));
}

/**
 * Build genre carousel
 */
function buildGenreCarousel(genre) {
    const genreMovies = allMovies.filter(movie => {
        const genres = movie.metadata.genre || [];
        return genres.some(g => g.toLowerCase() === genre.toLowerCase());
    });
    
    console.log(`Genre carousel "${genre}": found ${genreMovies.length} movies`);
    
    // Shuffle and take up to 20
    const shuffled = [...genreMovies].sort(() => Math.random() - 0.5);
    const selected = shuffled.slice(0, 20);
    
    return selected.map(movie => ({
        type: 'movie',
        data: movie,
        title: movie.metadata.title,
        year: movie.metadata.year,
        posterPath: movie.posterPath,
        fanartPath: movie.fanartPath
    }));
}

/**
 * Render home carousels
 */
function renderHomeCarousels() {
    const track = document.getElementById('homeCarouselTrack');
    track.innerHTML = '';
    
    homeCarousels.forEach((carousel, index) => {
        const carouselEl = document.createElement('div');
        carouselEl.className = 'home-carousel';
        carouselEl.dataset.carouselIndex = index;
        
        // Title
        const titleEl = document.createElement('h3');
        titleEl.className = 'home-carousel-title';
        titleEl.textContent = carousel.title;
        carouselEl.appendChild(titleEl);
        
        // Scroll container
        const scrollEl = document.createElement('div');
        scrollEl.className = 'home-carousel-scroll';
        scrollEl.id = `homeCarouselScroll-${index}`;
        
        // Grid
        const gridEl = document.createElement('div');
        gridEl.className = 'home-carousel-grid';
        gridEl.id = `homeCarouselGrid-${index}`;
        
        // Cards
        carousel.items.forEach((item, cardIndex) => {
            const card = createHomeCard(item, index, cardIndex);
            gridEl.appendChild(card);
        });
        
        scrollEl.appendChild(gridEl);
        carouselEl.appendChild(scrollEl);
        track.appendChild(carouselEl);
    });
    
    // Position track to show first carousel
    updateCarouselTrackPosition();
}

/**
 * Refresh watch status on home cards without re-rendering
 */
function refreshHomeCardsWatchStatus() {
    if (!watchDataManager) return;
    
    const homeCards = document.querySelectorAll('.home-card');
    homeCards.forEach(card => {
        const type = card.dataset.type;
        const videoPath = card.dataset.videoPath;
        if (!videoPath) return;
        
        const imgContainer = card.querySelector('.home-card-image-container');
        if (!imgContainer) return;
        
        // Remove old badge and progress bar
        const oldBadge = imgContainer.querySelector('.watched-badge');
        const oldProgress = imgContainer.querySelector('.progress-bar');
        const oldUpNext = imgContainer.querySelector('.up-next-badge');
        if (oldBadge) oldBadge.remove();
        if (oldProgress) oldProgress.remove();
        if (oldUpNext) oldUpNext.remove();
        
        const ws = watchDataManager.getWatchStatus(videoPath);
        const threshold = type === 'tv' ? 300 : 600;
        
        // Add watched badge if watched
        if (ws.watched) {
            const badge = document.createElement('div');
            badge.className = 'watched-badge';
            badge.innerHTML = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M12 24C15.1826 24 18.2348 22.7357 20.4853 20.4853C22.7357 18.2348 24 15.1826 24 12C24 8.8174 22.7357 5.76516 20.4853 3.51472C18.2348 1.26428 15.1826 0 12 0C8.8174 0 5.76516 1.26428 3.51472 3.51472C1.26428 5.76516 0 8.8174 0 12C0 15.1826 1.26428 18.2348 3.51472 20.4853C5.76516 22.7357 8.8174 24 12 24ZM17.2969 9.79688L11.2969 15.7969C10.8563 16.2375 10.1438 16.2375 9.70781 15.7969L6.70781 12.7969C6.26719 12.3563 6.26719 11.6438 6.70781 11.2078C7.14844 10.7719 7.86094 10.7672 8.29688 11.2078L10.5 13.4109L15.7031 8.20312C16.1437 7.7625 16.8562 7.7625 17.2922 8.20312C17.7281 8.64375 17.7328 9.35625 17.2922 9.79219L17.2969 9.79688Z" fill="white"/>
            </svg>`;
            imgContainer.appendChild(badge);
        }
        
        // Add progress bar if applicable
        const timeRemaining = ws.duration - ws.position;
        if (ws.position >= threshold && timeRemaining > threshold) {
            const progressBar = document.createElement('div');
            progressBar.className = 'progress-bar';
            const progressFill = document.createElement('div');
            progressFill.className = 'progress-bar-fill';
            progressFill.style.width = `${Math.min(ws.percentage, 100)}%`;
            progressBar.appendChild(progressFill);
            imgContainer.appendChild(progressBar);
        }
        
        // Check if this is an "up next" item (no progress, not watched, but in active shows)
        if (type === 'tv' && !ws.watched && ws.position === 0) {
            const activeShows = watchDataManager.watchData._activeShows || {};
            for (const [showPath, showData] of Object.entries(activeShows)) {
                if (showData.nextEpisodePath === videoPath) {
                    const upNextBadge = document.createElement('div');
                    upNextBadge.className = 'up-next-badge';
                    upNextBadge.textContent = 'UP NEXT';
                    imgContainer.appendChild(upNextBadge);
                    break;
                }
            }
        }
    });
}

/**
 * Refresh only the Continue Watching carousel (and its duplicates)
 * This updates the items without rebuilding genre carousels
 */
function refreshContinueWatchingCarousel() {
    if (!homeCarousels || homeCarousels.length === 0) return false;
    
    // Build fresh Continue Watching items
    const continueWatchingItems = buildContinueWatchingCarousel();
    
    // Check if Continue Watching carousel exists
    const hasCWCarousel = homeCarousels.some(c => c.id === 'continue-watching');
    const hadCWBefore = window.hasContinueWatching;
    const hasCWNow = continueWatchingItems.length > 0;
    
    // If CW status changed (didn't have it before but have now, or vice versa), rebuild everything
    if (hasCWNow !== hadCWBefore || hasCWNow !== hasCWCarousel) {
        console.log('Continue Watching status changed - rebuilding carousels');
        buildHomeCarousels();
        renderHomeCarousels();
        return true; // Signal that we rebuilt
    }
    
    // If no CW items and no CW carousel, nothing to do
    if (!hasCWNow && !hasCWCarousel) {
        console.log('No Continue Watching items and no carousel - nothing to refresh');
        return false;
    }
    
    // Find and update Continue Watching carousels (main and duplicates)
    const cwIndex = window.continueWatchingIndex || 1;
    
    // Update the main Continue Watching carousel
    if (homeCarousels[cwIndex] && homeCarousels[cwIndex].id === 'continue-watching') {
        homeCarousels[cwIndex].items = continueWatchingItems;
    }
    
    // Update the bottom duplicate
    const bottomDupeIndex = homeCarousels.findIndex(c => c.id === 'continue-watching-loop');
    if (bottomDupeIndex >= 0) {
        homeCarousels[bottomDupeIndex].items = continueWatchingItems;
    }
    
    // Re-render just those carousels in the DOM
    const renderCarouselAtIndex = (index) => {
        const carousel = homeCarousels[index];
        if (!carousel) return;
        
        const grid = document.getElementById(`homeCarouselGrid-${index}`);
        if (!grid) return;
        
        // Clear existing cards
        grid.innerHTML = '';
        
        // Add new cards
        carousel.items.forEach((item, cardIdx) => {
            const card = createHomeCard(item, index, cardIdx);
            grid.appendChild(card);
        });
    };
    
    renderCarouselAtIndex(cwIndex);
    if (bottomDupeIndex >= 0) {
        renderCarouselAtIndex(bottomDupeIndex);
    }
    
    // Reset card indices for continue watching if current index is out of bounds
    if (carouselCardIndices[cwIndex] >= continueWatchingItems.length) {
        carouselCardIndices[cwIndex] = Math.max(0, continueWatchingItems.length - 1);
    }
    if (bottomDupeIndex >= 0 && carouselCardIndices[bottomDupeIndex] >= continueWatchingItems.length) {
        carouselCardIndices[bottomDupeIndex] = Math.max(0, continueWatchingItems.length - 1);
    }
    
    console.log('Refreshed Continue Watching carousel with', continueWatchingItems.length, 'items');
    return false;
}

/**
 * Create a home card element
 */
function createHomeCard(item, carouselIndex, cardIndex) {
    const card = document.createElement('div');
    card.className = 'home-card';
    card.dataset.carouselIndex = carouselIndex;
    card.dataset.cardIndex = cardIndex;
    card.dataset.type = item.type;
    
    // Store videoPath for watch status updates
    if (item.type === 'movie' && item.data) {
        card.dataset.videoPath = item.data.videoPath;
    } else if (item.type === 'tv' && item.data && item.data.episode) {
        card.dataset.videoPath = item.data.episode.videoPath;
    }
    
    // Image container
    const imgContainer = document.createElement('div');
    imgContainer.className = 'home-card-image-container';
    
    const outerStroke = document.createElement('div');
    outerStroke.className = 'home-card-outer-stroke';
    
    const innerStroke = document.createElement('div');
    innerStroke.className = 'home-card-inner-stroke';
    
    const img = document.createElement('img');
    img.className = 'home-card-image';
    if (item.posterPath && fs.existsSync(item.posterPath)) {
        img.src = `file://${item.posterPath}`;
    } else {
        img.className = 'home-card-placeholder';
    }
    img.alt = item.title;
    
    innerStroke.appendChild(img);
    outerStroke.appendChild(innerStroke);
    imgContainer.appendChild(outerStroke);
    
    // Progress bar (for Continue Watching)
    // Show if position > 0 and there's meaningful progress
    if (item.progress && item.progress > 0 && item.position && item.duration) {
        const timeRemaining = item.duration - item.position;
        // TV shows use 5 min threshold, movies use 10 min
        const threshold = item.type === 'tv' ? 300 : 600;
        // Show progress bar if watched past threshold AND threshold remaining
        if (item.position >= threshold && timeRemaining > threshold) {
            const progressBar = document.createElement('div');
            progressBar.className = 'progress-bar';
            const progressFill = document.createElement('div');
            progressFill.className = 'progress-bar-fill';
            progressFill.style.width = `${Math.min(item.progress, 100)}%`;
            progressBar.appendChild(progressFill);
            imgContainer.appendChild(progressBar);
        }
    }
    
    // UP NEXT badge for episodes that haven't been started yet
    if (item.isUpNext) {
        const upNextBadge = document.createElement('div');
        upNextBadge.className = 'up-next-badge';
        upNextBadge.textContent = 'UP NEXT';
        imgContainer.appendChild(upNextBadge);
    }
    
    card.appendChild(imgContainer);
    
    // Info
    const info = document.createElement('div');
    info.className = 'home-card-info';
    
    const title = document.createElement('div');
    title.className = 'home-card-title';
    title.textContent = item.title;
    info.appendChild(title);
    
    const year = document.createElement('div');
    year.className = 'home-card-year';
    year.textContent = item.year || '';
    info.appendChild(year);
    
    card.appendChild(info);
    
    // Click handler
    card.onclick = () => handleHomeCardClick(item);
    
    return card;
}

/**
 * Update which card is focused and update info section
 */
function updateHomeFocus() {
    // Remove focus from all cards
    document.querySelectorAll('.home-card').forEach(card => {
        card.classList.remove('focused');
    });
    
    // Add focus to current card
    const currentCarousel = homeCarousels[currentCarouselIndex];
    if (!currentCarousel) return;
    
    const grid = document.getElementById(`homeCarouselGrid-${currentCarouselIndex}`);
    if (!grid) return;
    
    const cards = grid.querySelectorAll('.home-card');
    if (cards[currentCardIndex]) {
        cards[currentCardIndex].classList.add('focused');
        scrollHomeCardIntoView(currentCarouselIndex, currentCardIndex);
    }
    
    // Update info section
    const item = currentCarousel.items[currentCardIndex];
    if (item) {
        updateHomeInfoSection(item);
    }
}

/**
 * Update the info section with item data
 */
function updateHomeInfoSection(item) {
    const titleEl = document.getElementById('homeTitle');
    const subtitleEl = document.getElementById('homeSubtitle');
    const metaEl = document.getElementById('homeMeta');
    const plotEl = document.getElementById('homePlot');
    const fanartEl = document.getElementById('homeFanart');
    const accentEl = document.getElementById('homeFanartAccent');
    
    if (item.type === 'movie') {
        const movie = item.data;
        const metadata = movie.metadata;
        
        titleEl.textContent = metadata.title || '';
        subtitleEl.textContent = ''; // No tagline for movies on home screen
        
        // Build meta
        let metaHTML = '';
        const metaItems = [];
        if (metadata.year) metaItems.push(`<span>${metadata.year}</span>`);
        if (metadata.runtime) metaItems.push(`<span>${formatRuntime(metadata.runtime)}</span>`);
        if (metadata.mpaa) metaItems.push(`<span>${metadata.mpaa}</span>`);
        if (metadata.rating) metaItems.push(`<span>IMDb ${metadata.rating.toFixed(1)}</span>`);
        
        // End time (accounting for watch progress)
        if (metadata.runtime) {
            let remainingMinutes = metadata.runtime;
            // Subtract watch progress if exists (even for watched movies)
            if (movie.watchStatus && movie.watchStatus.position > 0) {
                const watchedMinutes = Math.floor(movie.watchStatus.position / 60);
                remainingMinutes = Math.max(0, metadata.runtime - watchedMinutes);
            }
            const now = new Date();
            const endTime = new Date(now.getTime() + remainingMinutes * 60000);
            const hours = endTime.getHours().toString().padStart(2, '0');
            const mins = endTime.getMinutes().toString().padStart(2, '0');
            metaItems.push(`<span>Ends at ${hours}:${mins}</span>`);
        }
        
        metaEl.innerHTML = metaItems.join('<div class="detail-meta-divider"></div>');
        plotEl.textContent = metadata.plot || '';
        
        // Update fanart
        if (movie.fanartPath && fs.existsSync(movie.fanartPath)) {
            fanartEl.style.backgroundImage = `url('file://${movie.fanartPath.replace(/'/g, "\\'")}')`;
        } else {
            fanartEl.style.backgroundImage = 'none';
        }
        
        // Load accent color from accentcolor.txt
        let accentColor = '#39ddd8';
        if (movie.videoPath) {
            const movieDir = path.dirname(movie.videoPath);
            const accentColorFile = path.join(movieDir, 'accentcolor.txt');
            if (fs.existsSync(accentColorFile)) {
                try {
                    accentColor = fs.readFileSync(accentColorFile, 'utf8').trim();
                } catch (err) {
                    console.error('Error reading accentcolor.txt:', err);
                }
            }
        }
        
        // Update accent gradient
        const homeGradientEnabled = localStorage.getItem('homeGradientEnabled') !== 'false';
        if (homeGradientEnabled) {
            accentEl.style.background = `linear-gradient(to top, ${accentColor}33 0%, transparent 50%)`;
        } else {
            accentEl.style.background = 'none';
        }
        
    } else if (item.type === 'tv') {
        const { show, season, episode } = item.data;
        
        titleEl.textContent = show.title || '';
        subtitleEl.textContent = episode.title || ''; // Episode title for TV shows
        
        // Build meta for TV
        const metaItems = [];
        metaItems.push(`<span>S${season.number.toString().padStart(2, '0')} E${episode.episode.toString().padStart(2, '0')}</span>`);
        if (episode.aired) metaItems.push(`<span>${formatAirDate(episode.aired)}</span>`);
        if (episode.runtime) metaItems.push(`<span>${formatRuntime(episode.runtime)}</span>`);
        if (episode.contentRating) metaItems.push(`<span>${episode.contentRating}</span>`);
        if (episode.rating) metaItems.push(`<span>IMDb ${episode.rating}</span>`);
        
        // End time (accounting for watch progress)
        if (episode.runtime) {
            let remainingMinutes = episode.runtime;
            // Subtract watch progress if exists (even for watched episodes)
            if (episode.watchStatus && episode.watchStatus.position > 0) {
                const watchedMinutes = Math.floor(episode.watchStatus.position / 60);
                remainingMinutes = Math.max(0, episode.runtime - watchedMinutes);
            } else if (window.watchDataManager && episode.videoPath) {
                // Fallback: check watchDataManager directly
                const ws = window.watchDataManager.getWatchStatus(episode.videoPath);
                if (ws && ws.position > 0) {
                    const watchedMinutes = Math.floor(ws.position / 60);
                    remainingMinutes = Math.max(0, episode.runtime - watchedMinutes);
                }
            }
            const now = new Date();
            const endTime = new Date(now.getTime() + remainingMinutes * 60000);
            const hours = endTime.getHours().toString().padStart(2, '0');
            const mins = endTime.getMinutes().toString().padStart(2, '0');
            metaItems.push(`<span>Ends at ${hours}:${mins}</span>`);
        }
        
        metaEl.innerHTML = metaItems.join('<div class="detail-meta-divider"></div>');
        plotEl.textContent = episode.plot || '';
        
        // Find fanart from show directory
        let fanartPath = '';
        let accentColor = '#39ddd8';
        
        if (show.showPath) {
            const fanartVariations = ['fanart.jpg', 'Fanart.jpg', 'FANART.jpg', 'fanart.JPG'];
            for (const filename of fanartVariations) {
                const fanartFile = path.join(show.showPath, filename);
                if (fs.existsSync(fanartFile)) {
                    fanartPath = fanartFile;
                    break;
                }
            }
            
            // Check for accent color
            const accentColorFile = path.join(show.showPath, 'accentcolor.txt');
            if (fs.existsSync(accentColorFile)) {
                try {
                    accentColor = fs.readFileSync(accentColorFile, 'utf8').trim();
                } catch (err) {
                    console.error('Error reading accentcolor.txt:', err);
                }
            }
        }
        
        // Update fanart
        if (fanartPath) {
            fanartEl.style.backgroundImage = `url('file://${fanartPath.replace(/'/g, "\\'")}')`;
        } else {
            fanartEl.style.backgroundImage = 'none';
        }
        
        // Update accent gradient
        const homeGradientEnabled = localStorage.getItem('homeGradientEnabled') !== 'false';
        if (homeGradientEnabled) {
            accentEl.style.background = `linear-gradient(to top, ${accentColor}33 0%, transparent 50%)`;
        } else {
            accentEl.style.background = 'none';
        }
    }
}

/**
 * Update carousel track position for track-style navigation
 */
function updateCarouselTrackPosition() {
    const track = document.getElementById('homeCarouselTrack');
    if (!track) return;
    
    // Calculate the offset to show current carousel at bottom
    // Each carousel has some height, we translate to show the current one
    const carousels = track.querySelectorAll('.home-carousel');
    let offset = 0;
    
    for (let i = 0; i < currentCarouselIndex; i++) {
        if (carousels[i]) {
            offset += carousels[i].offsetHeight;
        }
    }
    
    track.style.transform = `translateY(-${offset}px)`;
}

/**
 * Scroll a card into view within its carousel
 */
function scrollHomeCardIntoView(carouselIndex, cardIndex) {
    const scrollContainer = document.getElementById(`homeCarouselScroll-${carouselIndex}`);
    const grid = document.getElementById(`homeCarouselGrid-${carouselIndex}`);
    if (!scrollContainer || !grid) return;
    
    const cards = grid.querySelectorAll('.home-card');
    const card = cards[cardIndex];
    if (!card) return;
    
    // Use smooth scroll for navigation (CSS has scroll-behavior: smooth)
    if (cardIndex === 0) {
        scrollContainer.scrollLeft = 0;
    } else {
        const cardWidth = card.offsetWidth;
        const gap = window.innerHeight * 0.0185; // 20px
        const peekAmount = (cardWidth / 4) + gap;
        const cardOffset = card.offsetLeft - grid.offsetLeft;
        scrollContainer.scrollLeft = cardOffset - peekAmount;
    }
}

/**
 * Handle click/enter on home card
 */
function handleHomeCardClick(item) {
    // Save current state so we can restore on return
    const scrollPositions = [];
    homeCarousels.forEach((_, index) => {
        const scrollContainer = document.getElementById(`homeCarouselScroll-${index}`);
        scrollPositions.push(scrollContainer ? scrollContainer.scrollLeft : 0);
    });
    
    // Get the videoPath of the clicked item to find it again after returning
    let videoPath = null;
    if (item.type === 'movie' && item.data) {
        videoPath = item.data.videoPath;
    } else if (item.type === 'tv' && item.data && item.data.episode) {
        videoPath = item.data.episode.videoPath;
    }
    
    homeStateBeforeDetail = {
        carouselIndex: currentCarouselIndex,
        cardIndex: currentCardIndex,
        videoPath: videoPath, // Save videoPath to find item after reordering
        carouselId: homeCarousels[currentCarouselIndex] ? homeCarousels[currentCarouselIndex].id : null,
        scrollPositions: scrollPositions
    };
    console.log('Saved home state:', homeStateBeforeDetail);
    
    // Set flag so we return to home when closing detail
    localStorage.setItem('cameFromHome', 'true');
    
    if (item.type === 'movie') {
        // Go to movie detail
        hideHomeScreen();
        openDetail(item.data, false);
    } else if (item.type === 'tv') {
        // Go to season detail with episode focused
        hideHomeScreen();
        const { show, season, episode } = item.data;
        openSeasonDetailWithEpisode(show, season, episode);
    }
}

/**
 * Open season detail page with a specific episode focused
 */
function openSeasonDetailWithEpisode(show, season, episode) {
    console.log('Opening season detail with episode:', show.title, 'S' + season.number, 'E' + episode.episode);
    
    // Store the episode index to focus after page renders
    window.focusEpisodeIndex = episode.episode - 1; // 0-based index
    
    // Mark that we came directly to season detail from home (for back navigation)
    window.cameToSeasonFromHome = true;
    
    // Save current show for reference
    window.currentShow = show;
    window.currentSeason = season;
    
    // Hide detail page initially to prevent flash
    const detailPage = document.getElementById('detailPage');
    if (detailPage) {
        detailPage.style.opacity = '0';
    }
    
    // Open the season detail directly
    openSeasonDetail(show, season.number);
    
    // Wait for render then focus the episode
    setTimeout(() => {
        if (window.keyboardNav) {
            // Get scroll container and disable smooth scrolling
            const scrollContainer = document.querySelector('.season-episodes-scroll');
            if (scrollContainer) {
                scrollContainer.style.scrollBehavior = 'auto';
            }
            
            // Update items to episode cards
            window.keyboardNav.updateItems('.season-episode-card');
            window.keyboardNav.currentIndex = window.focusEpisodeIndex;
            window.keyboardNav.detailSubMode = 'episodes';
            window.keyboardNav.focusItem();
            
            // Scroll the episode card into view (flush left) - instant
            window.keyboardNav.scrollCarouselCardIntoView();
            
            // Update episode info display
            const episodeCard = document.querySelector(`.season-episode-card[data-episode-index="${window.focusEpisodeIndex}"]`);
            if (episodeCard) {
                const episodeDataString = episodeCard.dataset.episodeData
                    .replace(/&quot;/g, '"')
                    .replace(/&#39;/g, "'");
                const episodeData = JSON.parse(episodeDataString);
                
                // Update title, meta, plot
                const titleEl = document.getElementById('seasonEpisodeTitle');
                if (titleEl) titleEl.textContent = episodeData.title;
                
                // Update episode info section
                if (window.keyboardNav && window.keyboardNav.updateSeasonEpisodeInfo) {
                    window.keyboardNav.updateSeasonEpisodeInfo();
                }
            }
            
            // Now show the detail page and re-enable smooth scrolling
            requestAnimationFrame(() => {
                if (detailPage) {
                    detailPage.style.opacity = '1';
                }
                if (scrollContainer) {
                    scrollContainer.style.scrollBehavior = '';
                }
            });
        }
        window.focusEpisodeIndex = null;
    }, 100);
}

/**
 * Handle keyboard navigation on home screen
 */
function handleHomeKeydown(e) {
    if (!isHomeActive) return false;
    
    // Check if context menu is active - handle its keys first
    if (window.contextMenu && window.contextMenu.isActive()) {
        switch (e.key) {
            case 'ArrowUp':
                window.contextMenu.handleArrowUp();
                return true;
            case 'ArrowDown':
                window.contextMenu.handleArrowDown();
                return true;
            case 'Enter':
                window.contextMenu.handleEnter();
                return true;
            case 'Escape':
            case 'o':
            case 'O':
                window.contextMenu.handleBack();
                return true;
        }
        return false;
    }
    
    // Check if nav is expanded (in nav mode)
    const sideNav = document.querySelector('.side-nav');
    const navExpanded = sideNav && sideNav.classList.contains('expanded');
    
    if (navExpanded) {
        // Let keyboard-nav handle nav mode
        return false;
    }
    
    const currentCarousel = homeCarousels[currentCarouselIndex];
    if (!currentCarousel) return false;
    
    switch (e.key) {
        case 'o':
        case 'O':
            // Open context menu
            if (window.showHomeContextMenu) {
                window.showHomeContextMenu();
            }
            return true;
            
        case 'ArrowLeft':
            if (currentCardIndex > 0) {
                currentCardIndex--;
                carouselCardIndices[currentCarouselIndex] = currentCardIndex;
                updateHomeFocus();
            } else {
                // At first card, enter nav mode
                enterHomeNavMode();
            }
            return true;
            
        case 'ArrowRight':
            if (currentCardIndex < currentCarousel.items.length - 1) {
                currentCardIndex++;
                carouselCardIndices[currentCarouselIndex] = currentCardIndex;
                updateHomeFocus();
            }
            return true;
            
        case 'ArrowUp':
            // Save current card index
            carouselCardIndices[currentCarouselIndex] = currentCardIndex;
            
            // Check if we're at Continue Watching (the real one, after top duplicate)
            const continueWatchingIdx = window.continueWatchingIndex || 1;
            
            if (currentCarouselIndex === continueWatchingIdx) {
                // At Continue Watching - animate up to the top duplicate (last genre copy)
                currentCarouselIndex--;
                
                const prevCarousel = homeCarousels[currentCarouselIndex];
                if (prevCarousel && prevCarousel.isLoopDuplicateTop) {
                    // Get card index from the real last genre carousel
                    const lastGenreIdx = window.lastGenreIndex;
                    currentCardIndex = carouselCardIndices[lastGenreIdx] || 0;
                    
                    // Remove focus from Continue Watching
                    const cwGrid = document.getElementById(`homeCarouselGrid-${continueWatchingIdx}`);
                    if (cwGrid) {
                        cwGrid.querySelectorAll('.home-card').forEach(card => {
                            card.classList.remove('focused');
                        });
                    }
                    
                    // Get scroll containers
                    const realLastGenreScroll = document.getElementById(`homeCarouselScroll-${lastGenreIdx}`);
                    const topDupeScroll = document.getElementById(`homeCarouselScroll-${currentCarouselIndex}`);
                    
                    // BEFORE animating: sync top duplicate's scroll position to match target card
                    // and disable smooth scroll on duplicate
                    if (topDupeScroll) {
                        topDupeScroll.style.scrollBehavior = 'auto';
                        // Calculate scroll position for the target card
                        const topDupeGrid = document.getElementById(`homeCarouselGrid-${currentCarouselIndex}`);
                        if (topDupeGrid) {
                            const cards = topDupeGrid.querySelectorAll('.home-card');
                            const card = cards[currentCardIndex];
                            if (card && currentCardIndex > 0) {
                                const cardWidth = card.offsetWidth;
                                const gap = window.innerHeight * 0.0185;
                                const peekAmount = (cardWidth / 4) + gap;
                                const cardOffset = card.offsetLeft - topDupeGrid.offsetLeft;
                                topDupeScroll.scrollLeft = cardOffset - peekAmount;
                            } else {
                                topDupeScroll.scrollLeft = 0;
                            }
                        }
                    }
                    
                    // Add focus to BOTH the top duplicate AND the real last genre
                    const realLastGenreGrid = document.getElementById(`homeCarouselGrid-${lastGenreIdx}`);
                    const topDupeGrid = document.getElementById(`homeCarouselGrid-${currentCarouselIndex}`);
                    
                    if (realLastGenreGrid) {
                        const realCards = realLastGenreGrid.querySelectorAll('.home-card');
                        if (realCards[currentCardIndex]) {
                            realCards[currentCardIndex].classList.add('focused');
                        }
                    }
                    if (topDupeGrid) {
                        const dupeCards = topDupeGrid.querySelectorAll('.home-card');
                        if (dupeCards[currentCardIndex]) {
                            dupeCards[currentCardIndex].classList.add('focused');
                        }
                    }
                    
                    // Update info section
                    const item = prevCarousel.items[currentCardIndex];
                    if (item) {
                        updateHomeInfoSection(item);
                    }
                    
                    // Animate up to the top duplicate (vertical only, horizontal already set)
                    updateCarouselTrackPosition();
                    
                    // After animation, instantly jump to the real last genre carousel
                    setTimeout(() => {
                        const track = document.getElementById('homeCarouselTrack');
                        if (track) {
                            track.style.transition = 'none';
                        }
                        
                        // Disable smooth scroll on real last genre carousel
                        if (realLastGenreScroll) {
                            realLastGenreScroll.style.scrollBehavior = 'auto';
                            // Sync scroll position to match duplicate
                            if (topDupeScroll) {
                                realLastGenreScroll.scrollLeft = topDupeScroll.scrollLeft;
                            }
                        }
                        
                        // Jump to real last genre
                        currentCarouselIndex = lastGenreIdx;
                        updateCarouselTrackPosition();
                        
                        // Remove focus from top duplicate
                        if (topDupeGrid) {
                            topDupeGrid.querySelectorAll('.home-card').forEach(card => {
                                card.classList.remove('focused');
                            });
                        }
                        
                        // Re-enable transitions
                        requestAnimationFrame(() => {
                            requestAnimationFrame(() => {
                                if (track) {
                                    track.style.transition = '';
                                }
                                if (realLastGenreScroll) {
                                    realLastGenreScroll.style.scrollBehavior = '';
                                }
                                if (topDupeScroll) {
                                    topDupeScroll.style.scrollBehavior = '';
                                }
                            });
                        });
                    }, 300);
                    
                    return true;
                }
            }
            
            if (currentCarouselIndex > 0) {
                // Normal navigation up
                currentCarouselIndex--;
                currentCardIndex = carouselCardIndices[currentCarouselIndex] || 0;
                const upCarousel = homeCarousels[currentCarouselIndex];
                if (upCarousel && currentCardIndex >= upCarousel.items.length) {
                    currentCardIndex = upCarousel.items.length - 1;
                }
                updateCarouselTrackPosition();
                updateHomeFocus();
            }
            return true;
            
        case 'ArrowDown':
            // Save current card index
            carouselCardIndices[currentCarouselIndex] = currentCardIndex;
            
            // Move to next carousel
            currentCarouselIndex++;
            
            // Check if we landed on the bottom loop duplicate
            const nextCarousel = homeCarousels[currentCarouselIndex];
            if (nextCarousel && nextCarousel.isLoopDuplicateBottom) {
                // Get the card index from the real first content carousel (Continue Watching or Random Movies)
                const firstContentIdx = window.continueWatchingIndex || 1;
                currentCardIndex = carouselCardIndices[firstContentIdx] || 0;
                
                // Remove focus from current carousel (the last genre)
                const prevIndex = currentCarouselIndex - 1;
                const prevGrid = document.getElementById(`homeCarouselGrid-${prevIndex}`);
                if (prevGrid) {
                    prevGrid.querySelectorAll('.home-card').forEach(card => {
                        card.classList.remove('focused');
                    });
                }
                
                // Get scroll containers
                const realFirstScroll = document.getElementById(`homeCarouselScroll-${firstContentIdx}`);
                const dupeScroll = document.getElementById(`homeCarouselScroll-${currentCarouselIndex}`);
                
                // BEFORE animating: sync duplicate's scroll position to match target card
                // and disable smooth scroll on duplicate
                if (dupeScroll) {
                    dupeScroll.style.scrollBehavior = 'auto';
                    // Calculate scroll position for the target card
                    const dupeGrid = document.getElementById(`homeCarouselGrid-${currentCarouselIndex}`);
                    if (dupeGrid) {
                        const cards = dupeGrid.querySelectorAll('.home-card');
                        const card = cards[currentCardIndex];
                        if (card && currentCardIndex > 0) {
                            const cardWidth = card.offsetWidth;
                            const gap = window.innerHeight * 0.0185;
                            const peekAmount = (cardWidth / 4) + gap;
                            const cardOffset = card.offsetLeft - dupeGrid.offsetLeft;
                            dupeScroll.scrollLeft = cardOffset - peekAmount;
                        } else {
                            dupeScroll.scrollLeft = 0;
                        }
                    }
                }
                
                // Add focus to BOTH the duplicate AND the real first content carousel
                const realFirstGrid = document.getElementById(`homeCarouselGrid-${firstContentIdx}`);
                const dupeGrid = document.getElementById(`homeCarouselGrid-${currentCarouselIndex}`);
                
                if (realFirstGrid) {
                    const realCards = realFirstGrid.querySelectorAll('.home-card');
                    if (realCards[currentCardIndex]) {
                        realCards[currentCardIndex].classList.add('focused');
                    }
                }
                if (dupeGrid) {
                    const dupeCards = dupeGrid.querySelectorAll('.home-card');
                    if (dupeCards[currentCardIndex]) {
                        dupeCards[currentCardIndex].classList.add('focused');
                    }
                }
                
                // Update info section
                const item = nextCarousel.items[currentCardIndex];
                if (item) {
                    updateHomeInfoSection(item);
                }
                
                // Animate to the duplicate (vertical only, horizontal already set)
                updateCarouselTrackPosition();
                
                // After animation completes, instantly jump to real first content carousel
                setTimeout(() => {
                    const track = document.getElementById('homeCarouselTrack');
                    if (track) {
                        track.style.transition = 'none';
                    }
                    
                    // Disable smooth scroll on real first content carousel
                    if (realFirstScroll) {
                        realFirstScroll.style.scrollBehavior = 'auto';
                        // Sync scroll position to match duplicate
                        if (dupeScroll) {
                            realFirstScroll.scrollLeft = dupeScroll.scrollLeft;
                        }
                    }
                    
                    // Switch to real first content carousel
                    currentCarouselIndex = firstContentIdx;
                    updateCarouselTrackPosition();
                    
                    // Remove focus from duplicate only (real one stays focused)
                    if (dupeGrid) {
                        dupeGrid.querySelectorAll('.home-card').forEach(card => {
                            card.classList.remove('focused');
                        });
                    }
                    
                    // Re-enable transitions
                    requestAnimationFrame(() => {
                        requestAnimationFrame(() => {
                            if (track) {
                                track.style.transition = '';
                            }
                            if (realFirstScroll) {
                                realFirstScroll.style.scrollBehavior = '';
                            }
                            if (dupeScroll) {
                                dupeScroll.style.scrollBehavior = '';
                            }
                        });
                    });
                }, 300);
                
                return true;
            }
            
            // Normal navigation down
            currentCardIndex = carouselCardIndices[currentCarouselIndex] || 0;
            const downCarousel = homeCarousels[currentCarouselIndex];
            if (downCarousel && currentCardIndex >= downCarousel.items.length) {
                currentCardIndex = downCarousel.items.length - 1;
            }
            updateCarouselTrackPosition();
            updateHomeFocus();
            return true;
            
        case 'Enter':
            const item = currentCarousel.items[currentCardIndex];
            if (item) {
                handleHomeCardClick(item);
            }
            return true;
            
        case 'Escape':
        case 'Backspace':
            // If not at Continue Watching card 0, go there instantly
            const cwIndex = window.continueWatchingIndex || 1;
            if (currentCarouselIndex !== cwIndex || currentCardIndex !== 0) {
                // Save current position
                carouselCardIndices[currentCarouselIndex] = currentCardIndex;
                
                // Go to Continue Watching, first card
                currentCarouselIndex = cwIndex;
                currentCardIndex = 0;
                carouselCardIndices[cwIndex] = 0;
                
                // Instant jump (no animation)
                const track = document.getElementById('homeCarouselTrack');
                if (track) {
                    track.style.transition = 'none';
                }
                
                updateCarouselTrackPosition();
                updateHomeFocus();
                
                // Also reset horizontal scroll to first card
                const scrollContainer = document.getElementById(`homeCarouselScroll-${cwIndex}`);
                if (scrollContainer) {
                    scrollContainer.scrollLeft = 0;
                }
                
                // Re-enable transition
                requestAnimationFrame(() => {
                    requestAnimationFrame(() => {
                        if (track) {
                            track.style.transition = '';
                        }
                    });
                });
            }
            return true;
    }
    
    return false;
}

/**
 * Enter nav mode from home screen
 */
function enterHomeNavMode() {
    if (window.keyboardNav) {
        // Use the standard enterNavMode but mark we came from home
        window.keyboardNav.previousMode = 'home';
        window.keyboardNav.enterNavMode();
    }
}

/**
 * Exit nav mode back to home screen
 */
function exitHomeNavMode() {
    const sideNav = document.querySelector('.side-nav');
    if (sideNav) {
        sideNav.classList.remove('expanded');
        document.querySelectorAll('.nav-item').forEach(item => item.classList.remove('focused'));
    }
    
    // Restore focus to current card
    updateHomeFocus();
}

// Expose home functions globally
window.showHomeScreen = showHomeScreen;
window.hideHomeScreen = hideHomeScreen;
window.isHomeActive = () => isHomeActive;
window.handleHomeKeydown = handleHomeKeydown;
window.enterHomeNavMode = enterHomeNavMode;
window.exitHomeNavMode = exitHomeNavMode;

// Load movies from disk
async function loadMoviesData() {
    const loading = document.getElementById('loading');
    const grid = document.getElementById('movieGrid');
    const tvGrid = document.getElementById('tvShowGrid');
    
    // Check if we're opening a movie or TV show detail directly from search
    const movieToOpen = localStorage.getItem('openMovieDetail');
    const tvShowToOpen = localStorage.getItem('openTVShowDetail');
    const skipGridRender = !!movieToOpen || !!tvShowToOpen;
    
    // Hide everything when opening from search - clear grids to prevent flash
    if (skipGridRender) {
        loading.style.display = 'none';
        grid.style.display = 'none';
        grid.innerHTML = '';
        if (tvGrid) {
            tvGrid.style.display = 'none';
            tvGrid.innerHTML = '';
        }
    } else {
        loading.style.display = 'flex';
        grid.style.display = 'none';
    }
    
    try {
        // Try to load from cache first (no expiration - use until manually refreshed)
        const cachedMovies = localStorage.getItem('allMoviesCache');
        
        if (cachedMovies) {
            console.log('Loading movies from cache');
            allMovies = JSON.parse(cachedMovies);
            window.allMovies = allMovies;
            
            // Always refresh watch status from watch-data.json
            allMovies.forEach(movie => {
                movie.watchStatus = watchDataManager.getWatchStatus(movie.videoPath);
            });
            
            if (!skipGridRender) {
                renderMovieGrid(allMovies);
                loading.style.display = 'none';
                grid.style.display = 'grid';
            }
            
            // Check if we should open a movie detail (from search page)
            checkForMovieToOpen();
            return;
        }
        
        console.log('No cache found, loading movies from:', config.moviesPath);
        allMovies = await loadMovies(config.moviesPath);
        window.allMovies = allMovies; // Expose globally for click handlers
        
        // Get watch status from local watch data
        console.log('Loading watch status from local storage...');
        allMovies.forEach(movie => {
            movie.watchStatus = watchDataManager.getWatchStatus(movie.videoPath);
        });
        
        // Cache the loaded movies (without watch status baked in - we refresh it on load)
        console.log('Caching', allMovies.length, 'movies to localStorage');
        localStorage.setItem('allMoviesCache', JSON.stringify(allMovies));
        localStorage.setItem('allMoviesCacheTimestamp', Date.now().toString());
        
        if (!skipGridRender) {
            renderMovieGrid(allMovies);
            loading.style.display = 'none';
            grid.style.display = 'grid';
        }
        
        // Check if we should open a movie detail (from search page)
        checkForMovieToOpen();
        
    } catch (error) {
        console.error('Error loading movies:', error);
        loading.innerHTML = `<p style="color: #f44;">Error loading movies: ${error.message}</p>`;
    }
}

// Load TV shows from configured path
async function loadTVShowsFromConfig() {
    console.log('Loading TV shows...');
    
    if (!config.tvShowsPath) {
        console.log('No TV shows path configured');
        return;
    }
    
    try {
        // Try to load from cache first
        const cachedShows = localStorage.getItem('allShowsCache');
        
        if (cachedShows) {
            console.log('Loading TV shows from cache');
            allShows = JSON.parse(cachedShows);
            window.allShows = allShows;
            
            // Load watch status for all episodes
            allShows.forEach(show => {
                show.seasons.forEach(season => {
                    season.episodes.forEach(episode => {
                        episode.watchStatus = watchDataManager.getWatchStatus(episode.videoPath);
                    });
                });
            });
            
            console.log('TV shows loaded from cache:', allShows.length);
            return;
        }
        
        console.log('No cache found, scanning TV library from:', config.tvShowsPath);
        allShows = tvScanner.scanLibrary(config.tvShowsPath);
        window.allShows = allShows;
        
        // Get watch status for all episodes
        console.log('Loading watch status for all episodes...');
        allShows.forEach(show => {
            show.seasons.forEach(season => {
                season.episodes.forEach(episode => {
                    episode.watchStatus = watchDataManager.getWatchStatus(episode.videoPath);
                });
            });
        });
        
        // Cache the loaded shows
        console.log('Caching', allShows.length, 'TV shows to localStorage');
        localStorage.setItem('allShowsCache', JSON.stringify(allShows));
        localStorage.setItem('allShowsCacheTimestamp', Date.now().toString());
        
        console.log('TV shows loaded:', allShows.length);
        
    } catch (error) {
        console.error('Error loading TV shows:', error);
    }
}

// Render movie grid
function renderMovieGrid(movies, skipKeyboardNav = false) {
    const grid = document.getElementById('movieGrid');
    grid.innerHTML = '';
    
    // Sort movies alphabetically by NFO sortTitle (or title if no sortTitle)
    const sortedMovies = movies.slice().sort((a, b) => {
        // Use sortTitle if available, otherwise fall back to title with articles removed
        const titleA = (a.metadata.sortTitle || a.metadata.title.replace(/^(The|A|An)\s+/i, '')).toUpperCase();
        const titleB = (b.metadata.sortTitle || b.metadata.title.replace(/^(The|A|An)\s+/i, '')).toUpperCase();
        return titleA.localeCompare(titleB);
    });
    
    sortedMovies.forEach(movie => {
        const card = createMovieCard(movie);
        grid.appendChild(card);
    });
    
    // Update keyboard navigation (skip if requested)
    if (!skipKeyboardNav && typeof keyboardNav !== 'undefined') {
        setTimeout(() => {
            keyboardNav.updateItems('.movie-card');
            keyboardNav.focusItem(); // Apply visual focus to first item
        }, 100);
    }
    
    // Update alphabet navigation
    updateAlphabetNav();
}

/**
 * Refresh watch status on movie grid cards without re-rendering
 */
function refreshMovieGridWatchStatus() {
    if (!watchDataManager) return;
    
    // Update allMovies watch status
    allMovies.forEach(movie => {
        movie.watchStatus = watchDataManager.getWatchStatus(movie.videoPath);
    });
    
    // Update DOM in place
    const movieCards = document.querySelectorAll('.movie-card');
    movieCards.forEach(card => {
        const videoPath = card.dataset.videoPath;
        const movie = allMovies.find(m => m.videoPath === videoPath);
        if (!movie) return;
        
        const posterContainer = card.querySelector('.movie-card-poster-container');
        if (!posterContainer) return;
        
        // Remove old badge and progress bar
        const oldBadge = posterContainer.querySelector('.watched-badge');
        const oldProgress = posterContainer.querySelector('.progress-bar');
        if (oldBadge) oldBadge.remove();
        if (oldProgress) oldProgress.remove();
        
        const ws = movie.watchStatus;
        
        // Add watched badge if watched
        if (ws.watched) {
            const badge = document.createElement('div');
            badge.className = 'watched-badge';
            badge.innerHTML = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M12 24C15.1826 24 18.2348 22.7357 20.4853 20.4853C22.7357 18.2348 24 15.1826 24 12C24 8.8174 22.7357 5.76516 20.4853 3.51472C18.2348 1.26428 15.1826 0 12 0C8.8174 0 5.76516 1.26428 3.51472 3.51472C1.26428 5.76516 0 8.8174 0 12C0 15.1826 1.26428 18.2348 3.51472 20.4853C5.76516 22.7357 8.8174 24 12 24ZM17.2969 9.79688L11.2969 15.7969C10.8563 16.2375 10.1438 16.2375 9.70781 15.7969L6.70781 12.7969C6.26719 12.3563 6.26719 11.6438 6.70781 11.2078C7.14844 10.7719 7.86094 10.7672 8.29688 11.2078L10.5 13.4109L15.7031 8.20312C16.1437 7.7625 16.8562 7.7625 17.2922 8.20312C17.7281 8.64375 17.7328 9.35625 17.2922 9.79219L17.2969 9.79688Z" fill="white"/>
            </svg>`;
            posterContainer.appendChild(badge);
        }
        
        // Add progress bar if applicable
        const timeRemaining = ws.duration - ws.position;
        if (ws.position >= 600 && timeRemaining > 600) {
            const progressBar = document.createElement('div');
            progressBar.className = 'progress-bar';
            const progressFill = document.createElement('div');
            progressFill.className = 'progress-bar-fill';
            progressFill.style.width = `${Math.min(ws.percentage, 100)}%`;
            progressBar.appendChild(progressFill);
            posterContainer.appendChild(progressBar);
        }
    });
}
function createMovieCard(movie) {
    const card = document.createElement('div');
    card.className = 'movie-card';
    card.onclick = () => openDetail(movie);
    card.dataset.videoPath = movie.videoPath; // Store video path for finding card later
    
    const metadata = movie.metadata;
    const watchStatus = movie.watchStatus || { watched: false, position: 0 };
    
    // Poster
    // Poster container and image with nested wrappers for strokes
    const posterContainer = document.createElement('div');
    posterContainer.className = 'movie-card-poster-container';
    
    const posterOuterStroke = document.createElement('div');
    posterOuterStroke.className = 'movie-card-poster-outer-stroke';
    
    const posterInnerStroke = document.createElement('div');
    posterInnerStroke.className = 'movie-card-poster-inner-stroke';
    
    const poster = document.createElement('img');
    poster.className = 'movie-card-poster';
    poster.src = movie.posterPath 
        ? `file://${movie.posterPath}` 
        : 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>';
    poster.alt = metadata.title;
    poster.onerror = () => {
        poster.src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="%23333"/><text x="50%" y="50%" text-anchor="middle" fill="%23666" font-size="20">No Image</text></svg>';
    };
    
    posterInnerStroke.appendChild(poster);
    posterOuterStroke.appendChild(posterInnerStroke);
    posterContainer.appendChild(posterOuterStroke);
    
    // Watched badge (only show if fully watched) - add to posterContainer
    if (watchStatus.watched) {
        const badge = document.createElement('div');
        badge.className = 'watched-badge';
        badge.innerHTML = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M12 24C15.1826 24 18.2348 22.7357 20.4853 20.4853C22.7357 18.2348 24 15.1826 24 12C24 8.8174 22.7357 5.76516 20.4853 3.51472C18.2348 1.26428 15.1826 0 12 0C8.8174 0 5.76516 1.26428 3.51472 3.51472C1.26428 5.76516 0 8.8174 0 12C0 15.1826 1.26428 18.2348 3.51472 20.4853C5.76516 22.7357 8.8174 24 12 24ZM17.2969 9.79688L11.2969 15.7969C10.8563 16.2375 10.1438 16.2375 9.70781 15.7969L6.70781 12.7969C6.26719 12.3563 6.26719 11.6438 6.70781 11.2078C7.14844 10.7719 7.86094 10.7672 8.29688 11.2078L10.5 13.4109L15.7031 8.20312C16.1437 7.7625 16.8562 7.7625 17.2922 8.20312C17.7281 8.64375 17.7328 9.35625 17.2922 9.79219L17.2969 9.79688Z" fill="white"/>
        </svg>`;
        posterContainer.appendChild(badge);
    }
    
    // Progress bar (show if 10+ min watched AND 10+ min remaining) - add to posterContainer
    const timeRemaining = watchStatus.duration - watchStatus.position;
    if (watchStatus.position >= 600 && timeRemaining > 600) {
        const progressBar = document.createElement('div');
        progressBar.className = 'progress-bar';
        const progressFill = document.createElement('div');
        progressFill.className = 'progress-bar-fill';
        progressFill.style.width = `${Math.min(watchStatus.percentage, 100)}%`;
        progressBar.appendChild(progressFill);
        posterContainer.appendChild(progressBar);
    }
    
    card.appendChild(posterContainer);
    
    // Info
    const info = document.createElement('div');
    info.className = 'movie-card-info';
    
    const title = document.createElement('div');
    title.className = 'movie-card-title';
    title.textContent = metadata.title;
    // Store sort title (without articles) for alphabet indexing
    const sortTitle = metadata.title.replace(/^(The|A|An)\s+/i, '');
    title.setAttribute('data-sort-title', sortTitle);
    info.appendChild(title);
    
    const year = document.createElement('div');
    year.className = 'movie-card-year';
    year.textContent = metadata.year;
    info.appendChild(year);
    
    const meta = document.createElement('div');
    meta.className = 'movie-card-meta';
    
    if (metadata.rating > 0) {
        const rating = document.createElement('span');
        rating.className = 'rating';
        rating.textContent = `★ ${metadata.rating.toFixed(1)}`;
        meta.appendChild(rating);
    }
    
    if (metadata.runtime > 0) {
        const runtime = document.createElement('span');
        runtime.className = 'runtime';
        runtime.textContent = `${metadata.runtime} min`;
        meta.appendChild(runtime);
    }
    
    info.appendChild(meta);
    card.appendChild(info);
    
    return card;
}

// ==================== TV SHOWS GRID ====================

// Render TV shows grid
function renderTVShowGrid(shows, skipKeyboardNav = false) {
    const grid = document.getElementById('tvGrid');
    grid.innerHTML = '';
    
    // Sort shows alphabetically by title (with articles removed)
    const sortedShows = shows.slice().sort((a, b) => {
        const titleA = a.title.replace(/^(The|A|An)\s+/i, '').toUpperCase();
        const titleB = b.title.replace(/^(The|A|An)\s+/i, '').toUpperCase();
        return titleA.localeCompare(titleB);
    });
    
    sortedShows.forEach(show => {
        const card = createTVShowCard(show);
        grid.appendChild(card);
    });
    
    // Update keyboard navigation (skip if requested)
    if (!skipKeyboardNav && typeof keyboardNav !== 'undefined') {
        setTimeout(() => {
            keyboardNav.updateItems('.tv-show-card');
            keyboardNav.focusItem(); // Apply visual focus to first item
        }, 100);
    }
    
    // Update alphabet navigation
    updateAlphabetNav();
}

// Create TV show card element
function createTVShowCard(show) {
    const card = document.createElement('div');
    card.className = 'tv-show-card';
    card.onclick = () => openTVShowDetail(show);
    card.dataset.showPath = show.showPath; // Store show path for finding card later
    
    // Calculate watch statistics
    const watchStats = watchDataManager.getShowWatchStats(show);
    const allWatched = watchStats.watchedEpisodes === watchStats.totalEpisodes;
    const hasUnwatched = watchStats.unwatchedEpisodes > 0;
    
    // Check if there's an in-progress episode (for progress bar)
    const nextEpisode = watchDataManager.getNextEpisode(show);
    const showProgress = nextEpisode && nextEpisode.watchStatus && nextEpisode.watchStatus.position > 0;
    
    // Poster container and image with nested wrappers for strokes
    const posterContainer = document.createElement('div');
    posterContainer.className = 'tv-show-card-poster-container';
    
    const posterOuterStroke = document.createElement('div');
    posterOuterStroke.className = 'tv-show-card-poster-outer-stroke';
    
    const posterInnerStroke = document.createElement('div');
    posterInnerStroke.className = 'tv-show-card-poster-inner-stroke';
    
    const poster = document.createElement('img');
    poster.className = 'tv-show-card-poster';
    poster.src = show.posterPath 
        ? `file://${show.posterPath}` 
        : 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>';
    poster.alt = show.title;
    poster.onerror = () => {
        poster.src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="%23333"/><text x="50%" y="50%" text-anchor="middle" fill="%23666" font-size="20">No Image</text></svg>';
    };
    
    posterInnerStroke.appendChild(poster);
    posterOuterStroke.appendChild(posterInnerStroke);
    posterContainer.appendChild(posterOuterStroke);
    
    // Watched badge (only show if all episodes watched)
    if (allWatched) {
        const badge = document.createElement('div');
        badge.className = 'watched-badge';
        badge.innerHTML = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M12 24C15.1826 24 18.2348 22.7357 20.4853 20.4853C22.7357 18.2348 24 15.1826 24 12C24 8.8174 22.7357 5.76516 20.4853 3.51472C18.2348 1.26428 15.1826 0 12 0C8.8174 0 5.76516 1.26428 3.51472 3.51472C1.26428 5.76516 0 8.8174 0 12C0 15.1826 1.26428 18.2348 3.51472 20.4853C5.76516 22.7357 8.8174 24 12 24ZM17.2969 9.79688L11.2969 15.7969C10.8563 16.2375 10.1438 16.2375 9.70781 15.7969L6.70781 12.7969C6.26719 12.3563 6.26719 11.6438 6.70781 11.2078C7.14844 10.7719 7.86094 10.7672 8.29688 11.2078L10.5 13.4109L15.7031 8.20312C16.1437 7.7625 16.8562 7.7625 17.2922 8.20312C17.7281 8.64375 17.7328 9.35625 17.2922 9.79219L17.2969 9.79688Z" fill="white"/>
        </svg>`;
        posterContainer.appendChild(badge);
    }
    
    // Unwatched count badge (show if there are unwatched episodes and not all watched)
    if (hasUnwatched && !allWatched) {
        const unwatchedBadge = document.createElement('div');
        unwatchedBadge.className = 'unwatched-count-badge';
        unwatchedBadge.textContent = `${watchStats.unwatchedEpisodes}`;
        posterContainer.appendChild(unwatchedBadge);
    }
    
    // No progress bar on TV grid - only on season detail thumbnails
    
    card.appendChild(posterContainer);
    
    // Info
    const info = document.createElement('div');
    info.className = 'tv-show-card-info';
    
    const title = document.createElement('div');
    title.className = 'tv-show-card-title';
    title.textContent = show.title;
    // Store sort title (without articles) for alphabet indexing
    const sortTitle = show.title.replace(/^(The|A|An)\s+/i, '');
    title.setAttribute('data-sort-title', sortTitle);
    info.appendChild(title);
    
    const year = document.createElement('div');
    year.className = 'tv-show-card-year';
    year.textContent = show.year;
    info.appendChild(year);
    
    card.appendChild(info);
    
    return card;
}

// ==================== PLAYLISTS ====================

/**
 * Render the playlist grid
 */
function renderPlaylistGrid() {
    const grid = document.getElementById('playlistGrid');
    console.log('renderPlaylistGrid called, grid element:', grid);
    grid.innerHTML = '';
    
    const playlists = playlistManager.getAll();
    console.log('Playlists to render:', playlists.length, playlists);
    
    // Show empty state if no playlists
    if (playlists.length === 0) {
        const emptyState = document.createElement('div');
        emptyState.className = 'playlist-empty-state';
        emptyState.innerHTML = `
            <img src="assets/icons/playlist.svg" class="playlist-empty-icon" alt="">
            <p class="playlist-empty-text">No playlists yet</p>
            <button class="detail-button focused" id="createPlaylistBtn">
                <img src="assets/icons/plus.svg" class="detail-button-icon" alt="">
                <span class="detail-button-text">Create Playlist</span>
            </button>
        `;
        grid.appendChild(emptyState);
        console.log('Showing empty state with create button');
        
        // Setup keyboard handler for empty state
        setupEmptyPlaylistNavigation();
        return;
    }
    
    // Sort playlists by name
    const sortedPlaylists = playlists.slice().sort((a, b) => {
        return a.name.localeCompare(b.name);
    });
    
    sortedPlaylists.forEach(playlist => {
        const card = createPlaylistCard(playlist);
        grid.appendChild(card);
    });
    
    console.log('Playlist grid rendered, children:', grid.children.length);
    
    // Update keyboard navigation
    if (typeof keyboardNav !== 'undefined') {
        setTimeout(() => {
            keyboardNav.updateItems('.playlist-card');
            keyboardNav.focusItem();
        }, 100);
    }
}

/**
 * Create a playlist card element
 * @param {Object} playlist - Playlist object
 * @returns {HTMLElement} - Playlist card element
 */
function createPlaylistCard(playlist) {
    const card = document.createElement('div');
    card.className = 'playlist-card';
    card.onclick = () => openPlaylistDetail(playlist);
    card.dataset.playlistId = playlist.id;
    
    // Poster container with 4-poster collage
    const posterContainer = document.createElement('div');
    posterContainer.className = 'playlist-card-poster-container';
    
    const posterOuterStroke = document.createElement('div');
    posterOuterStroke.className = 'playlist-card-poster-outer-stroke';
    
    const posterInnerStroke = document.createElement('div');
    posterInnerStroke.className = 'playlist-card-poster-inner-stroke';
    
    // Generate 4-poster collage or use custom thumbnail
    if (playlist.customThumbnail && fs.existsSync(playlist.customThumbnail)) {
        const thumb = document.createElement('img');
        thumb.className = 'playlist-card-poster';
        thumb.src = `file://${playlist.customThumbnail}`;
        thumb.alt = playlist.name;
        posterInnerStroke.appendChild(thumb);
    } else {
        // Create 4-poster collage
        const collage = document.createElement('div');
        collage.className = 'playlist-card-collage';
        
        const posters = playlistManager.getThumbnailPosters(playlist.id, allMovies);
        
        for (let i = 0; i < 4; i++) {
            const quadrant = document.createElement('div');
            quadrant.className = 'playlist-collage-quadrant';
            
            if (posters[i]) {
                const img = document.createElement('img');
                img.src = `file://${posters[i]}`;
                img.alt = '';
                img.onerror = () => {
                    img.style.display = 'none';
                    quadrant.style.backgroundColor = '#2a2a2a';
                };
                quadrant.appendChild(img);
            } else {
                // Empty quadrant
                quadrant.style.backgroundColor = '#2a2a2a';
            }
            
            collage.appendChild(quadrant);
        }
        
        posterInnerStroke.appendChild(collage);
    }
    
    posterOuterStroke.appendChild(posterInnerStroke);
    posterContainer.appendChild(posterOuterStroke);
    card.appendChild(posterContainer);
    
    // Info section (title and item count)
    const info = document.createElement('div');
    info.className = 'playlist-card-info';
    
    const title = document.createElement('div');
    title.className = 'playlist-card-title';
    title.textContent = playlist.name;
    info.appendChild(title);
    
    // Item count (same styling as movie year)
    const itemCount = document.createElement('div');
    itemCount.className = 'playlist-card-count';
    const count = playlist.items ? playlist.items.length : 0;
    itemCount.textContent = count === 1 ? '1 Movie' : `${count} Movies`;
    info.appendChild(itemCount);
    
    card.appendChild(info);
    
    return card;
}

/**
 * Setup keyboard navigation for empty playlist state
 */
function setupEmptyPlaylistNavigation() {
    // Remove any existing handler
    if (window.emptyPlaylistKeyHandler) {
        document.removeEventListener('keydown', window.emptyPlaylistKeyHandler, true);
    }
    
    // Update button focus state
    const btn = document.getElementById('createPlaylistBtn');
    if (btn) {
        btn.classList.add('focused');
    }
    
    window.emptyPlaylistKeyHandler = function(e) {
        // Only handle if we're on playlists page with empty state
        const emptyState = document.querySelector('.playlist-empty-state');
        if (!emptyState) return;
        
        const btn = document.getElementById('createPlaylistBtn');
        
        if (e.key === 'Enter') {
            e.preventDefault();
            e.stopPropagation();
            
            // Remove this handler
            document.removeEventListener('keydown', window.emptyPlaylistKeyHandler, true);
            window.emptyPlaylistKeyHandler = null;
            
            // Open create playlist modal (without a video to add)
            showCreatePlaylistModalEmpty();
        } else if (e.key === 'ArrowLeft') {
            e.preventDefault();
            e.stopPropagation();
            
            // Remove focus from button
            if (btn) btn.classList.remove('focused');
            
            // Remove this handler
            document.removeEventListener('keydown', window.emptyPlaylistKeyHandler, true);
            window.emptyPlaylistKeyHandler = null;
            
            // Go to nav
            if (typeof keyboardNav !== 'undefined') {
                keyboardNav.enterNavMode();
            }
        } else if (e.key === 'Escape' || e.key === 'Backspace') {
            e.preventDefault();
            e.stopPropagation();
            
            // Remove focus from button
            if (btn) btn.classList.remove('focused');
            
            // Remove this handler
            document.removeEventListener('keydown', window.emptyPlaylistKeyHandler, true);
            window.emptyPlaylistKeyHandler = null;
            
            // Go back to nav
            if (typeof keyboardNav !== 'undefined') {
                keyboardNav.enterNavMode();
            }
        }
    };
    
    document.addEventListener('keydown', window.emptyPlaylistKeyHandler, true);
}

/**
 * Show create playlist modal without adding a video (from empty state)
 */
function showCreatePlaylistModalEmpty() {
    window.createPlaylistForVideoPath = null; // Not adding a video
    window.playlistInputText = '';
    window.playlistCursorPos = 0;
    window.playlistKeyboardLayout = 'alpha';
    window.playlistKeyboardShift = true; // Start with shift for capital first letter
    window.playlistKeyboardRow = 0;
    window.playlistKeyboardCol = 0;
    
    const html = `
        <div class="create-playlist-modal" id="createPlaylistModal">
            <div class="create-playlist-content">
                <div class="create-playlist-header">CREATE PLAYLIST</div>
                <div class="create-playlist-input" id="createPlaylistInput"><span class="cursor"></span></div>
                <div class="create-playlist-keyboard" id="createPlaylistKeyboard">
                    ${generateKeyboardHTML('alpha')}
                </div>
            </div>
        </div>
    `;
    
    const modal = document.createElement('div');
    modal.id = 'createPlaylistModalContainer';
    modal.innerHTML = html;
    document.body.appendChild(modal);
    
    // Setup keyboard navigation
    setupCreatePlaylistNavigation();
    updateKeyboardFocus();
    updatePlaylistInput();
}

/**
 * Open playlist detail page
 * @param {Object} playlist - Playlist object
 */
function openPlaylistDetail(playlist, initialFocus = null) {
    console.log('Opening playlist detail for:', playlist.name);
    
    // Store current playlist globally
    window.currentPlaylist = playlist;
    
    // Check if we need instant scroll (returning from playback)
    const needsInstantScroll = initialFocus && initialFocus.section === 'list';
    
    // Set focus state - use passed values or defaults
    if (initialFocus) {
        window.playlistFocusSection = initialFocus.section || 'buttons';
        window.playlistFocusedIndex = initialFocus.focusedIndex || 0;
        window.playlistItemButtonIndex = initialFocus.buttonIndex || 0;
    } else {
        window.playlistFocusedIndex = 0; // Start on Play All button
        window.playlistFocusSection = 'buttons'; // 'buttons' or 'list'
        window.playlistItemButtonIndex = 0; // Which action button is focused (0-3)
    }
    window.playlistReorderMode = false;
    window.playlistReorderFromIndex = -1;
    
    // Flag for instant scroll
    window.playlistInstantScroll = needsInstantScroll;
    
    // Set playlists nav item as active
    document.querySelectorAll('.nav-item').forEach(item => {
        item.classList.remove('nav-item-active');
        if (item.dataset.page === 'playlists') {
            item.classList.add('nav-item-active');
        }
    });
    
    const detailPage = document.getElementById('detailPage');
    const content = document.getElementById('detailContent');
    const contentArea = document.getElementById('contentArea');
    
    // Hide content area, show detail
    contentArea.style.display = 'none';
    detailPage.style.display = 'flex';
    
    // Build playlist detail HTML
    let html = '';
    
    // Add fanart background elements (will be updated when focusing on list items)
    html += '<div class="detail-fanart playlist-detail-fanart" id="playlistDetailFanart" style="background-image: none;"></div>';
    html += '<div class="detail-fanart-overlay playlist-detail-fanart-overlay" id="playlistDetailFanartOverlay" style="display: none;"></div>';
    html += '<div class="detail-fanart-gradient-left playlist-detail-fanart-gradient" id="playlistDetailFanartGradientLeft" style="display: none;"></div>';
    html += '<div class="detail-fanart-gradient-bottom playlist-detail-fanart-gradient" id="playlistDetailFanartGradientBottom" style="display: none;"></div>';
    html += '<div class="detail-fanart-gradient-bottom-accent" id="playlistDetailFanartAccent" style="display: none;"></div>';
    
    html += '<div class="playlist-detail-wrapper">';
    
    // Left side - poster area
    html += '<div class="playlist-detail-poster-area">';
    
    // Check for custom thumbnail first
    if (playlist.customThumbnail && fs.existsSync(playlist.customThumbnail)) {
        // Custom poster view
        html += `<div class="playlist-detail-custom-poster" id="playlistCollageView">`;
        html += `<img src="file://${playlist.customThumbnail}" alt="">`;
        html += '</div>';
    } else {
        // Collage view (shown when on buttons)
        html += '<div class="playlist-detail-collage-container" id="playlistCollageView">';
        const posters = playlistManager.getThumbnailPosters(playlist.id, allMovies);
        for (let i = 0; i < 4; i++) {
            if (posters[i]) {
                html += `<div class="playlist-collage-quadrant"><img src="file://${posters[i]}" alt=""></div>`;
            } else {
                html += '<div class="playlist-collage-quadrant"></div>';
            }
        }
        html += '</div>';
    }
    
    // Single poster view (shown when focused on list item)
    html += '<div class="playlist-detail-single-poster" id="playlistSinglePoster" style="display: none;">';
    html += '<img id="playlistPosterImg" src="" alt="">';
    html += `<div class="playlist-poster-watched-badge" id="playlistPosterWatched" style="display: none;">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M12 24C15.1826 24 18.2348 22.7357 20.4853 20.4853C22.7357 18.2348 24 15.1826 24 12C24 8.8174 22.7357 5.76516 20.4853 3.51472C18.2348 1.26428 15.1826 0 12 0C8.8174 0 5.76516 1.26428 3.51472 3.51472C1.26428 5.76516 0 8.8174 0 12C0 15.1826 1.26428 18.2348 3.51472 20.4853C5.76516 22.7357 8.8174 24 12 24ZM17.2969 9.79688L11.2969 15.7969C10.8563 16.2375 10.1438 16.2375 9.70781 15.7969L6.70781 12.7969C6.26719 12.3563 6.26719 11.6438 6.70781 11.2078C7.14844 10.7719 7.86094 10.7672 8.29688 11.2078L10.5 13.4109L15.7031 8.20312C16.1437 7.7625 16.8562 7.7625 17.2922 8.20312C17.7281 8.64375 17.7328 9.35625 17.2922 9.79219L17.2969 9.79688Z"/>
        </svg>
    </div>`;
    html += '<div class="playlist-poster-progress" id="playlistPosterProgress" style="display: none;"><div class="playlist-poster-progress-bar" id="playlistPosterProgressBar"></div></div>';
    html += '</div>';
    
    html += '</div>'; // End poster area
    
    // Right side - info and list
    html += '<div class="playlist-detail-content">';
    
    // Title - same class as movie detail
    html += `<h1 class="playlist-detail-title">${playlist.name}</h1>`;
    
    // Meta
    const itemCount = playlist.items.length;
    const totalRuntime = playlistManager.getTotalRuntime(playlist.id, allMovies);
    const runtimeHours = Math.floor(totalRuntime / 60);
    const runtimeMins = totalRuntime % 60;
    const runtimeStr = runtimeHours > 0 
        ? `${runtimeHours}h ${runtimeMins}m` 
        : `${runtimeMins}m`;
    
    html += '<div class="playlist-detail-meta">';
    html += `<span>${itemCount} ${itemCount === 1 ? 'item' : 'items'}</span>`;
    if (totalRuntime > 0) {
        html += '<div class="detail-meta-divider"></div>';
        html += `<span>${runtimeStr}</span>`;
    }
    html += '</div>';
    
    // Check if all items are watched
    let allWatched = true;
    if (playlist.items && playlist.items.length > 0) {
        for (const item of playlist.items) {
            const ws = watchDataManager.getWatchStatus(item.videoPath);
            if (!ws || !ws.watched) {
                allWatched = false;
                break;
            }
        }
    } else {
        allWatched = false;
    }
    
    // Action buttons - use detail-button class
    html += '<div class="playlist-detail-buttons" id="playlistDetailButtons">';
    html += `<button class="detail-button" data-index="0" id="playlistPlayAllBtn">
        <img src="assets/icons/play.svg" class="detail-button-icon" alt="">
        <span class="detail-button-text">Play All</span>
    </button>`;
    html += `<button class="detail-button" data-index="1" id="playlistShuffleBtn">
        <img src="assets/icons/shuffle.svg" class="detail-button-icon" alt="">
        <span class="detail-button-text">Shuffle</span>
    </button>`;
    html += `<button class="detail-button" data-index="2" id="playlistWatchedBtn">
        <img src="assets/icons/${allWatched ? 'unwatched' : 'watched'}.svg" class="detail-button-icon" alt="">
        <span class="detail-button-text">${allWatched ? 'Mark as Unwatched' : 'Mark as Watched'}</span>
    </button>`;
    html += `<button class="detail-button" data-index="3" id="playlistMoreBtn">
        <img src="assets/icons/more-options.svg" class="detail-button-icon" alt="">
        <span class="detail-button-text">More Options</span>
    </button>`;
    html += '</div>';
    
    // Movie list
    html += '<div class="playlist-detail-list" id="playlistDetailList">';
    
    playlist.items.forEach((item, index) => {
        const movie = allMovies.find(m => m.videoPath === item.videoPath);
        if (movie) {
            const ws = watchDataManager.getWatchStatus(movie.videoPath);
            const isWatched = ws && ws.watched;
            
            html += `<div class="playlist-item" data-index="${index}" data-video-path="${movie.videoPath}">`;
            html += '<div class="playlist-item-content">';
            
            // Title row with watched icon (inline SVG for accent color)
            html += '<div class="playlist-item-title-row">';
            if (isWatched) {
                html += `<svg class="playlist-item-watched-icon" width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M12 24C15.1826 24 18.2348 22.7357 20.4853 20.4853C22.7357 18.2348 24 15.1826 24 12C24 8.8174 22.7357 5.76516 20.4853 3.51472C18.2348 1.26428 15.1826 0 12 0C8.8174 0 5.76516 1.26428 3.51472 3.51472C1.26428 5.76516 0 8.8174 0 12C0 15.1826 1.26428 18.2348 3.51472 20.4853C5.76516 22.7357 8.8174 24 12 24ZM17.2969 9.79688L11.2969 15.7969C10.8563 16.2375 10.1438 16.2375 9.70781 15.7969L6.70781 12.7969C6.26719 12.3563 6.26719 11.6438 6.70781 11.2078C7.14844 10.7719 7.86094 10.7672 8.29688 11.2078L10.5 13.4109L15.7031 8.20312C16.1437 7.7625 16.8562 7.7625 17.2922 8.20312C17.7281 8.64375 17.7328 9.35625 17.2922 9.79219L17.2969 9.79688Z" fill="var(--accent)"/>
                </svg>`;
            }
            html += `<span class="playlist-item-title">${movie.metadata?.title || path.basename(movie.videoPath)}</span>`;
            html += '</div>';
            
            // Metadata row - same structure as movie detail meta
            html += '<div class="playlist-item-meta">';
            const metaParts = [];
            if (movie.metadata?.year) metaParts.push(`<span>${movie.metadata.year}</span>`);
            if (movie.metadata?.runtime) {
                const hrs = Math.floor(movie.metadata.runtime / 60);
                const mins = movie.metadata.runtime % 60;
                metaParts.push(`<span>${hrs > 0 ? `${hrs}h ${mins}m` : `${mins}m`}</span>`);
            }
            if (movie.metadata?.mpaa) metaParts.push(`<span>${movie.metadata.mpaa}</span>`);
            if (movie.metadata?.rating) metaParts.push(`<span>IMDb ${movie.metadata.rating}</span>`);
            html += metaParts.join('<div class="playlist-item-meta-divider"></div>');
            html += '</div>';
            
            html += '</div>'; // End content
            
            // Action buttons - use detail-button class
            html += '<div class="playlist-item-actions">';
            html += `<button class="detail-button" data-action="play" data-btn-index="0">
                <img src="assets/icons/play.svg" class="detail-button-icon" alt="">
                <span class="detail-button-text">Play</span>
            </button>`;
            html += `<button class="detail-button" data-action="info" data-btn-index="1">
                <img src="assets/icons/info.svg" class="detail-button-icon" alt="">
                <span class="detail-button-text">Info</span>
            </button>`;
            html += `<button class="detail-button" data-action="reorder" data-btn-index="2">
                <img src="assets/icons/reorder.svg" class="detail-button-icon" alt="">
                <span class="detail-button-text">Reorder</span>
            </button>`;
            html += `<button class="detail-button" data-action="remove" data-btn-index="3">
                <img src="assets/icons/xmark-large.svg" class="detail-button-icon" alt="">
                <span class="detail-button-text">Remove</span>
            </button>`;
            html += '</div>';
            
            html += '</div>'; // End playlist-item
        }
    });
    
    html += '</div>'; // End list
    html += '</div>'; // End content
    html += '</div>'; // End wrapper
    
    content.innerHTML = html;
    
    // Setup keyboard navigation for playlist detail
    setupPlaylistDetailNavigation();
    updatePlaylistDetailFocus();
}

/**
 * Setup keyboard navigation for playlist detail page
 */
function setupPlaylistDetailNavigation() {
    // Remove any existing handler first
    if (window.playlistDetailKeyHandler) {
        document.removeEventListener('keydown', window.playlistDetailKeyHandler, true);
    }
    
    window.playlistDetailKeyHandler = function(e) {
        // Stop event from reaching other handlers
        e.stopPropagation();
        e.stopImmediatePropagation();
        
        const playlist = window.currentPlaylist;
        if (!playlist) return;
        
        const section = window.playlistFocusSection;
        const itemCount = playlist.items.length;
        
        // Handle reorder mode separately
        if (window.playlistReorderMode) {
            handlePlaylistReorderKey(e);
            return;
        }
        
        switch (e.key) {
            case 'ArrowUp':
                e.preventDefault();
                if (section === 'list') {
                    if (window.playlistFocusedIndex > 0) {
                        window.playlistFocusedIndex--;
                        window.playlistItemButtonIndex = 0;
                    } else {
                        // Move to buttons
                        window.playlistFocusSection = 'buttons';
                        window.playlistFocusedIndex = 0;
                    }
                }
                updatePlaylistDetailFocus();
                break;
                
            case 'ArrowDown':
                e.preventDefault();
                if (section === 'buttons') {
                    if (itemCount > 0) {
                        window.playlistFocusSection = 'list';
                        window.playlistFocusedIndex = 0;
                        window.playlistItemButtonIndex = 0;
                    }
                } else if (section === 'list') {
                    if (window.playlistFocusedIndex < itemCount - 1) {
                        window.playlistFocusedIndex++;
                        window.playlistItemButtonIndex = 0;
                    }
                }
                updatePlaylistDetailFocus();
                break;
                
            case 'ArrowLeft':
                e.preventDefault();
                if (section === 'buttons') {
                    if (window.playlistFocusedIndex > 0) {
                        window.playlistFocusedIndex--;
                    } else {
                        // Enter nav - save playlist state
                        window.playlistNavState = {
                            section: window.playlistFocusSection,
                            focusedIndex: window.playlistFocusedIndex,
                            buttonIndex: window.playlistItemButtonIndex
                        };
                        
                        // Remove focus from playlist buttons
                        document.querySelectorAll('.playlist-detail-buttons .detail-button').forEach(btn => btn.classList.remove('focused'));
                        document.querySelectorAll('.playlist-item').forEach(item => {
                            item.classList.remove('focused');
                            item.querySelectorAll('.detail-button').forEach(btn => btn.classList.remove('focused'));
                        });
                        
                        // Remove playlist key handler temporarily
                        if (window.playlistDetailKeyHandler) {
                            document.removeEventListener('keydown', window.playlistDetailKeyHandler, true);
                        }
                        
                        // Enter nav mode
                        if (window.keyboardNav) {
                            window.keyboardNav.previousMode = 'playlist';
                            window.keyboardNav.mode = 'nav';
                            window.keyboardNav.updateNavItems();
                            const activeIndex = window.keyboardNav.navItems.findIndex(item => item.classList.contains('nav-item-active'));
                            window.keyboardNav.navIndex = activeIndex >= 0 ? activeIndex : 4; // Playlists is index 4
                            window.keyboardNav.focusNavItem();
                            
                            // Expand nav
                            const nav = document.getElementById('sideNav');
                            nav.classList.add('expanded');
                        }
                        return;
                    }
                } else if (section === 'list') {
                    if (window.playlistItemButtonIndex > 0) {
                        window.playlistItemButtonIndex--;
                    } else {
                        // Enter nav from list section
                        window.playlistNavState = {
                            section: window.playlistFocusSection,
                            focusedIndex: window.playlistFocusedIndex,
                            buttonIndex: window.playlistItemButtonIndex
                        };
                        
                        // Remove focus from playlist items
                        document.querySelectorAll('.playlist-item').forEach(item => {
                            item.classList.remove('focused');
                            item.querySelectorAll('.detail-button').forEach(btn => btn.classList.remove('focused'));
                        });
                        
                        // Remove playlist key handler temporarily
                        if (window.playlistDetailKeyHandler) {
                            document.removeEventListener('keydown', window.playlistDetailKeyHandler, true);
                        }
                        
                        // Enter nav mode
                        if (window.keyboardNav) {
                            window.keyboardNav.previousMode = 'playlist';
                            window.keyboardNav.mode = 'nav';
                            window.keyboardNav.updateNavItems();
                            const activeIndex = window.keyboardNav.navItems.findIndex(item => item.classList.contains('nav-item-active'));
                            window.keyboardNav.navIndex = activeIndex >= 0 ? activeIndex : 4;
                            window.keyboardNav.focusNavItem();
                            
                            const nav = document.getElementById('sideNav');
                            nav.classList.add('expanded');
                        }
                        return;
                    }
                }
                updatePlaylistDetailFocus();
                break;
                
            case 'ArrowRight':
                e.preventDefault();
                if (section === 'buttons') {
                    if (window.playlistFocusedIndex < 3) {
                        window.playlistFocusedIndex++;
                    }
                } else if (section === 'list') {
                    if (window.playlistItemButtonIndex < 3) {
                        window.playlistItemButtonIndex++;
                    }
                }
                updatePlaylistDetailFocus();
                break;
                
            case 'Enter':
                e.preventDefault();
                if (section === 'buttons') {
                    handlePlaylistHeaderButton(window.playlistFocusedIndex);
                } else if (section === 'list') {
                    handlePlaylistItemButton(window.playlistFocusedIndex, window.playlistItemButtonIndex);
                }
                break;
                
            case 'Escape':
            case 'Backspace':
                e.preventDefault();
                closePlaylistDetail();
                break;
        }
    };
    
    document.addEventListener('keydown', window.playlistDetailKeyHandler, true);
}

/**
 * Handle reorder mode key presses
 */
function handlePlaylistReorderKey(e) {
    const playlist = window.currentPlaylist;
    const fromIndex = window.playlistReorderFromIndex;
    const currentIndex = window.playlistFocusedIndex;
    
    switch (e.key) {
        case 'ArrowUp':
            e.preventDefault();
            if (currentIndex > 0) {
                // Visually move the item up
                movePlaylistItemVisually(currentIndex, currentIndex - 1);
                window.playlistFocusedIndex--;
                updatePlaylistDetailFocus();
            }
            break;
            
        case 'ArrowDown':
            e.preventDefault();
            if (currentIndex < playlist.items.length - 1) {
                // Visually move the item down
                movePlaylistItemVisually(currentIndex, currentIndex + 1);
                window.playlistFocusedIndex++;
                updatePlaylistDetailFocus();
            }
            break;
            
        case 'Enter':
            e.preventDefault();
            // Confirm reorder - save the new position
            if (fromIndex !== currentIndex) {
                playlistManager.reorderItem(playlist.id, fromIndex, currentIndex);
            }
            // Exit reorder mode
            window.playlistReorderMode = false;
            window.playlistReorderFromIndex = -1;
            // Preserve focus position and refresh
            const savedIndex = window.playlistFocusedIndex;
            // Remove old handler before opening
            if (window.playlistDetailKeyHandler) {
                document.removeEventListener('keydown', window.playlistDetailKeyHandler, true);
                window.playlistDetailKeyHandler = null;
            }
            openPlaylistDetail(playlistManager.getById(playlist.id));
            // Restore focus to list
            window.playlistFocusSection = 'list';
            window.playlistFocusedIndex = savedIndex;
            window.playlistItemButtonIndex = 0;
            updatePlaylistDetailFocus();
            break;
            
        case 'Escape':
        case 'Backspace':
            e.preventDefault();
            // Cancel reorder - refresh to restore original order
            window.playlistReorderMode = false;
            const originalIndex = window.playlistReorderFromIndex;
            window.playlistReorderFromIndex = -1;
            // Remove old handler before opening
            if (window.playlistDetailKeyHandler) {
                document.removeEventListener('keydown', window.playlistDetailKeyHandler, true);
                window.playlistDetailKeyHandler = null;
            }
            openPlaylistDetail(playlistManager.getById(playlist.id));
            // Restore focus to original position in list
            window.playlistFocusSection = 'list';
            window.playlistFocusedIndex = originalIndex;
            window.playlistItemButtonIndex = 0;
            updatePlaylistDetailFocus();
            break;
    }
}

/**
 * Visually move a playlist item from one position to another in the DOM
 */
function movePlaylistItemVisually(fromIndex, toIndex) {
    const list = document.getElementById('playlistDetailList');
    if (!list) return;
    
    const items = list.querySelectorAll('.playlist-item');
    const movingItem = items[fromIndex];
    
    if (!movingItem) return;
    
    if (toIndex < fromIndex) {
        // Moving up - insert before the target
        list.insertBefore(movingItem, items[toIndex]);
    } else {
        // Moving down - insert after the target
        const targetItem = items[toIndex];
        if (targetItem.nextSibling) {
            list.insertBefore(movingItem, targetItem.nextSibling);
        } else {
            list.appendChild(movingItem);
        }
    }
}

/**
 * Update the visual focus state for playlist detail
 */
function updatePlaylistDetailFocus() {
    const playlist = window.currentPlaylist;
    if (!playlist) return;
    
    const section = window.playlistFocusSection;
    const focusedIndex = window.playlistFocusedIndex;
    const buttonIndex = window.playlistItemButtonIndex;
    
    // Clear all focus states - header buttons
    document.querySelectorAll('.playlist-detail-buttons .detail-button').forEach(btn => btn.classList.remove('focused'));
    
    // Clear all focus states - list items and their buttons
    document.querySelectorAll('.playlist-item').forEach(item => {
        item.classList.remove('focused', 'reordering');
        item.querySelectorAll('.detail-button').forEach(btn => btn.classList.remove('focused'));
    });
    
    // Show/hide collage vs single poster
    const collageView = document.getElementById('playlistCollageView');
    const singlePoster = document.getElementById('playlistSinglePoster');
    
    if (section === 'buttons') {
        // Focus on header button
        const buttons = document.querySelectorAll('.playlist-detail-buttons .detail-button');
        if (buttons[focusedIndex]) {
            buttons[focusedIndex].classList.add('focused');
        }
        
        // Show collage
        if (collageView) collageView.style.display = 'grid';
        if (singlePoster) singlePoster.style.display = 'none';
        
        // Hide fanart background when on buttons
        const fanartEl = document.getElementById('playlistDetailFanart');
        const fanartOverlay = document.getElementById('playlistDetailFanartOverlay');
        const fanartGradientLeft = document.getElementById('playlistDetailFanartGradientLeft');
        const fanartGradientBottom = document.getElementById('playlistDetailFanartGradientBottom');
        const fanartAccent = document.getElementById('playlistDetailFanartAccent');
        
        if (fanartEl) fanartEl.style.backgroundImage = 'none';
        if (fanartOverlay) fanartOverlay.style.display = 'none';
        if (fanartGradientLeft) fanartGradientLeft.style.display = 'none';
        if (fanartGradientBottom) fanartGradientBottom.style.display = 'none';
        if (fanartAccent) fanartAccent.style.display = 'none';
        
    } else if (section === 'list') {
        // Focus on list item
        const items = document.querySelectorAll('.playlist-item');
        const item = items[focusedIndex];
        
        if (item) {
            if (window.playlistReorderMode) {
                item.classList.add('reordering');
            } else {
                item.classList.add('focused');
            }
            
            // Focus on specific action button
            const actionBtns = item.querySelectorAll('.detail-button');
            if (actionBtns[buttonIndex]) {
                actionBtns[buttonIndex].classList.add('focused');
            }
            
            // Vertical carousel scrolling - keep focused item in fixed position near top
            const list = document.getElementById('playlistDetailList');
            if (list) {
                // Check if we need instant scroll (no animation)
                const useInstantScroll = window.playlistInstantScroll;
                if (useInstantScroll) {
                    // Disable smooth scrolling temporarily
                    list.style.scrollBehavior = 'auto';
                    window.playlistInstantScroll = false;
                }
                
                // We want the focused item to appear with the previous item fully visible above it
                // Index 0: no scroll
                // Index 1: no scroll (both items visible)
                // Index 2+: scroll so previous item is at top, focused item below it
                const items = document.querySelectorAll('.playlist-item');
                const firstItem = items[0];
                
                if (focusedIndex <= 1) {
                    // First two items - no scroll needed
                    list.scrollTop = 0;
                } else if (firstItem) {
                    // For index 2+, scroll so the previous item is at the top
                    const prevItem = items[focusedIndex - 1];
                    const targetScrollTop = prevItem.offsetTop - firstItem.offsetTop;
                    
                    list.scrollTop = Math.max(0, targetScrollTop);
                }
                
                // Re-enable smooth scrolling after instant scroll
                if (useInstantScroll) {
                    requestAnimationFrame(() => {
                        list.style.scrollBehavior = '';
                    });
                }
            }
            
            // Show single poster with movie details
            if (collageView) collageView.style.display = 'none';
            if (singlePoster) singlePoster.style.display = 'block';
            
            // Update poster image and progress
            const videoPath = item.dataset.videoPath;
            const movie = allMovies.find(m => m.videoPath === videoPath);
            if (movie) {
                const posterImg = document.getElementById('playlistPosterImg');
                const watchedBadge = document.getElementById('playlistPosterWatched');
                const progressContainer = document.getElementById('playlistPosterProgress');
                const progressBar = document.getElementById('playlistPosterProgressBar');
                
                if (posterImg && movie.posterPath) {
                    posterImg.src = `file://${movie.posterPath}`;
                }
                
                const ws = watchDataManager.getWatchStatus(videoPath);
                if (watchedBadge) {
                    watchedBadge.style.display = (ws && ws.watched) ? 'flex' : 'none';
                }
                
                // Show progress bar if there's a saved position (regardless of watched status)
                if (progressContainer && progressBar && ws && ws.position > 0 && ws.duration > 0) {
                    const percent = (ws.position / ws.duration) * 100;
                    progressBar.style.width = `${percent}%`;
                    progressContainer.style.display = 'block';
                } else if (progressContainer) {
                    progressContainer.style.display = 'none';
                }
                
                // Update fanart background
                const fanartEl = document.getElementById('playlistDetailFanart');
                const fanartOverlay = document.getElementById('playlistDetailFanartOverlay');
                const fanartGradientLeft = document.getElementById('playlistDetailFanartGradientLeft');
                const fanartGradientBottom = document.getElementById('playlistDetailFanartGradientBottom');
                const fanartAccent = document.getElementById('playlistDetailFanartAccent');
                
                if (movie.fanartPath && fs.existsSync(movie.fanartPath)) {
                    const escapedPath = movie.fanartPath.replace(/'/g, "\\'");
                    fanartEl.style.backgroundImage = `url('file://${escapedPath}')`;
                    fanartOverlay.style.display = 'block';
                    fanartGradientLeft.style.display = 'block';
                    fanartGradientBottom.style.display = 'block';
                    
                    // Check for accent color
                    const movieDir = path.dirname(movie.videoPath);
                    const accentColorFile = path.join(movieDir, 'accentcolor.txt');
                    if (fs.existsSync(accentColorFile)) {
                        try {
                            const accentColor = fs.readFileSync(accentColorFile, 'utf8').trim();
                            fanartAccent.style.background = `linear-gradient(to top, ${accentColor}40 0%, transparent 50%)`;
                            fanartAccent.style.display = 'block';
                        } catch (err) {
                            fanartAccent.style.display = 'none';
                        }
                    } else {
                        fanartAccent.style.display = 'none';
                    }
                } else {
                    fanartEl.style.backgroundImage = 'none';
                    fanartOverlay.style.display = 'none';
                    fanartGradientLeft.style.display = 'none';
                    fanartGradientBottom.style.display = 'none';
                    fanartAccent.style.display = 'none';
                }
            }
        }
    }
}

/**
 * Handle header button press
 */
function handlePlaylistHeaderButton(index) {
    console.log('handlePlaylistHeaderButton called with index:', index);
    switch (index) {
        case 0: // Play All
            playPlaylistAll();
            break;
        case 1: // Shuffle
            playPlaylistShuffle();
            break;
        case 2: // Watched
            togglePlaylistWatched();
            break;
        case 3: // More Options
            console.log('Calling showPlaylistMoreOptions');
            showPlaylistMoreOptions();
            break;
    }
}

/**
 * Handle item action button press
 */
function handlePlaylistItemButton(itemIndex, buttonIndex) {
    switch (buttonIndex) {
        case 0: // Play
            playPlaylistItem(itemIndex);
            break;
        case 1: // Info
            showPlaylistItemInfo(itemIndex);
            break;
        case 2: // Reorder
            startReorderItem(itemIndex);
            break;
        case 3: // Remove
            removePlaylistItem(itemIndex);
            break;
    }
}

/**
 * Play all items in playlist (with continuous playback)
 */
function playPlaylistAll() {
    const playlist = window.currentPlaylist;
    if (!playlist || playlist.items.length === 0) return;
    
    // Save playlist state for return navigation - return to Play All button
    window.returnToPlaylist = {
        playlistId: playlist.id,
        section: 'buttons',
        focusedIndex: 0, // Play All is index 0
        buttonIndex: 0
    };
    
    // Remove playlist key handler before playing
    if (window.playlistDetailKeyHandler) {
        document.removeEventListener('keydown', window.playlistDetailKeyHandler, true);
        window.playlistDetailKeyHandler = null;
    }
    
    // Set up playlist playback queue
    window.playlistQueue = playlist.items.map(item => item.videoPath);
    window.playlistQueueIndex = 0;
    window.playlistQueueName = playlist.name;
    window.playlistQueueTotal = window.playlistQueue.length;
    
    // Play first item with proper metadata
    playPlaylistQueueItem(0);
}

/**
 * Play playlist in shuffle order (with continuous playback)
 */
function playPlaylistShuffle() {
    const playlist = window.currentPlaylist;
    if (!playlist || playlist.items.length === 0) return;
    
    // Save playlist state for return navigation - return to Shuffle button
    window.returnToPlaylist = {
        playlistId: playlist.id,
        section: 'buttons',
        focusedIndex: 1, // Shuffle is index 1
        buttonIndex: 0
    };
    
    // Remove playlist key handler before playing
    if (window.playlistDetailKeyHandler) {
        document.removeEventListener('keydown', window.playlistDetailKeyHandler, true);
        window.playlistDetailKeyHandler = null;
    }
    
    // Create shuffled queue
    const queue = playlist.items.map(item => item.videoPath);
    for (let i = queue.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [queue[i], queue[j]] = [queue[j], queue[i]];
    }
    
    window.playlistQueue = queue;
    window.playlistQueueIndex = 0;
    window.playlistQueueName = playlist.name;
    window.playlistQueueTotal = window.playlistQueue.length;
    
    // Play first item
    playPlaylistQueueItem(0);
}

/**
 * Play a specific item from the playlist queue
 * @param {number} index - Index in the queue
 */
function playPlaylistQueueItem(index) {
    if (!window.playlistQueue || index >= window.playlistQueue.length) {
        // Queue finished
        window.playlistQueue = null;
        window.playlistQueueIndex = 0;
        window.playlistQueueName = null;
        window.playlistQueueTotal = 0;
        return;
    }
    
    const videoPath = window.playlistQueue[index];
    const movie = allMovies.find(m => m.videoPath === videoPath);
    if (!movie) return;
    
    window.playlistQueueIndex = index;
    window.currentQueueIndex = index; // Keep track for nav buttons
    
    // Get saved position
    const ws = watchDataManager.getWatchStatus(movie.videoPath);
    const startPosition = (ws && ws.position > 0) ? ws.position : 0;
    
    // Build metadata (this reads accentcolor.txt for each movie)
    window.currentMovieMetadata = buildMovieOSDMetadata(movie);
    
    // Set up nav buttons for OSD
    window.pendingNavButtons = {
        hasPrevious: index > 0,
        hasNext: index < window.playlistQueue.length - 1
    };
    
    // Check if there's a next item in the queue
    const nextIndex = index + 1;
    if (nextIndex < window.playlistQueue.length) {
        const nextPath = window.playlistQueue[nextIndex];
        const nextMovie = allMovies.find(m => m.videoPath === nextPath);
        if (nextMovie) {
            // Build full OSD metadata for the next movie (same as buildMovieOSDMetadata)
            const nextMetadata = buildMovieOSDMetadata(nextMovie);
            
            // Set up next item data for Up Next modal - include ALL metadata for OSD
            window.pendingNextEpisodeData = {
                videoPath: nextMovie.videoPath,
                title: nextMetadata.title,
                year: nextMetadata.year,
                rating: nextMetadata.rating,  // MPAA rating
                runtime: nextMetadata.runtime,
                resolution: nextMetadata.resolution,
                endTime: nextMetadata.endTime,
                accentColor: nextMetadata.accentColor,
                posterPath: nextMovie.posterPath,  // Use posterPath directly from movie object
                isPlaylistItem: true,
                queueIndex: nextIndex,
                queueTotal: window.playlistQueue.length,
                // Include full metadata object for OSD to use directly
                osdMetadata: nextMetadata
            };
            console.log('Next playlist item set:', window.pendingNextEpisodeData.title);
        }
    } else {
        window.pendingNextEpisodeData = null;
        console.log('No next playlist item (end of queue)');
    }
    
    // Play the movie
    playMovieWithMetadata(movie.videoPath, startPosition, window.currentMovieMetadata);
}

/**
 * Toggle watched status for all items in playlist
 */
function togglePlaylistWatched() {
    const playlist = window.currentPlaylist;
    if (!playlist) return;
    
    // Check if all are watched
    const allWatched = playlist.items.every(item => {
        const ws = watchDataManager.getWatchStatus(item.videoPath);
        return ws && ws.watched;
    });
    
    // Toggle all
    playlist.items.forEach(item => {
        const movie = allMovies.find(m => m.videoPath === item.videoPath);
        if (movie) {
            if (allWatched) {
                watchDataManager.markUnwatched(item.videoPath);
            } else {
                watchDataManager.markWatched(item.videoPath, movie.metadata?.runtime * 60 || 0);
            }
        }
    });
    
    // Update the watched icons in place without re-rendering
    const listItems = document.querySelectorAll('.playlist-item');
    listItems.forEach((item, index) => {
        const videoPath = item.dataset.videoPath;
        const ws = watchDataManager.getWatchStatus(videoPath);
        const isWatched = ws && ws.watched;
        
        const titleRow = item.querySelector('.playlist-item-title-row');
        if (titleRow) {
            // Remove existing watched icon if any
            const existingIcon = titleRow.querySelector('.playlist-item-watched-icon');
            if (existingIcon) existingIcon.remove();
            
            // Add watched icon if now watched
            if (isWatched) {
                const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
                icon.setAttribute('class', 'playlist-item-watched-icon');
                icon.setAttribute('width', '24');
                icon.setAttribute('height', '24');
                icon.setAttribute('viewBox', '0 0 24 24');
                icon.setAttribute('fill', 'none');
                icon.innerHTML = `<path d="M12 24C15.1826 24 18.2348 22.7357 20.4853 20.4853C22.7357 18.2348 24 15.1826 24 12C24 8.8174 22.7357 5.76516 20.4853 3.51472C18.2348 1.26428 15.1826 0 12 0C8.8174 0 5.76516 1.26428 3.51472 3.51472C1.26428 5.76516 0 8.8174 0 12C0 15.1826 1.26428 18.2348 3.51472 20.4853C5.76516 22.7357 8.8174 24 12 24ZM17.2969 9.79688L11.2969 15.7969C10.8563 16.2375 10.1438 16.2375 9.70781 15.7969L6.70781 12.7969C6.26719 12.3563 6.26719 11.6438 6.70781 11.2078C7.14844 10.7719 7.86094 10.7672 8.29688 11.2078L10.5 13.4109L15.7031 8.20312C16.1437 7.7625 16.8562 7.7625 17.2922 8.20312C17.7281 8.64375 17.7328 9.35625 17.2922 9.79219L17.2969 9.79688Z" fill="var(--accent)"/>`;
                titleRow.insertBefore(icon, titleRow.firstChild);
            }
        }
    });
    
    // Update the poster area if on a list item
    if (window.playlistFocusSection === 'list') {
        updatePlaylistDetailFocus();
    }
}

/**
 * Show more options menu for playlist
 */
function showPlaylistMoreOptions() {
    console.log('showPlaylistMoreOptions called');
    const playlist = window.currentPlaylist;
    if (!playlist) {
        console.log('No current playlist!');
        return;
    }
    console.log('Playlist:', playlist.name);
    
    // Remove playlist key handler while context menu is open
    if (window.playlistDetailKeyHandler) {
        document.removeEventListener('keydown', window.playlistDetailKeyHandler, true);
    }
    
    // Build context menu items (renamed icons to match actual files)
    const menuItems = [
        { id: 'rename', icon: 'pen-to-square', label: 'Rename Playlist' },
        { id: 'clear', icon: 'clear', label: 'Clear All Items' },
        { id: 'delete', icon: 'trash', label: 'Delete Playlist' }
    ];
    
    // Create context menu HTML - match styling of other context menus
    let menuHtml = '<div class="context-menu playlist-context-menu" id="playlistContextMenu">';
    menuItems.forEach((item, index) => {
        menuHtml += `
            <div class="context-menu-item${index === 0 ? ' focused' : ''}" data-action="${item.id}">
                <img src="assets/icons/${item.icon}.svg" class="context-menu-icon" alt="">
                <span class="context-menu-text">${item.label}</span>
            </div>
        `;
    });
    menuHtml += '</div>';
    
    // Add backdrop
    menuHtml = '<div class="context-menu-backdrop" id="playlistContextBackdrop"></div>' + menuHtml;
    
    // Insert into DOM
    document.body.insertAdjacentHTML('beforeend', menuHtml);
    
    // Set up keyboard navigation
    window.playlistContextMenuIndex = 0;
    window.playlistContextMenuItems = menuItems;
    
    // Add key handler with capture to intercept before playlist handler
    window.playlistContextMenuHandler = (e) => {
        e.preventDefault();
        e.stopPropagation();
        
        if (e.key === 'ArrowUp') {
            if (window.playlistContextMenuIndex > 0) {
                window.playlistContextMenuIndex--;
                updatePlaylistContextMenuFocus();
            }
        } else if (e.key === 'ArrowDown') {
            if (window.playlistContextMenuIndex < window.playlistContextMenuItems.length - 1) {
                window.playlistContextMenuIndex++;
                updatePlaylistContextMenuFocus();
            }
        } else if (e.key === 'Enter') {
            executePlaylistContextMenuAction(window.playlistContextMenuItems[window.playlistContextMenuIndex].id);
        } else if (e.key === 'Escape' || e.key === 'Backspace') {
            closePlaylistContextMenu();
        }
    };
    
    document.addEventListener('keydown', window.playlistContextMenuHandler, true);
}

/**
 * Update context menu focus
 */
function updatePlaylistContextMenuFocus() {
    const items = document.querySelectorAll('#playlistContextMenu .context-menu-item');
    items.forEach((item, i) => {
        item.classList.toggle('focused', i === window.playlistContextMenuIndex);
    });
}

/**
 * Close playlist context menu
 * @param {boolean} skipRestoreNavigation - If true, don't restore playlist detail navigation
 */
function closePlaylistContextMenu(skipRestoreNavigation = false) {
    const menu = document.getElementById('playlistContextMenu');
    const backdrop = document.getElementById('playlistContextBackdrop');
    if (menu) menu.remove();
    if (backdrop) backdrop.remove();
    
    if (window.playlistContextMenuHandler) {
        document.removeEventListener('keydown', window.playlistContextMenuHandler, true);
        window.playlistContextMenuHandler = null;
    }
    
    // Re-add playlist detail key handler and restore focus to More Options button
    if (window.currentPlaylist && !skipRestoreNavigation) {
        setupPlaylistDetailNavigation();
        window.playlistFocusSection = 'buttons';
        window.playlistFocusedIndex = 3; // More Options button
        updatePlaylistDetailFocus();
    }
}

/**
 * Execute playlist context menu action
 */
function executePlaylistContextMenuAction(action) {
    const playlist = window.currentPlaylist;
    
    // For rename, skip restoring navigation since we're opening the keyboard
    const skipRestore = action === 'rename';
    closePlaylistContextMenu(skipRestore);
    
    switch (action) {
        case 'rename':
            // Open rename overlay (reuse existing keyboard)
            openPlaylistRenameOverlay(playlist);
            break;
        case 'clear':
            // Clear all items from playlist
            if (playlist) {
                playlistManager.clearPlaylist(playlist.id);
                const updatedPlaylist = playlistManager.getById(playlist.id);
                // Always stay on playlist detail (even if empty)
                openPlaylistDetail(updatedPlaylist, {
                    section: 'buttons',
                    focusedIndex: 3, // More Options button
                    buttonIndex: 0
                });
            }
            break;
        case 'delete':
            // Delete the playlist
            if (playlist) {
                playlistManager.deletePlaylist(playlist.id);
                closePlaylistDetail();
            }
            break;
    }
}

/**
 * Open rename overlay for playlist
 */
function openPlaylistRenameOverlay(playlist) {
    // Remove playlist detail key handler if it exists
    if (window.playlistDetailKeyHandler) {
        document.removeEventListener('keydown', window.playlistDetailKeyHandler, true);
        window.playlistDetailKeyHandler = null;
    }
    
    // Set up for rename mode
    window.playlistRenameMode = true;
    window.playlistRenameId = playlist.id;
    window.playlistRenameFromDetail = !!window.currentPlaylist; // Track if we came from detail page
    window.createPlaylistForVideoPath = null; // Not adding a video
    window.playlistInputText = playlist.name;
    window.playlistCursorPos = playlist.name.length;
    window.playlistKeyboardLayout = 'alpha';
    window.playlistKeyboardShift = false; // Don't start with shift for rename
    window.playlistKeyboardRow = 0;
    window.playlistKeyboardCol = 0;
    
    const html = `
        <div class="create-playlist-modal" id="createPlaylistModal">
            <div class="create-playlist-content">
                <div class="create-playlist-header">RENAME PLAYLIST</div>
                <div class="create-playlist-input" id="createPlaylistInput"><span class="cursor"></span></div>
                <div class="create-playlist-keyboard" id="createPlaylistKeyboard">
                    ${generateKeyboardHTML('alpha')}
                </div>
            </div>
        </div>
    `;
    
    const modal = document.createElement('div');
    modal.id = 'createPlaylistModalContainer';
    modal.innerHTML = html;
    document.body.appendChild(modal);
    
    // Setup keyboard navigation
    setupCreatePlaylistNavigation();
    updateKeyboardFocus();
    updatePlaylistInput();
}

/**
 * Build OSD metadata for a movie - extracted from openDetail so it can be reused
 * @param {Object} movie - Movie object
 * @returns {Object} Metadata object for OSD
 */
function buildMovieOSDMetadata(movie) {
    const metadata = movie.metadata || {};
    const pathModule = require('path');
    const fs = require('fs');
    
    // Get accent color from movie directory
    let accentColor = '#39ddd8'; // Default
    if (movie.videoPath) {
        const movieDir = pathModule.dirname(movie.videoPath);
        const accentColorFile = pathModule.join(movieDir, 'accentcolor.txt');
        if (fs.existsSync(accentColorFile)) {
            try {
                accentColor = fs.readFileSync(accentColorFile, 'utf8').trim();
            } catch (err) {
                console.error('Error reading accentcolor.txt:', err);
            }
        }
    }
    
    // Get resolution from NFO fileinfo - same logic as openDetail
    let resolutionText = '';
    if (metadata.fileinfo && metadata.fileinfo.streamdetails && metadata.fileinfo.streamdetails.video) {
        const videoInfo = Array.isArray(metadata.fileinfo.streamdetails.video) 
            ? metadata.fileinfo.streamdetails.video[0] 
            : metadata.fileinfo.streamdetails.video;
        
        const width = parseInt(videoInfo.width) || 0;
        const height = parseInt(videoInfo.height) || 0;
        
        if (width >= 1800 || height >= 1000) {
            resolutionText = '1080p';
        } else if (width >= 1200 || height >= 700) {
            resolutionText = '720p';
        } else if (width >= 700 || height >= 450) {
            resolutionText = '480p';
        } else if (height > 0) {
            resolutionText = '420p';
        }
    }
    
    // Calculate end time string
    let endTimeStr = '';
    if (metadata.runtime) {
        const now = new Date();
        const endTime = new Date(now.getTime() + metadata.runtime * 60000);
        const hours = endTime.getHours().toString().padStart(2, '0');
        const mins = endTime.getMinutes().toString().padStart(2, '0');
        endTimeStr = `${hours}:${mins}`;
    }
    
    return {
        title: metadata.title || 'Unknown',
        year: metadata.year || '',
        rating: metadata.mpaa || '',
        endTime: endTimeStr,
        resolution: resolutionText,
        runtime: metadata.runtime || 0,
        accentColor: accentColor,
        videoPath: movie.videoPath
    };
}

/**
 * Play a specific item (no continuous playback)
 */
function playPlaylistItem(index) {
    const playlist = window.currentPlaylist;
    if (!playlist || index >= playlist.items.length) return;
    
    // Clear playlist queue - single item playback
    window.playlistQueue = null;
    window.playlistQueueIndex = 0;
    
    const item = playlist.items[index];
    const movie = allMovies.find(m => m.videoPath === item.videoPath);
    if (movie) {
        // Save playlist state for return navigation
        window.returnToPlaylist = {
            playlistId: playlist.id,
            section: 'list',
            focusedIndex: index,
            buttonIndex: window.playlistItemButtonIndex
        };
        
        // Remove playlist key handler before playing
        if (window.playlistDetailKeyHandler) {
            document.removeEventListener('keydown', window.playlistDetailKeyHandler, true);
            window.playlistDetailKeyHandler = null;
        }
        
        // Get saved position
        const ws = watchDataManager.getWatchStatus(movie.videoPath);
        const startPosition = (ws && ws.position > 0) ? ws.position : 0;
        
        // Build metadata using the same logic as openDetail
        window.currentMovieMetadata = buildMovieOSDMetadata(movie);
        
        // Play using the same function movie detail uses
        playMovieWithMetadata(movie.videoPath, startPosition, window.currentMovieMetadata);
    }
}

/**
 * Show movie info (go to movie detail page)
 */
function showPlaylistItemInfo(index) {
    const playlist = window.currentPlaylist;
    if (!playlist || index >= playlist.items.length) return;
    
    const item = playlist.items[index];
    const movie = allMovies.find(m => m.videoPath === item.videoPath);
    if (movie) {
        // Save playlist state for return navigation
        window.returnToPlaylist = {
            playlistId: playlist.id,
            section: 'list',
            focusedIndex: index,
            buttonIndex: window.playlistItemButtonIndex
        };
        
        // Remove playlist key handler
        if (window.playlistDetailKeyHandler) {
            document.removeEventListener('keydown', window.playlistDetailKeyHandler, true);
            window.playlistDetailKeyHandler = null;
        }
        window.currentPlaylist = null;
        
        // Set playlists nav item as active
        document.querySelectorAll('.nav-item').forEach(item => {
            item.classList.remove('nav-item-active');
            if (item.dataset.page === 'playlists') {
                item.classList.add('nav-item-active');
            }
        });
        
        // Open movie detail
        openDetail(movie, false);
    }
}

/**
 * Start reorder mode for an item
 */
function startReorderItem(index) {
    window.playlistReorderMode = true;
    window.playlistReorderFromIndex = index;
    updatePlaylistDetailFocus();
}

/**
 * Remove an item from the playlist
 */
function removePlaylistItem(index) {
    const playlist = window.currentPlaylist;
    if (!playlist || index >= playlist.items.length) return;
    
    const item = playlist.items[index];
    playlistManager.removeMovie(playlist.id, item.videoPath);
    
    // Refresh
    const updatedPlaylist = playlistManager.getById(playlist.id);
    if (updatedPlaylist.items.length === 0) {
        // If empty, go back to grid
        closePlaylistDetail();
    } else {
        // Save current focus state
        const savedSection = window.playlistFocusSection;
        const savedButtonIndex = window.playlistItemButtonIndex;
        let savedFocusIndex = window.playlistFocusedIndex;
        
        // Adjust focus index: stay at same index, or go to last item if index is now out of bounds
        if (savedFocusIndex >= updatedPlaylist.items.length) {
            savedFocusIndex = updatedPlaylist.items.length - 1;
        }
        
        // Re-open playlist (this resets focus vars)
        openPlaylistDetail(updatedPlaylist);
        
        // Restore focus to list section at the same/adjusted index
        window.playlistFocusSection = savedSection;
        window.playlistFocusedIndex = savedFocusIndex;
        window.playlistItemButtonIndex = savedButtonIndex;
        updatePlaylistDetailFocus();
    }
}

/**
 * Close playlist detail and return to grid
 */
function closePlaylistDetail() {
    // Save the playlist ID before clearing it
    const closingPlaylistId = window.currentPlaylist ? window.currentPlaylist.id : null;
    
    // Remove key handler
    if (window.playlistDetailKeyHandler) {
        document.removeEventListener('keydown', window.playlistDetailKeyHandler, true);
        window.playlistDetailKeyHandler = null;
    }
    
    window.currentPlaylist = null;
    
    const detailPage = document.getElementById('detailPage');
    const contentArea = document.getElementById('contentArea');
    
    detailPage.style.display = 'none';
    contentArea.style.display = 'block';
    
    // Refresh playlist grid
    renderPlaylistGrid();
    
    // Restore focus to the playlist card that was open
    if (closingPlaylistId && typeof keyboardNav !== 'undefined') {
        setTimeout(() => {
            const cards = document.querySelectorAll('.playlist-card');
            let targetIndex = 0;
            
            cards.forEach((card, index) => {
                if (card.dataset.playlistId === closingPlaylistId) {
                    targetIndex = index;
                }
            });
            
            keyboardNav.mode = 'grid';
            keyboardNav.updateItems('.playlist-card');
            keyboardNav.currentIndex = targetIndex;
            keyboardNav.focusItem();
        }, 50);
    }
}

// Expose playlist functions globally
window.openPlaylistDetail = openPlaylistDetail;
window.renderPlaylistGrid = renderPlaylistGrid;
window.playPlaylistAll = playPlaylistAll;
window.playPlaylistShuffle = playPlaylistShuffle;
window.playPlaylistQueueItem = playPlaylistQueueItem;
window.togglePlaylistWatched = togglePlaylistWatched;
window.playPlaylistItem = playPlaylistItem;
window.showPlaylistItemInfo = showPlaylistItemInfo;
window.startReorderItem = startReorderItem;
window.removePlaylistItem = removePlaylistItem;
window.closePlaylistDetail = closePlaylistDetail;
window.updatePlaylistDetailFocus = updatePlaylistDetailFocus;
window.setupEmptyPlaylistNavigation = setupEmptyPlaylistNavigation;

// ==================== END PLAYLISTS ====================

// Open TV show detail
function openTVShowDetail(show) {
    console.log('Opening TV show detail for:', show.title);
    
    // Set current show globally for context menu and other functions
    window.currentShow = show;
    // Clear current season (we're at show level, not season level)
    window.currentSeason = null;
    
    const detailPage = document.getElementById('detailPage');
    const content = document.getElementById('detailContent');
    const contentArea = document.getElementById('contentArea');
    
    // Get watch statistics
    const watchStats = watchDataManager.getShowWatchStats(show);
    const nextEpisode = watchDataManager.getNextEpisode(show);
    
    console.log('Watch stats:', watchStats);
    console.log('Next episode:', nextEpisode);
    
    // Check for fanart - ONLY BACKGROUND CODE FROM MOVIES
    let fanartPath = '';
    let accentColor = '';
    if (show.showPath) {
        const fs = require('fs');
        const path = require('path');
        
        const fanartVariations = ['fanart.jpg', 'Fanart.jpg', 'FANART.jpg', 'fanart.JPG'];
        for (const filename of fanartVariations) {
            const fanartFile = path.join(show.showPath, filename);
            if (fs.existsSync(fanartFile)) {
                fanartPath = fanartFile.replace(/'/g, "\\'");
                console.log('Found fanart:', fanartPath);
                break;
            }
        }
        
        // Check for accent color
        const accentColorFile = path.join(show.showPath, 'accentcolor.txt');
        if (fs.existsSync(accentColorFile)) {
            try {
                accentColor = fs.readFileSync(accentColorFile, 'utf8').trim();
                console.log('Found accent color:', accentColor);
            } catch (err) {
                console.error('Error reading accentcolor.txt:', err);
            }
        }
    }
    
    // Build HTML - start fresh
    let html = '';
    
    // Add fanart background if exists
    if (fanartPath) {
        html += `
            <div class="detail-fanart" style="background-image: url('file://${fanartPath}');"></div>
            <div class="detail-fanart-overlay"></div>
            <div class="detail-fanart-gradient-left"></div>
            <div class="detail-fanart-gradient-bottom"></div>
        `;
        
        // Add accent gradient if accent color exists and setting is enabled
        const tvDetailGradientEnabled = localStorage.getItem('tvDetailGradientEnabled') !== 'false';
        if (accentColor && tvDetailGradientEnabled) {
            html += `<div class="detail-fanart-gradient-bottom-accent" style="background: linear-gradient(to top, ${accentColor}40 0%, transparent 50%);"></div>`;
        }
    }
    
    // Simple wrapper using grid positioning
    html += '<div class="tv-detail-wrapper">';
    
    // Spacer container to take up available space
    html += '<div class="tv-content-spacer">';
    
    // Info group (title, meta, plot)
    html += '<div class="tv-info-group">';
    
    // Title
    html += `<h1 class="detail-title">${show.title}</h1>`;
    
    // Metadata with dividers (like movie detail)
    html += '<div class="detail-meta">';
    let metaItems = [];
    if (show.year) metaItems.push(show.year);
    if (show.mpaa || show.certification) metaItems.push(show.mpaa || show.certification);
    if (show.rating) metaItems.push(`IMDb ${parseFloat(show.rating).toFixed(1)}`);
    
    metaItems.forEach((item, index) => {
        if (index > 0) {
            html += '<div class="detail-meta-divider"></div>';
        }
        html += `<span>${item}</span>`;
    });
    html += '</div>';
    
    // Plot
    if (show.plot) {
        html += `<p class="detail-plot">${show.plot}</p>`;
    }
    
    html += '</div>'; // End tv-info-group
    html += '</div>'; // End tv-content-spacer
    
    // Actions group (buttons and seasons)
    html += '<div class="tv-actions-group">';
    
    // Action Buttons
    html += '<div class="detail-actions">';
    
    // Next Episode button
    if (nextEpisode) {
        const buttonText = nextEpisode.watchStatus && nextEpisode.watchStatus.position > 0 ? 'Resume' : 'Next Episode';
        const escapedPath = nextEpisode.videoPath.replace(/'/g, "\\'");
        const seasonEp = `S${nextEpisode.season.toString().padStart(2, '0')} E${nextEpisode.episode.toString().padStart(2, '0')}`;
        
        html += `
            <button class="detail-button detail-button-play" onclick="playTVEpisode('${escapedPath}', ${nextEpisode.watchStatus ? nextEpisode.watchStatus.position : 0}, '${show.title.replace(/'/g, "\\'")}', '${seasonEp}', '${nextEpisode.title.replace(/'/g, "\\'")}')">
                <img src="assets/icons/play.svg" class="detail-button-icon" alt="">
                <span class="detail-button-text">${buttonText}</span>
            </button>
        `;
    }
    
    // Shuffle button
    html += `
        <button class="detail-button" onclick="alert('Shuffle not yet implemented')">
            <img src="assets/icons/shuffle.svg" class="detail-button-icon" alt="">
            <span class="detail-button-text">Shuffle</span>
        </button>
    `;
    
    // Mark as Watched button
    const allWatched = watchStats.watchedEpisodes === watchStats.totalEpisodes;
    const watchIcon = allWatched ? 'unwatched' : 'watched';
    const watchText = allWatched ? 'Mark Unwatched' : 'Mark Watched';
    html += `
        <button class="detail-button" onclick="alert('Mark watched not yet implemented')">
            <img src="assets/icons/${watchIcon}.svg" class="detail-button-icon" alt="">
            <span class="detail-button-text">${watchText}</span>
        </button>
    `;
    
    // Favorites button
    html += `
        <button class="detail-button" onclick="alert('Favorites not yet implemented')">
            <img src="assets/icons/heart-outline.svg" class="detail-button-icon" alt="">
            <span class="detail-button-text">Add to Favorites</span>
        </button>
    `;
    
    // More Options button
    html += `
        <button class="detail-button" onclick="showTVShowDetailContextMenu()">
            <img src="assets/icons/more-options.svg" class="detail-button-icon" alt="">
            <span class="detail-button-text">More Options</span>
        </button>
    `;
    
    html += '</div>'; // End detail-actions
    
    // Seasons grid (no header)
    html += '<div class="tv-seasons-scroll">';
    html += '<div class="tv-seasons-grid">';
    
    if (show.seasons && show.seasons.length > 0) {
        show.seasons.forEach(season => {
            const seasonStats = watchDataManager.getSeasonWatchStats(season);
            const allWatched = seasonStats.watchedEpisodes === seasonStats.totalEpisodes;
            const hasUnwatched = seasonStats.unwatchedEpisodes > 0;
            
            html += `<div class="tv-season-card" data-season="${season.number}" onclick="openSeasonDetail(window.currentShow || window.allShows.find(s => s.showPath === '${show.showPath.replace(/'/g, "\\'")}'), ${season.number})">`;
            html += '<div class="tv-season-poster-container">';
            
            // Add nested strokes like cast cards
            html += '<div class="tv-season-outer-stroke">';
            html += '<div class="tv-season-inner-stroke">';
            
            // Use season poster, or fallback to main show poster
            let posterSrc = '';
            if (season.posterPath) {
                posterSrc = `file://${season.posterPath}`;
            } else if (show.posterPath) {
                posterSrc = `file://${show.posterPath}`;
            }
            
            if (posterSrc) {
                html += `<img src="${posterSrc}" class="tv-season-poster" alt="Season ${season.number}">`;
            } else {
                html += `<div class="tv-season-poster tv-season-poster-placeholder"></div>`;
            }
            
            html += '</div>'; // End inner stroke
            html += '</div>'; // End outer stroke
            
            // Badges only (no label overlay)
            if (allWatched) {
                // Use inline SVG - CSS will apply accent color via fill: var(--accent)
                html += `<div class="tv-season-badge tv-season-badge-watched">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M12 24C15.1826 24 18.2348 22.7357 20.4853 20.4853C22.7357 18.2348 24 15.1826 24 12C24 8.8174 22.7357 5.76516 20.4853 3.51472C18.2348 1.26428 15.1826 0 12 0C8.8174 0 5.76516 1.26428 3.51472 3.51472C1.26428 5.76516 0 8.8174 0 12C0 15.1826 1.26428 18.2348 3.51472 20.4853C5.76516 22.7357 8.8174 24 12 24ZM17.2969 9.79688L11.2969 15.7969C10.8563 16.2375 10.1438 16.2375 9.70781 15.7969L6.70781 12.7969C6.26719 12.3563 6.26719 11.6438 6.70781 11.2078C7.14844 10.7719 7.86094 10.7672 8.29688 11.2078L10.5 13.4109L15.7031 8.20312C16.1437 7.7625 16.8562 7.7625 17.2922 8.20312C17.7281 8.64375 17.7328 9.35625 17.2922 9.79219L17.2969 9.79688Z"/>
                    </svg>
                </div>`;
            } else if (hasUnwatched) {
                html += `<div class="tv-season-badge tv-season-badge-count">${seasonStats.unwatchedEpisodes}</div>`;
            }
            
            html += '</div>'; // End poster container
            
            const episodeText = season.totalEpisodes === 1 ? 'Episode' : 'Episodes';
            html += `<div class="tv-season-title">${season.name}</div>`;
            html += `<div class="tv-season-count">${season.totalEpisodes} ${episodeText}</div>`;
            html += '</div>'; // End season card
        });
    }
    
    html += '</div>'; // End tv-seasons-grid
    html += '</div>'; // End tv-seasons-scroll
    html += '</div>'; // End tv-actions-group
    html += '</div>'; // End tv-detail-wrapper
    
    // Set content
    content.innerHTML = html;
    contentArea.style.display = 'none';
    detailPage.style.display = 'block';
    
    // Store current show for season navigation
    window.currentShow = show;
    
    // Enter TV detail keyboard navigation mode
    if (window.keyboardNav) {
        window.keyboardNav.enterTVDetailMode();
        
        // If we have a saved season index (e.g., from context menu), switch to seasons carousel
        if (window.keyboardNav.savedSeasonIndex !== undefined) {
            window.keyboardNav.switchToTVSeasons();
        }
    }
    
    console.log('TV show detail page rendered');
}

// Open season detail page
function openSeasonDetail(show, seasonNumber) {
    console.log('Opening season detail:', show.title, 'Season', seasonNumber);
    
    // Save the season ARRAY INDEX for back navigation (not seasonNumber - 1)
    if (window.keyboardNav) {
        const seasonIndex = show.seasons.findIndex(s => s.number === seasonNumber);
        window.keyboardNav.savedSeasonIndex = seasonIndex >= 0 ? seasonIndex : 0;
        console.log('Saved season array index for back navigation:', seasonIndex);
    }
    
    const detailPage = document.getElementById('detailPage');
    const content = document.getElementById('detailContent');
    const contentArea = document.getElementById('contentArea');
    
    // Find the season data
    const season = show.seasons.find(s => s.number === seasonNumber);
    if (!season) {
        console.error('Season not found:', seasonNumber);
        return;
    }
    
    // Get fanart and accent color from show
    let fanartPath = '';
    let accentColor = '';
    if (show.showPath) {
        const fs = require('fs');
        const path = require('path');
        
        const fanartVariations = ['fanart.jpg', 'Fanart.jpg', 'FANART.jpg', 'fanart.JPG'];
        for (const filename of fanartVariations) {
            const fanartFile = path.join(show.showPath, filename);
            if (fs.existsSync(fanartFile)) {
                fanartPath = fanartFile.replace(/'/g, "\\'");
                console.log('Found fanart:', fanartPath);
                break;
            }
        }
        
        // Check for accent color
        const accentColorFile = path.join(show.showPath, 'accentcolor.txt');
        if (fs.existsSync(accentColorFile)) {
            try {
                accentColor = fs.readFileSync(accentColorFile, 'utf8').trim();
                console.log('Found accent color:', accentColor);
            } catch (err) {
                console.error('Error reading accentcolor.txt:', err);
            }
        }
    }
    
    // Build HTML
    let html = '';
    
    // Add fanart background
    if (fanartPath) {
        html += `
            <div class="detail-fanart" style="background-image: url('file://${fanartPath}');"></div>
            <div class="detail-fanart-overlay"></div>
            <div class="detail-fanart-gradient-left"></div>
            <div class="detail-fanart-gradient-bottom"></div>
        `;
        
        // Add accent gradient if setting is enabled
        const tvDetailGradientEnabled = localStorage.getItem('tvDetailGradientEnabled') !== 'false';
        if (accentColor && tvDetailGradientEnabled) {
            html += `<div class="detail-fanart-gradient-bottom-accent" style="background: linear-gradient(to top, ${accentColor}40 0%, transparent 50%);"></div>`;
        }
    }
    
    // Season detail wrapper
    html += '<div class="season-detail-wrapper">';
    
    // Season tabs for top-bar (will be positioned absolutely)
    html += '<div class="season-tabs-container">';
    html += '<div class="season-tabs">';
    show.seasons.forEach(s => {
        const activeClass = s.number === seasonNumber ? ' season-tab-active' : '';
        html += `<div class="season-tab${activeClass}" onclick="openSeasonDetail(window.allShows.find(show => show.title === '${show.title.replace(/'/g, "\\'")}'), ${s.number})">${s.name}</div>`;
    });
    html += '</div>'; // End season-tabs
    html += '</div>'; // End season-tabs-container
    
    // Content spacer
    html += '<div class="season-content-spacer">';
    
    // Info group (title, episode title, metadata, plot)
    html += '<div class="season-info-group">';
    
    // Show title
    html += `<h1 class="season-show-title">${show.title}</h1>`;
    
    // Get first episode for initial display
    const firstEpisode = season.episodes[0];
    
    // Episode title
    html += `<h2 class="season-episode-title" id="seasonEpisodeTitle">${firstEpisode.title}</h2>`;
    
    // Episode metadata
    html += '<div class="season-episode-meta" id="seasonEpisodeMeta">';
    html += `<span>S${seasonNumber.toString().padStart(2, '0')} E${firstEpisode.episode.toString().padStart(2, '0')}</span>`;
    html += '<div class="detail-meta-divider"></div>';
    const airDateFormatted = firstEpisode.aired ? formatAirDate(firstEpisode.aired) : '';
    if (airDateFormatted) {
        html += `<span>${airDateFormatted}</span>`;
        html += '<div class="detail-meta-divider"></div>';
    }
    const runtimeDisplay = firstEpisode.runtime ? (typeof firstEpisode.runtime === 'string' ? firstEpisode.runtime : formatRuntime(firstEpisode.runtime)) : '21m';
    html += `<span>${runtimeDisplay}</span>`;
    if (firstEpisode.contentRating) {
        html += '<div class="detail-meta-divider"></div>';
        html += `<span>${firstEpisode.contentRating}</span>`;
    }
    if (firstEpisode.rating) {
        html += '<div class="detail-meta-divider"></div>';
        html += `<span>IMDb ${firstEpisode.rating}</span>`;
    }
    // Calculate end time based on runtime minus watch progress
    if (firstEpisode.runtime) {
        const runtimeMinutes = typeof firstEpisode.runtime === 'string' 
            ? parseInt(firstEpisode.runtime) || 21 
            : firstEpisode.runtime;
        
        // Get watch progress and subtract from runtime (even for watched episodes)
        let remainingMinutes = runtimeMinutes;
        const watchStatus = watchDataManager.getWatchStatus(firstEpisode.videoPath);
        if (watchStatus && watchStatus.position > 0) {
            const watchedMinutes = Math.floor(watchStatus.position / 60);
            remainingMinutes = Math.max(0, runtimeMinutes - watchedMinutes);
        }
        
        const now = new Date();
        const endTime = new Date(now.getTime() + remainingMinutes * 60000);
        const endHours = endTime.getHours().toString().padStart(2, '0');
        const endMins = endTime.getMinutes().toString().padStart(2, '0');
        html += '<div class="detail-meta-divider"></div>';
        html += `<span>Ends at ${endHours}:${endMins}</span>`;
    }
    html += '</div>'; // End episode-meta
    
    // Episode plot
    html += `<div class="season-episode-plot" id="seasonEpisodePlot">${firstEpisode.plot || ''}</div>`;
    
    html += '</div>'; // End season-info-group
    html += '</div>'; // End season-content-spacer
    
    // Episodes group (thumbnails, buttons, media badges)
    html += '<div class="season-episodes-group">';
    
    // Episode thumbnails scroll
    html += '<div class="season-episodes-scroll">';
    html += '<div class="season-episodes-grid">';
    
    season.episodes.forEach(episode => {
        const episodeId = `s${seasonNumber}e${episode.episode}`;
        const watchStatus = watchDataManager.getWatchStatus(episode.videoPath);
        const isWatched = watchStatus && watchStatus.watched;
        const hasProgress = watchStatus && watchStatus.position > 0; // Show progress even if watched
        
        // Escape episode data for HTML attribute
        const episodeDataJson = JSON.stringify(episode).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
        
        html += `<div class="season-episode-card" data-episode-index="${episode.episode - 1}" data-video-path="${episode.videoPath}" data-episode-data="${episodeDataJson}">`;
        html += '<div class="season-episode-thumb-container">';
        
        // Add nested strokes for focus styling
        html += '<div class="season-episode-outer-stroke">';
        html += '<div class="season-episode-inner-stroke">';
        
        // Thumbnail image
        const thumbPath = episode.videoPath.replace(/\.[^.]+$/, '.jpg');
        const fs = require('fs');
        if (fs.existsSync(thumbPath)) {
            html += `<img src="file://${thumbPath}" class="season-episode-thumb" alt="Episode ${episode.episode}">`;
        } else {
            html += `<div class="season-episode-thumb season-episode-thumb-placeholder"></div>`;
        }
        
        html += '</div>'; // End inner-stroke
        html += '</div>'; // End outer-stroke
        
        // Episode number badge with optional watched icon
        if (isWatched) {
            const accentColor = show.accentColor || '#39ddd8';
            html += `<div class="season-episode-number">`;
            html += `<span class="season-episode-watched-icon">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M12 24C15.1826 24 18.2348 22.7357 20.4853 20.4853C22.7357 18.2348 24 15.1826 24 12C24 8.8174 22.7357 5.76516 20.4853 3.51472C18.2348 1.26428 15.1826 0 12 0C8.8174 0 5.76516 1.26428 3.51472 3.51472C1.26428 5.76516 0 8.8174 0 12C0 15.1826 1.26428 18.2348 3.51472 20.4853C5.76516 22.7357 8.8174 24 12 24ZM17.2969 9.79688L11.2969 15.7969C10.8563 16.2375 10.1438 16.2375 9.70781 15.7969L6.70781 12.7969C6.26719 12.3563 6.26719 11.6438 6.70781 11.2078C7.14844 10.7719 7.86094 10.7672 8.29688 11.2078L10.5 13.4109L15.7031 8.20312C16.1437 7.7625 16.8562 7.7625 17.2922 8.20312C17.7281 8.64375 17.7328 9.35625 17.2922 9.79219L17.2969 9.79688Z"/>
                </svg>
            </span>`;
            html += `E${episode.episode.toString().padStart(2, '0')}`;
            html += `</div>`;
        } else {
            html += `<div class="season-episode-number">E${episode.episode.toString().padStart(2, '0')}</div>`;
        }
        
        // Progress bar
        if (hasProgress) {
            html += '<div class="progress-bar">';
            html += `<div class="progress-bar-fill" style="width: ${Math.min(watchStatus.percentage, 100)}%"></div>`;
            html += '</div>';
        }
        
        html += '</div>'; // End thumb-container
        html += '</div>'; // End episode-card
    });
    
    html += '</div>'; // End episodes-grid
    html += '</div>'; // End episodes-scroll
    
    // Buttons and media badges row
    html += '<div class="season-actions-row">';
    
    // Action buttons
    html += '<div class="season-action-buttons">';
    
    // Play button - plays the currently focused episode
    // Use first episode as default (already declared above at line 863)
    const firstWs = watchDataManager.getWatchStatus(firstEpisode.videoPath);
    const defaultButtonText = firstWs && firstWs.position > 0 ? 'Resume' : 'Play';
    const defaultSeasonEp = `S${seasonNumber.toString().padStart(2, '0')} E${firstEpisode.episode.toString().padStart(2, '0')}`;
    
    html += `<button class="detail-button detail-button-play" id="seasonPlayButton" onclick="playFocusedEpisode()">`;
    html += '<img src="assets/icons/play.svg" class="detail-button-icon" alt="">';
    html += `<span class="detail-button-text" id="seasonPlayButtonText">${defaultButtonText}</span>`;
    html += '</button>';
    
    // Mark Watched button - shows based on focused episode's watched status
    const firstEpisodeWatched = watchDataManager.getWatchStatus(firstEpisode.videoPath)?.watched;
    const watchedIcon = firstEpisodeWatched ? 'unwatched.svg' : 'watched.svg';
    const watchedText = firstEpisodeWatched ? 'Mark Unwatched' : 'Mark Watched';
    
    html += `<button class="detail-button" id="seasonWatchedButton" onclick="toggleSeasonEpisodeWatched()">`;
    html += `<img src="assets/icons/${watchedIcon}" class="detail-button-icon" id="seasonWatchedIcon" alt="">`;
    html += `<span class="detail-button-text" id="seasonWatchedText">${watchedText}</span>`;
    html += '</button>';
    
    // Favorite button
    html += '<button class="detail-button">';
    html += '<img src="assets/icons/heart-outline.svg" class="detail-button-icon" alt="">';
    html += '<span class="detail-button-text">Add to Favorites</span>';
    html += '</button>';
    
    // More button
    html += '<button class="detail-button" onclick="showSeasonContextMenu()">';
    html += '<img src="assets/icons/more-options.svg" class="detail-button-icon" alt="">';
    html += '<span class="detail-button-text">More Options</span>';
    html += '</button>';
    
    html += '</div>'; // End action-buttons
    
    // Media info badges (will be updated on focus change)
    html += '<div class="season-media-badges" id="seasonMediaBadges">';
    
    // Resolution badge - read from NFO streamdetails like movies
    let resolutionText = 'SD';
    let resolutionIcon = 'sd';
    
    // Check if first episode has fileinfo.streamdetails.video
    if (firstEpisode && firstEpisode.videoPath) {
        const path = require('path');
        const fs = require('fs');
        const baseName = path.basename(firstEpisode.videoPath, path.extname(firstEpisode.videoPath));
        const nfoPath = path.join(path.dirname(firstEpisode.videoPath), `${baseName}.nfo`);
        
        if (fs.existsSync(nfoPath)) {
            const nfoContent = fs.readFileSync(nfoPath, 'utf8');
            const widthMatch = nfoContent.match(/<width>(\d+)<\/width>/);
            const heightMatch = nfoContent.match(/<height>(\d+)<\/height>/);
            
            if (widthMatch && heightMatch) {
                const width = parseInt(widthMatch[1]);
                const height = parseInt(heightMatch[1]);
                
                if (width >= 3800 || height >= 2100) {
                    resolutionText = '4K';
                    resolutionIcon = 'hd';
                } else if (width >= 1800 || height >= 1000) {
                    resolutionText = '1080p';
                    resolutionIcon = 'hd';
                } else if (width >= 1200 || height >= 700) {
                    resolutionText = '720p';
                    resolutionIcon = 'sd';
                } else if (width >= 700 || height >= 450) {
                    resolutionText = '480p';
                    resolutionIcon = 'sd';
                }
            }
        }
    }
    
    html += `
        <div class="detail-badge">
            <img src="assets/icons/${resolutionIcon}.svg" class="detail-badge-icon" alt="">
            <span class="detail-badge-text">${resolutionText}</span>
        </div>
    `;
    
    // Language badge - read from NFO
    let languageText = 'English'; // Default
    
    if (firstEpisode && firstEpisode.videoPath) {
        const path = require('path');
        const fs = require('fs');
        const baseName = path.basename(firstEpisode.videoPath, path.extname(firstEpisode.videoPath));
        const nfoPath = path.join(path.dirname(firstEpisode.videoPath), `${baseName}.nfo`);
        
        if (fs.existsSync(nfoPath)) {
            const nfoContent = fs.readFileSync(nfoPath, 'utf8');
            const langMatch = nfoContent.match(/<audio>[\s\S]*?<language>([^<]+)<\/language>/);
            
            if (langMatch) {
                const lang = langMatch[1].toLowerCase();
                const langMap = {
                    'eng': 'English', 'spa': 'Spanish', 'fre': 'French', 'french': 'French',
                    'ger': 'German', 'deu': 'German', 'ita': 'Italian', 'jpn': 'Japanese',
                    'kor': 'Korean', 'chi': 'Chinese', 'por': 'Portuguese',
                    'rus': 'Russian', 'english': 'English', 'spanish': 'Spanish',
                    'german': 'German', 'italian': 'Italian', 'japanese': 'Japanese',
                    'korean': 'Korean', 'chinese': 'Chinese', 'portuguese': 'Portuguese',
                    'russian': 'Russian', 'ara': 'Arabic', 'arabic': 'Arabic',
                    'hin': 'Hindi', 'hindi': 'Hindi', 'dut': 'Dutch', 'dutch': 'Dutch',
                    'nld': 'Dutch', 'pol': 'Polish', 'polish': 'Polish',
                    'swe': 'Swedish', 'swedish': 'Swedish', 'nor': 'Norwegian',
                    'norwegian': 'Norwegian', 'dan': 'Danish', 'danish': 'Danish',
                    'fin': 'Finnish', 'finnish': 'Finnish'
                };
                languageText = langMap[lang] || lang.charAt(0).toUpperCase() + lang.slice(1);
            }
        }
    }
    
    html += `
        <div class="detail-badge">
            <img src="assets/icons/language.svg" class="detail-badge-icon" alt="">
            <span class="detail-badge-text">${languageText}</span>
        </div>
    `;
    
    // Subtitle badge - check external first, then embedded if needed
    let subtitleText = 'None';
    
    if (firstEpisode && firstEpisode.videoPath) {
        // Extract languages from external .srt files synchronously
        const fs = require('fs');
        const path = require('path');
        let hasExternalSubs = false;
        
        try {
            const videoDir = path.dirname(firstEpisode.videoPath);
            const videoBasename = path.basename(firstEpisode.videoPath, path.extname(firstEpisode.videoPath));
            const files = fs.readdirSync(videoDir);
            
            // Try to match subtitle files more leniently
            const srtFiles = files.filter(file => {
                if (!file.endsWith('.srt')) return false;
                
                const srtBasename = path.basename(file, '.srt');
                
                // Check multiple matching strategies:
                // 1. Exact match with video basename
                if (srtBasename.startsWith(videoBasename)) return true;
                
                // 2. Extract episode identifier (e.g., S01E01) and match on that
                const episodeMatch = videoBasename.match(/S\d+E\d+/i);
                if (episodeMatch && srtBasename.includes(episodeMatch[0])) return true;
                
                // 3. Check if subtitle has same show name prefix
                // e.g., "The 8 Show - S01E01" matches both "The 8 Show - S01E01 - Episode 1.mp4" 
                // and "The 8 Show - S01E01.eng.forced.srt"
                const showPrefix = videoBasename.split(' - ')[0];
                if (showPrefix && srtBasename.startsWith(showPrefix)) {
                    // Make sure it's for the same episode
                    const videoEp = videoBasename.match(/[Ee]\d+/);
                    const srtEp = srtBasename.match(/[Ee]\d+/);
                    if (videoEp && srtEp && videoEp[0].toLowerCase() === srtEp[0].toLowerCase()) {
                        return true;
                    }
                }
                
                return false;
            });
            
            console.log(`Video: ${videoBasename}`);
            console.log(`Found subtitle files:`, srtFiles);
            
            if (srtFiles.length > 0) {
                hasExternalSubs = true;
                console.log('>>> Processing subtitle files for language extraction...');
                // Extract language codes from filenames
                const languages = [];
                srtFiles.forEach(srtFile => {
                    console.log(`>>> Processing file: "${srtFile}"`);
                    let langCode = 'und';
                    
                    // Try multiple patterns to handle different naming conventions:
                    // 1. .lang.forced.srt or .lang.sdh.srt
                    let match = srtFile.match(/\.([a-z]{2,3})\.(forced|sdh)\.srt$/i);
                    console.log(`>>> Pattern 1 result:`, match);
                    if (match) {
                        langCode = match[1].toLowerCase();
                        console.log(`>>>   ✓ Matched! langCode="${langCode}"`);
                    } else {
                        console.log(`>>>   Pattern 1 did not match, trying pattern 2...`);
                        // 2. .forced.lang.srt or .sdh.lang.srt (reversed order)
                        match = srtFile.match(/\.(forced|sdh)\.([a-z]{2,3})\.srt$/i);
                        console.log(`>>> Pattern 2 result:`, match);
                        if (match) {
                            langCode = match[2].toLowerCase();
                            console.log(`>>>   ✓ Matched! langCode="${langCode}"`);
                        } else {
                            console.log(`>>>   Pattern 2 did not match, trying pattern 3...`);
                            // 3. Standard .lang.srt
                            match = srtFile.match(/\.([a-z]{2,3})\.srt$/i);
                            console.log(`>>> Pattern 3 result:`, match);
                            if (match) {
                                langCode = match[1].toLowerCase();
                                console.log(`>>>   ✓ Matched! langCode="${langCode}"`);
                            } else {
                                console.log(`>>>   ✗ NO PATTERNS MATCHED!`);
                            }
                        }
                    }
                    console.log(`>>> Final langCode for this file: "${langCode}"`);
                    
                    // Map language code to full name
                    const langMap = {
                        'eng': 'English', 'en': 'English',
                        'spa': 'Spanish', 'es': 'Spanish',
                        'fre': 'French', 'fra': 'French', 'fr': 'French',
                        'ger': 'German', 'deu': 'German', 'de': 'German',
                        'ita': 'Italian', 'it': 'Italian',
                        'jpn': 'Japanese', 'ja': 'Japanese',
                        'kor': 'Korean', 'ko': 'Korean',
                        'chi': 'Chinese', 'zho': 'Chinese', 'zh': 'Chinese',
                        'por': 'Portuguese', 'pt': 'Portuguese',
                        'rus': 'Russian', 'ru': 'Russian',
                        'ara': 'Arabic', 'ar': 'Arabic',
                        'hin': 'Hindi', 'hi': 'Hindi',
                        'dut': 'Dutch', 'nld': 'Dutch', 'nl': 'Dutch',
                        'pol': 'Polish', 'pl': 'Polish',
                        'swe': 'Swedish', 'sv': 'Swedish',
                        'nor': 'Norwegian', 'no': 'Norwegian',
                        'dan': 'Danish', 'da': 'Danish',
                        'fin': 'Finnish', 'fi': 'Finnish'
                    };
                    
                    const language = langMap[langCode] || langCode.toUpperCase();
                    console.log(`>>> Mapped langCode "${langCode}" to language "${language}"`);
                    if (!languages.includes(language)) {
                        languages.push(language);
                        console.log(`>>> Added "${language}" to languages array, now:`, languages);
                    }
                });
                
                console.log(`>>> FINAL languages array for episode:`, languages);
                subtitleText = languages.join(', ');
                console.log(`>>> FINAL subtitleText for episode: "${subtitleText}"`);
            }
        } catch (err) {
            console.error('Error checking for external subtitles:', err);
        }
        
        console.log(`>>> About to check hasExternalSubs: ${hasExternalSubs}`);
        // Only check for embedded subtitles if no external subs found
        if (!hasExternalSubs) {
            const { getSubtitleSummary } = require('./subtitle-detector');
            const currentEpisodePath = firstEpisode.videoPath;
            
            getSubtitleSummary(firstEpisode.videoPath).then(result => {
                // Only update if we're still viewing the same episode
                const currentFirstEpisode = window.currentSeason?.episodes?.[0];
                if (currentFirstEpisode && currentFirstEpisode.videoPath === currentEpisodePath) {
                    const subtitleBadge = document.querySelector('.season-media-badges .detail-badge:last-child .detail-badge-text');
                    if (subtitleBadge) {
                        subtitleBadge.textContent = result;
                    }
                }
            }).catch(err => {
                console.error('Error checking for embedded subtitles:', err);
            });
        }
    }
    
    console.log(`>>> ABOUT TO RENDER SUBTITLE BADGE WITH TEXT: "${subtitleText}"`);
    html += `
        <div class="detail-badge">
            <img src="assets/icons/subtitles.svg" class="detail-badge-icon" alt="">
            <span class="detail-badge-text">${subtitleText}</span>
        </div>
    `;
    
    html += '</div>'; // End media-badges
    
    html += '</div>'; // End actions-row
    html += '</div>'; // End episodes-group
    html += '</div>'; // End season-detail-wrapper
    
    // Set content
    content.innerHTML = html;
    contentArea.style.display = 'none';
    detailPage.style.display = 'block';
    
    // Store current show and season for later use
    const wasOnSeasonDetail = window.currentShow && window.currentSeason;
    const isSwitchingSeason = wasOnSeasonDetail && window.currentShow.title === show.title && window.currentSeason.number !== seasonNumber;
    const isRefreshingSameSeason = wasOnSeasonDetail && window.currentShow.title === show.title && window.currentSeason.number === seasonNumber;
    const isSelectingFromTabs = window.keyboardNav && window.keyboardNav.detailSubMode === 'season-tabs';
    
    window.currentShow = show;
    window.currentSeason = season;
    
    // Enter season detail keyboard navigation mode
    if (window.keyboardNav) {
        // Only restore episode position if refreshing the SAME season (not when switching to a different season)
        // Pass fromTabSelection flag to prevent scroll animation when selecting from tabs
        window.keyboardNav.enterSeasonDetailMode(isRefreshingSameSeason, isSelectingFromTabs);
        
        // Position tabs after render - only scroll if needed to show active tab
        requestAnimationFrame(() => {
            const tabsContainer = document.querySelector('.season-tabs-container');
            if (tabsContainer) {
                const activeTab = document.querySelector('.season-tab-active');
                if (activeTab) {
                    const containerRect = tabsContainer.getBoundingClientRect();
                    const tabRect = activeTab.getBoundingClientRect();
                    
                    // Check if tab is fully visible
                    const isFullyVisible = tabRect.left >= containerRect.left && tabRect.right <= containerRect.right;
                    
                    if (!isFullyVisible) {
                        // Tab is out of view, scroll it into view with padding
                        // Disable smooth scrolling for instant positioning
                        tabsContainer.style.scrollBehavior = 'auto';
                        
                        const padding = 48; // 48px padding from edge
                        
                        if (tabRect.left < containerRect.left) {
                            // Tab is off to the left, scroll left to show it
                            const scrollAmount = tabRect.left - containerRect.left - padding;
                            tabsContainer.scrollLeft += scrollAmount;
                        } else if (tabRect.right > containerRect.right) {
                            // Tab is off to the right, scroll right to show it
                            const scrollAmount = tabRect.right - containerRect.right + padding;
                            tabsContainer.scrollLeft += scrollAmount;
                        }
                        
                        // Re-enable smooth scrolling after positioning
                        setTimeout(() => {
                            tabsContainer.style.scrollBehavior = '';
                        }, 50);
                    }
                }
            }
        });
    }
    
    console.log('Season detail page rendered');
}

// Play TV episode function
window.playTVEpisode = function(videoPath, startPosition, showTitle, seasonEp, episodeTitle) {
    console.log('Playing TV episode:', showTitle, seasonEp, episodeTitle);
    
    // Track the currently playing video path for focus on return
    currentlyPlayingVideoPath = videoPath;
    
    // Find the show to get its accent color
    let accentColor = '#39ddd8'; // Default cyan
    if (window.currentShow && window.currentShow.showPath) {
        const accentColorFile = path.join(window.currentShow.showPath, 'accentcolor.txt');
        if (fs.existsSync(accentColorFile)) {
            try {
                accentColor = fs.readFileSync(accentColorFile, 'utf8').trim();
                console.log('Using TV show accent color:', accentColor);
            } catch (err) {
                console.error('Error reading accentcolor.txt:', err);
            }
        }
    }
    
    // Calculate end time (if episode has duration in metadata)
    const endTimeStr = ''; // TODO: Calculate from episode duration
    
    const metadata = {
        title: showTitle,
        year: seasonEp,
        rating: episodeTitle,
        endTime: endTimeStr,
        resolution: '',
        runtime: 0,
        accentColor: accentColor, // Pass show accent color
        videoPath: videoPath
    };
    
    // Find next episode data for Up Next feature
    const nextEpisodeData = findNextEpisode(videoPath);
    if (nextEpisodeData) {
        console.log('Next episode found:', nextEpisodeData.title);
        // Store it globally so we can send it after OSD is created
        window.pendingNextEpisodeData = nextEpisodeData;
    } else {
        window.pendingNextEpisodeData = null;
        console.log('No next episode available');
    }
    
    // Find previous episode for nav buttons
    const prevEpisodeData = findPreviousEpisode(videoPath);
    
    // Set up nav buttons for OSD
    window.pendingNavButtons = {
        hasPrevious: !!prevEpisodeData,
        hasNext: !!nextEpisodeData
    };
    
    player.playMovie(videoPath, startPosition, metadata, window.watchDataManager);
};

/**
 * Find the next episode after the given video path
 */
function findNextEpisode(currentVideoPath) {
    if (!window.currentShow) {
        return null;
    }
    
    const show = window.currentShow;
    
    // Find the season containing the current episode
    let currentSeason = window.currentSeason;
    let currentEpisodeIndex = -1;
    
    // If currentSeason isn't set, or the episode isn't in it, search all seasons
    if (!currentSeason) {
        for (const season of show.seasons) {
            const idx = season.episodes.findIndex(ep => ep.videoPath === currentVideoPath);
            if (idx >= 0) {
                currentSeason = season;
                currentEpisodeIndex = idx;
                // Set window.currentSeason so playback-ended handler works correctly
                window.currentSeason = season;
                break;
            }
        }
    } else {
        currentEpisodeIndex = currentSeason.episodes.findIndex(ep => ep.videoPath === currentVideoPath);
        // If not found in currentSeason, search all seasons
        if (currentEpisodeIndex < 0) {
            for (const season of show.seasons) {
                const idx = season.episodes.findIndex(ep => ep.videoPath === currentVideoPath);
                if (idx >= 0) {
                    currentSeason = season;
                    currentEpisodeIndex = idx;
                    window.currentSeason = season;
                    break;
                }
            }
        }
    }
    
    if (!currentSeason || currentEpisodeIndex < 0) {
        return null;
    }
    
    if (currentEpisodeIndex < currentSeason.episodes.length - 1) {
        // Next episode in same season
        const nextEp = currentSeason.episodes[currentEpisodeIndex + 1];
        return {
            videoPath: nextEp.videoPath,
            title: nextEp.title,
            seasonNumber: currentSeason.number,
            episodeNumber: nextEp.episode,
            runtime: nextEp.runtime || 30, // Default 30 min
            showTitle: show.title,
            showPath: show.showPath,
            accentColor: show.accentColor || '#39ddd8'
        };
    } else if (currentEpisodeIndex === currentSeason.episodes.length - 1) {
        // Last episode of season - find next season
        const currentSeasonIndex = show.seasons.findIndex(s => s.number === currentSeason.number);
        if (currentSeasonIndex >= 0 && currentSeasonIndex < show.seasons.length - 1) {
            const nextSeason = show.seasons[currentSeasonIndex + 1];
            if (nextSeason.episodes && nextSeason.episodes.length > 0) {
                const nextEp = nextSeason.episodes[0];
                return {
                    videoPath: nextEp.videoPath,
                    title: nextEp.title,
                    seasonNumber: nextSeason.number,
                    episodeNumber: nextEp.episode,
                    runtime: nextEp.runtime || 30,
                    showTitle: show.title,
                    showPath: show.showPath,
                    accentColor: show.accentColor || '#39ddd8'
                };
            }
        }
    }
    
    // No next episode (end of show)
    return null;
}

/**
 * Find the previous episode before the given video path
 */
function findPreviousEpisode(currentVideoPath) {
    if (!window.currentShow) {
        return null;
    }
    
    const show = window.currentShow;
    
    // Find the season containing the current episode
    let currentSeason = window.currentSeason;
    let currentEpisodeIndex = -1;
    
    // If currentSeason isn't set, or the episode isn't in it, search all seasons
    if (!currentSeason) {
        for (const season of show.seasons) {
            const idx = season.episodes.findIndex(ep => ep.videoPath === currentVideoPath);
            if (idx >= 0) {
                currentSeason = season;
                currentEpisodeIndex = idx;
                break;
            }
        }
    } else {
        currentEpisodeIndex = currentSeason.episodes.findIndex(ep => ep.videoPath === currentVideoPath);
        // If not found in currentSeason, search all seasons
        if (currentEpisodeIndex < 0) {
            for (const season of show.seasons) {
                const idx = season.episodes.findIndex(ep => ep.videoPath === currentVideoPath);
                if (idx >= 0) {
                    currentSeason = season;
                    currentEpisodeIndex = idx;
                    break;
                }
            }
        }
    }
    
    if (!currentSeason || currentEpisodeIndex < 0) {
        return null;
    }
    
    if (currentEpisodeIndex > 0) {
        // Previous episode in same season
        const prevEp = currentSeason.episodes[currentEpisodeIndex - 1];
        return {
            videoPath: prevEp.videoPath,
            title: prevEp.title,
            seasonNumber: currentSeason.number,
            episodeNumber: prevEp.episode,
            runtime: prevEp.runtime || 30,
            showTitle: show.title,
            showPath: show.showPath,
            accentColor: show.accentColor || '#39ddd8'
        };
    } else if (currentEpisodeIndex === 0) {
        // First episode of season - find previous season
        const currentSeasonIndex = show.seasons.findIndex(s => s.number === currentSeason.number);
        if (currentSeasonIndex > 0) {
            const prevSeason = show.seasons[currentSeasonIndex - 1];
            if (prevSeason.episodes && prevSeason.episodes.length > 0) {
                const prevEp = prevSeason.episodes[prevSeason.episodes.length - 1]; // Last episode of previous season
                return {
                    videoPath: prevEp.videoPath,
                    title: prevEp.title,
                    seasonNumber: prevSeason.number,
                    episodeNumber: prevEp.episode,
                    runtime: prevEp.runtime || 30,
                    showTitle: show.title,
                    showPath: show.showPath,
                    accentColor: show.accentColor || '#39ddd8'
                };
            }
        }
    }
    
    // No previous episode (start of show)
    return null;
}

// Play the currently focused episode
window.playFocusedEpisode = function() {
    // Get the last focused episode based on keyboard nav index
    let episodeCard = null;
    
    // If we're on episodes, use current focus
    if (window.keyboardNav && window.keyboardNav.detailSubMode === 'episodes') {
        episodeCard = document.querySelector('.season-episode-card.focused');
    } else if (window.keyboardNav && window.keyboardNav.lastEpisodeIndex !== undefined) {
        // Otherwise use saved episode index
        const allEpisodeCards = document.querySelectorAll('.season-episode-card');
        episodeCard = allEpisodeCards[window.keyboardNav.lastEpisodeIndex];
    }
    
    if (!episodeCard) {
        // Fall back to first episode if nothing is tracked
        episodeCard = document.querySelector('.season-episode-card');
        console.log('No tracked episode, using first episode');
    }
    
    if (!episodeCard) {
        console.log('No episode card found at all');
        return;
    }
    
    // Get episode data from the card
    const episodeDataStr = episodeCard.dataset.episodeData;
    if (!episodeDataStr) {
        console.log('No episode data on card');
        return;
    }
    
    try {
        const episodeData = JSON.parse(episodeDataStr.replace(/&quot;/g, '"').replace(/&#39;/g, "'"));
        
        // Get watch status
        const ws = window.watchDataManager ? window.watchDataManager.getWatchStatus(episodeData.videoPath) : null;
        const startPosition = ws && ws.position > 0 ? ws.position : 0;
        
        // Format season/episode
        const seasonEp = `S${episodeData.season.toString().padStart(2, '0')} E${episodeData.episode.toString().padStart(2, '0')}`;
        
        // Play the episode
        window.playTVEpisode(
            episodeData.videoPath,
            startPosition,
            window.currentShow.title,
            seasonEp,
            episodeData.title
        );
    } catch (err) {
        console.error('Error playing focused episode:', err);
    }
};

// Toggle watched status for the currently focused episode
window.toggleSeasonEpisodeWatched = function() {
    // Get the focused episode
    let focusedEpisode = null;
    if (window.keyboardNav && window.keyboardNav.lastEpisodeIndex !== undefined) {
        focusedEpisode = window.currentSeason.episodes[window.keyboardNav.lastEpisodeIndex];
    }
    
    if (!focusedEpisode) {
        console.log('No focused episode to toggle watched status');
        return;
    }
    
    const isWatched = watchDataManager.getWatchStatus(focusedEpisode.videoPath)?.watched;
    
    if (isWatched) {
        // Mark as unwatched
        watchDataManager.markUnwatched(focusedEpisode.videoPath);
    } else {
        // Mark as watched
        watchDataManager.markWatched(focusedEpisode.videoPath, focusedEpisode.runtime || 0);
        // Update active show tracking
        if (window.currentShow) {
            updateActiveShowTracking(focusedEpisode.videoPath, window.currentShow, window.currentSeason);
        }
    }
    
    // Update the button
    updateSeasonWatchedButton(focusedEpisode);
    
    // Update the episode card's watched badge
    updateEpisodeWatchedBadge(window.keyboardNav.lastEpisodeIndex, !isWatched);
    
    // Refresh continue watching on home screen
    if (typeof loadHomeContent === 'function') {
        loadHomeContent();
    }
};

// Update the season watched button based on episode status
function updateSeasonWatchedButton(episode) {
    const watchedIcon = document.getElementById('seasonWatchedIcon');
    const watchedText = document.getElementById('seasonWatchedText');
    
    if (!watchedIcon || !watchedText || !episode) return;
    
    const isWatched = watchDataManager.getWatchStatus(episode.videoPath)?.watched;
    watchedIcon.src = isWatched ? 'assets/icons/unwatched.svg' : 'assets/icons/watched.svg';
    watchedText.textContent = isWatched ? 'Mark Unwatched' : 'Mark Watched';
}

// Update episode card watched badge
function updateEpisodeWatchedBadge(episodeIndex, isWatched) {
    const episodeCards = document.querySelectorAll('.season-episode-card');
    const card = episodeCards[episodeIndex];
    
    if (!card) return;
    
    // Get the episode number from the card data
    const episodeDataStr = card.dataset.episodeData;
    if (!episodeDataStr) return;
    
    let episodeNum;
    try {
        const episodeData = JSON.parse(episodeDataStr.replace(/&quot;/g, '"').replace(/&#39;/g, "'"));
        episodeNum = episodeData.episode;
    } catch (err) {
        return;
    }
    
    // Find the episode number div
    const numberDiv = card.querySelector('.season-episode-number');
    if (!numberDiv) return;
    
    if (isWatched) {
        // Add watched icon before episode number
        numberDiv.innerHTML = `<span class="season-episode-watched-icon">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M12 24C15.1826 24 18.2348 22.7357 20.4853 20.4853C22.7357 18.2348 24 15.1826 24 12C24 8.8174 22.7357 5.76516 20.4853 3.51472C18.2348 1.26428 15.1826 0 12 0C8.8174 0 5.76516 1.26428 3.51472 3.51472C1.26428 5.76516 0 8.8174 0 12C0 15.1826 1.26428 18.2348 3.51472 20.4853C5.76516 22.7357 8.8174 24 12 24ZM17.2969 9.79688L11.2969 15.7969C10.8563 16.2375 10.1438 16.2375 9.70781 15.7969L6.70781 12.7969C6.26719 12.3563 6.26719 11.6438 6.70781 11.2078C7.14844 10.7719 7.86094 10.7672 8.29688 11.2078L10.5 13.4109L15.7031 8.20312C16.1437 7.7625 16.8562 7.7625 17.2922 8.20312C17.7281 8.64375 17.7328 9.35625 17.2922 9.79219L17.2969 9.79688Z"/>
            </svg>
        </span>E${episodeNum.toString().padStart(2, '0')}`;
    } else {
        // Remove watched icon, keep just episode number
        numberDiv.innerHTML = `E${episodeNum.toString().padStart(2, '0')}`;
    }
    
    // Also update progress bar if marking unwatched (remove it)
    if (!isWatched) {
        const progressBar = card.querySelector('.progress-bar');
        if (progressBar) {
            progressBar.remove();
        }
    }
}

// ==================== END TV SHOWS DETAIL ====================

// Open movie detail
function openDetail(movie, fromCarousel = false, isRefresh = false) {
    // Set current movie globally for context menu and other functions
    window.currentMovie = movie;
    
    // If opening from grid (not from carousel), clear history and set as new starting point
    if (!fromCarousel && window.keyboardNav) {
        window.keyboardNav.detailHistory = [];
        window.keyboardNav.currentMovie = movie;
        
        // Save current grid position ONLY when opening from grid
        if (!isRefresh) {
            window.keyboardNav.savedDetailReturnIndex = window.keyboardNav.currentIndex;
            console.log('Saved grid index:', window.keyboardNav.currentIndex);
        }
    }
    
    const detailPage = document.getElementById('detailPage');
    const content = document.getElementById('detailContent');
    const contentArea = document.getElementById('contentArea');
    
    const metadata = movie.metadata;
    
    // Always get fresh watch status from watchDataManager
    let watchStatus = { watched: false, position: 0, percentage: 0 };
    if (watchDataManager) {
        watchStatus = watchDataManager.getWatchStatus(movie.videoPath);
        // Update movie object with fresh status
        movie.watchStatus = watchStatus;
    } else {
        watchStatus = movie.watchStatus || { watched: false, position: 0, percentage: 0 };
    }
    
    console.log('Opening detail for:', metadata.title, 'Watch status:', watchStatus);
    
    // Check for fanart.jpg and accentcolor.txt in movie directory
    let fanartPath = '';
    let accentColor = '';
    if (movie.videoPath) {
        const path = require('path');
        const fs = require('fs');
        const movieDir = path.dirname(movie.videoPath);
        
        // Check for fanart (try different case variations)
        const fanartVariations = ['fanart.jpg', 'Fanart.jpg', 'FANART.jpg', 'fanart.JPG'];
        for (const filename of fanartVariations) {
            const fanartFile = path.join(movieDir, filename);
            if (fs.existsSync(fanartFile)) {
                // Escape apostrophes for inline CSS
                fanartPath = fanartFile.replace(/'/g, "\\'");
                console.log('Found fanart:', fanartPath);
                break;
            }
        }
        
        if (!fanartPath) {
            console.log('No fanart found in:', movieDir);
        }
        
        // Check for accent color
        const accentColorFile = path.join(movieDir, 'accentcolor.txt');
        if (fs.existsSync(accentColorFile)) {
            try {
                accentColor = fs.readFileSync(accentColorFile, 'utf8').trim();
            } catch (err) {
                console.error('Error reading accentcolor.txt:', err);
            }
        }
    }
    
    let html = '';
    
    // Add fanart background if exists
    if (fanartPath) {
        html += `
            <div class="detail-fanart" style="background-image: url('file://${fanartPath}');"></div>
            <div class="detail-fanart-overlay"></div>
            <div class="detail-fanart-gradient-left"></div>
            <div class="detail-fanart-gradient-bottom"></div>
        `;
        
        // Add accent gradient if accent color exists
        if (accentColor) {
            // Convert hex to rgba with 25% opacity
            let accentRgba = 'rgba(0, 0, 0, 0)'; // fallback
            if (accentColor.startsWith('#')) {
                const hex = accentColor.replace('#', '');
                const r = parseInt(hex.substring(0, 2), 16);
                const g = parseInt(hex.substring(2, 4), 16);
                const b = parseInt(hex.substring(4, 6), 16);
                accentRgba = `rgba(${r}, ${g}, ${b}, 0.25)`;
            }
            
            // Check if detail gradient is enabled
            const detailGradientEnabled = localStorage.getItem('detailGradientEnabled') !== 'false'; // Default true
            
            if (detailGradientEnabled) {
                html += `
                    <div class="detail-fanart-gradient-bottom-accent" style="background: linear-gradient(to top, ${accentRgba}, rgba(0, 0, 0, 0));"></div>
                `;
            }
        }
    }
    
    html += '<div class="detail-content">';
    
    // Poster - stays outside viewport
    html += '<div class="detail-poster-container">';
    html += `<img src="file://${movie.posterPath || ''}" class="detail-poster" alt="${metadata.title}">`;
    
    // Watched badge (only show if fully watched)
    if (watchStatus.watched) {
        html += `<div class="watched-badge">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M12 24C15.1826 24 18.2348 22.7357 20.4853 20.4853C22.7357 18.2348 24 15.1826 24 12C24 8.8174 22.7357 5.76516 20.4853 3.51472C18.2348 1.26428 15.1826 0 12 0C8.8174 0 5.76516 1.26428 3.51472 3.51472C1.26428 5.76516 0 8.8174 0 12C0 15.1826 1.26428 18.2348 3.51472 20.4853C5.76516 22.7357 8.8174 24 12 24ZM17.2969 9.79688L11.2969 15.7969C10.8563 16.2375 10.1438 16.2375 9.70781 15.7969L6.70781 12.7969C6.26719 12.3563 6.26719 11.6438 6.70781 11.2078C7.14844 10.7719 7.86094 10.7672 8.29688 11.2078L10.5 13.4109L15.7031 8.20312C16.1437 7.7625 16.8562 7.7625 17.2922 8.20312C17.7281 8.64375 17.7328 9.35625 17.2922 9.79219L17.2969 9.79688Z" fill="white"/>
            </svg>
        </div>`;
    }
    
    // Progress bar (only show if >0% and <90%)
    const timeRemaining = watchStatus.duration - watchStatus.position;
    if (watchStatus.position >= 600 && timeRemaining > 600) {
        html += '<div class="progress-bar">';
        html += `<div class="progress-bar-fill" style="width: ${Math.min(watchStatus.percentage, 100)}%"></div>`;
        html += '</div>';
    }
    
    html += '</div>';
    
    // Viewport with track inside
    html += '<div class="detail-content-viewport">';
    html += '<div class="detail-content-track">';
    
    // Main Info Container (first in track)
    html += '<div class="detail-info-container">';
    
    // Text group - title, meta, tagline, synopsis
    html += '<div class="detail-text-group">';
    
    // Title
    html += `<h1 class="detail-title">${metadata.title}</h1>`;
    
    // Meta row - Year | Runtime | MPAA | IMDB Rating
    html += '<div class="detail-meta">';
    // Build meta items array
    const metaItems = [];
    
    if (metadata.year) {
        metaItems.push(`<span>${metadata.year}</span>`);
    }
    
    if (metadata.runtime) {
        const hours = Math.floor(metadata.runtime / 60);
        const mins = metadata.runtime % 60;
        if (hours > 0) {
            metaItems.push(`<span>${hours}h ${mins}m</span>`);
        } else {
            metaItems.push(`<span>${mins}m</span>`);
        }
    }
    
    if (metadata.mpaa) {
        metaItems.push(`<span>${metadata.mpaa}</span>`);
    }
    
    if (metadata.rating > 0) {
        metaItems.push(`<span>IMDb ${metadata.rating.toFixed(1)}</span>`);
    }
    
    // Calculate end time (accounting for watch progress)
    if (metadata.runtime) {
        let remainingMinutes = metadata.runtime;
        // Subtract watch progress if exists (even for watched movies - user may want to rewatch from position)
        if (watchStatus && watchStatus.position > 0) {
            const watchedMinutes = Math.floor(watchStatus.position / 60);
            remainingMinutes = Math.max(0, metadata.runtime - watchedMinutes);
        }
        const now = new Date();
        const endTime = new Date(now.getTime() + remainingMinutes * 60000);
        const hours = endTime.getHours().toString().padStart(2, '0');
        const mins = endTime.getMinutes().toString().padStart(2, '0');
        metaItems.push(`<span>Ends at ${hours}:${mins}</span>`);
    }
    
    // Join with dividers
    if (metaItems.length > 0) {
        html += metaItems.join('<div class="detail-meta-divider"></div>');
    }
    
    html += '</div>';
    
    // Tagline
    if (metadata.tagline) {
        html += `<div class="detail-tagline">${metadata.tagline}</div>`;
    }
    
    // Synopsis
    if (metadata.plot) {
        html += `<div class="detail-synopsis">${metadata.plot}</div>`;
    }
    
    html += '</div>'; // End text-group
    
    // File Info Badges
    html += '<div class="detail-file-info">';
    
    // Resolution badge - detect from NFO fileinfo
    let resolutionText = 'SD';
    let resolutionIcon = 'sd';
    
    if (metadata.fileinfo && metadata.fileinfo.streamdetails && metadata.fileinfo.streamdetails.video) {
        // Handle both array and single object
        const videoInfo = Array.isArray(metadata.fileinfo.streamdetails.video) 
            ? metadata.fileinfo.streamdetails.video[0] 
            : metadata.fileinfo.streamdetails.video;
        
        const width = parseInt(videoInfo.width) || 0;
        const height = parseInt(videoInfo.height) || 0;
        
        console.log('Video resolution:', width, 'x', height); // Debug log
        
        // Determine resolution - lenient thresholds for real-world files
        if (width >= 1800 || height >= 1000) {
            resolutionText = '1080p';
            resolutionIcon = 'hd';
        } else if (width >= 1200 || height >= 700) {
            resolutionText = '720p';
            resolutionIcon = 'sd';
        } else if (width >= 700 || height >= 450) {
            resolutionText = '480p';
            resolutionIcon = 'sd';
        } else if (height > 0) {
            resolutionText = '420p';
            resolutionIcon = 'sd';
        }
    }
    
    html += `
        <div class="detail-badge">
            <img src="assets/icons/${resolutionIcon}.svg" class="detail-badge-icon" alt="">
            <span class="detail-badge-text">${resolutionText}</span>
        </div>
    `;
    
    // Language badge - show only first language
    let languageText = metadata.language || 'English';
    if (languageText.includes(',')) {
        languageText = languageText.split(',')[0].trim();
    }
    html += `
        <div class="detail-badge">
            <img src="assets/icons/language.svg" class="detail-badge-icon" alt="">
            <span class="detail-badge-text">${languageText}</span>
        </div>
    `;
    
    // Subtitle badge - check external first, then embedded if needed
    let subtitleText = 'None';
    
    if (movie.videoPath) {
        // Extract languages from external .srt files synchronously
        const fs = require('fs');
        const path = require('path');
        let hasExternalSubs = false;
        
        try {
            const videoDir = path.dirname(movie.videoPath);
            const videoBasename = path.basename(movie.videoPath, path.extname(movie.videoPath));
            const files = fs.readdirSync(videoDir);
            
            // Match subtitle files leniently - movies usually have exact basename match
            const srtFiles = files.filter(file => {
                if (!file.endsWith('.srt')) return false;
                const srtBasename = path.basename(file, '.srt');
                return srtBasename.startsWith(videoBasename);
            });
            
            console.log(`Movie: ${videoBasename}`);
            console.log(`Found subtitle files:`, srtFiles);
            
            if (srtFiles.length > 0) {
                hasExternalSubs = true;
                // Extract language codes from filenames
                const languages = [];
                srtFiles.forEach(srtFile => {
                    let langCode = 'und';
                    
                    // Try multiple patterns to handle different naming conventions:
                    // 1. .lang.forced.srt or .lang.sdh.srt
                    let match = srtFile.match(/\.([a-z]{2,3})\.(forced|sdh)\.srt$/i);
                    if (match) {
                        langCode = match[1].toLowerCase();
                    } else {
                        // 2. .forced.lang.srt or .sdh.lang.srt (reversed order)
                        match = srtFile.match(/\.(forced|sdh)\.([a-z]{2,3})\.srt$/i);
                        if (match) {
                            langCode = match[2].toLowerCase();
                        } else {
                            // 3. Standard .lang.srt
                            match = srtFile.match(/\.([a-z]{2,3})\.srt$/i);
                            if (match) {
                                langCode = match[1].toLowerCase();
                            }
                        }
                    }
                    
                    // Map language code to full name
                    const langMap = {
                        'eng': 'English', 'en': 'English',
                        'spa': 'Spanish', 'es': 'Spanish',
                        'fre': 'French', 'fra': 'French', 'fr': 'French',
                        'ger': 'German', 'deu': 'German', 'de': 'German',
                        'ita': 'Italian', 'it': 'Italian',
                        'jpn': 'Japanese', 'ja': 'Japanese',
                        'kor': 'Korean', 'ko': 'Korean',
                        'chi': 'Chinese', 'zho': 'Chinese', 'zh': 'Chinese',
                        'por': 'Portuguese', 'pt': 'Portuguese',
                        'rus': 'Russian', 'ru': 'Russian',
                        'ara': 'Arabic', 'ar': 'Arabic',
                        'hin': 'Hindi', 'hi': 'Hindi',
                        'dut': 'Dutch', 'nld': 'Dutch', 'nl': 'Dutch',
                        'pol': 'Polish', 'pl': 'Polish',
                        'swe': 'Swedish', 'sv': 'Swedish',
                        'nor': 'Norwegian', 'no': 'Norwegian',
                        'dan': 'Danish', 'da': 'Danish',
                        'fin': 'Finnish', 'fi': 'Finnish'
                    };
                    
                    const language = langMap[langCode] || langCode.toUpperCase();
                    if (!languages.includes(language)) {
                        languages.push(language);
                    }
                });
                
                subtitleText = languages.join(', ');
            }
        } catch (err) {
            console.error('Error checking for external subtitles:', err);
        }
        
        // Only check for embedded subtitles if no external subs found
        if (!hasExternalSubs) {
            const { getSubtitleSummary } = require('./subtitle-detector');
            const currentMoviePath = movie.videoPath;
            
            getSubtitleSummary(movie.videoPath).then(result => {
                // Only update if we're still on the same movie
                if (window.currentMovie && window.currentMovie.videoPath === currentMoviePath) {
                    const subtitleBadge = document.querySelector('.detail-file-info .detail-badge:last-child .detail-badge-text');
                    if (subtitleBadge) {
                        subtitleBadge.textContent = result;
                    }
                }
            }).catch(err => {
                console.error('Error checking for embedded subtitles:', err);
            });
        }
    }
    
    html += `
        <div class="detail-badge">
            <img src="assets/icons/subtitles.svg" class="detail-badge-icon" alt="">
            <span class="detail-badge-text">${subtitleText}</span>
        </div>
    `;
    
    html += '</div>'; // End file-info
    
    // Action Buttons
    html += '<div class="detail-actions">';
    
    // Play button
    const escapedVideoPath = movie.videoPath.replace(/'/g, "\\'");
    
    // Calculate end time string for OSD
    let endTimeStr = '';
    if (metadata.runtime) {
        const now = new Date();
        const endTime = new Date(now.getTime() + metadata.runtime * 60000);
        const hours = endTime.getHours().toString().padStart(2, '0');
        const mins = endTime.getMinutes().toString().padStart(2, '0');
        endTimeStr = `${hours}:${mins}`;
    }
    
    // Store metadata globally for playMovie to access - use shared function
    window.currentMovieMetadata = buildMovieOSDMetadata(movie);
    
    // Check if there's saved progress (>10 minutes in)
    // Note: timeRemaining is already calculated earlier for progress bar
    const showProgressButtons = watchStatus.position >= 600 && timeRemaining > 600;
    
    // Adaptive Play/Resume button
    const playButtonText = showProgressButtons ? 'Resume' : 'Play';
    html += `
        <button class="detail-button" onclick="playMovieWithMetadata('${escapedVideoPath}', ${watchStatus.position}, window.currentMovieMetadata)">
            <img src="assets/icons/play.svg" class="detail-button-icon" alt="">
            <span class="detail-button-text">${playButtonText}</span>
        </button>
    `;
    
    // Play From Beginning button (only shown when there's progress)
    if (showProgressButtons) {
        html += `
            <button class="detail-button" onclick="playFromBeginning('${escapedVideoPath}')">
                <img src="assets/icons/restart.svg" class="detail-button-icon" alt="">
                <span class="detail-button-text">Play From Beginning</span>
            </button>
        `;
    }
    
    // Watch status button
    const watchIcon = watchStatus.watched ? 'unwatched' : 'watched';
    const watchText = watchStatus.watched ? 'Mark as Unwatched' : 'Mark as Watched';
    html += `
        <button class="detail-button" onclick="toggleWatchStatus()">
            <img src="assets/icons/${watchIcon}.svg" class="detail-button-icon" alt="">
            <span class="detail-button-text">${watchText}</span>
        </button>
    `;
    
    // Favorites button
    const isFavorite = false; // TODO: Check favorites status
    const favIcon = isFavorite ? 'heart-fill' : 'heart-outline';
    const favText = isFavorite ? 'Add to Favorites' : 'Remove from Favorites';
    html += `
        <button class="detail-button" onclick="toggleFavorite()">
            <img src="assets/icons/${favIcon}.svg" class="detail-button-icon" alt="">
            <span class="detail-button-text">${favText}</span>
        </button>
    `;
    
    // More Options button
    html += `
        <button class="detail-button" onclick="showMovieDetailContextMenu()">
            <img src="assets/icons/more-options.svg" class="detail-button-icon" alt="">
            <span class="detail-button-text">More Options</span>
        </button>
    `;
    
    html += '</div>'; // End detail-actions
    html += '</div>'; // End detail-info-container (main)
    
    // Cast Info Container (second in track)
    html += '<div class="detail-info-container detail-cast-info-container">';
    html += '<h2 class="detail-section-title">Cast</h2>';
    
    // Cast cards (horizontal scrollable)
    if (metadata.actors && metadata.actors.length > 0) {
        html += '<div class="detail-cast-scroll-container">';
        html += '<div class="detail-cast-grid">';
        
        metadata.actors.forEach(actor => {
            // Find actor image in .actors_img directory
            let actorImagePath = '';
            if (movie.videoPath && actor.name) {
                const path = require('path');
                const fs = require('fs');
                const movieDir = path.dirname(movie.videoPath);
                const actorsDir = path.join(movieDir, '.actors_img');
                
                if (fs.existsSync(actorsDir)) {
                    // Convert actor name to expected filename format: lowercase with underscores
                    const expectedFileName = actor.name.toLowerCase().replace(/\s+/g, '_');
                    
                    // Try to match actor name to filename
                    const files = fs.readdirSync(actorsDir);
                    const actorFileName = files.find(file => {
                        const nameWithoutExt = path.parse(file).name;
                        return nameWithoutExt.toLowerCase() === expectedFileName;
                    });
                    
                    if (actorFileName) {
                        // Build the full path - encodeURI will be applied when rendering
                        const fullPath = path.join(actorsDir, actorFileName);
                        actorImagePath = fullPath.replace(/\\/g, '/');
                    }
                }
            }
            
            html += '<div class="cast-card">';
            
            // Actor image container with strokes (same as movie cards)
            html += '<div class="cast-card-image-container">';
            html += '<div class="cast-card-outer-stroke">';
            html += '<div class="cast-card-inner-stroke">';
            if (actorImagePath) {
                const encodedActorImagePath = encodeURI(actorImagePath);
                html += `<img src="file://${encodedActorImagePath}" class="cast-card-image" alt="${actor.name}">`;
            } else {
                // Use no-photo placeholder image
                html += `<img src="./assets/no-photo.png" class="cast-card-image" alt="${actor.name}">`;
            }
            html += '</div></div></div>';
            
            // Actor info
            html += '<div class="cast-card-info">';
            html += `<div class="cast-card-name">${actor.name}</div>`;
            if (actor.role) {
                html += `<div class="cast-card-role">as ${actor.role}</div>`;
            }
            html += '</div>';
            
            html += '</div>'; // End cast-card
        });
        
        html += '</div>'; // End detail-cast-grid
        html += '</div>'; // End detail-cast-scroll-container
    }
    
    // More Info Section
    html += '<div class="detail-more-info">';
    
    // Directors
    if (metadata.director) {
        const directors = metadata.director.split(',').map(d => d.trim()).filter(d => d);
        const label = directors.length === 1 ? 'Director' : 'Directors';
        html += `<div class="detail-info-row">`;
        html += `<span class="detail-info-label">${label}:</span>`;
        html += '<div class="detail-info-values">';
        directors.forEach(director => {
            html += `<span class="detail-info-badge">${director}</span>`;
        });
        html += '</div></div>';
    }
    
    // Writers
    if (metadata.writers && metadata.writers.length > 0) {
        const label = metadata.writers.length === 1 ? 'Writer' : 'Writers';
        html += `<div class="detail-info-row">`;
        html += `<span class="detail-info-label">${label}:</span>`;
        html += '<div class="detail-info-values">';
        metadata.writers.forEach(writer => {
            html += `<span class="detail-info-badge">${writer}</span>`;
        });
        html += '</div></div>';
    }
    
    // Studio
    if (metadata.studio) {
        const studios = Array.isArray(metadata.studio) ? metadata.studio : [metadata.studio];
        const label = studios.length === 1 ? 'Studio' : 'Studios';
        html += `<div class="detail-info-row">`;
        html += `<span class="detail-info-label">${label}:</span>`;
        html += '<div class="detail-info-values">';
        studios.forEach(studio => {
            html += `<span class="detail-info-badge">${studio}</span>`;
        });
        html += '</div></div>';
    }
    
    // Genres
    if (metadata.genre && metadata.genre.length > 0) {
        const label = metadata.genre.length === 1 ? 'Genre' : 'Genres';
        html += `<div class="detail-info-row">`;
        html += `<span class="detail-info-label">${label}:</span>`;
        html += '<div class="detail-info-values">';
        metadata.genre.forEach(genre => {
            html += `<span class="detail-info-badge">${genre}</span>`;
        });
        html += '</div></div>';
    }
    
    html += '</div>'; // End detail-more-info
    
    html += '</div>'; // End detail-cast-info-container
    
    // Get collection movies once
    const collectionMovies = getCollectionMovies(movie, allMovies);
    
    // Collect all movies from tags (to exclude from recommendations)
    const movieTags = movie.metadata?.tags || [];
    let tagMovies = [];
    if (movieTags.length > 0) {
        const tagMovieSet = new Set(); // Use set to avoid duplicates if a movie has multiple matching tags
        movieTags.forEach(tag => {
            const moviesWithTag = allMovies.filter(m => {
                const tags = m.metadata?.tags || [];
                return tags.includes(tag) && m.videoPath !== movie.videoPath;
            });
            moviesWithTag.forEach(m => tagMovieSet.add(m.videoPath));
        });
        // Convert set back to array of movie objects
        tagMovies = allMovies.filter(m => tagMovieSet.has(m.videoPath));
    }
    
    // Get recommendations excluding both collection and tag movies
    const recommendations = getRecommendations(movie, allMovies, collectionMovies, tagMovies, 15);
    
    // ========================================
    // THIRD CONTAINER: Collection (if exists)
    // ========================================
    
    if (collectionMovies.length > 0) {
        const metadata = movie.metadata || {};
        html += '<div class="detail-info-container detail-collection-container">';
        
        html += '<div class="detail-section">';
        html += `<h2 class="detail-section-title">${metadata.collection?.name || 'Collection'}</h2>`;
        
        html += '<div class="detail-collection-scroll-container">';
        html += '<div class="detail-collection-grid">';
        
        collectionMovies.forEach(collectionMovie => {
            html += renderMovieCard(collectionMovie);
        });
        
        html += '</div>'; // End detail-collection-grid
        html += '</div>'; // End detail-collection-scroll-container
        html += '</div>'; // End detail-section
        
        html += '</div>'; // End detail-collection-container
    }
    
    // ========================================
    // TAG CAROUSELS: One carousel per tag
    // ========================================
    
    // movieTags already declared above when collecting tag movies
    if (movieTags.length > 0) {
        movieTags.forEach(tag => {
            // Get all movies with this tag (excluding current movie)
            const tagMovies = allMovies
                .filter(m => {
                    const tags = m.metadata?.tags || [];
                    return tags.includes(tag) && m.videoPath !== movie.videoPath;
                })
                .sort((a, b) => {
                    const yearA = parseInt(a.metadata?.year) || 0;
                    const yearB = parseInt(b.metadata?.year) || 0;
                    return yearA - yearB; // Older first for tags
                });
            
            // Only render if there are other movies with this tag
            if (tagMovies.length > 0) {
                // Convert tag to Title Case for display
                const displayTag = tag.split(' ')
                    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
                    .join(' ');
                
                html += '<div class="detail-info-container detail-tag-container">';
                html += '<div class="detail-section">';
                html += `<h2 class="detail-section-title">${displayTag}</h2>`;
                html += '<div class="detail-tag-scroll-container">';
                html += '<div class="detail-tag-grid">';
                
                tagMovies.forEach(tagMovie => {
                    html += renderMovieCard(tagMovie);
                });
                
                html += '</div>'; // End detail-tag-grid
                html += '</div>'; // End detail-tag-scroll-container
                html += '</div>'; // End detail-section
                html += '</div>'; // End detail-tag-container
            }
        });
    }
    
    // ========================================
    // FOURTH CONTAINER: More Like This (if exists)
    // ========================================
    
    if (recommendations.length > 0) {
        html += '<div class="detail-info-container detail-recommendations-container">';
        
        html += '<div class="detail-section">';
        html += '<h2 class="detail-section-title">More Like This</h2>';
        
        html += '<div class="detail-recommendations-scroll-container">';
        html += '<div class="detail-recommendations-grid">';
        
        recommendations.forEach(recMovie => {
            html += renderMovieCard(recMovie);
        });
        
        html += '</div>'; // End detail-recommendations-grid
        html += '</div>'; // End detail-recommendations-scroll-container
        html += '</div>'; // End detail-section
        
        html += '</div>'; // End detail-recommendations-container
    }
    
    html += '</div>'; // End detail-content-track
    html += '</div>'; // End detail-content-viewport
    html += '</div>'; // End detail-content
    
    content.innerHTML = html;
    
    // Add click handlers to collection, tag, and recommendation cards
    setTimeout(() => {
        // Collection cards
        const collectionCards = document.querySelectorAll('.detail-collection-container .recommendation-card');
        console.log('Found collection cards:', collectionCards.length);
        collectionCards.forEach(card => {
            card.style.cursor = 'pointer';
            card.onclick = () => {
                console.log('Collection card clicked!');
                const titleEl = card.querySelector('.recommendation-card-title');
                if (titleEl) {
                    const movieTitle = titleEl.textContent;
                    console.log('Looking for movie:', movieTitle);
                    const movie = window.allMovies?.find(m => m.metadata.title === movieTitle);
                    console.log('Found movie:', movie);
                    if (movie && window.keyboardNav) {
                        window.keyboardNav.openDetailFromCarousel(movie);
                    }
                }
            };
        });
        
        // Tag cards
        const tagCards = document.querySelectorAll('.detail-tag-container .recommendation-card');
        console.log('Found tag cards:', tagCards.length);
        tagCards.forEach(card => {
            card.style.cursor = 'pointer';
            card.onclick = () => {
                console.log('Tag card clicked!');
                const titleEl = card.querySelector('.recommendation-card-title');
                if (titleEl) {
                    const movieTitle = titleEl.textContent;
                    console.log('Looking for movie:', movieTitle);
                    const movie = window.allMovies?.find(m => m.metadata.title === movieTitle);
                    console.log('Found movie:', movie);
                    if (movie && window.keyboardNav) {
                        window.keyboardNav.openDetailFromCarousel(movie);
                    }
                }
            };
        });
        
        // Recommendation cards
        const recommendationCards = document.querySelectorAll('.detail-recommendations-container .recommendation-card');
        console.log('Found recommendation cards:', recommendationCards.length);
        recommendationCards.forEach(card => {
            card.style.cursor = 'pointer';
            card.onclick = () => {
                console.log('Recommendation card clicked!');
                const titleEl = card.querySelector('.recommendation-card-title');
                if (titleEl) {
                    const movieTitle = titleEl.textContent;
                    console.log('Looking for movie:', movieTitle);
                    const movie = window.allMovies?.find(m => m.metadata.title === movieTitle);
                    console.log('Found movie:', movie);
                    if (movie && window.keyboardNav) {
                        window.keyboardNav.openDetailFromCarousel(movie);
                    }
                }
            };
        });
    }, 50);
    
    // Hide main content, show detail page
    contentArea.style.display = 'none';
    detailPage.style.display = 'block';
    
    // Apply smart truncation after content is rendered
    setTimeout(() => {
        applySmartTruncation();
    }, 50);
    
    // Enable keyboard navigation for detail view
    if (typeof keyboardNav !== 'undefined') {
        setTimeout(() => keyboardNav.enterDetailMode(), 100);
    }
}

/* ========================================
   BACKUP: v139 Truncation Algorithm
   Uncomment if new approach doesn't work
   ========================================

// Smart truncation function to fit content within poster height
function applySmartTruncation() {
    const infoContainer = document.querySelector('.detail-info-container');
    const posterContainer = document.querySelector('.detail-poster-container');
    const textGroup = document.querySelector('.detail-text-group');
    const synopsis = document.querySelector('.detail-synopsis');
    const title = document.querySelector('.detail-title');
    const tagline = document.querySelector('.detail-tagline');
    
    if (!infoContainer || !textGroup || !posterContainer) {
        console.log('Missing elements:', { infoContainer: !!infoContainer, textGroup: !!textGroup, posterContainer: !!posterContainer });
        return;
    }
    
    // Use actual poster height, not hardcoded pixels
    const posterHeight = posterContainer.offsetHeight;
    const topPadding = parseFloat(getComputedStyle(infoContainer).paddingTop);
    const maxHeight = posterHeight - topPadding;
    
    console.log('Container measurements:', {
        posterHeight,
        topPadding,
        maxHeight
    });
    
    // Helper function to check if content fits
    const checkHeight = () => {
        const textGroupHeight = textGroup.offsetHeight;
        const fileInfo = document.querySelector('.detail-file-info');
        const actions = document.querySelector('.detail-actions');
        
        let totalHeight = textGroupHeight;
        if (fileInfo) totalHeight += fileInfo.offsetHeight + 48; // 48px gap
        if (actions) totalHeight += actions.offsetHeight + 48; // 48px gap
        
        console.log('Height check:', {
            textGroup: textGroupHeight,
            fileInfo: fileInfo?.offsetHeight || 0,
            actions: actions?.offsetHeight || 0,
            total: totalHeight,
            max: maxHeight,
            fits: totalHeight <= maxHeight
        });
        
        return totalHeight;
    };
    
    // Check initial height - if it fits, do nothing
    const initialHeight = checkHeight();
    if (initialHeight <= maxHeight) {
        console.log('Content fits without truncation');
        return;
    }
    
    console.log('Starting truncation...');
    
    // Step 1: Try clamping synopsis to 4 lines
    if (synopsis) {
        synopsis.classList.add('synopsis-clamp-4');
        const height = checkHeight();
        if (height <= maxHeight) {
            console.log('✓ Fits with synopsis at 4 lines');
            return;
        }
    }
    
    // Step 2: Try clamping synopsis to 3 lines
    if (synopsis) {
        synopsis.classList.remove('synopsis-clamp-4');
        synopsis.classList.add('synopsis-clamp-3');
        const height = checkHeight();
        if (height <= maxHeight) {
            console.log('✓ Fits with synopsis at 3 lines');
            return;
        }
    }
    
    // Step 3: Check if tagline is 3+ lines, clamp to 2 if so
    if (tagline) {
        const taglineHeight = tagline.offsetHeight;
        const lineHeight = parseFloat(getComputedStyle(tagline).fontSize);
        console.log('Tagline check:', { height: taglineHeight, lineHeight, lines: taglineHeight / lineHeight });
        if (taglineHeight >= lineHeight * 3) {
            tagline.classList.add('tagline-clamp-2');
            const height = checkHeight();
            if (height <= maxHeight) {
                console.log('✓ Fits with tagline at 2 lines');
                return;
            }
        }
    }
    
    // Step 4: Try clamping title to 3 lines
    if (title) {
        title.classList.add('title-clamp-3');
        const height = checkHeight();
        if (height <= maxHeight) {
            console.log('✓ Fits with title at 3 lines');
            return;
        }
    }
    
    // Step 5: Try clamping title to 2 lines
    if (title) {
        title.classList.remove('title-clamp-3');
        title.classList.add('title-clamp-2');
        const height = checkHeight();
        if (height <= maxHeight) {
            console.log('✓ Fits with title at 2 lines');
            return;
        }
    }
    
    // Step 6: Try clamping title to 1 line (minimum)
    if (title) {
        title.classList.remove('title-clamp-2');
        title.classList.add('title-clamp-1');
        const height = checkHeight();
        if (height <= maxHeight) {
            console.log('✓ Fits with title at 1 line');
            return;
        }
    }
    
    // If still too tall, we've done our best
    console.log('⚠ Content still too tall after all truncation');
}

   ======================================== */

// NEW v140: Font-size reduction approach
function applySmartTruncation() {
    const infoContainer = document.querySelector('.detail-info-container');
    const posterContainer = document.querySelector('.detail-poster-container');
    const textGroup = document.querySelector('.detail-text-group');
    const synopsis = document.querySelector('.detail-synopsis');
    const title = document.querySelector('.detail-title');
    const tagline = document.querySelector('.detail-tagline');
    
    if (!infoContainer || !textGroup || !posterContainer) {
        console.log('Missing elements');
        return;
    }
    
    // Use actual poster height
    const posterHeight = posterContainer.offsetHeight;
    const topPadding = parseFloat(getComputedStyle(infoContainer).paddingTop);
    const maxHeight = posterHeight - topPadding;
    
    // Helper function to check if content fits
    const checkHeight = () => {
        const textGroupHeight = textGroup.offsetHeight;
        const fileInfo = document.querySelector('.detail-file-info');
        const actions = document.querySelector('.detail-actions');
        
        let totalHeight = textGroupHeight;
        if (fileInfo) totalHeight += fileInfo.offsetHeight + 48;
        if (actions) totalHeight += actions.offsetHeight + 48;
        
        return totalHeight;
    };
    
    // Step 1: Check if content fits without changes
    if (checkHeight() <= maxHeight) {
        console.log('✓ Content fits without changes');
        return;
    }
    
    // Step 2: Reduce title font size (96px → 81px)
    if (title) {
        title.classList.add('title-reduced');
        if (checkHeight() <= maxHeight) {
            console.log('✓ Fits with reduced title size');
            return;
        }
    }
    
    // Step 3: Clamp title to 3 lines (minimum, won't go lower)
    if (title) {
        title.classList.add('title-clamp-3');
        if (checkHeight() <= maxHeight) {
            console.log('✓ Fits with title at 3 lines');
            return;
        }
    }
    
    // Step 4: Clamp tagline to 2 lines (if 3+ lines)
    if (tagline) {
        const taglineHeight = tagline.offsetHeight;
        const lineHeight = parseFloat(getComputedStyle(tagline).fontSize);
        if (taglineHeight >= lineHeight * 3) {
            tagline.classList.add('tagline-clamp-2');
            if (checkHeight() <= maxHeight) {
                console.log('✓ Fits with tagline at 2 lines');
                return;
            }
        }
    }
    
    // Step 5: Clamp synopsis to 4 lines
    if (synopsis) {
        synopsis.classList.add('synopsis-clamp-4');
        if (checkHeight() <= maxHeight) {
            console.log('✓ Fits with synopsis at 4 lines');
            return;
        }
    }
    
    // Step 6: Clamp synopsis to 3 lines (final attempt)
    if (synopsis) {
        synopsis.classList.remove('synopsis-clamp-4');
        synopsis.classList.add('synopsis-clamp-3');
        console.log('✓ Applied minimum truncation (synopsis 3 lines)');
        return;
    }
}

// Close detail
function closeDetail() {
    // Check if we should return to a playlist
    if (window.returnToPlaylist) {
        const returnState = window.returnToPlaylist;
        window.returnToPlaylist = null;
        
        const playlist = playlistManager.getById(returnState.playlistId);
        if (playlist) {
            // Open playlist detail with saved focus state
            openPlaylistDetail(playlist, {
                section: returnState.section || 'list',
                focusedIndex: returnState.focusedIndex,
                buttonIndex: returnState.buttonIndex
            });
            return;
        }
    }
    
    // Check if we came from search page
    const searchState = localStorage.getItem('searchState');
    if (searchState) {
        // Set flag to indicate we're returning from detail
        localStorage.setItem('cameFromDetail', 'true');
        
        // Return to search page
        console.log('Returning to search page');
        window.location.href = 'search.html';
        return;
    }
    
    const detailPage = document.getElementById('detailPage');
    const contentArea = document.getElementById('contentArea');
    
    // Hide detail page
    detailPage.style.display = 'none';
    contentArea.style.display = 'block';
    
    // Clear detail history when returning
    if (window.keyboardNav) {
        window.keyboardNav.detailHistory = [];
        window.keyboardNav.currentMovie = null;
    }
    
    // Check if we should return to home screen
    const cameFromHome = localStorage.getItem('cameFromHome');
    if (cameFromHome) {
        localStorage.removeItem('cameFromHome');
        showHomeScreen(true); // Restore state
        return;
    }
    
    // Return to grid navigation and restore saved position
    if (typeof keyboardNav !== 'undefined') {
        setTimeout(() => {
            console.log('closeDetail - savedDetailReturnIndex:', keyboardNav.savedDetailReturnIndex);
            keyboardNav.exitDetailMode();
            
            // Set flag to prevent immediate back-to-home
            keyboardNav.justReturnedFromDetail = true;
            
            // Refresh movie grid watch status (in case anything changed while in detail)
            if (currentLibrary === 'movies') {
                refreshMovieGridWatchStatus();
            }
            
            // Restore saved grid position
            if (keyboardNav.savedDetailReturnIndex !== undefined) {
                console.log('Restoring grid index to:', keyboardNav.savedDetailReturnIndex);
                keyboardNav.currentIndex = keyboardNav.savedDetailReturnIndex;
                keyboardNav.savedDetailReturnIndex = undefined; // Clear after ESC return
                keyboardNav.savedDetailReturnRow = undefined; // Clear row tracking
                keyboardNav.savedDetailReturnColumns = undefined; // Clear column tracking
                keyboardNav.focusItem();
            } else {
                console.log('No savedDetailReturnIndex to restore!');
            }
        }, 100);
    }
}

// Toggle watch status
function toggleWatchStatus() {
    if (!window.currentMovie || !watchDataManager) return;
    
    const movie = window.currentMovie;
    const currentStatus = watchDataManager.getWatchStatus(movie.videoPath);
    
    if (currentStatus.watched) {
        // Mark as unwatched and clear progress
        watchDataManager.markUnwatched(movie.videoPath);
        console.log('Marked unwatched:', movie.metadata.title);
    } else {
        // Mark as watched
        const duration = movie.metadata.runtime ? movie.metadata.runtime * 60 : 0;
        watchDataManager.markWatched(movie.videoPath, duration);
        console.log('Marked watched:', movie.metadata.title);
    }
    
    // Update the movie's watch status
    movie.watchStatus = watchDataManager.getWatchStatus(movie.videoPath);
    
    // Update all movie cards in the grid
    updateAllMovieCards();
    
    // Re-open detail page with updated status
    openDetail(movie);
}

// Toggle favorite status (placeholder for now)
function toggleFavorite() {
    console.log('Favorites not yet implemented');
}

// Update all movie cards with current watch status
function updateAllMovieCards() {
    // Update cached movies
    allMovies.forEach(movie => {
        movie.watchStatus = watchDataManager.getWatchStatus(movie.videoPath);
    });
    
    // Update localStorage cache
    localStorage.setItem('allMoviesCache', JSON.stringify(allMovies));
    
    // Re-render the grid
    const grid = document.getElementById('movieGrid');
    if (grid && grid.style.display !== 'none') {
        renderMovieGrid(allMovies);
    }
}

// Play movie
window.playMovie = function(videoPath, startPosition = 0) {
    console.log('Playing:', videoPath, 'at position:', startPosition);
    
    // Don't close detail page - just hide it so we can restore it after playback
    // closeDetail();
    
    // Send play command to main process
    ipcRenderer.send('play-video', { videoPath, startPosition });
};

// Toggle watch status
window.toggleWatchStatus = function() {
    if (!window.keyboardNav || !window.keyboardNav.currentMovie || !watchDataManager) {
        console.log('Cannot toggle watch status - missing dependencies');
        return;
    }
    
    const movie = window.keyboardNav.currentMovie;
    const currentStatus = watchDataManager.getWatchStatus(movie.videoPath);
    
    console.log('Toggling watch status for:', movie.metadata.title, 'Current status:', currentStatus.watched);
    
    if (currentStatus.watched) {
        // Mark as unwatched and clear progress
        watchDataManager.markUnwatched(movie.videoPath);
        console.log('Marked unwatched:', movie.metadata.title);
    } else {
        // Mark as watched
        const duration = movie.metadata.runtime ? movie.metadata.runtime * 60 : 0;
        watchDataManager.markWatched(movie.videoPath, duration);
        console.log('Marked watched:', movie.metadata.title);
    }
    
    // Update the movie's watch status
    const newStatus = watchDataManager.getWatchStatus(movie.videoPath);
    movie.watchStatus = newStatus;
    
    // Update in allMovies array
    const movieInArray = allMovies.find(m => m.videoPath === movie.videoPath);
    if (movieInArray) {
        movieInArray.watchStatus = newStatus;
    }
    
    // Update localStorage cache
    localStorage.setItem('allMoviesCache', JSON.stringify(allMovies));
    
    // Update detail page poster badge AND progress bar in place
    const detailPosterContainer = document.querySelector('.detail-poster-container');
    if (detailPosterContainer) {
        // Remove old watched badge and progress bar
        const oldBadge = detailPosterContainer.querySelector('.watched-badge');
        const oldProgress = detailPosterContainer.querySelector('.progress-bar');
        if (oldBadge) oldBadge.remove();
        if (oldProgress) oldProgress.remove();
        
        // Add watched badge if now watched
        if (newStatus.watched) {
            const badge = document.createElement('div');
            badge.className = 'watched-badge';
            badge.innerHTML = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M12 24C15.1826 24 18.2348 22.7357 20.4853 20.4853C22.7357 18.2348 24 15.1826 24 12C24 8.8174 22.7357 5.76516 20.4853 3.51472C18.2348 1.26428 15.1826 0 12 0C8.8174 0 5.76516 1.26428 3.51472 3.51472C1.26428 5.76516 0 8.8174 0 12C0 15.1826 1.26428 18.2348 3.51472 20.4853C5.76516 22.7357 8.8174 24 12 24ZM17.2969 9.79688L11.2969 15.7969C10.8563 16.2375 10.1438 16.2375 9.70781 15.7969L6.70781 12.7969C6.26719 12.3563 6.26719 11.6438 6.70781 11.2078C7.14844 10.7719 7.86094 10.7672 8.29688 11.2078L10.5 13.4109L15.7031 8.20312C16.1437 7.7625 16.8562 7.7625 17.2922 8.20312C17.7281 8.64375 17.7328 9.35625 17.2922 9.79219L17.2969 9.79688Z" fill="white"/>
            </svg>`;
            detailPosterContainer.appendChild(badge);
            console.log('Added watched badge');
        } else {
            console.log('Removed watched badge');
        }
        
        // Add progress bar if applicable (position >= 10 min AND remaining >= 10 min)
        const timeRemaining = newStatus.duration - newStatus.position;
        if (newStatus.position >= 600 && timeRemaining > 600) {
            const progressBar = document.createElement('div');
            progressBar.className = 'progress-bar';
            const progressFill = document.createElement('div');
            progressFill.className = 'progress-bar-fill';
            progressFill.style.width = `${Math.min(newStatus.percentage, 100)}%`;
            progressBar.appendChild(progressFill);
            detailPosterContainer.appendChild(progressBar);
            console.log('Added progress bar:', newStatus.percentage + '%');
        }
    }
    
    // Update the watch status button itself
    const detailActions = document.querySelector('.detail-actions');
    if (detailActions) {
        // Find the watch status button (should be second or third depending on if restart button exists)
        const buttons = Array.from(detailActions.querySelectorAll('.detail-button'));
        const watchButton = buttons.find(btn => {
            const img = btn.querySelector('img[src*="watched.svg"], img[src*="unwatched.svg"]');
            return img !== null;
        });
        
        if (watchButton) {
            const icon = watchButton.querySelector('img');
            const text = watchButton.querySelector('.detail-button-text');
            
            if (newStatus.watched) {
                // Now watched - show "Mark as Unwatched"
                icon.src = 'assets/icons/watched.svg';
                text.textContent = 'Mark as Unwatched';
                console.log('Updated button to: Mark as Unwatched');
            } else {
                // Now unwatched - show "Mark as Watched"
                icon.src = 'assets/icons/unwatched.svg';
                text.textContent = 'Mark as Watched';
                console.log('Updated button to: Mark as Watched');
            }
        }
    }
    
    // Update grid cards in background
    const movieCards = document.querySelectorAll('.movie-card');
    movieCards.forEach(card => {
        const videoPath = card.dataset.videoPath;
        if (videoPath === movie.videoPath) {
            const posterContainer = card.querySelector('.movie-card-poster-container');
            if (posterContainer) {
                // Remove old badge and progress bar
                const oldBadge = posterContainer.querySelector('.watched-badge');
                const oldProgress = posterContainer.querySelector('.progress-bar');
                if (oldBadge) oldBadge.remove();
                if (oldProgress) oldProgress.remove();
                
                // Add badge if watched
                if (newStatus.watched) {
                    const badge = document.createElement('div');
                    badge.className = 'watched-badge';
                    badge.innerHTML = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M12 24C15.1826 24 18.2348 22.7357 20.4853 20.4853C22.7357 18.2348 24 15.1826 24 12C24 8.8174 22.7357 5.76516 20.4853 3.51472C18.2348 1.26428 15.1826 0 12 0C8.8174 0 5.76516 1.26428 3.51472 3.51472C1.26428 5.76516 0 8.8174 0 12C0 15.1826 1.26428 18.2348 3.51472 20.4853C5.76516 22.7357 8.8174 24 12 24ZM17.2969 9.79688L11.2969 15.7969C10.8563 16.2375 10.1438 16.2375 9.70781 15.7969L6.70781 12.7969C6.26719 12.3563 6.26719 11.6438 6.70781 11.2078C7.14844 10.7719 7.86094 10.7672 8.29688 11.2078L10.5 13.4109L15.7031 8.20312C16.1437 7.7625 16.8562 7.7625 17.2922 8.20312C17.7281 8.64375 17.7328 9.35625 17.2922 9.79219L17.2969 9.79688Z" fill="white"/>
                    </svg>`;
                    posterContainer.appendChild(badge);
                }
                
                // Add progress bar if applicable
                const timeRemaining = newStatus.duration - newStatus.position;
                if (newStatus.position >= 600 && timeRemaining > 600) {
                    const progressBar = document.createElement('div');
                    progressBar.className = 'progress-bar';
                    const progressFill = document.createElement('div');
                    progressFill.className = 'progress-bar-fill';
                    progressFill.style.width = `${Math.min(newStatus.percentage, 100)}%`;
                    progressBar.appendChild(progressFill);
                    posterContainer.appendChild(progressBar);
                }
            }
        }
    });
    
    // Update Play/Resume button since marking unwatched clears position (Option B)
    const playButton = detailActions?.querySelector('.detail-button:first-child');
    if (playButton) {
        const playButtonText = playButton.querySelector('.detail-button-text');
        const timeRemaining = newStatus.duration - newStatus.position;
        const showProgressButtons = newStatus.position >= 600 && timeRemaining > 600;
        
        // Update button text
        if (playButtonText) {
            playButtonText.textContent = showProgressButtons ? 'Resume' : 'Play';
        }
        
        // Update onclick to use current position
        const escapedVideoPath = movie.videoPath.replace(/'/g, "\\'");
        playButton.setAttribute('onclick', `playMovieWithMetadata('${escapedVideoPath}', ${newStatus.position}, window.currentMovieMetadata)`);
        
        // Handle "Play From Beginning" button
        const restartButton = detailActions.querySelector('.detail-button:nth-child(2)');
        const isRestartButton = restartButton && restartButton.querySelector('img[src*="restart.svg"]');
        
        if (!showProgressButtons && isRestartButton) {
            // No longer need restart button (position cleared)
            restartButton.remove();
            console.log('Removed "Play From Beginning" button (no progress)');
            
            // Re-initialize keyboard navigation
            if (window.keyboardNav && window.keyboardNav.detailMode) {
                window.keyboardNav.updateItems('.detail-button');
                window.keyboardNav.currentIndex = 0;
                window.keyboardNav.focusItem();
            }
        }
    }
    
    console.log('Watch status toggled successfully');
};

// Toggle favorite status (stub for now)
window.toggleFavorite = function() {
    console.log('Toggle favorite - not yet implemented');
    // TODO: Implement favorites toggling
};

// Handle playback ended
ipcRenderer.on('playback-ended', async (event, videoPath) => {
    console.log('Playback ended:', videoPath);
    
    // Refresh watch status for all movies
    if (watchDataManager) {
        console.log('Refreshing watch status after playback...');
        
        // Update all movies with current watch status from watch-data.json
        allMovies.forEach(movie => {
            movie.watchStatus = watchDataManager.getWatchStatus(movie.videoPath);
        });
        
        // Check the playback position and handle saved progress:
        // 1. Less than 10 minutes watched → Clear everything (unwatched + no progress)
        // 2. Otherwise → Keep position (in-progress, even if manually marked watched)
        const currentMovie = allMovies.find(m => m.videoPath === videoPath);
        if (currentMovie) {
            const ws = currentMovie.watchStatus;
            
            // If under 10 minutes watched AND not watched - clear progress completely
            if (ws.position < 600 && !ws.watched) {
                const minutes = Math.floor(ws.position / 60);
                const seconds = Math.floor(ws.position % 60);
                console.log(`Position is ${minutes}:${seconds.toString().padStart(2, '0')} (under 10 minutes, not watched) - clearing saved progress`);
                watchDataManager.markUnwatched(videoPath);
                currentMovie.watchStatus = watchDataManager.getWatchStatus(videoPath);
            } else {
                // Has significant progress or is watched - keep position saved
                console.log('Position saved - in progress or rewatching');
            }
        }
        
        // Update localStorage cache
        localStorage.setItem('allMoviesCache', JSON.stringify(allMovies));
        
        // Check if detail page is open
        const detailPage = document.getElementById('detailPage');
        const detailIsOpen = detailPage && detailPage.style.display !== 'none';
        
        // If detail page is open, refresh just the content without calling openDetail
        if (detailIsOpen && window.keyboardNav && window.keyboardNav.currentMovie) {
            console.log('Detail page is open - updating content in place');
            const movie = allMovies.find(m => m.videoPath === window.keyboardNav.currentMovie.videoPath);
            if (movie) {
                // Update the movie's watch status
                window.keyboardNav.currentMovie.watchStatus = movie.watchStatus;
                
                // Update detail poster badges/progress in place
                const detailPosterContainer = document.querySelector('.detail-poster-container');
                if (detailPosterContainer) {
                    // Remove old badge and progress bar
                    const oldBadge = detailPosterContainer.querySelector('.watched-badge');
                    const oldProgress = detailPosterContainer.querySelector('.progress-bar');
                    if (oldBadge) oldBadge.remove();
                    if (oldProgress) oldProgress.remove();
                    
                    const ws = movie.watchStatus;
                    
                    // Add watched badge if watched
                    if (ws.watched) {
                        const badge = document.createElement('div');
                        badge.className = 'watched-badge';
                        badge.innerHTML = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <path d="M12 24C15.1826 24 18.2348 22.7357 20.4853 20.4853C22.7357 18.2348 24 15.1826 24 12C24 8.8174 22.7357 5.76516 20.4853 3.51472C18.2348 1.26428 15.1826 0 12 0C8.8174 0 5.76516 1.26428 3.51472 3.51472C1.26428 5.76516 0 8.8174 0 12C0 15.1826 1.26428 18.2348 3.51472 20.4853C5.76516 22.7357 8.8174 24 12 24ZM17.2969 9.79688L11.2969 15.7969C10.8563 16.2375 10.1438 16.2375 9.70781 15.7969L6.70781 12.7969C6.26719 12.3563 6.26719 11.6438 6.70781 11.2078C7.14844 10.7719 7.86094 10.7672 8.29688 11.2078L10.5 13.4109L15.7031 8.20312C16.1437 7.7625 16.8562 7.7625 17.2922 8.20312C17.7281 8.64375 17.7328 9.35625 17.2922 9.79219L17.2969 9.79688Z" fill="white"/>
                        </svg>`;
                        detailPosterContainer.appendChild(badge);
                    }
                    
                    // Add progress bar if applicable
                    const timeRemaining = ws.duration - ws.position;
                    if (ws.position >= 600 && timeRemaining > 600) {
                        const progressBar = document.createElement('div');
                        progressBar.className = 'progress-bar';
                        const progressFill = document.createElement('div');
                        progressFill.className = 'progress-bar-fill';
                        progressFill.style.width = `${Math.min(ws.percentage, 100)}%`;
                        progressBar.appendChild(progressFill);
                        detailPosterContainer.appendChild(progressBar);
                    }
                    
                    console.log('Detail poster updated in place');
                }
                
                // Update meta (Ends at time) in place
                const detailMeta = document.querySelector('.detail-meta');
                if (detailMeta && movie.metadata) {
                    const metadata = movie.metadata;
                    const ws = movie.watchStatus;
                    
                    // Rebuild meta items
                    const metaItems = [];
                    if (metadata.year) metaItems.push(`<span>${metadata.year}</span>`);
                    if (metadata.runtime) {
                        const hours = Math.floor(metadata.runtime / 60);
                        const mins = metadata.runtime % 60;
                        if (hours > 0) {
                            metaItems.push(`<span>${hours}h ${mins}m</span>`);
                        } else {
                            metaItems.push(`<span>${mins}m</span>`);
                        }
                    }
                    if (metadata.mpaa) metaItems.push(`<span>${metadata.mpaa}</span>`);
                    if (metadata.rating > 0) metaItems.push(`<span>IMDb ${metadata.rating.toFixed(1)}</span>`);
                    
                    // Calculate end time with watch progress
                    if (metadata.runtime) {
                        let remainingMinutes = metadata.runtime;
                        if (ws && ws.position > 0) {
                            const watchedMinutes = Math.floor(ws.position / 60);
                            remainingMinutes = Math.max(0, metadata.runtime - watchedMinutes);
                        }
                        const now = new Date();
                        const endTime = new Date(now.getTime() + remainingMinutes * 60000);
                        const hours = endTime.getHours().toString().padStart(2, '0');
                        const mins = endTime.getMinutes().toString().padStart(2, '0');
                        metaItems.push(`<span>Ends at ${hours}:${mins}</span>`);
                    }
                    
                    detailMeta.innerHTML = metaItems.join('<div class="detail-meta-divider"></div>');
                    console.log('Detail meta updated in place');
                }
                
                // Update action buttons in place
                const detailActions = document.querySelector('.detail-actions');
                if (detailActions) {
                    const ws = movie.watchStatus;
                    const timeRemaining = ws.duration - ws.position;
                    const showProgressButtons = ws.position >= 600 && timeRemaining > 600;
                    
                    // BEFORE making any changes, save the current focus state
                    let wasFocusedOnPlayButton = false;
                    let wasFocusedOnRestartButton = false;
                    let hadRestartButton = false;
                    
                    if (window.keyboardNav && window.keyboardNav.detailMode) {
                        const wasFocused = document.activeElement;
                        const oldButtons = Array.from(document.querySelectorAll('.detail-button'));
                        const oldFocusIndex = oldButtons.indexOf(wasFocused);
                        
                        // Check if restart button exists before changes
                        const existingRestartButton = detailActions.querySelector('.detail-button:nth-child(2)');
                        hadRestartButton = existingRestartButton && existingRestartButton.querySelector('img[src*="restart.svg"]');
                        
                        // Track what was focused
                        wasFocusedOnPlayButton = oldFocusIndex === 0;
                        wasFocusedOnRestartButton = oldFocusIndex === 1 && hadRestartButton;
                        
                        console.log('Before update - focus on play:', wasFocusedOnPlayButton, 'focus on restart:', wasFocusedOnRestartButton, 'had restart:', hadRestartButton);
                    }
                    
                    // Find the first button (Play/Resume button)
                    const playButton = detailActions.querySelector('.detail-button:first-child');
                    if (playButton) {
                        const playButtonText = playButton.querySelector('.detail-button-text');
                        if (playButtonText) {
                            playButtonText.textContent = showProgressButtons ? 'Resume' : 'Play';
                        }
                        
                        // Update onclick to use current position
                        const escapedVideoPath = movie.videoPath.replace(/'/g, "\\'");
                        playButton.setAttribute('onclick', `playMovieWithMetadata('${escapedVideoPath}', ${ws.position}, window.currentMovieMetadata)`);
                    }
                    
                    // Check if "Play From Beginning" button exists
                    const restartButton = detailActions.querySelector('.detail-button:nth-child(2)');
                    const isRestartButton = restartButton && restartButton.querySelector('img[src*="restart.svg"]');
                    
                    if (showProgressButtons) {
                        // Need restart button
                        if (!isRestartButton) {
                            // Create restart button
                            const button = document.createElement('button');
                            button.className = 'detail-button';
                            const escapedVideoPath = movie.videoPath.replace(/'/g, "\\'");
                            button.setAttribute('onclick', `playFromBeginning('${escapedVideoPath}')`);
                            
                            const icon = document.createElement('img');
                            icon.src = 'assets/icons/restart.svg';
                            icon.className = 'detail-button-icon';
                            icon.alt = '';
                            
                            const text = document.createElement('span');
                            text.className = 'detail-button-text';
                            text.textContent = 'Play From Beginning';
                            
                            button.appendChild(icon);
                            button.appendChild(text);
                            
                            // Insert after play button
                            if (playButton && playButton.nextSibling) {
                                detailActions.insertBefore(button, playButton.nextSibling);
                            }
                        }
                    } else {
                        // No restart button needed
                        if (isRestartButton) {
                            restartButton.remove();
                        }
                    }
                    
                    // Re-initialize keyboard navigation for buttons
                    // CRITICAL: Force keyboard nav into detail mode if detail page is open
                    if (window.keyboardNav) {
                        console.log('=== KEYBOARD NAV STATE ===');
                        console.log('detailMode:', window.keyboardNav.detailMode);
                        console.log('mode:', window.keyboardNav.mode);
                        console.log('currentIndex:', window.keyboardNav.currentIndex);
                        console.log('items.length:', window.keyboardNav.items.length);
                        
                        // Force into detail mode since detail page is open
                        window.keyboardNav.detailMode = true;
                        window.keyboardNav.mode = 'detail';
                        
                        // Update the items list to get all buttons
                        window.keyboardNav.updateItems('.detail-button');
                        console.log('After updateItems - items.length:', window.keyboardNav.items.length);
                        
                        // Determine the correct index after update
                        let newIndex = 0;
                        
                        if (wasFocusedOnRestartButton && !showProgressButtons) {
                            // Was focused on restart button, but it's now gone - focus play button
                            newIndex = 0;
                            console.log('Logic: Was on restart, now gone -> focus play (0)');
                        } else if (wasFocusedOnPlayButton) {
                            // Was on play button, keep it there
                            newIndex = 0;
                            console.log('Logic: Was on play -> stay on play (0)');
                        } else {
                            // Default to play button if uncertain
                            newIndex = 0;
                            console.log('Logic: Default -> focus play (0)');
                        }
                        
                        console.log('Setting currentIndex to:', newIndex);
                        
                        // Update index and focus with a small delay to ensure DOM is ready
                        window.keyboardNav.currentIndex = newIndex;
                        
                        // Use setTimeout to ensure DOM updates have completed
                        setTimeout(() => {
                            console.log('Calling focusItem...');
                            window.keyboardNav.focusItem();
                            console.log('=== END KEYBOARD NAV UPDATE ===');
                        }, 50);
                    }
                    
                    console.log('Detail action buttons updated in place');
                }
                
                // Update grid cards in place
                const movieCards = document.querySelectorAll('.movie-card');
                movieCards.forEach(card => {
                    const videoPath = card.dataset.videoPath;
                    const cardMovie = allMovies.find(m => m.videoPath === videoPath);
                    if (cardMovie) {
                        const posterContainer = card.querySelector('.movie-card-poster-container');
                        if (posterContainer) {
                            // Remove old badge and progress bar
                            const oldBadge = posterContainer.querySelector('.watched-badge');
                            const oldProgress = posterContainer.querySelector('.progress-bar');
                            if (oldBadge) oldBadge.remove();
                            if (oldProgress) oldProgress.remove();
                            
                            const ws = cardMovie.watchStatus;
                            
                            // Add watched badge if watched
                            if (ws.watched) {
                                const badge = document.createElement('div');
                                badge.className = 'watched-badge';
                                badge.innerHTML = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                    <path d="M12 24C15.1826 24 18.2348 22.7357 20.4853 20.4853C22.7357 18.2348 24 15.1826 24 12C24 8.8174 22.7357 5.76516 20.4853 3.51472C18.2348 1.26428 15.1826 0 12 0C8.8174 0 5.76516 1.26428 3.51472 3.51472C1.26428 5.76516 0 8.8174 0 12C0 15.1826 1.26428 18.2348 3.51472 20.4853C5.76516 22.7357 8.8174 24 12 24ZM17.2969 9.79688L11.2969 15.7969C10.8563 16.2375 10.1438 16.2375 9.70781 15.7969L6.70781 12.7969C6.26719 12.3563 6.26719 11.6438 6.70781 11.2078C7.14844 10.7719 7.86094 10.7672 8.29688 11.2078L10.5 13.4109L15.7031 8.20312C16.1437 7.7625 16.8562 7.7625 17.2922 8.20312C17.7281 8.64375 17.7328 9.35625 17.2922 9.79219L17.2969 9.79688Z" fill="white"/>
                                </svg>`;
                                posterContainer.appendChild(badge);
                            }
                            
                            // Add progress bar if applicable
                            const timeRemaining = ws.duration - ws.position;
                            if (ws.position >= 600 && timeRemaining > 600) {
                                const progressBar = document.createElement('div');
                                progressBar.className = 'progress-bar';
                                const progressFill = document.createElement('div');
                                progressFill.className = 'progress-bar-fill';
                                progressFill.style.width = `${Math.min(ws.percentage, 100)}%`;
                                progressBar.appendChild(progressFill);
                                posterContainer.appendChild(progressBar);
                            }
                        }
                    }
                });
                console.log('Grid cards updated in place');
                
                // Keyboard nav stays in detail mode - nothing to restore
            }
        } else if (window.currentShow) {
            // Check if we're on show detail page (has season cards) or season detail page
            const isShowDetailPage = document.querySelector('.tv-seasons-grid') !== null;
            const isSeasonDetailPage = document.querySelector('.season-detail-wrapper') !== null;
            
            if (isShowDetailPage) {
                // We're on the TV show detail page (overview with season cards)
                console.log('Show detail page is open - updating season badges');
                
                // Update season card badges
                updateSeasonCardBadges();
                
                // Refresh the Next Episode button text/state
                // Re-render the show detail page to update the button
                openShowDetail(window.currentShow);
                
            } else if (isSeasonDetailPage && window.currentSeason) {
            // We're on a TV show season detail page - update episode cards
            console.log('Season detail page is open - updating episode cards');
            
            // Focus on the episode that was playing when exiting (use currentlyPlayingVideoPath)
            const episodeToFocus = currentlyPlayingVideoPath || videoPath;
            if (episodeToFocus && window.keyboardNav) {
                // First, find which season this episode belongs to
                let targetSeason = null;
                let targetEpisodeIndex = -1;
                
                for (const season of window.currentShow.seasons) {
                    const idx = season.episodes.findIndex(ep => ep.videoPath === episodeToFocus);
                    if (idx >= 0) {
                        targetSeason = season;
                        targetEpisodeIndex = idx;
                        break;
                    }
                }
                
                if (targetSeason && targetEpisodeIndex >= 0) {
                    // Check what season is ACTUALLY displayed in the UI (not window.currentSeason which may be stale)
                    const activeTab = document.querySelector('.season-tab-active');
                    const displayedSeasonNumber = activeTab ? parseInt(activeTab.textContent.replace(/\D/g, '')) : window.currentSeason.number;
                    
                    console.log('Target season:', targetSeason.number, 'Displayed season:', displayedSeasonNumber);
                    
                    // Check if we need to switch seasons
                    if (targetSeason.number !== displayedSeasonNumber) {
                        console.log('Episode is in different season - switching from Season', displayedSeasonNumber, 'to Season', targetSeason.number);
                        console.log('Target episode index:', targetEpisodeIndex);
                        
                        // Store the target episode index before switching
                        const savedEpisodeIdx = targetEpisodeIndex;
                        
                        // Open the new season detail page (same as clicking a season tab)
                        openSeasonDetail(window.currentShow, targetSeason.number);
                        
                        // Use setTimeout to ensure DOM is fully rendered
                        setTimeout(() => {
                            console.log('After season switch - focusing episode', savedEpisodeIdx);
                            
                            // Update keyboard nav state
                            window.keyboardNav.lastEpisodeIndex = savedEpisodeIdx;
                            window.keyboardNav.savedEpisodeIndex = savedEpisodeIdx;
                            window.keyboardNav.detailSubMode = 'episodes';
                            window.keyboardNav.updateItems('.season-episode-card');
                            window.keyboardNav.currentIndex = savedEpisodeIdx;
                            
                            const episodeCards = document.querySelectorAll('.season-episode-card');
                            const scrollContainer = document.querySelector('.season-episodes-scroll');
                            
                            console.log('Episode cards found:', episodeCards.length);
                            
                            if (episodeCards[savedEpisodeIdx] && scrollContainer) {
                                // Disable smooth scroll for instant positioning
                                scrollContainer.style.scrollBehavior = 'auto';
                                
                                // Use flush-left positioning
                                if (savedEpisodeIdx === 0) {
                                    scrollContainer.scrollLeft = 0;
                                } else {
                                    scrollContainer.scrollLeft = episodeCards[savedEpisodeIdx].offsetLeft;
                                }
                                
                                // Re-enable smooth scroll
                                setTimeout(() => {
                                    scrollContainer.style.scrollBehavior = '';
                                }, 50);
                                
                                // Update focus styling
                                episodeCards.forEach(card => card.classList.remove('focused'));
                                episodeCards[savedEpisodeIdx].classList.add('focused');
                                
                                // Update the episode info panel
                                if (window.keyboardNav.updateSeasonEpisodeInfo) {
                                    window.keyboardNav.updateSeasonEpisodeInfo();
                                }
                            }
                        }, 150); // Give DOM time to render
                    } else {
                        // Same season - just focus the episode
                        console.log('Same season - focusing episode index:', targetEpisodeIndex);
                        window.keyboardNav.lastEpisodeIndex = targetEpisodeIndex;
                        window.keyboardNav.savedEpisodeIndex = targetEpisodeIndex;
                        
                        // Set the current index
                        if (window.keyboardNav.detailSubMode === 'episodes') {
                            window.keyboardNav.currentIndex = targetEpisodeIndex;
                        }
                        
                        // Scroll the episode into view instantly (flush left position)
                        requestAnimationFrame(() => {
                            const episodeCards = document.querySelectorAll('.season-episode-card');
                            const scrollContainer = document.querySelector('.season-episodes-scroll');
                            
                            if (episodeCards[targetEpisodeIndex] && scrollContainer) {
                                // Disable smooth scroll for instant positioning
                                scrollContainer.style.scrollBehavior = 'auto';
                                
                                // Use flush-left positioning like keyboard-nav does
                                if (targetEpisodeIndex === 0) {
                                    scrollContainer.scrollLeft = 0;
                                } else {
                                    scrollContainer.scrollLeft = episodeCards[targetEpisodeIndex].offsetLeft;
                                }
                                
                                // Re-enable smooth scroll
                                setTimeout(() => {
                                    scrollContainer.style.scrollBehavior = '';
                                }, 50);
                                
                                // Update focus styling
                                episodeCards.forEach(card => card.classList.remove('focused'));
                                episodeCards[targetEpisodeIndex].classList.add('focused');
                                
                                // Update the episode info panel to match the focused episode
                                if (window.keyboardNav.updateSeasonEpisodeInfo) {
                                    window.keyboardNav.updateSeasonEpisodeInfo();
                                }
                                
                                // Update items array for keyboard nav
                                window.keyboardNav.updateItems('.season-episode-card');
                                window.keyboardNav.currentIndex = targetEpisodeIndex;
                            }
                        });
                    }
                }
            }
            
            // Clear the currently playing video path
            currentlyPlayingVideoPath = null;
            
            // Check the played episode's watch status
            const isTVEpisode = videoPath.includes('/Season ') || videoPath.includes('\\Season ');
            if (isTVEpisode) {
                const episodeWs = watchDataManager.getWatchStatus(videoPath);
                
                // If under 5 minutes watched AND not watched - clear progress completely
                if (episodeWs.position < 300 && !episodeWs.watched) {
                    console.log('TV episode under 5 min watched, not marked watched - clearing');
                    watchDataManager.markUnwatched(videoPath);
                }
            }
            
            // Update all shows' episodes with fresh watch status
            allShows.forEach(show => {
                show.seasons.forEach(season => {
                    season.episodes.forEach(episode => {
                        episode.watchStatus = watchDataManager.getWatchStatus(episode.videoPath);
                    });
                });
            });
            
            // Check if the played episode is now watched - if so, track the next episode
            const playedEpisodeWatchStatus = watchDataManager.getWatchStatus(videoPath);
            if (playedEpisodeWatchStatus.watched) {
                updateActiveShowTracking(videoPath, window.currentShow, window.currentSeason, true);
            }
            
            // Update episode cards in DOM
            const episodeCards = document.querySelectorAll('.season-episode-card');
            episodeCards.forEach(card => {
                const episodeVideoPath = card.dataset.videoPath;
                if (!episodeVideoPath) return;
                
                const ws = watchDataManager.getWatchStatus(episodeVideoPath);
                const thumbContainer = card.querySelector('.season-episode-thumb-container');
                if (!thumbContainer) return;
                
                // Remove old watched badge and progress bar
                const oldBadge = thumbContainer.querySelector('.season-episode-number');
                const oldProgress = thumbContainer.querySelector('.progress-bar');
                if (oldBadge) oldBadge.remove();
                if (oldProgress) oldProgress.remove();
                
                // Get episode data
                const episodeData = JSON.parse(
                    card.dataset.episodeData
                        .replace(/&quot;/g, '"')
                        .replace(/&#39;/g, "'")
                );
                
                // Add new episode number badge with watched icon if applicable
                const isWatched = ws && ws.watched;
                const accentColor = window.currentShow.accentColor || '#39ddd8';
                
                if (isWatched) {
                    const badge = document.createElement('div');
                    badge.className = 'season-episode-number';
                    badge.innerHTML = `<span class="season-episode-watched-icon">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <path d="M12 24C15.1826 24 18.2348 22.7357 20.4853 20.4853C22.7357 18.2348 24 15.1826 24 12C24 8.8174 22.7357 5.76516 20.4853 3.51472C18.2348 1.26428 15.1826 0 12 0C8.8174 0 5.76516 1.26428 3.51472 3.51472C1.26428 5.76516 0 8.8174 0 12C0 15.1826 1.26428 18.2348 3.51472 20.4853C5.76516 22.7357 8.8174 24 12 24ZM17.2969 9.79688L11.2969 15.7969C10.8563 16.2375 10.1438 16.2375 9.70781 15.7969L6.70781 12.7969C6.26719 12.3563 6.26719 11.6438 6.70781 11.2078C7.14844 10.7719 7.86094 10.7672 8.29688 11.2078L10.5 13.4109L15.7031 8.20312C16.1437 7.7625 16.8562 7.7625 17.2922 8.20312C17.7281 8.64375 17.7328 9.35625 17.2922 9.79219L17.2969 9.79688Z"/>
                        </svg>
                    </span>E${episodeData.episode.toString().padStart(2, '0')}`;
                    thumbContainer.appendChild(badge);
                } else {
                    const badge = document.createElement('div');
                    badge.className = 'season-episode-number';
                    badge.textContent = `E${episodeData.episode.toString().padStart(2, '0')}`;
                    thumbContainer.appendChild(badge);
                }
                
                // Add progress bar if applicable (show even if watched)
                const hasProgress = ws && ws.position > 0;
                if (hasProgress) {
                    const progressBar = document.createElement('div');
                    progressBar.className = 'progress-bar';
                    const progressFill = document.createElement('div');
                    progressFill.className = 'progress-bar-fill';
                    progressFill.style.width = `${Math.min(ws.percentage, 100)}%`;
                    progressBar.appendChild(progressFill);
                    thumbContainer.appendChild(progressBar);
                }
            });
            
            console.log('Episode cards updated in place');
            
            // Update season card badges in the show detail page
            updateSeasonCardBadges();
            }
        } else if (window.returnToPlaylist) {
            // We need to return to a playlist after playback
            console.log('Returning to playlist after playback', window.returnToPlaylist);
            const returnState = window.returnToPlaylist;
            window.returnToPlaylist = null;
            
            const playlist = playlistManager.getById(returnState.playlistId);
            if (playlist) {
                // Open playlist detail with saved focus state
                openPlaylistDetail(playlist, {
                    section: returnState.section || 'list',
                    focusedIndex: returnState.focusedIndex,
                    buttonIndex: returnState.buttonIndex
                });
            }
        } else {
            console.log('Detail page is closed - re-rendering grid normally');
            // Detail page is closed, re-render grid normally
            const grid = document.getElementById('movieGrid');
            if (grid && grid.style.display !== 'none') {
                renderMovieGrid(allMovies);
            }
            
            // Check if this was a TV episode and handle active show tracking
            const isTVEpisode = videoPath.includes('/Season ') || videoPath.includes('\\Season ');
            if (isTVEpisode) {
                const episodeWatchStatus = watchDataManager.getWatchStatus(videoPath);
                if (episodeWatchStatus.watched) {
                    // Find the show this episode belongs to
                    for (const show of allShows) {
                        let found = false;
                        for (const season of show.seasons) {
                            if (season.episodes.some(ep => ep.videoPath === videoPath)) {
                                updateActiveShowTracking(videoPath, show, season, true);
                                found = true;
                                break;
                            }
                        }
                        if (found) break;
                    }
                }
            }
        }
        
        console.log('Watch status refreshed');
    }
});

/**
 * Update season card badges in the show detail page after watch status changes
 */
function updateSeasonCardBadges() {
    if (!window.currentShow) return;
    
    const seasonCards = document.querySelectorAll('.tv-season-card');
    if (!seasonCards.length) return;
    
    seasonCards.forEach(card => {
        const seasonNumber = parseInt(card.dataset.season);
        const season = window.currentShow.seasons.find(s => s.number === seasonNumber);
        if (!season) return;
        
        // Calculate watch stats for this season
        let watchedCount = 0;
        let unwatchedCount = 0;
        
        season.episodes.forEach(episode => {
            const ws = watchDataManager.getWatchStatus(episode.videoPath);
            if (ws && ws.watched) {
                watchedCount++;
            } else {
                unwatchedCount++;
            }
        });
        
        const allWatched = unwatchedCount === 0 && watchedCount > 0;
        const hasUnwatched = unwatchedCount > 0;
        
        // Find and update/replace the badge
        const posterContainer = card.querySelector('.tv-season-poster-container');
        if (!posterContainer) return;
        
        // Remove existing badge
        const existingBadge = posterContainer.querySelector('.tv-season-badge');
        if (existingBadge) existingBadge.remove();
        
        // Add new badge
        if (allWatched) {
            const badge = document.createElement('div');
            badge.className = 'tv-season-badge tv-season-badge-watched';
            badge.innerHTML = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M12 24C15.1826 24 18.2348 22.7357 20.4853 20.4853C22.7357 18.2348 24 15.1826 24 12C24 8.8174 22.7357 5.76516 20.4853 3.51472C18.2348 1.26428 15.1826 0 12 0C8.8174 0 5.76516 1.26428 3.51472 3.51472C1.26428 5.76516 0 8.8174 0 12C0 15.1826 1.26428 18.2348 3.51472 20.4853C5.76516 22.7357 8.8174 24 12 24ZM17.2969 9.79688L11.2969 15.7969C10.8563 16.2375 10.1438 16.2375 9.70781 15.7969L6.70781 12.7969C6.26719 12.3563 6.26719 11.6438 6.70781 11.2078C7.14844 10.7719 7.86094 10.7672 8.29688 11.2078L10.5 13.4109L15.7031 8.20312C16.1437 7.7625 16.8562 7.7625 17.2922 8.20312C17.7281 8.64375 17.7328 9.35625 17.2922 9.79219L17.2969 9.79688Z"/>
            </svg>`;
            posterContainer.appendChild(badge);
        } else if (hasUnwatched) {
            const badge = document.createElement('div');
            badge.className = 'tv-season-badge tv-season-badge-count';
            badge.textContent = unwatchedCount.toString();
            posterContainer.appendChild(badge);
        }
    });
    
    console.log('Season card badges updated');
}

/**
 * Update active show tracking when a TV episode is watched
 * @param {string} videoPath - Path to the episode that was just watched
 * @param {Object} show - The show object
 * @param {Object} currentSeason - The current season object (optional, will search if not provided)
 * @param {boolean} forceUpdate - If true, always update (e.g., from Continue Watching carousel)
 */
function updateActiveShowTracking(videoPath, show, currentSeason = null, forceUpdate = false) {
    if (!show || !watchDataManager) return;
    
    // Check if this show is already in Continue Watching (active shows)
    // Only update if it's already there, unless forceUpdate is true
    const activeShows = watchDataManager.watchData._activeShows || {};
    const isInContinueWatching = Object.keys(activeShows).includes(show.showPath);
    
    if (!isInContinueWatching && !forceUpdate) {
        console.log(`Show "${show.title}" not in Continue Watching, skipping active show update`);
        return;
    }
    
    // Find the episode that was watched
    let watchedEpisode = null;
    let watchedSeason = null;
    
    for (const season of show.seasons) {
        const episode = season.episodes.find(ep => ep.videoPath === videoPath);
        if (episode) {
            watchedEpisode = episode;
            watchedSeason = season;
            break;
        }
    }
    
    if (!watchedEpisode || !watchedSeason) {
        console.log('Could not find watched episode in show data');
        return;
    }
    
    console.log(`Episode watched: ${show.title} S${watchedSeason.number}E${watchedEpisode.episode}`);
    
    // Find the next episode
    let nextEpisode = null;
    let nextSeason = null;
    
    // First, try to find next episode in same season
    const currentEpisodeIndex = watchedSeason.episodes.findIndex(ep => ep.videoPath === videoPath);
    if (currentEpisodeIndex < watchedSeason.episodes.length - 1) {
        nextEpisode = watchedSeason.episodes[currentEpisodeIndex + 1];
        nextSeason = watchedSeason;
    } else {
        // Look for first episode of next season
        const currentSeasonIndex = show.seasons.findIndex(s => s.number === watchedSeason.number);
        if (currentSeasonIndex < show.seasons.length - 1) {
            const nextSeasonObj = show.seasons[currentSeasonIndex + 1];
            if (nextSeasonObj.episodes.length > 0) {
                nextEpisode = nextSeasonObj.episodes[0];
                nextSeason = nextSeasonObj;
            }
        }
    }
    
    if (nextEpisode) {
        console.log(`Next episode: ${show.title} S${nextSeason.number}E${nextEpisode.episode}`);
        watchDataManager.updateActiveShow(
            videoPath,
            show.showPath,
            watchedSeason.number,
            watchedEpisode.episode,
            nextEpisode.videoPath
        );
    } else {
        console.log(`No next episode - show complete`);
        watchDataManager.updateActiveShow(
            videoPath,
            show.showPath,
            watchedSeason.number,
            watchedEpisode.episode,
            null
        );
    }
}

// Make it globally accessible for other parts of the app
window.updateActiveShowTracking = updateActiveShowTracking;

// Handle close player (when movie ends via eof-reached)
ipcRenderer.on('close-player', () => {
    console.log('Closing player and returning to detail page');
    const { closePlayer } = require('./player.js');
    closePlayer();
});

// Handle play next episode (from OSD up-next modal - fallback for old method)
ipcRenderer.on('play-next-episode', (event, nextEpisodeData) => {
    console.log('Playing next item from up-next modal:', nextEpisodeData);
    
    const { closePlayer } = require('./player.js');
    
    // Close current player
    closePlayer();
    
    // Small delay to ensure clean transition
    setTimeout(() => {
        // Check if this is a playlist item
        if (nextEpisodeData.isPlaylistItem) {
            console.log('Playing next playlist item:', nextEpisodeData.title);
            playPlaylistQueueItem(nextEpisodeData.queueIndex);
        } else {
            // It's a TV episode
            // Format season/episode string
            const seasonEp = `S${String(nextEpisodeData.seasonNumber).padStart(2, '0')} E${String(nextEpisodeData.episodeNumber).padStart(2, '0')}`;
            
            // Play the next episode
            window.playTVEpisode(
                nextEpisodeData.videoPath,
                0, // Start from beginning
                nextEpisodeData.showTitle,
                seasonEp,
                nextEpisodeData.title
            );
        }
    }, 300);
});

// Handle request for next item from OSD nav button (seamless playback)
ipcRenderer.on('request-next-item', () => {
    console.log('Request next item from OSD');
    
    // Check if we're playing a playlist
    if (window.playlistQueue && window.playlistQueue.length > 0 && typeof window.currentQueueIndex === 'number') {
        const nextIndex = window.currentQueueIndex + 1;
        if (nextIndex < window.playlistQueue.length) {
            console.log('Sending next playlist item for seamless playback, index:', nextIndex);
            
            const videoPath = window.playlistQueue[nextIndex];
            const movie = allMovies.find(m => m.videoPath === videoPath);
            if (!movie) return;
            
            // Get saved position
            const ws = watchDataManager.getWatchStatus(movie.videoPath);
            const startPosition = (ws && ws.position > 0) ? ws.position : 0;
            
            // Build metadata
            const metadata = buildMovieOSDMetadata(movie);
            
            // Send to OSD for seamless playback
            ipcRenderer.send('play-item-seamless', {
                videoPath: videoPath,
                startPosition: startPosition,
                osdMetadata: metadata,
                isPlaylistItem: true,
                queueIndex: nextIndex,
                navButtons: {
                    hasPrevious: nextIndex > 0,
                    hasNext: nextIndex < window.playlistQueue.length - 1
                }
            });
        } else {
            console.log('Already at end of playlist');
        }
    } 
    // Check if we're playing a TV show
    else if (window.currentShow) {
        const player = require('./player.js');
        const currentVideoPath = player.getCurrentVideoPath();
        const nextEpisodeData = findNextEpisode(currentVideoPath);
        
        if (nextEpisodeData) {
            console.log('Sending next episode for seamless playback:', nextEpisodeData.title);
            
            // Get saved position
            const ws = watchDataManager.getWatchStatus(nextEpisodeData.videoPath);
            const startPosition = (ws && ws.position > 0) ? ws.position : 0;
            
            // Build OSD metadata for TV
            const seasonEp = `S${String(nextEpisodeData.seasonNumber).padStart(2, '0')} E${String(nextEpisodeData.episodeNumber).padStart(2, '0')}`;
            const metadata = {
                title: nextEpisodeData.showTitle,
                year: seasonEp,
                rating: nextEpisodeData.title,
                accentColor: nextEpisodeData.accentColor
            };
            
            // Check for previous episode (for nav buttons)
            const prevEpisodeData = findPreviousEpisode(nextEpisodeData.videoPath);
            const nextNextEpisodeData = findNextEpisode(nextEpisodeData.videoPath);
            
            ipcRenderer.send('play-item-seamless', {
                videoPath: nextEpisodeData.videoPath,
                startPosition: startPosition,
                osdMetadata: metadata,
                isTVEpisode: true,
                seasonNumber: nextEpisodeData.seasonNumber,
                episodeNumber: nextEpisodeData.episodeNumber,
                showTitle: nextEpisodeData.showTitle,
                episodeTitle: nextEpisodeData.title,
                navButtons: {
                    hasPrevious: !!prevEpisodeData,
                    hasNext: !!nextNextEpisodeData
                }
            });
        } else {
            console.log('No next episode available');
        }
    }
});

// Handle request for previous item from OSD nav button (seamless playback)
ipcRenderer.on('request-previous-item', () => {
    console.log('Request previous item from OSD');
    
    // Check if we're playing a playlist
    if (window.playlistQueue && window.playlistQueue.length > 0 && typeof window.currentQueueIndex === 'number') {
        const prevIndex = window.currentQueueIndex - 1;
        if (prevIndex >= 0) {
            console.log('Sending previous playlist item for seamless playback, index:', prevIndex);
            
            const videoPath = window.playlistQueue[prevIndex];
            const movie = allMovies.find(m => m.videoPath === videoPath);
            if (!movie) return;
            
            // Get saved position
            const ws = watchDataManager.getWatchStatus(movie.videoPath);
            const startPosition = (ws && ws.position > 0) ? ws.position : 0;
            
            // Build metadata
            const metadata = buildMovieOSDMetadata(movie);
            
            // Send to OSD for seamless playback
            ipcRenderer.send('play-item-seamless', {
                videoPath: videoPath,
                startPosition: startPosition,
                osdMetadata: metadata,
                isPlaylistItem: true,
                queueIndex: prevIndex,
                navButtons: {
                    hasPrevious: prevIndex > 0,
                    hasNext: prevIndex < window.playlistQueue.length - 1
                }
            });
        } else {
            console.log('Already at beginning of playlist');
        }
    }
    // Check if we're playing a TV show
    else if (window.currentShow) {
        const player = require('./player.js');
        const currentVideoPath = player.getCurrentVideoPath();
        const prevEpisodeData = findPreviousEpisode(currentVideoPath);
        
        if (prevEpisodeData) {
            console.log('Sending previous episode for seamless playback:', prevEpisodeData.title);
            
            // Get saved position
            const ws = watchDataManager.getWatchStatus(prevEpisodeData.videoPath);
            const startPosition = (ws && ws.position > 0) ? ws.position : 0;
            
            // Build OSD metadata for TV
            const seasonEp = `S${String(prevEpisodeData.seasonNumber).padStart(2, '0')} E${String(prevEpisodeData.episodeNumber).padStart(2, '0')}`;
            const metadata = {
                title: prevEpisodeData.showTitle,
                year: seasonEp,
                rating: prevEpisodeData.title,
                accentColor: prevEpisodeData.accentColor
            };
            
            // Check for nav buttons
            const prevPrevEpisodeData = findPreviousEpisode(prevEpisodeData.videoPath);
            const nextEpisodeData = findNextEpisode(prevEpisodeData.videoPath);
            
            ipcRenderer.send('play-item-seamless', {
                videoPath: prevEpisodeData.videoPath,
                startPosition: startPosition,
                osdMetadata: metadata,
                isTVEpisode: true,
                seasonNumber: prevEpisodeData.seasonNumber,
                episodeNumber: prevEpisodeData.episodeNumber,
                showTitle: prevEpisodeData.showTitle,
                episodeTitle: prevEpisodeData.title,
                navButtons: {
                    hasPrevious: !!prevPrevEpisodeData,
                    hasNext: !!nextEpisodeData
                }
            });
        } else {
            console.log('No previous episode available');
        }
    }
});

// Handle item started seamlessly - update tracking
ipcRenderer.on('item-started-seamless', (event, itemData) => {
    console.log('Item started seamlessly:', itemData.osdMetadata?.title);
    
    // Get the player module
    const player = require('./player.js');
    
    // Get the previous video path
    const previousVideoPath = player.getCurrentVideoPath();
    
    // Stop tracking the previous item
    if (player.stopPositionTracking) {
        player.stopPositionTracking();
    }
    
    // Mark the previous item as watched if it was near the end
    if (window.watchDataManager && previousVideoPath) {
        const prevWs = window.watchDataManager.getWatchStatus(previousVideoPath);
        if (prevWs && prevWs.percentage >= 90) {
            console.log('Marking previous item as watched:', previousVideoPath);
            window.watchDataManager.markWatched(previousVideoPath, prevWs.duration);
        }
    }
    
    // Update current video path in player
    if (player.setCurrentVideoPath) {
        player.setCurrentVideoPath(itemData.videoPath);
    }
    
    // Start tracking for the new item
    if (player.startPositionTracking) {
        player.startPositionTracking(itemData.videoPath, window.watchDataManager);
    }
    
    // Update queue index for playlists
    if (itemData.isPlaylistItem && typeof itemData.queueIndex === 'number') {
        window.currentQueueIndex = itemData.queueIndex;
        window.playlistQueueIndex = itemData.queueIndex;
    }
    
    // Update current show/season context for TV
    if (itemData.isTVEpisode && window.currentShow) {
        // Find the season for this episode
        for (const season of window.currentShow.seasons) {
            const episode = season.episodes.find(ep => ep.videoPath === itemData.videoPath);
            if (episode) {
                window.currentSeason = season;
                break;
            }
        }
    }
    
    // Track the currently playing video path
    currentlyPlayingVideoPath = itemData.videoPath;
    
    // Set up next episode data for Up Next modal
    if (itemData.isPlaylistItem) {
        const nextIndex = itemData.queueIndex + 1;
        if (nextIndex < window.playlistQueue.length) {
            const nextPath = window.playlistQueue[nextIndex];
            const nextMovie = allMovies.find(m => m.videoPath === nextPath);
            if (nextMovie) {
                const nextMetadata = buildMovieOSDMetadata(nextMovie);
                window.pendingNextEpisodeData = {
                    videoPath: nextMovie.videoPath,
                    title: nextMetadata.title,
                    posterPath: nextMovie.posterPath,
                    isPlaylistItem: true,
                    queueIndex: nextIndex,
                    osdMetadata: nextMetadata
                };
                ipcRenderer.send('set-next-episode', window.pendingNextEpisodeData);
            }
        } else {
            ipcRenderer.send('set-next-episode', null);
        }
    } else if (itemData.isTVEpisode) {
        const nextEp = findNextEpisode(itemData.videoPath);
        if (nextEp) {
            ipcRenderer.send('set-next-episode', nextEp);
        } else {
            ipcRenderer.send('set-next-episode', null);
        }
    }
});

// Handle episode started (seamless auto-play within same MPV window)
ipcRenderer.on('episode-started', (event, episodeData) => {
    console.log('Episode started (seamless):', episodeData);
    
    // Track the currently playing video path for focus on return
    currentlyPlayingVideoPath = episodeData.videoPath;
    
    // Get the player module
    const player = require('./player.js');
    
    // Get the previous video path BEFORE stopping tracking (which clears it)
    const previousVideoPath = player.getCurrentVideoPath();
    console.log('Previous video path:', previousVideoPath);
    
    // Stop tracking the previous episode
    if (player.stopPositionTracking) {
        player.stopPositionTracking();
    }
    
    // Mark the previous episode as watched (it was at the end - that's why Up Next appeared)
    if (window.watchDataManager && previousVideoPath && previousVideoPath !== episodeData.videoPath) {
        console.log('Marking previous episode as watched:', previousVideoPath);
        // Get the duration from watch data, or use a default
        const prevStatus = window.watchDataManager.getWatchStatus(previousVideoPath);
        const duration = (prevStatus && prevStatus.duration) ? prevStatus.duration : 0;
        window.watchDataManager.markWatched(previousVideoPath, duration);
        
        // Update active show tracking for Continue Watching carousel
        // Find the show/season for the previous episode
        if (window.allShows) {
            for (const show of window.allShows) {
                for (const season of show.seasons) {
                    const episode = season.episodes.find(ep => ep.videoPath === previousVideoPath);
                    if (episode) {
                        updateActiveShowTracking(previousVideoPath, show, season, true);
                        break;
                    }
                }
            }
        }
    }
    
    // Now start tracking the new episode
    if (window.watchDataManager && episodeData.videoPath) {
        // Clear any existing progress for the new episode (fresh start)
        // This prevents inheriting progress from the previous episode
        window.watchDataManager.clearPosition(episodeData.videoPath);
        
        // Update player's current video path
        if (player.setCurrentVideoPath) {
            player.setCurrentVideoPath(episodeData.videoPath);
        }
        
        // Start position tracking for the new episode
        if (player.startPositionTracking) {
            player.startPositionTracking(episodeData.videoPath, window.watchDataManager);
        }
    }
    
    // Update current show/season context if needed for finding next episode
    // Check if this is a playlist item first
    if (episodeData.isPlaylistItem && window.playlistQueue) {
        console.log('Playlist item started, updating queue index');
        // Find and send the next playlist item data to OSD
        const nextIndex = episodeData.queueIndex + 1;
        if (nextIndex < window.playlistQueue.length) {
            const nextPath = window.playlistQueue[nextIndex];
            const nextMovie = window.allMovies ? window.allMovies.find(m => m.videoPath === nextPath) : null;
            if (nextMovie) {
                // Build full OSD metadata for the next movie
                const nextMetadata = buildMovieOSDMetadata(nextMovie);
                
                const nextItemData = {
                    videoPath: nextMovie.videoPath,
                    title: nextMetadata.title,
                    year: nextMetadata.year,
                    rating: nextMetadata.rating,
                    runtime: nextMetadata.runtime,
                    resolution: nextMetadata.resolution,
                    endTime: nextMetadata.endTime,
                    accentColor: nextMetadata.accentColor,
                    posterPath: nextMovie.posterPath,
                    isPlaylistItem: true,
                    queueIndex: nextIndex,
                    queueTotal: window.playlistQueueTotal || window.playlistQueue.length,
                    osdMetadata: nextMetadata
                };
                console.log('Sending next playlist item data to OSD:', nextItemData.title);
                ipcRenderer.send('set-next-episode', nextItemData);
            }
        } else {
            console.log('End of playlist queue');
        }
    } else if (window.allShows) {
        // Find the show and season for this episode
        for (const show of window.allShows) {
            for (const season of show.seasons) {
                const episode = season.episodes.find(ep => ep.videoPath === episodeData.videoPath);
                if (episode) {
                    window.currentShow = show;
                    window.currentSeason = season;
                    console.log('Updated current show/season context:', show.title, 'S' + season.number);
                    break;
                }
            }
            if (window.currentShow === show) break;
        }
        
        // Find and send the next episode data to OSD
        const nextEpisodeData = findNextEpisode(episodeData.videoPath);
        if (nextEpisodeData) {
            console.log('Sending next-next episode data to OSD:', nextEpisodeData.title);
            ipcRenderer.send('set-next-episode', nextEpisodeData);
        } else {
            console.log('No more episodes after this one');
        }
    }
});

// Format time in seconds to HH:MM:SS
function formatTime(seconds) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    
    if (hours > 0) {
        return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${minutes}:${secs.toString().padStart(2, '0')}`;
}

// Search
function handleSearch(e) {
    const query = e.target.value.toLowerCase();
    
    if (!query) {
        renderMovieGrid(allMovies);
        return;
    }
    
    const filtered = allMovies.filter(movie => {
        return movie.metadata.title.toLowerCase().includes(query) ||
               movie.metadata.year.includes(query) ||
               movie.metadata.genre.some(g => g.toLowerCase().includes(query));
    });
    
    renderMovieGrid(filtered);
}

// Settings
function openSettings() {
    const modal = document.getElementById('settingsModal');
    
    // Load current config into form
    document.getElementById('moviesPathInput').value = config.moviesPath || '';
    
    // Load subtitle settings from config
    settingsSubSize = config.subtitleSize || 100;
    settingsSubPos = config.subtitlePosition || 100;
    settingsSubColorIndex = config.subtitleColorIndex || 0;
    settingsSubBackIndex = config.subtitleBackgroundIndex || 0;
    
    // Update display values
    document.getElementById('settings-sub-size').textContent = settingsSubSize + '%';
    document.getElementById('settings-sub-pos').textContent = settingsSubPos + '%';
    document.getElementById('settings-sub-color').textContent = subColorOptions[settingsSubColorIndex];
    document.getElementById('settings-sub-back').textContent = subBackOptions[settingsSubBackIndex];
    
    // Reset focus
    settingsFocusedRow = -1;
    updateSettingsRowFocus();
    
    modal.classList.add('active');
}

function closeSettings() {
    const modal = document.getElementById('settingsModal');
    settingsFocusedRow = -1;
    modal.classList.remove('active');
}

function updateSettingsRowFocus() {
    const rows = document.querySelectorAll('.settings-row');
    rows.forEach((row, index) => {
        row.classList.remove('focused');
        if (index === settingsFocusedRow) {
            row.classList.add('focused');
        }
    });
}

function flashSettingsArrow(row, direction) {
    const arrows = row.querySelectorAll('.settings-arrow');
    const arrow = direction === 'left' ? arrows[0] : arrows[1];
    if (arrow) {
        arrow.classList.add('arrow-flash');
        setTimeout(() => arrow.classList.remove('arrow-flash'), 150);
    }
}

function adjustSettingsOption(direction) {
    const rows = document.querySelectorAll('.settings-row');
    if (settingsFocusedRow < 0 || settingsFocusedRow >= rows.length) return;
    
    const row = rows[settingsFocusedRow];
    const setting = row.dataset.setting;
    
    flashSettingsArrow(row, direction);
    
    switch (setting) {
        case 'sub-size':
            if (direction === 'left' && settingsSubSize > 50) {
                settingsSubSize -= 10;
            } else if (direction === 'right' && settingsSubSize < 200) {
                settingsSubSize += 10;
            }
            document.getElementById('settings-sub-size').textContent = settingsSubSize + '%';
            break;
            
        case 'sub-pos':
            if (direction === 'left' && settingsSubPos > 0) {
                settingsSubPos -= 5;
            } else if (direction === 'right' && settingsSubPos < 100) {
                settingsSubPos += 5;
            }
            document.getElementById('settings-sub-pos').textContent = settingsSubPos + '%';
            break;
            
        case 'sub-color':
            if (direction === 'left') {
                settingsSubColorIndex = (settingsSubColorIndex - 1 + subColorOptions.length) % subColorOptions.length;
            } else if (direction === 'right') {
                settingsSubColorIndex = (settingsSubColorIndex + 1) % subColorOptions.length;
            }
            document.getElementById('settings-sub-color').textContent = subColorOptions[settingsSubColorIndex];
            break;
            
        case 'sub-back':
            if (direction === 'left') {
                settingsSubBackIndex = (settingsSubBackIndex - 1 + subBackOptions.length) % subBackOptions.length;
            } else if (direction === 'right') {
                settingsSubBackIndex = (settingsSubBackIndex + 1) % subBackOptions.length;
            }
            document.getElementById('settings-sub-back').textContent = subBackOptions[settingsSubBackIndex];
            break;
    }
}

window.saveSettings = function() {
    config.moviesPath = document.getElementById('moviesPathInput').value;
    
    // Save subtitle settings
    config.subtitleSize = settingsSubSize;
    config.subtitlePosition = settingsSubPos;
    config.subtitleColorIndex = settingsSubColorIndex;
    config.subtitleBackgroundIndex = settingsSubBackIndex;
    
    saveConfig();
    
    alert('Settings saved! Click "Reload Movies" to apply changes.');
};

window.loadMoviesFromSettings = async function() {
    closeSettings();
    await loadMoviesData();
};

// Help modal
function openHelp() {
    const modal = document.getElementById('helpModal');
    modal.classList.add('active');
}

function closeHelp() {
    const modal = document.getElementById('helpModal');
    modal.classList.remove('active');
}

// Global functions for HTML onclick
window.closeDetail = closeDetail;
window.closeSettings = closeSettings;
window.closeHelp = closeHelp;

// Expose subtitle settings for OSD to read
window.getSubtitleDefaults = function() {
    return {
        size: config.subtitleSize || 100,
        position: config.subtitlePosition || 100,
        colorIndex: config.subtitleColorIndex || 0,
        backgroundIndex: config.subtitleBackgroundIndex || 0
    };
};

// Expose settings functions for keyboard nav
window.adjustSettingsOption = adjustSettingsOption;
window.updateSettingsRowFocus = updateSettingsRowFocus;
window.getSettingsFocusedRow = () => settingsFocusedRow;
window.setSettingsFocusedRow = (val) => { settingsFocusedRow = val; };
window.getSettingsRowCount = () => document.querySelectorAll('.settings-row').length;

// Refresh TV library cache - for console use
window.refreshTVLibrary = async function() {
    console.log('Refreshing TV library...');
    
    try {
        const { ipcRenderer } = require('electron');
        const tvScanner = require('./tv-scanner');
        
        // Get config from main process
        const config = ipcRenderer.sendSync('get-config');
        const tvPath = config.tvPath;
        
        if (!tvPath) {
            console.error('No TV path configured');
            return;
        }
        
        console.log('Scanning TV path:', tvPath);
        const shows = await tvScanner.scanTVLibrary(tvPath);
        console.log(`✓ Refreshed TV library: ${shows.length} shows found`);
        
        // Re-render if on TV page
        const activeNavItem = document.querySelector('.nav-item-active');
        if (activeNavItem && activeNavItem.dataset.page === 'tv') {
            const tvGrid = document.getElementById('tvGrid');
            tvGrid.innerHTML = '';
            renderTVShowGrid(shows);
            if (typeof keyboardNav !== 'undefined') {
                keyboardNav.updateItems('.tv-show-card');
                keyboardNav.currentIndex = 0;
                keyboardNav.focusItem();
            }
            console.log('✓ TV grid re-rendered');
        }
        
        return shows;
    } catch (err) {
        console.error('Error refreshing TV library:', err);
        console.log('Try using: reloadApp()');
    }
};

// Simple app reload - clears all caches
window.reloadApp = function() {
    console.log('Reloading app...');
    location.reload();
};

// Clear TV library cache and reload
window.clearTVCache = function() {
    console.log('Clearing TV library cache...');
    localStorage.removeItem('allShowsCache');
    console.log('✓ Cache cleared');
    console.log('Reloading app to re-scan library...');
    location.reload();
};

// Incremental update for movies - only scan new/removed items
window.incrementalUpdateMovies = async function(progressCallback) {
    if (!config.moviesPath) {
        console.log('No movies path configured');
        return { added: 0, removed: 0 };
    }
    
    const fs = require('fs');
    const path = require('path');
    
    progressCallback && progressCallback('Checking for new movies...');
    
    // Get current folder list from disk
    const currentFolders = new Set();
    try {
        const items = fs.readdirSync(config.moviesPath);
        for (const item of items) {
            const fullPath = path.join(config.moviesPath, item);
            if (fs.statSync(fullPath).isDirectory()) {
                currentFolders.add(fullPath);
            }
        }
    } catch (err) {
        console.error('Error reading movies directory:', err);
        return { added: 0, removed: 0, error: err.message };
    }
    
    // Get cached movie folders
    const cachedFolders = new Set(allMovies.map(m => path.dirname(m.videoPath)));
    
    // Find new folders (on disk but not in cache)
    const newFolders = [...currentFolders].filter(f => !cachedFolders.has(f));
    
    // Find removed folders (in cache but not on disk)
    const removedFolders = [...cachedFolders].filter(f => !currentFolders.has(f));
    
    console.log(`Found ${newFolders.length} new folders, ${removedFolders.length} removed folders`);
    if (removedFolders.length > 0) {
        console.log('Removed folders:', removedFolders);
    }
    
    // Remove deleted movies from cache
    if (removedFolders.length > 0) {
        const removedSet = new Set(removedFolders);
        const beforeCount = allMovies.length;
        allMovies = allMovies.filter(m => !removedSet.has(path.dirname(m.videoPath)));
        console.log(`Removed ${beforeCount - allMovies.length} movies from cache`);
    }
    
    // Scan and add new movies
    if (newFolders.length > 0) {
        progressCallback && progressCallback(`Scanning ${newFolders.length} new movies...`);
        
        const { scanSingleMovieFolder } = require('./movie-scanner.js');
        
        for (let i = 0; i < newFolders.length; i++) {
            const folder = newFolders[i];
            progressCallback && progressCallback(`Scanning ${i + 1}/${newFolders.length}: ${path.basename(folder)}`);
            
            try {
                const movie = await scanSingleMovieFolder(folder);
                if (movie) {
                    movie.watchStatus = watchDataManager.getWatchStatus(movie.videoPath);
                    allMovies.push(movie);
                }
            } catch (err) {
                console.error('Error scanning movie folder:', folder, err);
            }
        }
        
        // Sort movies alphabetically
        allMovies.sort((a, b) => {
            const titleA = (a.metadata?.sortTitle || a.metadata?.title || '').toLowerCase();
            const titleB = (b.metadata?.sortTitle || b.metadata?.title || '').toLowerCase();
            return titleA.localeCompare(titleB);
        });
    }
    
    // Update cache
    window.allMovies = allMovies;
    localStorage.setItem('allMoviesCache', JSON.stringify(allMovies));
    localStorage.setItem('allMoviesCacheTimestamp', Date.now().toString());
    
    progressCallback && progressCallback('Done!');
    
    return { added: newFolders.length, removed: removedFolders.length };
};

// Incremental update for TV shows - only scan new/removed items
window.incrementalUpdateTVShows = async function(progressCallback) {
    if (!config.tvShowsPath) {
        console.log('No TV shows path configured');
        return { added: 0, removed: 0, updated: 0 };
    }
    
    const fs = require('fs');
    const path = require('path');
    
    progressCallback && progressCallback('Checking for new TV shows...');
    
    // Get current show folders from disk
    const currentShowFolders = new Set();
    try {
        const items = fs.readdirSync(config.tvShowsPath);
        for (const item of items) {
            const fullPath = path.join(config.tvShowsPath, item);
            if (fs.statSync(fullPath).isDirectory()) {
                currentShowFolders.add(fullPath);
            }
        }
    } catch (err) {
        console.error('Error reading TV shows directory:', err);
        return { added: 0, removed: 0, updated: 0, error: err.message };
    }
    
    // Get cached show folders
    const cachedShowFolders = new Set(allShows.map(s => s.showPath));
    
    // Find new shows (on disk but not in cache)
    const newShowFolders = [...currentShowFolders].filter(f => !cachedShowFolders.has(f));
    
    // Find removed shows (in cache but not on disk)
    const removedShowFolders = [...cachedShowFolders].filter(f => !currentShowFolders.has(f));
    
    console.log(`Found ${newShowFolders.length} new shows, ${removedShowFolders.length} removed shows`);
    
    // Remove deleted shows from cache
    if (removedShowFolders.length > 0) {
        const removedSet = new Set(removedShowFolders);
        allShows = allShows.filter(s => !removedSet.has(s.showPath));
    }
    
    // Check existing shows for new seasons/episodes
    let updatedShows = 0;
    const tvScanner = require('./tv-scanner.js'); // Already an instance, not a class
    
    for (const show of allShows) {
        // Get current season folders for this show
        const currentSeasonFolders = new Set();
        try {
            const items = fs.readdirSync(show.showPath);
            for (const item of items) {
                const fullPath = path.join(show.showPath, item);
                if (fs.statSync(fullPath).isDirectory() && 
                    (item.toLowerCase().startsWith('season') || item.toLowerCase() === 'specials')) {
                    currentSeasonFolders.add(fullPath);
                }
            }
        } catch (err) {
            continue;
        }
        
        // Get cached season folders
        const cachedSeasonFolders = new Set(show.seasons.map(s => s.seasonPath));
        
        // Check for new seasons
        const newSeasons = [...currentSeasonFolders].filter(f => !cachedSeasonFolders.has(f));
        
        if (newSeasons.length > 0) {
            // Rescan the entire show to get updated seasons
            progressCallback && progressCallback(`Updating: ${show.title}`);
            const updatedShow = tvScanner.scanShow(show.showPath);
            if (updatedShow) {
                // Replace the show in allShows
                const index = allShows.findIndex(s => s.showPath === show.showPath);
                if (index >= 0) {
                    allShows[index] = updatedShow;
                    updatedShows++;
                }
            }
        } else {
            // Check each season for new episodes
            for (const season of show.seasons) {
                try {
                    const currentEpisodeFiles = fs.readdirSync(season.seasonPath)
                        .filter(f => /\.(mp4|mkv|avi|m4v|webm)$/i.test(f));
                    
                    if (currentEpisodeFiles.length !== season.episodes.length) {
                        // Episode count changed - rescan the show
                        progressCallback && progressCallback(`Updating: ${show.title}`);
                        const updatedShow = tvScanner.scanShow(show.showPath);
                        if (updatedShow) {
                            const index = allShows.findIndex(s => s.showPath === show.showPath);
                            if (index >= 0) {
                                allShows[index] = updatedShow;
                                updatedShows++;
                            }
                        }
                        break; // Move to next show
                    }
                } catch (err) {
                    continue;
                }
            }
        }
    }
    
    // Scan and add new shows
    if (newShowFolders.length > 0) {
        progressCallback && progressCallback(`Scanning ${newShowFolders.length} new shows...`);
        
        for (let i = 0; i < newShowFolders.length; i++) {
            const folder = newShowFolders[i];
            progressCallback && progressCallback(`Scanning ${i + 1}/${newShowFolders.length}: ${path.basename(folder)}`);
            
            try {
                const show = tvScanner.scanShow(folder);
                if (show && show.seasons.length > 0) {
                    allShows.push(show);
                }
            } catch (err) {
                console.error('Error scanning TV show folder:', folder, err);
            }
        }
        
        // Sort shows alphabetically
        allShows.sort((a, b) => {
            const titleA = (a.sortTitle || a.title || '').toLowerCase();
            const titleB = (b.sortTitle || b.title || '').toLowerCase();
            return titleA.localeCompare(titleB);
        });
    }
    
    // Update cache
    window.allShows = allShows;
    localStorage.setItem('allShowsCache', JSON.stringify(allShows));
    localStorage.setItem('allShowsCacheTimestamp', Date.now().toString());
    
    progressCallback && progressCallback('Done!');
    
    return { added: newShowFolders.length, removed: removedShowFolders.length, updated: updatedShows };
};

// Update time display
function updateTime() {
    const now = new Date();
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    document.getElementById('topBarTime').textContent = `${hours}:${minutes}`;
}

// Navigation control
function setupNavigation() {
    const nav = document.getElementById('sideNav');
    const navItems = document.querySelectorAll('.nav-item');
    
    // Navigation will be handled by keyboard-nav.js
    // Just set up click handlers
    navItems.forEach(item => {
        item.addEventListener('click', () => {
            const page = item.dataset.page;
            console.log('Navigate to:', page);
            
            // Handle settings page
            if (page === 'settings') {
                window.location.href = 'settings.html';
            } else if (page === 'search') {
                window.location.href = 'search.html';
            }
            // TODO: Implement other page routing
        });
    });
}

// Alphabet Navigation
function setupAlphabetNav() {
    console.log('Setting up alphabet navigation...');
    const alphabetItems = document.querySelectorAll('.alphabet-item');
    console.log('Found alphabet items:', alphabetItems.length);
    
    alphabetItems.forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const letter = item.dataset.letter;
            console.log('Clicked letter:', letter);
            scrollToLetter(letter);
        });
    });
    
    console.log('Alphabet navigation setup complete');
}

function scrollToLetter(letter) {
    console.log('scrollToLetter called with:', letter);
    
    // Get cards based on current library
    const cardSelector = currentLibrary === 'movies' ? '.movie-card' : '.tv-show-card';
    const titleSelector = currentLibrary === 'movies' ? '.movie-card-title' : '.tv-show-card-title';
    const cards = document.querySelectorAll(cardSelector);
    console.log('Total cards:', cards.length, 'Library:', currentLibrary);
    
    // Debug: check first few titles
    if (cards.length > 0) {
        const firstCard = cards[0];
        const titleElement = firstCard.querySelector(titleSelector);
        console.log('First card title element:', titleElement);
        console.log('First card title text:', titleElement?.textContent);
    }
    
    // Find first card starting with this letter
    let targetCard = null;
    
    for (const card of cards) {
        const titleElement = card.querySelector(titleSelector);
        // Use data-sort-title which already has "The" removed
        const title = titleElement?.getAttribute('data-sort-title') || titleElement?.textContent || '';
        const displayTitle = titleElement?.textContent || '';
        const firstChar = title.charAt(0).toUpperCase();
        
        console.log(`Checking: "${displayTitle}" -> sort: "${title}" -> first char: "${firstChar}"`);
        
        if (letter === '#') {
            // Match numbers
            if (firstChar.match(/[0-9]/)) {
                targetCard = card;
                console.log('Found number:', title);
                break;
            }
        } else {
            // Match letter
            if (firstChar === letter) {
                targetCard = card;
                console.log(`Found for letter ${letter}:`, displayTitle, '(sort:', title, ')');
                break;
            }
        }
    }
    
    if (targetCard) {
        // Center the row just like keyboard navigation does
        targetCard.scrollIntoView({ behavior: 'auto', block: 'center' });
        
        // Update keyboard navigation's saved index (but don't focus yet)
        if (typeof keyboardNav !== 'undefined') {
            // Find the index of this card in the items array
            const cardIndex = Array.from(cards).indexOf(targetCard);
            if (cardIndex !== -1) {
                keyboardNav.savedGridIndex = cardIndex;
                console.log('Updated savedGridIndex to:', cardIndex, '(will focus when exiting alphabet mode)');
            }
        }
        
        // Keep the letter active (remove active from all, add to clicked letter)
        const alphabetItems = document.querySelectorAll('.alphabet-item');
        alphabetItems.forEach(item => item.classList.remove('active'));
        
        const activeItem = document.querySelector(`.alphabet-item[data-letter="${letter}"]`);
        if (activeItem) {
            activeItem.classList.add('active');
            // No timeout - keep it active until another letter is clicked
        }
    } else {
        console.log('No item found starting with:', letter);
    }
}

// Make it globally accessible
window.scrollToLetter = scrollToLetter;

function updateAlphabetNav() {
    // Get cards based on current library
    const cardSelector = currentLibrary === 'movies' ? '.movie-card' : '.tv-show-card';
    const titleSelector = currentLibrary === 'movies' ? '.movie-card-title' : '.tv-show-card-title';
    const cards = document.querySelectorAll(cardSelector);
    const availableLetters = new Set();
    
    cards.forEach(card => {
        const titleElement = card.querySelector(titleSelector);
        // Use data-sort-title which already has "The" removed
        const title = titleElement?.getAttribute('data-sort-title') || titleElement?.textContent || '';
        const firstChar = title.charAt(0).toUpperCase();
        
        if (firstChar.match(/[0-9]/)) {
            availableLetters.add('#');
        } else if (firstChar.match(/[A-Z]/)) {
            availableLetters.add(firstChar);
        }
    });
    
    // Update alphabet nav to show which letters are available
    // Don't disable them, just dim them visually
    const alphabetItems = document.querySelectorAll('.alphabet-item');
    alphabetItems.forEach(item => {
        const letter = item.dataset.letter;
        if (availableLetters.has(letter)) {
            item.classList.remove('unavailable');
        } else {
            item.classList.add('unavailable');
        }
    });
    
    console.log('Available letters:', Array.from(availableLetters).join(', '));
}

// Setup nav item click handlers
document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', (e) => {
        const page = item.dataset.page;
        
        if (page === 'search') {
            // Navigate to search page
            window.location.href = 'search.html';
        } else if (page === 'home') {
            // Show home screen
            showHomeScreen();
            
            // Collapse nav and focus first carousel card
            if (typeof keyboardNav !== 'undefined') {
                keyboardNav.mode = 'grid';
                keyboardNav.previousMode = null;
                
                // Collapse the nav
                const sideNav = document.querySelector('.side-nav');
                if (sideNav && sideNav.classList.contains('expanded')) {
                    sideNav.classList.remove('expanded');
                }
            }
        } else if (page === 'movies') {
            // Switch to movies library
            hideHomeScreen();
            homeStateBeforeDetail = null; // Clear so returning to home is fresh
            localStorage.setItem('lastLibrary', 'movies');
            switchToLibrary('movies');
        } else if (page === 'tv') {
            // Switch to TV shows library
            hideHomeScreen();
            homeStateBeforeDetail = null; // Clear so returning to home is fresh
            localStorage.setItem('lastLibrary', 'tv');
            switchToLibrary('tv');
        } else if (page === 'playlists') {
            // Switch to playlists library
            hideHomeScreen();
            homeStateBeforeDetail = null; // Clear so returning to home is fresh
            localStorage.setItem('lastLibrary', 'playlists');
            switchToLibrary('playlists');
        } else if (page === 'settings') {
            // Navigate to settings page
            window.location.href = 'settings.html';
        }
        // Add handlers for other pages here when implemented
        
        // Update active state - remove from all first
        document.querySelectorAll('.nav-item').forEach(i => {
            i.classList.remove('nav-item-active');
            i.classList.remove('focused'); // Remove keyboard nav focus
        });
        
        // Add active class to clicked item
        item.classList.add('nav-item-active');
    });
});

// Switch between Movies and TV Shows libraries
function switchToLibrary(library) {
    console.log('Switching to library:', library);
    currentLibrary = library;
    window.currentLibrary = library; // Keep window reference in sync
    
    // Save to localStorage so we remember on next load
    localStorage.setItem('lastLibrary', library);
    
    // Remove focused class from all nav items
    document.querySelectorAll('.nav-item').forEach(item => {
        item.classList.remove('focused');
    });
    
    // Close detail if open
    const detailPage = document.getElementById('detailPage');
    if (detailPage && detailPage.style.display !== 'none') {
        detailPage.style.display = 'none';
    }
    
    // Show content area and content wrapper
    document.getElementById('contentArea').style.display = 'block';
    document.querySelector('.content-wrapper').style.display = 'flex';
    
    // Show alphabet nav (hide for playlists)
    const alphabetNav = document.querySelector('.alphabet-nav');
    if (alphabetNav) {
        alphabetNav.style.display = library === 'playlists' ? 'none' : 'flex';
    }
    
    // Hide/show appropriate grids
    const movieGrid = document.getElementById('movieGrid');
    const tvGrid = document.getElementById('tvGrid');
    const playlistGrid = document.getElementById('playlistGrid');
    const loading = document.getElementById('loading');
    
    if (library === 'movies') {
        // Show movies grid
        movieGrid.style.display = 'grid';
        tvGrid.style.display = 'none';
        playlistGrid.style.display = 'none';
        
        // Render movies if not already rendered
        if (allMovies.length > 0 && movieGrid.children.length === 0) {
            renderMovieGrid(allMovies);
        } else {
            // Update watch status in DOM without re-rendering
            refreshMovieGridWatchStatus();
        }
        
        // Update keyboard nav - exit nav mode and go to grid
        if (typeof keyboardNav !== 'undefined') {
            // Force exit nav mode
            keyboardNav.mode = 'grid';
            keyboardNav.updateItems('.movie-card');
            keyboardNav.currentIndex = 0;
            keyboardNav.focusItem();
            
            // Collapse the nav
            const sideNav = document.querySelector('.side-nav');
            if (sideNav && sideNav.classList.contains('expanded')) {
                sideNav.classList.remove('expanded');
            }
        }
    } else if (library === 'tv') {
        // Show TV shows grid
        tvGrid.style.display = 'grid';
        movieGrid.style.display = 'none';
        playlistGrid.style.display = 'none';
        
        // Check if TV shows are loaded
        if (allShows.length === 0) {
            // Show loading while we load TV shows
            loading.style.display = 'flex';
            tvGrid.style.display = 'none';
            
            loadTVShowsFromConfig().then(() => {
                loading.style.display = 'none';
                if (allShows.length > 0) {
                    tvGrid.style.display = 'grid';
                    renderTVShowGrid(allShows);
                    
                    // Update keyboard nav after shows are loaded
                    if (typeof keyboardNav !== 'undefined') {
                        keyboardNav.mode = 'grid';
                        keyboardNav.updateItems('.tv-show-card');
                        keyboardNav.currentIndex = 0;
                        keyboardNav.focusItem();
                        
                        // Collapse the nav
                        const sideNav = document.querySelector('.side-nav');
                        if (sideNav && sideNav.classList.contains('expanded')) {
                            sideNav.classList.remove('expanded');
                        }
                    }
                } else {
                    loading.innerHTML = '<p>No TV shows found. Please configure TV library path in settings.</p>';
                    loading.style.display = 'flex';
                }
            });
        } else {
            // Render TV shows if not already rendered
            if (tvGrid.children.length === 0) {
                renderTVShowGrid(allShows);
            }
            // Note: TV show grid cards don't show watch status, so no DOM refresh needed
            
            // Update keyboard nav - exit nav mode and go to grid
            if (typeof keyboardNav !== 'undefined') {
                keyboardNav.mode = 'grid';
                keyboardNav.updateItems('.tv-show-card');
                keyboardNav.currentIndex = 0;
                keyboardNav.focusItem();
                
                // Collapse the nav
                const sideNav = document.querySelector('.side-nav');
                if (sideNav && sideNav.classList.contains('expanded')) {
                    sideNav.classList.remove('expanded');
                }
            }
        }
    } else if (library === 'playlists') {
        // Show playlists grid
        playlistGrid.style.display = 'grid';
        movieGrid.style.display = 'none';
        tvGrid.style.display = 'none';
        
        // Always re-render playlists (they may have changed)
        renderPlaylistGrid();
        
        // Update keyboard nav
        if (typeof keyboardNav !== 'undefined') {
            keyboardNav.mode = 'grid';
            keyboardNav.updateItems('.playlist-card');
            keyboardNav.currentIndex = 0;
            keyboardNav.focusItem();
            
            // Collapse the nav
            const sideNav = document.querySelector('.side-nav');
            if (sideNav && sideNav.classList.contains('expanded')) {
                sideNav.classList.remove('expanded');
            }
        }
    }
    
    // Update alphabet navigation
    updateAlphabetNav();
    
    // Update nav active state
    document.querySelectorAll('.nav-item').forEach(item => {
        item.classList.remove('nav-item-active');
        if (item.dataset.page === library) {
            item.classList.add('nav-item-active');
        }
    });
}

// Make player functions globally available for onclick handlers
// Wrapper to pass movie metadata
window.playMovieWithMetadata = function(videoPath, startPosition, metadata) {
    player.playMovie(videoPath, startPosition, metadata, window.watchDataManager);
};
window.playMovie = function(videoPath, startPosition, metadata) {
    player.playMovie(videoPath, startPosition, metadata, window.watchDataManager);
}; // Keep for backward compatibility

// Play from beginning - clears progress and starts from 0
window.playFromBeginning = function(videoPath) {
    console.log('Playing from beginning:', videoPath);
    
    // Clear the watch position using markUnwatched
    if (window.watchDataManager) {
        window.watchDataManager.markUnwatched(videoPath);
        console.log('Cleared watch position for:', videoPath);
        
        // Update the movie's watch status in allMovies
        const movie = allMovies.find(m => m.videoPath === videoPath);
        if (movie) {
            movie.watchStatus = { watched: false, position: 0, percentage: 0 };
        }
    }
    
    // Play from start with current metadata
    player.playMovie(videoPath, 0, window.currentMovieMetadata, window.watchDataManager);
};

window.closePlayer = player.closePlayer;

// Keyboard handler for player page
document.addEventListener('keydown', (e) => {
    const playerPage = document.getElementById('playerPage');
    if (playerPage && playerPage.style.display !== 'none') {
        // Only handle keys when player is visible
        switch(e.key) {
            case 'Escape':
                player.closePlayer();
                break;
            case ' ': // Spacebar
                e.preventDefault();
                player.togglePlayPause();
                break;
            case 'ArrowRight':
                e.preventDefault();
                player.seek(10); // Seek forward 10 seconds
                break;
            case 'ArrowLeft':
                e.preventDefault();
                player.seek(-10); // Seek backward 10 seconds
                break;
        }
    }
});

/* ========================================
   RECOMMENDATION ENGINE
   ======================================== */

/**
 * Render a movie card for carousels (collection/recommendations)
 */
function renderMovieCard(movie) {
    const metadata = movie.metadata || {};
    const watchStatus = movie.watchStatus || { watched: false, percentage: 0 };
    
    // Escape videoPath for use in data attribute
    const escapedVideoPath = (movie.videoPath || '').replace(/"/g, '&quot;');
    
    let html = `<div class="recommendation-card" data-video-path="${escapedVideoPath}">`;
    
    html += '<div class="recommendation-card-image-container">';
    html += '<div class="recommendation-card-outer-stroke">';
    html += '<div class="recommendation-card-inner-stroke">';
    
    if (movie.posterPath) {
        const encodedPosterPath = encodeURI(movie.posterPath);
        html += `<img src="file://${encodedPosterPath}" class="recommendation-card-image" alt="${metadata.title || 'Movie'}">`;
    } else {
        html += '<div class="recommendation-card-placeholder">No Image</div>';
    }
    
    html += '</div></div>'; // End strokes
    
    // Watched badge (only show if fully watched)
    if (watchStatus.watched) {
        html += '<div class="watched-badge">';
        html += '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">';
        html += '<path d="M12 24C15.1826 24 18.2348 22.7357 20.4853 20.4853C22.7357 18.2348 24 15.1826 24 12C24 8.8174 22.7357 5.76516 20.4853 3.51472C18.2348 1.26428 15.1826 0 12 0C8.8174 0 5.76516 1.26428 3.51472 3.51472C1.26428 5.76516 0 8.8174 0 12C0 15.1826 1.26428 18.2348 3.51472 20.4853C5.76516 22.7357 8.8174 24 12 24ZM17.2969 9.79688L11.2969 15.7969C10.8563 16.2375 10.1438 16.2375 9.70781 15.7969L6.70781 12.7969C6.26719 12.3563 6.26719 11.6438 6.70781 11.2078C7.14844 10.7719 7.86094 10.7672 8.29688 11.2078L10.5 13.4109L15.7031 8.20312C16.1437 7.7625 16.8562 7.7625 17.2922 8.20312C17.7281 8.64375 17.7328 9.35625 17.2922 9.79219L17.2969 9.79688Z" fill="white"/>';
        html += '</svg>';
        html += '</div>';
    }
    
    // Progress bar (show if 10+ min watched AND 10+ min remaining)
    const timeRemaining = watchStatus.duration - watchStatus.position;
    if (watchStatus.position >= 600 && timeRemaining > 600) {
        html += '<div class="progress-bar">';
        html += `<div class="progress-bar-fill" style="width: ${Math.min(watchStatus.percentage, 100)}%"></div>`;
        html += '</div>';
    }
    
    html += '</div>'; // End image-container
    
    html += '<div class="recommendation-card-info">';
    html += `<div class="recommendation-card-title">${metadata.title || 'Unknown'}</div>`;
    if (metadata.year) {
        html += `<div class="recommendation-card-year">${metadata.year}</div>`;
    }
    html += '</div>'; // End info
    
    html += '</div>'; // End recommendation-card
    
    return html;
}

/**
 * Get movies from the same collection, sorted by year
 */
function getCollectionMovies(currentMovie, allMovies) {
    const currentMeta = currentMovie.metadata || {};
    if (!currentMeta.collection?.name) return [];
    
    return allMovies
        .filter(movie => {
            const meta = movie.metadata || {};
            return meta.collection?.name === currentMeta.collection.name &&
                   movie.videoPath !== currentMovie.videoPath; // Exclude current movie
        })
        .sort((a, b) => {
            const yearA = parseInt(a.metadata?.year) || 0;
            const yearB = parseInt(b.metadata?.year) || 0;
            return yearA - yearB; // Older first
        });
}

/**
 * Calculate similarity score between two movies
 */
function calculateSimilarity(movie1, movie2) {
    const meta1 = movie1.metadata || {};
    const meta2 = movie2.metadata || {};
    let score = 0;
    
    // Genre matching (40 points max)
    const genres1 = meta1.genre || [];
    const genres2 = meta2.genre || [];
    const genreOverlap = genres1.filter(g => genres2.includes(g)).length;
    score += genreOverlap * 10;
    
    // Director match (30 points)
    if (meta1.director && meta2.director && meta1.director === meta2.director) {
        score += 30;
    }
    
    // Actor overlap (20 points max)
    const actors1 = (meta1.actors || []).map(a => a.name);
    const actors2 = (meta2.actors || []).map(a => a.name);
    const actorOverlap = actors1.filter(a => actors2.includes(a)).length;
    score += Math.min(actorOverlap * 5, 20);
    
    // Year proximity (10 points max)
    const year1 = parseInt(meta1.year) || 0;
    const year2 = parseInt(meta2.year) || 0;
    if (year1 && year2) {
        const yearDiff = Math.abs(year1 - year2);
        score += Math.max(10 - yearDiff, 0);
    }
    
    return score;
}

/**
 * Get recommended movies based on similarity (excluding collection and tag movies)
 */
function getRecommendations(currentMovie, allMovies, collectionMovies = [], tagMovies = [], count = 15) {
    const collectionPaths = collectionMovies.map(m => m.videoPath);
    const tagPaths = tagMovies.map(m => m.videoPath);
    
    return allMovies
        .filter(m => 
            m.videoPath !== currentMovie.videoPath && // Not current movie
            !collectionPaths.includes(m.videoPath) && // Not in collection
            !tagPaths.includes(m.videoPath)           // Not in any tag
        )
        .map(movie => ({
            movie,
            score: calculateSimilarity(currentMovie, movie)
        }))
        .sort((a, b) => b.score - a.score)
        .slice(0, count)
        .map(item => item.movie);
}

// ==================== HELPER FUNCTIONS FOR CONTINUE WATCHING ====================

/**
 * Find the first unwatched episode in a show
 * @param {Object} show - The show object with seasons and episodes
 * @returns {Object|null} - { episode, season } or null if no unwatched episode found
 */
function findFirstUnwatchedEpisode(show) {
    if (!show || !show.seasons || show.seasons.length === 0) {
        return null;
    }
    
    for (const season of show.seasons) {
        if (!season.episodes || season.episodes.length === 0) continue;
        
        for (const episode of season.episodes) {
            const ws = watchDataManager.getWatchStatus(episode.videoPath);
            if (!ws || !ws.watched) {
                return { episode, season };
            }
        }
    }
    
    return null; // All episodes watched
}

/**
 * Find the first unwatched episode in a specific season
 * @param {Object} season - The season object with episodes
 * @returns {Object|null} - The episode object or null if all watched
 */
function findFirstUnwatchedEpisodeInSeason(season) {
    if (!season || !season.episodes || season.episodes.length === 0) {
        return null;
    }
    
    for (const episode of season.episodes) {
        const ws = watchDataManager.getWatchStatus(episode.videoPath);
        if (!ws || !ws.watched) {
            return episode;
        }
    }
    
    return null; // All episodes watched
}

// ==================== CONTEXT MENU FUNCTIONS ====================

// TV Show grid context menu (from TV show grid - triggered by 'O' key)
window.showTVShowGridContextMenu = function(tvShowCard) {
    if (!tvShowCard) {
        console.log('No TV show card provided');
        return;
    }
    
    const showPath = tvShowCard.dataset.showPath;
    if (!showPath) {
        console.log('No show path found on TV show card');
        return;
    }
    
    // Find the show data
    const show = window.allShows ? window.allShows.find(s => s.showPath === showPath) : null;
    if (!show) {
        console.log('Could not find show data');
        return;
    }
    
    // Check if all episodes are watched
    let allWatched = true;
    if (show.seasons && show.seasons.length > 0) {
        for (const season of show.seasons) {
            if (season.episodes && season.episodes.length > 0) {
                for (const episode of season.episodes) {
                    const ws = watchDataManager.getWatchStatus(episode.videoPath);
                    if (!ws || !ws.watched) {
                        allWatched = false;
                        break;
                    }
                }
            }
            if (!allWatched) break;
        }
    }
    
    const options = [];
    
    // Mark Show as Watched/Unwatched
    options.push({
        icon: allWatched ? 'assets/icons/unwatched.svg' : 'assets/icons/watched.svg',
        label: allWatched ? 'Mark Show as Unwatched' : 'Mark Show as Watched',
        action: allWatched ? 'unwatch-show' : 'watch-show'
    });
    
    // Add to Continue Watching (only if there's an unwatched episode and it's not already next)
    const firstUnwatched = findFirstUnwatchedEpisode(show);
    if (firstUnwatched) {
        const activeShow = watchDataManager.getActiveShow(show.showPath);
        const isAlreadyNext = activeShow && activeShow.nextEpisodePath === firstUnwatched.episode.videoPath;
        
        if (!isAlreadyNext) {
            options.push({
                icon: 'assets/icons/continue-watching.svg',
                label: 'Add to Continue Watching',
                action: 'add-continue-watching'
            });
        }
    }
    
    // Add to Favorites
    options.push({
        icon: 'assets/icons/heart-outline.svg',
        label: 'Add to Favorites',
        action: 'add-favorites'
    });
    
    // Show the context menu
    contextMenu.show(options, (action) => {
        handleTVShowGridContextMenuAction(action, show);
    });
};

// Handle TV show grid context menu actions
function handleTVShowGridContextMenuAction(action, show) {
    const savedIndex = window.keyboardNav ? window.keyboardNav.currentIndex : undefined;
    const showCard = window.keyboardNav ? window.keyboardNav.items[savedIndex] : null;
    
    switch (action) {
        case 'watch-show':
            // Mark all episodes as watched
            if (show.seasons && show.seasons.length > 0) {
                show.seasons.forEach(season => {
                    if (season.episodes && season.episodes.length > 0) {
                        season.episodes.forEach(episode => {
                            watchDataManager.markWatched(episode.videoPath, episode.runtime || 0);
                        });
                    }
                });
            }
            
            // Update the TV show card badge immediately
            if (showCard) {
                const posterContainer = showCard.querySelector('.tv-show-card-poster-container');
                if (posterContainer) {
                    // Remove unwatched count badge if it exists
                    const unwatchedBadge = posterContainer.querySelector('.unwatched-count-badge');
                    if (unwatchedBadge) {
                        unwatchedBadge.remove();
                    }
                    
                    // Add watched badge if it doesn't exist
                    let watchedBadge = posterContainer.querySelector('.watched-badge');
                    if (!watchedBadge) {
                        watchedBadge = document.createElement('div');
                        watchedBadge.className = 'watched-badge';
                        watchedBadge.innerHTML = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <path d="M12 24C15.1826 24 18.2348 22.7357 20.4853 20.4853C22.7357 18.2348 24 15.1826 24 12C24 8.8174 22.7357 5.76516 20.4853 3.51472C18.2348 1.26428 15.1826 0 12 0C8.8174 0 5.76516 1.26428 3.51472 3.51472C1.26428 5.76516 0 8.8174 0 12C0 15.1826 1.26428 18.2348 3.51472 20.4853C5.76516 22.7357 8.8174 24 12 24ZM17.2969 9.79688L11.2969 15.7969C10.8563 16.2375 10.1438 16.2375 9.70781 15.7969L6.70781 12.7969C6.26719 12.3563 6.26719 11.6438 6.70781 11.2078C7.14844 10.7719 7.86094 10.7672 8.29688 11.2078L10.5 13.4109L15.7031 8.20312C16.1437 7.7625 16.8562 7.7625 17.2922 8.20312C17.7281 8.64375 17.7328 9.35625 17.2922 9.79219L17.2969 9.79688Z" fill="white"/>
                        </svg>`;
                        posterContainer.appendChild(watchedBadge);
                    }
                }
            }
            break;
            
        case 'unwatch-show':
            // Mark all episodes as unwatched
            if (show.seasons && show.seasons.length > 0) {
                show.seasons.forEach(season => {
                    if (season.episodes && season.episodes.length > 0) {
                        season.episodes.forEach(episode => {
                            watchDataManager.markUnwatched(episode.videoPath);
                        });
                    }
                });
            }
            
            // Update the TV show card badge immediately
            if (showCard) {
                const posterContainer = showCard.querySelector('.tv-show-card-poster-container');
                if (posterContainer) {
                    // Remove watched badge
                    const watchedBadge = posterContainer.querySelector('.watched-badge');
                    if (watchedBadge) {
                        watchedBadge.remove();
                    }
                    
                    // Add unwatched count badge
                    const watchStats = watchDataManager.getShowWatchStats(show);
                    if (watchStats.unwatchedEpisodes > 0) {
                        let unwatchedBadge = posterContainer.querySelector('.unwatched-count-badge');
                        if (!unwatchedBadge) {
                            unwatchedBadge = document.createElement('div');
                            unwatchedBadge.className = 'unwatched-count-badge';
                            posterContainer.appendChild(unwatchedBadge);
                        }
                        unwatchedBadge.textContent = `${watchStats.unwatchedEpisodes}`;
                    }
                }
            }
            break;
            
        case 'add-continue-watching':
            const firstUnwatched = findFirstUnwatchedEpisode(show);
            if (firstUnwatched) {
                watchDataManager.addEpisodeToContinueWatching(
                    firstUnwatched.episode.videoPath,
                    show.showPath,
                    firstUnwatched.season.number,
                    firstUnwatched.episode.number
                );
            }
            break;
            
        case 'add-favorites':
            alert('Add to Favorites is not connected yet');
            break;
    }
}

// ========================================
// Playlist Grid Context Menu
// ========================================

window.showPlaylistGridContextMenu = function(playlistCard) {
    if (!playlistCard) {
        console.log('No playlist card provided');
        return;
    }
    
    const playlistId = playlistCard.dataset.playlistId;
    if (!playlistId) {
        console.log('No playlist ID found on playlist card');
        return;
    }
    
    const playlist = playlistManager.getById(playlistId);
    if (!playlist) {
        console.log('Could not find playlist data');
        return;
    }
    
    // Check if all items are watched
    let allWatched = true;
    if (playlist.items && playlist.items.length > 0) {
        for (const item of playlist.items) {
            const ws = watchDataManager.getWatchStatus(item.videoPath);
            if (!ws || !ws.watched) {
                allWatched = false;
                break;
            }
        }
    } else {
        allWatched = false; // Empty playlist
    }
    
    const options = [];
    
    // Mark as Watched/Unwatched
    if (playlist.items && playlist.items.length > 0) {
        options.push({
            icon: allWatched ? 'assets/icons/unwatched.svg' : 'assets/icons/watched.svg',
            label: allWatched ? 'Mark All as Unwatched' : 'Mark All as Watched',
            action: allWatched ? 'unwatch-playlist' : 'watch-playlist'
        });
    }
    
    // Rename Playlist
    options.push({
        icon: 'assets/icons/pen-to-square.svg',
        label: 'Rename Playlist',
        action: 'rename-playlist'
    });
    
    // Delete Playlist
    options.push({
        icon: 'assets/icons/trash.svg',
        label: 'Delete Playlist',
        action: 'delete-playlist'
    });
    
    // Show the context menu
    contextMenu.show(options, (action) => {
        handlePlaylistGridContextMenuAction(action, playlist);
    });
};

// Handle playlist grid context menu actions
function handlePlaylistGridContextMenuAction(action, playlist) {
    const savedIndex = window.keyboardNav ? window.keyboardNav.currentIndex : undefined;
    
    switch (action) {
        case 'watch-playlist':
            // Mark all items in playlist as watched
            if (playlist.items) {
                playlist.items.forEach(item => {
                    const movie = allMovies.find(m => m.videoPath === item.videoPath);
                    if (movie) {
                        watchDataManager.markWatched(item.videoPath, movie.metadata?.runtime * 60 || 0);
                    }
                });
            }
            break;
            
        case 'unwatch-playlist':
            // Mark all items in playlist as unwatched
            if (playlist.items) {
                playlist.items.forEach(item => {
                    watchDataManager.markUnwatched(item.videoPath);
                });
            }
            break;
            
        case 'rename-playlist':
            // Open rename overlay
            openPlaylistRenameOverlay(playlist);
            break;
            
        case 'delete-playlist':
            // Delete the playlist
            playlistManager.deletePlaylist(playlist.id);
            // Refresh the grid
            renderPlaylistGrid();
            // Update keyboard nav
            if (typeof keyboardNav !== 'undefined') {
                setTimeout(() => {
                    keyboardNav.updateItems('.playlist-card');
                    if (savedIndex !== undefined) {
                        keyboardNav.currentIndex = Math.min(savedIndex, keyboardNav.items.length - 1);
                    }
                    keyboardNav.focusItem();
                }, 50);
            }
            break;
    }
}

// TV Show detail context menu (from TV show detail page - triggered by 'O' key or More Options button)
window.showTVShowDetailContextMenu = function() {
    if (!window.currentShow) {
        console.log('No current show set');
        return;
    }
    
    const show = window.currentShow;
    
    // Check if all episodes are watched
    let allWatched = true;
    if (show.seasons && show.seasons.length > 0) {
        for (const season of show.seasons) {
            if (season.episodes && season.episodes.length > 0) {
                for (const episode of season.episodes) {
                    const ws = watchDataManager.getWatchStatus(episode.videoPath);
                    if (!ws || !ws.watched) {
                        allWatched = false;
                        break;
                    }
                }
            }
            if (!allWatched) break;
        }
    }
    
    const options = [];
    
    // Mark Show as Watched/Unwatched
    options.push({
        icon: allWatched ? 'assets/icons/unwatched.svg' : 'assets/icons/watched.svg',
        label: allWatched ? 'Mark Show as Unwatched' : 'Mark Show as Watched',
        action: allWatched ? 'unwatch-show-detail' : 'watch-show-detail'
    });
    
    // Add to Continue Watching (only if there's an unwatched episode and it's not already next)
    const firstUnwatched = findFirstUnwatchedEpisode(show);
    if (firstUnwatched) {
        const activeShow = watchDataManager.getActiveShow(show.showPath);
        const isAlreadyNext = activeShow && activeShow.nextEpisodePath === firstUnwatched.episode.videoPath;
        
        if (!isAlreadyNext) {
            options.push({
                icon: 'assets/icons/continue-watching.svg',
                label: 'Add to Continue Watching',
                action: 'add-continue-watching'
            });
        }
    }
    
    // Add to Favorites
    options.push({
        icon: 'assets/icons/heart-outline.svg',
        label: 'Add to Favorites',
        action: 'add-favorites'
    });
    
    // Show the context menu
    contextMenu.show(options, (action) => {
        handleTVShowDetailContextMenuAction(action);
    });
};

// Handle TV show detail context menu actions
function handleTVShowDetailContextMenuAction(action) {
    const show = window.currentShow;
    
    switch (action) {
        case 'watch-show-detail':
            // Mark all episodes as watched
            if (show.seasons && show.seasons.length > 0) {
                show.seasons.forEach(season => {
                    if (season.episodes && season.episodes.length > 0) {
                        season.episodes.forEach(episode => {
                            watchDataManager.markWatched(episode.videoPath, episode.runtime || 0);
                        });
                    }
                });
            }
            // Refresh the detail page
            openTVShowDetail(show);
            break;
            
        case 'unwatch-show-detail':
            // Mark all episodes as unwatched
            if (show.seasons && show.seasons.length > 0) {
                show.seasons.forEach(season => {
                    if (season.episodes && season.episodes.length > 0) {
                        season.episodes.forEach(episode => {
                            watchDataManager.markUnwatched(episode.videoPath);
                        });
                    }
                });
            }
            // Refresh the detail page
            openTVShowDetail(show);
            break;
            
        case 'add-continue-watching':
            const firstUnwatched = findFirstUnwatchedEpisode(show);
            if (firstUnwatched) {
                watchDataManager.addEpisodeToContinueWatching(
                    firstUnwatched.episode.videoPath,
                    show.showPath,
                    firstUnwatched.season.number,
                    firstUnwatched.episode.number
                );
            }
            // Restore focus without refreshing
            if (window.keyboardNav) {
                setTimeout(() => window.keyboardNav.focusItem(), 50);
            }
            break;
            
        case 'add-favorites':
            alert('Add to Favorites is not connected yet');
            if (window.keyboardNav) {
                setTimeout(() => window.keyboardNav.focusItem(), 50);
            }
            break;
    }
}

// Movie context menu (from movie grid - triggered by 'O' key)
window.showMovieContextMenu = function(movieCard) {
    if (!movieCard) {
        console.log('No movie card provided');
        return;
    }
    
    const videoPath = movieCard.dataset.videoPath;
    if (!videoPath) {
        console.log('No video path found on movie card');
        return;
    }
    
    const watchStatus = watchDataManager.getWatchStatus(videoPath);
    const isWatched = watchStatus && watchStatus.watched;
    const hasProgress = watchStatus && watchStatus.position > 0;
    
    const options = [];
    
    // Remove Progress (only if movie has progress)
    if (hasProgress) {
        options.push({
            icon: 'assets/icons/remove-progress.svg',
            label: 'Remove Progress',
            action: 'remove-progress'
        });
    }
    
    // Mark as Watched/Unwatched
    options.push({
        icon: isWatched ? 'assets/icons/unwatched.svg' : 'assets/icons/watched.svg',
        label: isWatched ? 'Mark as Unwatched' : 'Mark as Watched',
        action: isWatched ? 'unwatch-movie' : 'watch-movie'
    });
    
    // Add to Favorites
    options.push({
        icon: 'assets/icons/heart-outline.svg',
        label: 'Add to Favorites',
        action: 'add-favorites'
    });
    
    // Add to Playlist
    options.push({
        icon: 'assets/icons/add-to-playlist.svg',
        label: 'Add to Playlist',
        action: 'add-playlist'
    });
    
    // Select Multiple
    options.push({
        icon: 'assets/icons/square-check.svg',
        label: 'Select Multiple',
        action: 'select-multiple'
    });
    
    // Show the context menu
    contextMenu.show(options, (action) => {
        handleMovieGridContextMenuAction(action, videoPath);
    });
};

// Handle movie grid context menu actions
function handleMovieGridContextMenuAction(action, videoPath) {
    const savedIndex = window.keyboardNav ? window.keyboardNav.currentIndex : undefined;
    const movieCard = window.keyboardNav ? window.keyboardNav.items[savedIndex] : null;
    
    switch (action) {
        case 'remove-progress':
            watchDataManager.clearPosition(videoPath);
            
            // Update the card's progress bar immediately
            if (movieCard) {
                const progressBar = movieCard.querySelector('.progress-bar');
                if (progressBar) {
                    progressBar.remove();
                }
            }
            break;
            
        case 'watch-movie':
            watchDataManager.markWatched(videoPath, 0);
            
            // Update the card's watched badge immediately
            if (movieCard) {
                // Add watched badge if it doesn't exist (using the correct class)
                let badge = movieCard.querySelector('.watched-badge');
                if (!badge) {
                    badge = document.createElement('div');
                    badge.className = 'watched-badge';
                    badge.innerHTML = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M12 24C15.1826 24 18.2348 22.7357 20.4853 20.4853C22.7357 18.2348 24 15.1826 24 12C24 8.8174 22.7357 5.76516 20.4853 3.51472C18.2348 1.26428 15.1826 0 12 0C8.8174 0 5.76516 1.26428 3.51472 3.51472C1.26428 5.76516 0 8.8174 0 12C0 15.1826 1.26428 18.2348 3.51472 20.4853C5.76516 22.7357 8.8174 24 12 24ZM17.2969 9.79688L11.2969 15.7969C10.8563 16.2375 10.1438 16.2375 9.70781 15.7969L6.70781 12.7969C6.26719 12.3563 6.26719 11.6438 6.70781 11.2078C7.14844 10.7719 7.86094 10.7672 8.29688 11.2078L10.5 13.4109L15.7031 8.20312C16.1437 7.7625 16.8562 7.7625 17.2922 8.20312C17.7281 8.64375 17.7328 9.35625 17.2922 9.79219L17.2969 9.79688Z" fill="white"/>
                    </svg>`;
                    
                    const posterContainer = movieCard.querySelector('.movie-card-poster-container');
                    if (posterContainer) {
                        posterContainer.appendChild(badge);
                    }
                }
                
                // Remove progress bar if it exists
                const progressBar = movieCard.querySelector('.progress-bar');
                if (progressBar) {
                    progressBar.remove();
                }
            }
            break;
            
        case 'unwatch-movie':
            watchDataManager.markUnwatched(videoPath);
            
            // Remove the watched badge immediately
            if (movieCard) {
                const badge = movieCard.querySelector('.watched-badge');
                if (badge) {
                    badge.remove();
                }
            }
            break;
            
        case 'add-favorites':
            alert('Add to Favorites is not connected yet');
            break;
            
        case 'add-playlist':
            showAddToPlaylistOverlay(videoPath);
            break;
            
        case 'select-multiple':
            enterMultiSelectMode();
            break;
    }
}

// ==================== MULTI-SELECT MODE ====================

/**
 * Enter multi-select mode for movie grid
 */
function enterMultiSelectMode() {
    console.log('Entering multi-select mode');
    window.multiSelectMode = true;
    window.multiSelectItems = new Set(); // Store selected video paths
    
    // Add multi-select class to movie grid
    const movieGrid = document.getElementById('movieGrid');
    if (movieGrid) {
        movieGrid.classList.add('multi-select-mode');
    }
    
    // Add checkbox badges to all movie cards
    const cards = document.querySelectorAll('.movie-card');
    cards.forEach(card => {
        // Add checkbox badge if not already present
        if (!card.querySelector('.multi-select-checkbox')) {
            const checkbox = document.createElement('div');
            checkbox.className = 'multi-select-checkbox';
            checkbox.innerHTML = '<img src="assets/icons/square.svg" alt="">';
            const posterContainer = card.querySelector('.movie-card-poster-container');
            if (posterContainer) {
                posterContainer.appendChild(checkbox);
            }
        }
    });
    
    // Add indicator to top bar
    addMultiSelectIndicator();
    
    // Update keyboard nav to handle multi-select
    if (window.keyboardNav) {
        window.keyboardNav.multiSelectMode = true;
    }
}

/**
 * Exit multi-select mode
 */
function exitMultiSelectMode() {
    console.log('Exiting multi-select mode');
    window.multiSelectMode = false;
    window.multiSelectItems = new Set();
    
    // Remove multi-select class from movie grid
    const movieGrid = document.getElementById('movieGrid');
    if (movieGrid) {
        movieGrid.classList.remove('multi-select-mode');
    }
    
    // Remove checkbox badges and selected state from all cards
    const cards = document.querySelectorAll('.movie-card');
    cards.forEach(card => {
        const checkbox = card.querySelector('.multi-select-checkbox');
        if (checkbox) {
            checkbox.remove();
        }
        card.classList.remove('multi-selected');
    });
    
    // Remove indicator from top bar
    removeMultiSelectIndicator();
    
    // Update keyboard nav
    if (window.keyboardNav) {
        window.keyboardNav.multiSelectMode = false;
    }
}

/**
 * Toggle selection of a movie card
 */
function toggleMultiSelectItem(card) {
    if (!card || !window.multiSelectMode) return;
    
    const videoPath = card.dataset.videoPath;
    if (!videoPath) return;
    
    if (window.multiSelectItems.has(videoPath)) {
        // Deselect
        window.multiSelectItems.delete(videoPath);
        card.classList.remove('multi-selected');
        const checkbox = card.querySelector('.multi-select-checkbox img');
        if (checkbox) {
            checkbox.src = 'assets/icons/square.svg';
        }
    } else {
        // Select
        window.multiSelectItems.add(videoPath);
        card.classList.add('multi-selected');
        const checkbox = card.querySelector('.multi-select-checkbox img');
        if (checkbox) {
            checkbox.src = 'assets/icons/square-check.svg';
        }
    }
    
    // Update indicator count
    updateMultiSelectIndicator();
}

/**
 * Add multi-select indicator to top bar
 */
function addMultiSelectIndicator() {
    // Check if indicator already exists
    if (document.getElementById('multiSelectIndicator')) return;
    
    const topBar = document.querySelector('.top-bar-center');
    if (topBar) {
        const indicator = document.createElement('div');
        indicator.id = 'multiSelectIndicator';
        indicator.className = 'multi-select-indicator';
        indicator.innerHTML = `
            <img src="assets/icons/square-check.svg" class="multi-select-indicator-icon" alt="">
            <span class="multi-select-indicator-text">0 selected</span>
        `;
        topBar.appendChild(indicator);
    }
}

/**
 * Update multi-select indicator count
 */
function updateMultiSelectIndicator() {
    const indicator = document.getElementById('multiSelectIndicator');
    if (indicator) {
        const count = window.multiSelectItems ? window.multiSelectItems.size : 0;
        const text = indicator.querySelector('.multi-select-indicator-text');
        if (text) {
            text.textContent = `${count} selected`;
        }
    }
}

/**
 * Remove multi-select indicator from top bar
 */
function removeMultiSelectIndicator() {
    const indicator = document.getElementById('multiSelectIndicator');
    if (indicator) {
        indicator.remove();
    }
}

/**
 * Show multi-select context menu
 */
function showMultiSelectContextMenu() {
    if (!window.multiSelectMode) return;
    
    const count = window.multiSelectItems ? window.multiSelectItems.size : 0;
    
    const options = [
        {
            icon: 'assets/icons/add-to-playlist.svg',
            label: `Add ${count} to Playlist`,
            action: 'multi-add-playlist'
        },
        {
            icon: 'assets/icons/watched.svg',
            label: 'Mark as Watched',
            action: 'multi-watch'
        },
        {
            icon: 'assets/icons/unwatched.svg',
            label: 'Mark as Unwatched',
            action: 'multi-unwatch'
        },
        {
            icon: 'assets/icons/square-xmark.svg',
            label: 'Cancel',
            action: 'multi-cancel'
        }
    ];
    
    contextMenu.show(options, (action) => {
        handleMultiSelectContextMenuAction(action);
    });
}

/**
 * Handle multi-select context menu actions
 */
function handleMultiSelectContextMenuAction(action) {
    const selectedPaths = Array.from(window.multiSelectItems || []);
    
    switch (action) {
        case 'multi-add-playlist':
            if (selectedPaths.length > 0) {
                // Exit multi-select first, then show playlist overlay
                exitMultiSelectMode();
                showAddToPlaylistOverlay(selectedPaths);
            } else {
                exitMultiSelectMode();
            }
            break;
            
        case 'multi-watch':
            selectedPaths.forEach(videoPath => {
                watchDataManager.markWatched(videoPath, 0);
                // Update card UI
                const card = document.querySelector(`.movie-card[data-video-path="${CSS.escape(videoPath)}"]`);
                if (card) {
                    let badge = card.querySelector('.watched-badge');
                    if (!badge) {
                        badge = document.createElement('div');
                        badge.className = 'watched-badge';
                        badge.innerHTML = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <path d="M12 24C15.1826 24 18.2348 22.7357 20.4853 20.4853C22.7357 18.2348 24 15.1826 24 12C24 8.8174 22.7357 5.76516 20.4853 3.51472C18.2348 1.26428 15.1826 0 12 0C8.8174 0 5.76516 1.26428 3.51472 3.51472C1.26428 5.76516 0 8.8174 0 12C0 15.1826 1.26428 18.2348 3.51472 20.4853C5.76516 22.7357 8.8174 24 12 24ZM17.2969 9.79688L11.2969 15.7969C10.8563 16.2375 10.1438 16.2375 9.70781 15.7969L6.70781 12.7969C6.26719 12.3563 6.26719 11.6438 6.70781 11.2078C7.14844 10.7719 7.86094 10.7672 8.29688 11.2078L10.5 13.4109L15.7031 8.20312C16.1437 7.7625 16.8562 7.7625 17.2922 8.20312C17.7281 8.64375 17.7328 9.35625 17.2922 9.79219L17.2969 9.79688Z" fill="white"/>
                        </svg>`;
                        const posterContainer = card.querySelector('.movie-card-poster-container');
                        if (posterContainer) {
                            posterContainer.appendChild(badge);
                        }
                    }
                    // Remove progress bar
                    const progressBar = card.querySelector('.progress-bar');
                    if (progressBar) progressBar.remove();
                }
            });
            exitMultiSelectMode();
            break;
            
        case 'multi-unwatch':
            selectedPaths.forEach(videoPath => {
                watchDataManager.markUnwatched(videoPath);
                // Update card UI
                const card = document.querySelector(`.movie-card[data-video-path="${CSS.escape(videoPath)}"]`);
                if (card) {
                    const badge = card.querySelector('.watched-badge');
                    if (badge) badge.remove();
                }
            });
            exitMultiSelectMode();
            break;
            
        case 'multi-cancel':
            exitMultiSelectMode();
            break;
    }
}

/**
 * Show add to playlist overlay for multiple movies
 */
// Expose multi-select functions globally
window.enterMultiSelectMode = enterMultiSelectMode;
window.exitMultiSelectMode = exitMultiSelectMode;
window.toggleMultiSelectItem = toggleMultiSelectItem;
window.showMultiSelectContextMenu = showMultiSelectContextMenu;

// Movie detail context menu (from movie detail page - triggered by 'O' key or More Options button)
window.showMovieDetailContextMenu = function() {
    if (!window.currentMovie) {
        console.log('No current movie set');
        return;
    }
    
    const videoPath = window.currentMovie.videoPath;
    const watchStatus = watchDataManager.getWatchStatus(videoPath);
    const isWatched = watchStatus && watchStatus.watched;
    const hasProgress = watchStatus && watchStatus.position > 0;
    
    const options = [];
    
    // Remove Progress (only if movie has progress)
    if (hasProgress) {
        options.push({
            icon: 'assets/icons/remove-progress.svg',
            label: 'Remove Progress',
            action: 'remove-progress'
        });
    }
    
    // Mark as Watched/Unwatched
    options.push({
        icon: isWatched ? 'assets/icons/unwatched.svg' : 'assets/icons/watched.svg',
        label: isWatched ? 'Mark as Unwatched' : 'Mark as Watched',
        action: isWatched ? 'unwatch-movie-detail' : 'watch-movie-detail'
    });
    
    // Add to Favorites
    options.push({
        icon: 'assets/icons/heart-outline.svg',
        label: 'Add to Favorites',
        action: 'add-favorites'
    });
    
    // Add to Playlist
    options.push({
        icon: 'assets/icons/add-to-playlist.svg',
        label: 'Add to Playlist',
        action: 'add-playlist'
    });
    
    // Show the context menu
    contextMenu.show(options, (action) => {
        handleMovieDetailContextMenuAction(action);
    });
};

// Handle movie detail context menu actions
function handleMovieDetailContextMenuAction(action) {
    const videoPath = window.currentMovie.videoPath;
    
    switch (action) {
        case 'remove-progress':
            watchDataManager.clearPosition(videoPath);
            
            // Update the movie card in the grid immediately
            const cards = document.querySelectorAll('.movie-card');
            cards.forEach(card => {
                if (card.dataset.videoPath === videoPath) {
                    const progressBar = card.querySelector('.progress-bar');
                    if (progressBar) {
                        progressBar.remove();
                    }
                }
            });
            
            openDetail(window.currentMovie, false, true);
            break;
            
        case 'watch-movie-detail':
            watchDataManager.markWatched(videoPath, 0);
            
            // Update the movie card in the grid immediately
            const watchCards = document.querySelectorAll('.movie-card');
            watchCards.forEach(card => {
                if (card.dataset.videoPath === videoPath) {
                    // Add watched badge if it doesn't exist
                    let badge = card.querySelector('.watched-badge');
                    if (!badge) {
                        badge = document.createElement('div');
                        badge.className = 'watched-badge';
                        badge.innerHTML = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <path d="M12 24C15.1826 24 18.2348 22.7357 20.4853 20.4853C22.7357 18.2348 24 15.1826 24 12C24 8.8174 22.7357 5.76516 20.4853 3.51472C18.2348 1.26428 15.1826 0 12 0C8.8174 0 5.76516 1.26428 3.51472 3.51472C1.26428 5.76516 0 8.8174 0 12C0 15.1826 1.26428 18.2348 3.51472 20.4853C5.76516 22.7357 8.8174 24 12 24ZM17.2969 9.79688L11.2969 15.7969C10.8563 16.2375 10.1438 16.2375 9.70781 15.7969L6.70781 12.7969C6.26719 12.3563 6.26719 11.6438 6.70781 11.2078C7.14844 10.7719 7.86094 10.7672 8.29688 11.2078L10.5 13.4109L15.7031 8.20312C16.1437 7.7625 16.8562 7.7625 17.2922 8.20312C17.7281 8.64375 17.7328 9.35625 17.2922 9.79219L17.2969 9.79688Z" fill="white"/>
                        </svg>`;
                        
                        const posterContainer = card.querySelector('.movie-card-poster-container');
                        if (posterContainer) {
                            posterContainer.appendChild(badge);
                        }
                    }
                    
                    // Remove progress bar if it exists
                    const progressBar = card.querySelector('.progress-bar');
                    if (progressBar) {
                        progressBar.remove();
                    }
                }
            });
            
            openDetail(window.currentMovie, false, true);
            break;
            
        case 'unwatch-movie-detail':
            watchDataManager.markUnwatched(videoPath);
            
            // Update the movie card in the grid immediately
            const unwatchCards = document.querySelectorAll('.movie-card');
            unwatchCards.forEach(card => {
                if (card.dataset.videoPath === videoPath) {
                    const badge = card.querySelector('.watched-badge');
                    if (badge) {
                        badge.remove();
                    }
                }
            });
            
            openDetail(window.currentMovie, false, true);
            break;
            
        case 'add-favorites':
            alert('Add to Favorites is not connected yet');
            if (window.keyboardNav) {
                setTimeout(() => window.keyboardNav.focusItem(), 50);
            }
            break;
            
        case 'add-playlist':
            showAddToPlaylistOverlay(videoPath);
            break;
    }
}

// Show TV show season context menu (on TV show detail page)
window.showTVSeasonContextMenu = function(seasonNumber) {
    if (!window.currentShow) {
        console.log('No current show');
        return;
    }
    
    const season = window.currentShow.seasons.find(s => s.number === seasonNumber);
    if (!season) {
        console.log('Season not found');
        return;
    }
    
    // Check if season is fully watched
    const allWatched = season.episodes.every(ep => {
        const ws = watchDataManager.getWatchStatus(ep.videoPath);
        return ws && ws.watched;
    });
    
    const options = [];
    
    // Season watched/unwatched option
    options.push({
        icon: allWatched ? 'assets/icons/unwatched.svg' : 'assets/icons/watched.svg',
        label: allWatched ? 'Mark Season as Unwatched' : 'Mark Season as Watched',
        action: allWatched ? 'unwatch-season' : 'watch-season'
    });
    
    // Add to Continue Watching (only if there's an unwatched episode in this season and it's not already next)
    const firstUnwatchedInSeason = findFirstUnwatchedEpisodeInSeason(season);
    if (firstUnwatchedInSeason) {
        const activeShow = watchDataManager.getActiveShow(window.currentShow.showPath);
        const isAlreadyNext = activeShow && activeShow.nextEpisodePath === firstUnwatchedInSeason.videoPath;
        
        if (!isAlreadyNext) {
            options.push({
                icon: 'assets/icons/continue-watching.svg',
                label: 'Add to Continue Watching',
                action: 'add-continue-watching'
            });
        }
    }
    
    // Add to Favorites
    options.push({
        icon: 'assets/icons/heart-outline.svg',
        label: 'Add to Favorites',
        action: 'add-favorites'
    });
    
    // Add to Playlist
    options.push({
        icon: 'assets/icons/add-to-playlist.svg',
        label: 'Add to Playlist',
        action: 'add-playlist'
    });
    
    // Show menu
    contextMenu.show(options, (action) => {
        handleTVSeasonContextMenuAction(action, season);
    });
};

// Handle TV show season context menu actions
function handleTVSeasonContextMenuAction(action, season) {
    // Save current season card index before any refresh
    const savedSeasonIndex = window.keyboardNav ? window.keyboardNav.currentIndex : undefined;
    
    switch (action) {
        case 'watch-season':
            // Mark all episodes in season as watched
            season.episodes.forEach(ep => {
                watchDataManager.markWatched(ep.videoPath, ep.runtime || 0);
            });
            
            // Update active show tracking with the last episode of the season
            if (window.currentShow && season.episodes.length > 0) {
                const lastEpisode = season.episodes[season.episodes.length - 1];
                updateActiveShowTracking(lastEpisode.videoPath, window.currentShow, season);
            }
            
            // Save index before refresh
            if (savedSeasonIndex !== undefined && window.keyboardNav) {
                window.keyboardNav.savedSeasonIndex = savedSeasonIndex;
            }
            // Refresh display
            openTVShowDetail(window.currentShow);
            break;
            
        case 'unwatch-season':
            // Mark all episodes in season as unwatched
            season.episodes.forEach(ep => {
                watchDataManager.markUnwatched(ep.videoPath);
            });
            // Save index before refresh
            if (savedSeasonIndex !== undefined && window.keyboardNav) {
                window.keyboardNav.savedSeasonIndex = savedSeasonIndex;
            }
            // Refresh display
            openTVShowDetail(window.currentShow);
            break;
            
        case 'add-continue-watching':
            const firstUnwatchedInSeason = findFirstUnwatchedEpisodeInSeason(season);
            if (firstUnwatchedInSeason && window.currentShow) {
                watchDataManager.addEpisodeToContinueWatching(
                    firstUnwatchedInSeason.videoPath,
                    window.currentShow.showPath,
                    season.number,
                    firstUnwatchedInSeason.number
                );
            }
            // Restore focus without refreshing
            if (window.keyboardNav) {
                setTimeout(() => window.keyboardNav.focusItem(), 50);
            }
            break;
            
        case 'add-favorites':
            alert('Add to Favorites is not connected yet');
            break;
            
        case 'add-playlist':
            // TV season context - not supported for now (movies only)
            alert('Playlists only support movies for now');
            break;
    }
}

// Show season detail context menu
window.showSeasonContextMenu = function() {
    if (!window.currentShow || !window.currentSeason) {
        console.log('No current show/season');
        return;
    }
    
    // Save current mode (episodes or buttons) to restore after menu closes
    if (window.keyboardNav) {
        window.keyboardNav.contextMenuReturnMode = window.keyboardNav.detailSubMode;
        window.keyboardNav.contextMenuReturnIndex = window.keyboardNav.currentIndex;
    }
    
    // Get currently focused episode
    let focusedEpisode = null;
    if (window.keyboardNav && window.keyboardNav.lastEpisodeIndex !== undefined) {
        focusedEpisode = window.currentSeason.episodes[window.keyboardNav.lastEpisodeIndex];
    }
    
    const options = [];
    
    // Remove Progress (only show if episode has progress) - at top for easy access
    if (focusedEpisode) {
        const episodeProgress = watchDataManager.getWatchStatus(focusedEpisode.videoPath);
        if (episodeProgress && episodeProgress.position > 0) {
            options.push({
                icon: 'assets/icons/remove-progress.svg',
                label: 'Remove Progress',
                action: 'remove-progress'
            });
        }
    }
    
    // Episode watched/unwatched option (if we have a focused episode)
    if (focusedEpisode) {
        const episodeWatched = watchDataManager.getWatchStatus(focusedEpisode.videoPath)?.watched;
        options.push({
            icon: episodeWatched ? 'assets/icons/unwatched.svg' : 'assets/icons/watched.svg',
            label: episodeWatched ? 'Mark Episode as Unwatched' : 'Mark Episode as Watched',
            action: episodeWatched ? 'unwatch-episode' : 'watch-episode'
        });
    }
    
    // Add to Continue Watching (only if episode is not already the next episode)
    if (focusedEpisode) {
        const activeShow = watchDataManager.getActiveShow(window.currentShow.showPath);
        const isAlreadyNext = activeShow && activeShow.nextEpisodePath === focusedEpisode.videoPath;
        
        if (!isAlreadyNext) {
            options.push({
                icon: 'assets/icons/continue-watching.svg',
                label: 'Add to Continue Watching',
                action: 'add-continue-watching'
            });
        }
    }
    
    // Add to Favorites
    options.push({
        icon: 'assets/icons/heart-outline.svg',
        label: 'Add to Favorites',
        action: 'add-favorites'
    });
    
    // Add to Playlist
    options.push({
        icon: 'assets/icons/add-to-playlist.svg',
        label: 'Add to Playlist',
        action: 'add-playlist'
    });
    
    // Show menu
    contextMenu.show(options, (action) => {
        handleSeasonContextMenuAction(action, focusedEpisode);
    });
};

// Handle season context menu actions
function handleSeasonContextMenuAction(action, focusedEpisode) {
    // Save current episode index and mode before any action
    const savedEpisodeIndex = window.keyboardNav ? window.keyboardNav.lastEpisodeIndex : undefined;
    const returnMode = window.keyboardNav ? window.keyboardNav.contextMenuReturnMode : undefined;
    const returnIndex = window.keyboardNav ? window.keyboardNav.contextMenuReturnIndex : undefined;
    
    // Set savedEpisodeIndex BEFORE refresh so enterSeasonDetailMode can use it
    if (savedEpisodeIndex !== undefined && window.keyboardNav) {
        window.keyboardNav.savedEpisodeIndex = savedEpisodeIndex;
    }
    
    switch (action) {
        case 'watch-season':
            // Mark all episodes in season as watched
            window.currentSeason.episodes.forEach(ep => {
                watchDataManager.markWatched(ep.videoPath, ep.runtime || 0);
            });
            
            // Update active show tracking with the last episode of the season
            // This will advance Continue Watching to next season or mark show complete
            if (window.currentShow && window.currentSeason.episodes.length > 0) {
                const lastEpisode = window.currentSeason.episodes[window.currentSeason.episodes.length - 1];
                updateActiveShowTracking(lastEpisode.videoPath, window.currentShow, window.currentSeason);
            }
            
            // Refresh display (savedEpisodeIndex already set above)
            openSeasonDetail(window.currentShow, window.currentSeason.number);
            returnToButtonsIfNeeded(returnMode, returnIndex);
            break;
            
        case 'unwatch-season':
            // Mark all episodes in season as unwatched
            window.currentSeason.episodes.forEach(ep => {
                watchDataManager.markUnwatched(ep.videoPath);
            });
            // Refresh display (savedEpisodeIndex already set above)
            openSeasonDetail(window.currentShow, window.currentSeason.number);
            returnToButtonsIfNeeded(returnMode, returnIndex);
            break;
            
        case 'watch-episode':
            if (focusedEpisode) {
                watchDataManager.markWatched(focusedEpisode.videoPath, focusedEpisode.runtime || 0);
                
                // Update active show tracking so Continue Watching advances to next episode
                if (window.currentShow) {
                    updateActiveShowTracking(focusedEpisode.videoPath, window.currentShow, window.currentSeason);
                }
                
                // Refresh display (savedEpisodeIndex already set above)
                openSeasonDetail(window.currentShow, window.currentSeason.number);
                returnToButtonsIfNeeded(returnMode, returnIndex);
            }
            break;
            
        case 'unwatch-episode':
            if (focusedEpisode) {
                watchDataManager.markUnwatched(focusedEpisode.videoPath);
                // Refresh display (savedEpisodeIndex already set above)
                openSeasonDetail(window.currentShow, window.currentSeason.number);
                returnToButtonsIfNeeded(returnMode, returnIndex);
            }
            break;
            
        case 'add-favorites':
            alert('Add to Favorites is not connected yet');
            // Restore focus since we're not refreshing
            restoreSeasonDetailFocus();
            break;
            
        case 'add-playlist':
            // TV episode context - not supported for now (movies only)
            alert('Playlists only support movies for now');
            restoreSeasonDetailFocus();
            break;
            
        case 'remove-progress':
            console.log('Remove progress action triggered for episode:', focusedEpisode);
            if (focusedEpisode) {
                // Clear position using the correct method
                watchDataManager.clearPosition(focusedEpisode.videoPath);
                console.log('Progress cleared for:', focusedEpisode.videoPath);
                
                // Refresh display (savedEpisodeIndex already set above)
                openSeasonDetail(window.currentShow, window.currentSeason.number);
                returnToButtonsIfNeeded(returnMode, returnIndex);
            }
            break;
            
        case 'add-continue-watching':
            if (focusedEpisode && window.currentShow) {
                // Add episode to Continue Watching as the next episode
                watchDataManager.addEpisodeToContinueWatching(
                    focusedEpisode.videoPath,
                    window.currentShow.showPath,
                    window.currentSeason.number,
                    focusedEpisode.number
                );
                
                // Restore focus since we're not refreshing the page
                restoreSeasonDetailFocus();
            }
            break;
    }
}

// Helper to return to buttons after context menu action if needed
function returnToButtonsIfNeeded(returnMode, returnIndex) {
    if (returnMode === 'buttons') {
        setTimeout(() => {
            window.keyboardNav.detailSubMode = 'buttons';
            window.keyboardNav.updateItems('.detail-button');
            window.keyboardNav.currentIndex = returnIndex !== undefined ? returnIndex : 0;
            window.keyboardNav.focusItem();
        }, 150);
    }
}

// Restore focus on season detail page after context menu closes without refresh
function restoreSeasonDetailFocus() {
    console.log('restoreSeasonDetailFocus called');
    console.log('contextMenuReturnMode:', window.keyboardNav?.contextMenuReturnMode);
    console.log('contextMenuReturnIndex:', window.keyboardNav?.contextMenuReturnIndex);
    
    if (!window.keyboardNav || !window.keyboardNav.contextMenuReturnMode) return;
    
    const returnMode = window.keyboardNav.contextMenuReturnMode;
    const returnIndex = window.keyboardNav.contextMenuReturnIndex;
    
    console.log('Restoring to mode:', returnMode, 'index:', returnIndex);
    
    if (returnMode === 'episodes') {
        // Return to episodes carousel
        window.keyboardNav.detailSubMode = 'episodes';
        window.keyboardNav.updateItems('.season-episode-card');
        window.keyboardNav.currentIndex = returnIndex !== undefined ? returnIndex : 0;
        window.keyboardNav.focusItem();
        window.keyboardNav.scrollCarouselCardIntoView();
        window.keyboardNav.updateSeasonEpisodeInfo();
    } else if (returnMode === 'buttons') {
        // Return to buttons
        console.log('Returning to buttons, setting index to:', returnIndex);
        window.keyboardNav.detailSubMode = 'buttons';
        window.keyboardNav.updateItems('.detail-button');
        window.keyboardNav.currentIndex = returnIndex !== undefined ? returnIndex : 0;
        window.keyboardNav.focusItem();
    }
    
    // Clear saved return state
    window.keyboardNav.contextMenuReturnMode = undefined;
    window.keyboardNav.contextMenuReturnIndex = undefined;
}

// Cleanup player on app close
window.addEventListener('beforeunload', () => {
    player.cleanup();
});

// ============================================
// Home Screen Context Menu
// ============================================

window.showHomeContextMenu = function() {
    const currentCarousel = homeCarousels[currentCarouselIndex];
    if (!currentCarousel) {
        console.log('No current carousel');
        return;
    }
    
    const item = currentCarousel.items[currentCardIndex];
    if (!item) {
        console.log('No current item');
        return;
    }
    
    // Get videoPath based on item type
    let videoPath = null;
    if (item.type === 'movie' && item.data) {
        videoPath = item.data.videoPath;
    } else if (item.type === 'tv' && item.data && item.data.episode) {
        videoPath = item.data.episode.videoPath;
    }
    
    if (!videoPath) {
        console.log('No video path found');
        return;
    }
    
    const watchStatus = watchDataManager.getWatchStatus(videoPath);
    const isWatched = watchStatus && watchStatus.watched;
    const hasProgress = watchStatus && watchStatus.position > 0;
    const isContinueWatching = currentCarousel.title === 'Continue Watching';
    
    const options = [];
    
    // Continue Watching specific options
    if (isContinueWatching) {
        // 1. Mark as Watched/Unwatched (FIRST for Continue Watching)
        options.push({
            icon: isWatched ? 'assets/icons/unwatched.svg' : 'assets/icons/watched.svg',
            label: isWatched ? 'Mark as Unwatched' : 'Mark as Watched',
            action: isWatched ? 'mark-unwatched' : 'mark-watched'
        });
        
        // 2. Remove from Continue Watching
        options.push({
            icon: 'assets/icons/remove-continuewatching.svg',
            label: 'Remove from Continue Watching',
            action: 'remove-continue-watching'
        });
        
        // 3. Clear Progress (only if has progress)
        if (hasProgress) {
            options.push({
                icon: 'assets/icons/remove-progress.svg',
                label: 'Clear Progress',
                action: 'clear-progress'
            });
        }
    } else {
        // Non-Continue Watching carousels (Random Movies, etc.)
        
        // 1. Mark as Watched/Unwatched
        options.push({
            icon: isWatched ? 'assets/icons/unwatched.svg' : 'assets/icons/watched.svg',
            label: isWatched ? 'Mark as Unwatched' : 'Mark as Watched',
            action: isWatched ? 'mark-unwatched' : 'mark-watched'
        });
        
        // 2. Clear Progress (only if has progress)
        if (hasProgress) {
            options.push({
                icon: 'assets/icons/remove-progress.svg',
                label: 'Clear Progress',
                action: 'clear-progress'
            });
        }
        
        // 3. Add to Favorites
        options.push({
            icon: 'assets/icons/heart-outline.svg',
            label: 'Add to Favorites',
            action: 'add-favorites'
        });
        
        // 4. Add to Playlist
        options.push({
            icon: 'assets/icons/add-to-playlist.svg',
            label: 'Add to Playlist',
            action: 'add-playlist'
        });
    }
    
    // Show the context menu
    contextMenu.show(options, (action) => {
        handleHomeContextMenuAction(action, item, videoPath);
    });
};

function handleHomeContextMenuAction(action, item, videoPath) {
    const isTVEpisode = item.type === 'tv';
    
    switch (action) {
        case 'remove-continue-watching':
            // Exclude from Continue Watching (doesn't clear progress)
            watchDataManager.excludeFromContinueWatching(videoPath);
            
            // Rebuild home carousels to reflect the change
            buildHomeCarousels();
            renderHomeCarousels();
            
            // Adjust index if needed
            const carousel = homeCarousels[currentCarouselIndex];
            if (carousel && currentCardIndex >= carousel.items.length) {
                currentCardIndex = Math.max(0, carousel.items.length - 1);
            }
            
            updateHomeFocus();
            break;
            
        case 'clear-progress':
            // Clear progress
            watchDataManager.clearPosition(videoPath);
            
            if (isTVEpisode) {
                // TV episode: stays in Continue Watching as "UP NEXT" if in active shows
                // Rebuild to update the UI (progress bar removed, possibly UP NEXT badge added)
                buildHomeCarousels();
                renderHomeCarousels();
                
                // Try to find the same item
                const tvCarousel = homeCarousels[currentCarouselIndex];
                if (tvCarousel) {
                    const newIndex = tvCarousel.items.findIndex(i => {
                        if (i.type === 'tv' && i.data && i.data.episode) {
                            return i.data.episode.videoPath === videoPath;
                        }
                        return false;
                    });
                    if (newIndex >= 0) {
                        currentCardIndex = newIndex;
                    }
                }
                updateHomeFocus();
            } else {
                // Movie: removes from Continue Watching (no progress = not shown)
                buildHomeCarousels();
                renderHomeCarousels();
                
                // Adjust index if needed
                const movieCarousel = homeCarousels[currentCarouselIndex];
                if (movieCarousel && currentCardIndex >= movieCarousel.items.length) {
                    currentCardIndex = Math.max(0, movieCarousel.items.length - 1);
                }
                updateHomeFocus();
            }
            break;
            
        case 'mark-watched':
            watchDataManager.markWatched(videoPath);
            
            // For TV, update active show tracking (force update since we're in home carousel)
            if (isTVEpisode && item.data) {
                updateActiveShowTracking(videoPath, item.data.show, item.data.season, true);
            }
            
            // Check if we're in Continue Watching carousel
            const currentCarousel = homeCarousels[currentCarouselIndex];
            const isContinueWatchingCarousel = currentCarousel && currentCarousel.title === 'Continue Watching';
            
            if (isContinueWatchingCarousel) {
                // For Continue Watching: rebuild to show next episode (or remove item)
                buildHomeCarousels();
                renderHomeCarousels();
                
                // Try to stay on same show if it has a next episode
                if (isTVEpisode && item.data && item.data.show) {
                    const newCarousel = homeCarousels[currentCarouselIndex];
                    if (newCarousel) {
                        const showPath = item.data.show.showPath;
                        const newIndex = newCarousel.items.findIndex(i => {
                            if (i.type === 'tv' && i.data && i.data.show) {
                                return i.data.show.showPath === showPath;
                            }
                            return false;
                        });
                        if (newIndex >= 0) {
                            currentCardIndex = newIndex;
                        } else if (currentCardIndex >= newCarousel.items.length) {
                            currentCardIndex = Math.max(0, newCarousel.items.length - 1);
                        }
                    }
                } else {
                    // Movie or no show data - just adjust index if needed
                    const newCarousel = homeCarousels[currentCarouselIndex];
                    if (newCarousel && currentCardIndex >= newCarousel.items.length) {
                        currentCardIndex = Math.max(0, newCarousel.items.length - 1);
                    }
                }
                updateHomeFocus();
            } else {
                // For other carousels (Random Movies, etc.): update DOM in place
                const grid = document.getElementById(`homeCarouselGrid-${currentCarouselIndex}`);
                if (grid) {
                    const cards = grid.querySelectorAll('.home-card');
                    const currentCard = cards[currentCardIndex];
                    if (currentCard) {
                        const imgContainer = currentCard.querySelector('.home-card-image-container');
                        if (imgContainer) {
                            // Remove progress bar
                            const progressBar = imgContainer.querySelector('.progress-bar');
                            if (progressBar) progressBar.remove();
                            
                            // Add watched badge
                            let badge = imgContainer.querySelector('.watched-badge');
                            if (!badge) {
                                badge = document.createElement('div');
                                badge.className = 'watched-badge';
                                badge.innerHTML = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                    <path d="M12 24C15.1826 24 18.2348 22.7357 20.4853 20.4853C22.7357 18.2348 24 15.1826 24 12C24 8.8174 22.7357 5.76516 20.4853 3.51472C18.2348 1.26428 15.1826 0 12 0C8.8174 0 5.76516 1.26428 3.51472 3.51472C1.26428 5.76516 0 8.8174 0 12C0 15.1826 1.26428 18.2348 3.51472 20.4853C5.76516 22.7357 8.8174 24 12 24ZM17.2969 9.79688L11.2969 15.7969C10.8563 16.2375 10.1438 16.2375 9.70781 15.7969L6.70781 12.7969C6.26719 12.3563 6.26719 11.6438 6.70781 11.2078C7.14844 10.7719 7.86094 10.7672 8.29688 11.2078L10.5 13.4109L15.7031 8.20312C16.1437 7.7625 16.8562 7.7625 17.2922 8.20312C17.7281 8.64375 17.7328 9.35625 17.2922 9.79219L17.2969 9.79688Z" fill="white"/>
                                </svg>`;
                                imgContainer.appendChild(badge);
                            }
                        }
                    }
                }
            }
            break;
            
        case 'mark-unwatched':
            watchDataManager.markUnwatched(videoPath);
            
            // Update DOM in place - find the current card and update its badges
            const unwatchedGrid = document.getElementById(`homeCarouselGrid-${currentCarouselIndex}`);
            if (unwatchedGrid) {
                const unwatchedCards = unwatchedGrid.querySelectorAll('.home-card');
                const unwatchedCurrentCard = unwatchedCards[currentCardIndex];
                if (unwatchedCurrentCard) {
                    const imgContainer = unwatchedCurrentCard.querySelector('.home-card-image-container');
                    if (imgContainer) {
                        // Remove watched badge and progress bar
                        const badge = imgContainer.querySelector('.watched-badge');
                        const progressBar = imgContainer.querySelector('.progress-bar');
                        if (badge) badge.remove();
                        if (progressBar) progressBar.remove();
                    }
                }
            }
            break;
            
        case 'add-favorites':
            // TODO: Implement favorites
            console.log('Add to favorites:', videoPath);
            break;
            
        case 'add-playlist':
            showAddToPlaylistOverlay(videoPath);
            break;
    }
}

// ============================================
// Movie Detail Carousel Context Menu
// ============================================

window.showMovieCarouselContextMenu = function(cardElement) {
    if (!cardElement) {
        console.log('No card element provided');
        return;
    }
    
    const videoPath = cardElement.dataset.videoPath;
    if (!videoPath) {
        console.log('No video path found on card');
        return;
    }
    
    const watchStatus = watchDataManager.getWatchStatus(videoPath);
    const isWatched = watchStatus && watchStatus.watched;
    const hasProgress = watchStatus && watchStatus.position > 0;
    
    const options = [];
    
    // 1. Remove Progress (only if has progress)
    if (hasProgress) {
        options.push({
            icon: 'assets/icons/remove-progress.svg',
            label: 'Remove Progress',
            action: 'clear-progress'
        });
    }
    
    // 2. Mark as Watched/Unwatched
    options.push({
        icon: isWatched ? 'assets/icons/unwatched.svg' : 'assets/icons/watched.svg',
        label: isWatched ? 'Mark as Unwatched' : 'Mark as Watched',
        action: isWatched ? 'mark-unwatched' : 'mark-watched'
    });
    
    // 3. Add to Favorites
    options.push({
        icon: 'assets/icons/heart-outline.svg',
        label: 'Add to Favorites',
        action: 'add-favorites'
    });
    
    // 4. Add to Playlist
    options.push({
        icon: 'assets/icons/add-to-playlist.svg',
        label: 'Add to Playlist',
        action: 'add-playlist'
    });
    
    // Show the context menu
    contextMenu.show(options, (action) => {
        handleMovieCarouselContextMenuAction(action, videoPath, cardElement);
    });
};

function handleMovieCarouselContextMenuAction(action, videoPath, cardElement) {
    // Recommendation cards use .recommendation-card-image-container
    const imageContainer = cardElement ? cardElement.querySelector('.recommendation-card-image-container') : null;
    
    switch (action) {
        case 'mark-watched':
            watchDataManager.markWatched(videoPath);
            
            // Update card UI
            if (imageContainer) {
                // Remove progress bar if exists
                const progressBar = imageContainer.querySelector('.progress-bar');
                if (progressBar) progressBar.remove();
                
                // Add watched badge
                let badge = imageContainer.querySelector('.watched-badge');
                if (!badge) {
                    badge = document.createElement('div');
                    badge.className = 'watched-badge';
                    badge.innerHTML = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M12 24C15.1826 24 18.2348 22.7357 20.4853 20.4853C22.7357 18.2348 24 15.1826 24 12C24 8.8174 22.7357 5.76516 20.4853 3.51472C18.2348 1.26428 15.1826 0 12 0C8.8174 0 5.76516 1.26428 3.51472 3.51472C1.26428 5.76516 0 8.8174 0 12C0 15.1826 1.26428 18.2348 3.51472 20.4853C5.76516 22.7357 8.8174 24 12 24ZM17.2969 9.79688L11.2969 15.7969C10.8563 16.2375 10.1438 16.2375 9.70781 15.7969L6.70781 12.7969C6.26719 12.3563 6.26719 11.6438 6.70781 11.2078C7.14844 10.7719 7.86094 10.7672 8.29688 11.2078L10.5 13.4109L15.7031 8.20312C16.1437 7.7625 16.8562 7.7625 17.2922 8.20312C17.7281 8.64375 17.7328 9.35625 17.2922 9.79219L17.2969 9.79688Z" fill="white"/>
                    </svg>`;
                    imageContainer.appendChild(badge);
                }
            }
            break;
            
        case 'mark-unwatched':
            watchDataManager.markUnwatched(videoPath);
            
            // Update card UI
            if (imageContainer) {
                // Remove watched badge
                const badge = imageContainer.querySelector('.watched-badge');
                if (badge) badge.remove();
                
                // Remove progress bar
                const progressBar = imageContainer.querySelector('.progress-bar');
                if (progressBar) progressBar.remove();
            }
            break;
            
        case 'clear-progress':
            watchDataManager.clearPosition(videoPath);
            
            // Update card UI - remove progress bar
            if (imageContainer) {
                const progressBar = imageContainer.querySelector('.progress-bar');
                if (progressBar) progressBar.remove();
            }
            break;
            
        case 'add-favorites':
            // TODO: Implement favorites
            console.log('Add to favorites:', videoPath);
            break;
            
        case 'add-playlist':
            showAddToPlaylistOverlay(videoPath);
            break;
    }
}

// Initialize
init();

// ==================== ADD TO PLAYLIST OVERLAY ====================

/**
 * Show the Add to Playlist overlay
 * @param {string|string[]} videoPathOrPaths - Path(s) to the movie(s) to add
 */
function showAddToPlaylistOverlay(videoPathOrPaths) {
    // Normalize to array
    const videoPaths = Array.isArray(videoPathOrPaths) ? videoPathOrPaths : [videoPathOrPaths];
    
    // Store the video paths globally for use in the overlay
    window.addToPlaylistVideoPaths = videoPaths;
    window.addToPlaylistVideoPath = videoPaths[0]; // Keep for backwards compatibility
    
    // Get display title
    let movieTitle;
    if (videoPaths.length === 1) {
        const movie = allMovies.find(m => m.videoPath === videoPaths[0]);
        movieTitle = movie?.metadata?.title || path.basename(videoPaths[0]);
    } else {
        movieTitle = `${videoPaths.length} Movies`;
    }
    
    // Create overlay HTML
    let html = `
        <div class="add-to-playlist-overlay" id="addToPlaylistOverlay">
            <div class="add-to-playlist-header">
                <div class="add-to-playlist-header-left">
                    <img src="assets/icons/add-to-playlist.svg" class="add-to-playlist-icon" alt="">
                    <span class="add-to-playlist-title">Add to Playlist</span>
                </div>
                <div class="add-to-playlist-movie-title">${movieTitle}</div>
                <div class="add-to-playlist-header-right"></div>
            </div>
            <div class="add-to-playlist-grid" id="addToPlaylistGrid">
    `;
    
    // Add "Create New Playlist" card first
    html += `
        <div class="playlist-card add-to-playlist-card" data-action="create-new">
            <div class="playlist-card-poster-container">
                <div class="playlist-card-poster-outer-stroke">
                    <div class="playlist-card-poster-inner-stroke">
                        <div class="create-playlist-card-content">
                            <img src="assets/icons/plus.svg" class="create-playlist-icon" alt="">
                        </div>
                    </div>
                </div>
            </div>
            <div class="playlist-card-info">
                <div class="playlist-card-title">Create New Playlist</div>
            </div>
        </div>
    `;
    
    // Add existing playlists (sorted by last modified - most recent first)
    const playlists = playlistManager.getAllByLastModified();
    playlists.forEach(playlist => {
        // Check if ALL selected movies are already in this playlist
        const allInPlaylist = videoPaths.every(vp => 
            playlist.items.some(item => item.videoPath === vp)
        );
        
        html += `
            <div class="playlist-card add-to-playlist-card ${allInPlaylist ? 'already-in-playlist' : ''}" 
                 data-playlist-id="${playlist.id}" 
                 data-action="add-to-existing">
                <div class="playlist-card-poster-container">
                    <div class="playlist-card-poster-outer-stroke">
                        <div class="playlist-card-poster-inner-stroke">
        `;
        
        // Check for custom thumbnail first
        if (playlist.customThumbnail && fs.existsSync(playlist.customThumbnail)) {
            html += `<img src="file://${playlist.customThumbnail}" class="playlist-card-poster" alt="">`;
        } else {
            // Fall back to collage
            const posters = playlistManager.getThumbnailPosters(playlist.id, allMovies);
            html += '<div class="playlist-card-collage">';
            for (let i = 0; i < 4; i++) {
                if (posters[i]) {
                    html += `<div class="playlist-collage-quadrant"><img src="file://${posters[i]}" alt=""></div>`;
                } else {
                    html += '<div class="playlist-collage-quadrant" style="background-color: #2a2a2a;"></div>';
                }
            }
            html += '</div>';
        }
        
        html += `
                            <div class="add-to-playlist-hover-icon"><img src="assets/icons/add-to-playlist.svg" alt=""></div>
                        </div>
                    </div>
                </div>
                <div class="playlist-card-info">
                    <div class="playlist-card-title">${playlist.name}</div>
                </div>
            </div>
        `;
    });
    
    html += `
            </div>
        </div>
    `;
    
    // Insert overlay into DOM
    const overlay = document.createElement('div');
    overlay.id = 'addToPlaylistContainer';
    overlay.innerHTML = html;
    document.body.appendChild(overlay);
    
    // Setup keyboard navigation for overlay
    setupAddToPlaylistNavigation();
}

/**
 * Setup keyboard navigation for Add to Playlist overlay
 */
function setupAddToPlaylistNavigation() {
    window.addToPlaylistIndex = 0;
    const cards = document.querySelectorAll('.add-to-playlist-card');
    if (cards.length > 0) {
        cards[0].classList.add('focused');
    }
    
    // Store the handler so we can remove it later
    window.addToPlaylistKeyHandler = function(e) {
        // Stop event from reaching other handlers
        e.stopPropagation();
        e.stopImmediatePropagation();
        
        const cards = document.querySelectorAll('.add-to-playlist-card');
        if (cards.length === 0) return;
        
        const cols = 6; // Grid columns
        const current = window.addToPlaylistIndex;
        const currentRow = Math.floor(current / cols);
        const currentCol = current % cols;
        const totalRows = Math.ceil(cards.length / cols);
        
        switch (e.key) {
            case 'ArrowLeft':
                e.preventDefault();
                if (current > 0) {
                    cards[current].classList.remove('focused');
                    window.addToPlaylistIndex = current - 1;
                    cards[window.addToPlaylistIndex].classList.add('focused');
                    cards[window.addToPlaylistIndex].scrollIntoView({ behavior: 'auto', block: 'center' });
                }
                break;
            case 'ArrowRight':
                e.preventDefault();
                if (current < cards.length - 1) {
                    cards[current].classList.remove('focused');
                    window.addToPlaylistIndex = current + 1;
                    cards[window.addToPlaylistIndex].classList.add('focused');
                    cards[window.addToPlaylistIndex].scrollIntoView({ behavior: 'auto', block: 'center' });
                }
                break;
            case 'ArrowUp':
                e.preventDefault();
                if (currentRow > 0) {
                    cards[current].classList.remove('focused');
                    // Go to same column in previous row
                    window.addToPlaylistIndex = (currentRow - 1) * cols + currentCol;
                    cards[window.addToPlaylistIndex].classList.add('focused');
                    cards[window.addToPlaylistIndex].scrollIntoView({ behavior: 'auto', block: 'center' });
                }
                break;
            case 'ArrowDown':
                e.preventDefault();
                if (currentRow < totalRows - 1) {
                    cards[current].classList.remove('focused');
                    // Try same column in next row, or last item in next row if it doesn't exist
                    let targetIndex = (currentRow + 1) * cols + currentCol;
                    if (targetIndex >= cards.length) {
                        // Go to last item in next row
                        targetIndex = cards.length - 1;
                    }
                    window.addToPlaylistIndex = targetIndex;
                    cards[window.addToPlaylistIndex].classList.add('focused');
                    cards[window.addToPlaylistIndex].scrollIntoView({ behavior: 'auto', block: 'center' });
                }
                break;
            case 'Enter':
                e.preventDefault();
                const card = cards[window.addToPlaylistIndex];
                const action = card.dataset.action;
                const playlistId = card.dataset.playlistId;
                handleAddToPlaylistSelection(action, playlistId);
                break;
            case 'Escape':
            case 'Backspace':
                e.preventDefault();
                closeAddToPlaylistOverlay();
                break;
        }
    };
    
    // Use capture phase to intercept before other handlers
    document.addEventListener('keydown', window.addToPlaylistKeyHandler, true);
}

/**
 * Close the Add to Playlist overlay
 */
function closeAddToPlaylistOverlay() {
    const container = document.getElementById('addToPlaylistContainer');
    if (container) {
        container.remove();
    }
    
    // Remove key handler (must match capture: true)
    if (window.addToPlaylistKeyHandler) {
        document.removeEventListener('keydown', window.addToPlaylistKeyHandler, true);
        window.addToPlaylistKeyHandler = null;
    }
    
    window.addToPlaylistVideoPath = null;
    window.addToPlaylistVideoPaths = null;
    
    // Restore focus to previous context
    if (window.keyboardNav) {
        setTimeout(() => window.keyboardNav.focusItem(), 50);
    }
}

/**
 * Handle selection in Add to Playlist overlay
 * @param {string} action - 'create-new' or 'add-to-existing'
 * @param {string} playlistId - Playlist ID (for add-to-existing)
 */
function handleAddToPlaylistSelection(action, playlistId) {
    const videoPaths = window.addToPlaylistVideoPaths || [window.addToPlaylistVideoPath];
    
    if (action === 'create-new') {
        // Don't close the overlay - show keyboard modal on top of it
        // But remove the key handler so it doesn't interfere
        if (window.addToPlaylistKeyHandler) {
            document.removeEventListener('keydown', window.addToPlaylistKeyHandler, true);
            window.addToPlaylistKeyHandler = null;
        }
        showCreatePlaylistModal(videoPaths);
    } else if (action === 'add-to-existing' && playlistId) {
        // Add all paths to playlist
        let addedCount = 0;
        videoPaths.forEach(videoPath => {
            if (playlistManager.addMovie(playlistId, videoPath)) {
                addedCount++;
            }
        });
        
        closeAddToPlaylistOverlay();
        
        if (addedCount > 0) {
            const message = addedCount === 1 ? 'Added to playlist' : `Added ${addedCount} to playlist`;
            showPlaylistToast(message, 'success');
        } else {
            showPlaylistToast('Already in playlist', 'error');
        }
    }
}

/**
 * Show a toast notification for playlist actions
 * @param {string} message - Toast message
 * @param {string} type - 'success' or 'error'
 */
function showPlaylistToast(message, type) {
    // Remove existing toast
    const existing = document.querySelector('.playlist-toast');
    if (existing) existing.remove();
    
    const icon = type === 'success' ? 'playlist-success.svg' : 'playlist-failed.svg';
    
    const toast = document.createElement('div');
    toast.className = `playlist-toast toast-${type}`;
    toast.innerHTML = `
        <img src="assets/icons/${icon}" class="playlist-toast-icon" alt="">
        <span class="playlist-toast-text">${message}</span>
    `;
    
    document.body.appendChild(toast);
    
    // Auto-remove after 3 seconds
    setTimeout(() => {
        toast.classList.add('playlist-toast-fade');
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

/**
 * Show the Create New Playlist modal with keyboard
 * @param {string} videoPath - Path to movie to add after creating
 */
function showCreatePlaylistModal(videoPathOrPaths) {
    // Store as array for multiple videos support
    window.createPlaylistForVideoPaths = Array.isArray(videoPathOrPaths) 
        ? videoPathOrPaths 
        : (videoPathOrPaths ? [videoPathOrPaths] : []);
    window.createPlaylistForVideoPath = window.createPlaylistForVideoPaths[0] || null; // Keep for backwards compatibility
    window.playlistInputText = '';
    window.playlistCursorPos = 0; // Cursor position
    window.playlistKeyboardLayout = 'alpha';
    window.playlistKeyboardShift = true; // Start with shift ON for title case
    window.playlistKeyboardRow = 0;
    window.playlistKeyboardCol = 0;
    
    const html = `
        <div class="create-playlist-modal" id="createPlaylistModal">
            <div class="create-playlist-content">
                <div class="create-playlist-header">CREATE NEW PLAYLIST</div>
                <div class="create-playlist-input" id="createPlaylistInput"><span class="cursor"></span></div>
                <div class="create-playlist-keyboard" id="createPlaylistKeyboard">
                    ${generateKeyboardHTML('alpha')}
                </div>
            </div>
        </div>
    `;
    
    const modal = document.createElement('div');
    modal.id = 'createPlaylistModalContainer';
    modal.innerHTML = html;
    document.body.appendChild(modal);
    
    // Setup keyboard navigation
    setupCreatePlaylistNavigation();
    updateKeyboardFocus();
    updatePlaylistInput(); // Show initial cursor
}

/**
 * Generate keyboard HTML for playlist naming
 * @param {string} layout - 'alpha', 'numeric', or 'emoji'
 */
function generateKeyboardHTML(layout) {
    let keys = [];
    const isShift = window.playlistKeyboardShift;
    
    if (layout === 'alpha') {
        keys = [
            ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'],
            ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l', "'"],
            ['shift', 'z', 'x', 'c', 'v', 'b', 'n', 'm', '.', 'backspace'],
            ['?123', 'left', 'right', 'space', '-', '_', 'confirm']
        ];
        if (isShift) {
            keys = keys.map(row => row.map(k => {
                if (k.length === 1 && k.match(/[a-z]/)) return k.toUpperCase();
                return k;
            }));
        }
    } else if (layout === 'numeric') {
        keys = [
            ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'],
            ['@', '#', '$', '~', '&', '=', '+', '(', ')', '/'],
            ['emoji', '*', '"', "'", ':', ';', '!', '?', '%', 'backspace'],
            ['ABC', 'left', 'right', 'space', '.', ',', 'confirm']
        ];
    } else if (layout === 'emoji') {
        keys = [
            ['😄', '🤣', '😭', '😍', '😎', '😱', '😤', '😡', '🥴', '🫠'],
            ['👍', '👌', '🤙', '🤟', '👉', '👈', '✌️', '💗', '🔥', '⭐'],
            ['?123', '©', '™', '{', '}', '[', ']', '<', '>', 'backspace'],
            ['ABC', 'left', 'right', 'space', '.', ',', 'confirm']
        ];
    }
    
    let html = '';
    keys.forEach((row, rowIndex) => {
        html += `<div class="keyboard-row" data-row="${rowIndex}">`;
        row.forEach((key, colIndex) => {
            let keyClass = 'keyboard-key';
            let keyContent = key;
            // Only lowercase ASCII letters, not emojis or special characters
            let dataKey = (key.length === 1 && key.match(/[a-zA-Z]/)) ? key.toLowerCase() : key;
            
            // Special keys
            if (key === 'shift' || key === 'SHIFT') {
                keyClass += ' keyboard-key-special';
                keyContent = '<img src="assets/icons/shift-key.svg" alt="Shift">';
                dataKey = 'shift';
            } else if (key === 'backspace') {
                keyClass += ' keyboard-key-special';
                keyContent = '<img src="assets/icons/delete-left.svg" alt="Delete">';
            } else if (key === 'space') {
                keyClass += ' keyboard-key-space';
                keyContent = '<img src="assets/icons/space-text.svg" alt="Space">';
            } else if (key === 'confirm') {
                keyClass += ' keyboard-key-confirm';
                keyContent = '<img src="assets/icons/check.svg" alt="Confirm">';
            } else if (key === 'left') {
                keyClass += ' keyboard-key-nav';
                keyContent = '<img src="assets/icons/caret-left.svg" alt="Left">';
            } else if (key === 'right') {
                keyClass += ' keyboard-key-nav';
                keyContent = '<img src="assets/icons/caret-right.svg" alt="Right">';
            } else if (key === '?123' || key === 'ABC' || key === 'emoji') {
                keyClass += ' keyboard-key-mode';
            }
            
            html += `<div class="${keyClass}" data-key="${dataKey}" data-display="${key}" data-row="${rowIndex}" data-col="${colIndex}">${keyContent}</div>`;
        });
        html += '</div>';
    });
    
    return html;
}

/**
 * Get the visual width of a key (in key units)
 * Space = 3, Confirm = 2, all others = 1
 */
function getKeyVisualWidth(keyElement) {
    if (keyElement.classList.contains('keyboard-key-space')) return 3;
    if (keyElement.classList.contains('keyboard-key-confirm')) return 2;
    return 1;
}

/**
 * Get visual start position of a key within its row
 */
function getKeyVisualStart(rowElement, colIndex) {
    const keys = rowElement.querySelectorAll('.keyboard-key');
    let pos = 0;
    for (let i = 0; i < colIndex && i < keys.length; i++) {
        pos += getKeyVisualWidth(keys[i]);
    }
    return pos;
}

/**
 * Get visual center position of a key
 */
function getKeyVisualCenter(rowElement, colIndex) {
    const keys = rowElement.querySelectorAll('.keyboard-key');
    if (colIndex >= keys.length) return 0;
    const start = getKeyVisualStart(rowElement, colIndex);
    const width = getKeyVisualWidth(keys[colIndex]);
    return start + width / 2;
}

/**
 * Find the best matching column in a row based on visual position
 * Prefers keys that contain the visual position, otherwise closest center
 */
function findBestColumn(rowElement, visualPosition) {
    const keys = rowElement.querySelectorAll('.keyboard-key');
    
    // First, check if any key contains this visual position
    for (let i = 0; i < keys.length; i++) {
        const start = getKeyVisualStart(rowElement, i);
        const width = getKeyVisualWidth(keys[i]);
        const end = start + width;
        
        // Check if position falls within this key's range
        if (visualPosition >= start && visualPosition < end) {
            return i;
        }
    }
    
    // If not contained, find closest center
    let bestCol = 0;
    let bestDistance = Infinity;
    
    for (let i = 0; i < keys.length; i++) {
        const keyCenter = getKeyVisualCenter(rowElement, i);
        const distance = Math.abs(keyCenter - visualPosition);
        if (distance < bestDistance) {
            bestDistance = distance;
            bestCol = i;
        }
    }
    return bestCol;
}

/**
 * Setup keyboard navigation for create playlist modal
 */
function setupCreatePlaylistNavigation() {
    window.createPlaylistKeyHandler = function(e) {
        // Stop event from reaching any other handlers
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        
        const keyboard = document.getElementById('createPlaylistKeyboard');
        if (!keyboard) return;
        
        const rows = keyboard.querySelectorAll('.keyboard-row');
        const currentRow = rows[window.playlistKeyboardRow];
        const keys = currentRow ? currentRow.querySelectorAll('.keyboard-key') : [];
        
        switch (e.key) {
            case 'ArrowUp':
                if (window.playlistKeyboardRow > 0) {
                    // Get visual center of current key
                    const currentCenter = getKeyVisualCenter(currentRow, window.playlistKeyboardCol);
                    window.playlistKeyboardRow--;
                    // Find best matching column in new row
                    const newRow = rows[window.playlistKeyboardRow];
                    window.playlistKeyboardCol = findBestColumn(newRow, currentCenter);
                }
                updateKeyboardFocus();
                break;
            case 'ArrowDown':
                if (window.playlistKeyboardRow < rows.length - 1) {
                    // Get visual center of current key
                    const currentCenter = getKeyVisualCenter(currentRow, window.playlistKeyboardCol);
                    window.playlistKeyboardRow++;
                    // Find best matching column in new row
                    const newRow = rows[window.playlistKeyboardRow];
                    window.playlistKeyboardCol = findBestColumn(newRow, currentCenter);
                }
                updateKeyboardFocus();
                break;
            case 'ArrowLeft':
                if (window.playlistKeyboardCol > 0) {
                    window.playlistKeyboardCol--;
                }
                updateKeyboardFocus();
                break;
            case 'ArrowRight':
                if (window.playlistKeyboardCol < keys.length - 1) {
                    window.playlistKeyboardCol++;
                }
                updateKeyboardFocus();
                break;
            case 'Enter':
                const focusedKey = keyboard.querySelector('.keyboard-key.focused');
                if (focusedKey) {
                    handlePlaylistKeyPress(focusedKey.dataset.key, focusedKey.dataset.display);
                }
                break;
            case 'Escape':
            case 'Backspace':
                if (e.key === 'Backspace' && window.playlistInputText.length > 0) {
                    // Delete character
                    const result = deleteBeforeCursor(window.playlistInputText, window.playlistCursorPos);
                    window.playlistInputText = result.text;
                    window.playlistCursorPos = result.newPos;
                    updatePlaylistInput();
                } else if (e.key === 'Escape') {
                    // Go back to playlist selection, not all the way out
                    backToPlaylistSelection();
                }
                break;
        }
    };
    
    // Use capture phase to intercept before any other handlers
    document.addEventListener('keydown', window.createPlaylistKeyHandler, true);
}

/**
 * Update keyboard focus visual
 */
function updateKeyboardFocus() {
    const keyboard = document.getElementById('createPlaylistKeyboard');
    if (!keyboard) return;
    
    // Remove all focus
    keyboard.querySelectorAll('.keyboard-key').forEach(k => k.classList.remove('focused'));
    
    // Add focus to current key
    const rows = keyboard.querySelectorAll('.keyboard-row');
    const currentRow = rows[window.playlistKeyboardRow];
    if (currentRow) {
        const keys = currentRow.querySelectorAll('.keyboard-key');
        if (keys[window.playlistKeyboardCol]) {
            keys[window.playlistKeyboardCol].classList.add('focused');
        }
    }
}

/**
 * Handle key press in create playlist keyboard
 */
function handlePlaylistKeyPress(key, display) {
    const text = window.playlistInputText;
    const pos = window.playlistCursorPos;
    
    switch (key) {
        case 'backspace':
            if (pos > 0) {
                // Delete character before cursor (handle surrogate pairs)
                const result = deleteBeforeCursor(text, pos);
                window.playlistInputText = result.text;
                window.playlistCursorPos = result.newPos;
            }
            break;
        case 'space':
            // Insert space at cursor position
            window.playlistInputText = insertAtCursor(text, pos, ' ');
            window.playlistCursorPos = pos + 1;
            // Turn ON shift after space for title case
            if (!window.playlistKeyboardShift && window.playlistKeyboardLayout === 'alpha') {
                window.playlistKeyboardShift = true;
                refreshKeyboard();
            }
            break;
        case 'shift':
            window.playlistKeyboardShift = !window.playlistKeyboardShift;
            refreshKeyboard();
            return;
        case '?123':
            window.playlistKeyboardLayout = 'numeric';
            window.playlistKeyboardShift = false;
            refreshKeyboard();
            return;
        case 'abc':
        case 'ABC':
            window.playlistKeyboardLayout = 'alpha';
            window.playlistKeyboardShift = true; // Start with shift for title case
            refreshKeyboard();
            return;
        case 'emoji':
            window.playlistKeyboardLayout = 'emoji';
            refreshKeyboard();
            return;
        case 'left':
            // Move cursor left (handle surrogate pairs)
            if (window.playlistCursorPos > 0) {
                window.playlistCursorPos = moveCursorLeft(text, pos);
            }
            break;
        case 'right':
            // Move cursor right (handle surrogate pairs)
            if (window.playlistCursorPos < text.length) {
                window.playlistCursorPos = moveCursorRight(text, pos);
            }
            break;
        case 'confirm':
            confirmCreatePlaylist();
            return;
        default:
            // Regular character - insert at cursor position
            const char = display || key;
            window.playlistInputText = insertAtCursor(text, pos, char);
            // Move cursor by number of characters inserted (usually 1, even for emojis)
            window.playlistCursorPos = pos + [...char].length;
            // Turn off shift after typing a letter
            if (window.playlistKeyboardShift && key.match(/^[a-z]$/i)) {
                window.playlistKeyboardShift = false;
                refreshKeyboard();
            }
    }
    updatePlaylistInput();
}

/**
 * Insert text at cursor position, handling Unicode properly
 * cursorPos is the character index (not byte position)
 */
function insertAtCursor(text, cursorPos, insertText) {
    // Convert to array of code points to handle surrogate pairs
    const chars = [...text];
    const beforeChars = chars.slice(0, cursorPos);
    const afterChars = chars.slice(cursorPos);
    return beforeChars.join('') + insertText + afterChars.join('');
}

/**
 * Delete character before cursor, handling surrogate pairs
 * Returns { text, newPos }
 */
function deleteBeforeCursor(text, cursorPos) {
    if (cursorPos <= 0) return { text, newPos: 0 };
    const chars = [...text];
    // cursorPos is character index
    const beforeChars = chars.slice(0, cursorPos - 1);
    const afterChars = chars.slice(cursorPos);
    return {
        text: beforeChars.join('') + afterChars.join(''),
        newPos: cursorPos - 1
    };
}

/**
 * Move cursor left by one character
 */
function moveCursorLeft(text, currentPos) {
    if (currentPos <= 0) return 0;
    return currentPos - 1;
}

/**
 * Move cursor right by one character
 */
function moveCursorRight(text, currentPos) {
    const chars = [...text];
    if (currentPos >= chars.length) return chars.length;
    return currentPos + 1;
}

/**
 * Update playlist input display with cursor
 */
function updatePlaylistInput() {
    const input = document.getElementById('createPlaylistInput');
    if (input) {
        const text = window.playlistInputText;
        const cursorPos = window.playlistCursorPos;
        
        // Use spread operator to handle surrogate pairs correctly
        const chars = [...text];
        const beforeCursor = chars.slice(0, cursorPos).join('');
        const afterCursor = chars.slice(cursorPos).join('');
        
        input.innerHTML = `${escapeHtml(beforeCursor)}<span class="cursor"></span>${escapeHtml(afterCursor)}`;
    }
    
    // Update confirm button state
    const confirmKey = document.querySelector('.keyboard-key-confirm');
    if (confirmKey) {
        if (window.playlistInputText.trim().length > 0) {
            confirmKey.classList.add('enabled');
        } else {
            confirmKey.classList.remove('enabled');
        }
    }
}

/**
 * Escape HTML special characters
 */
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

/**
 * Refresh keyboard with current layout
 */
function refreshKeyboard() {
    const keyboard = document.getElementById('createPlaylistKeyboard');
    if (keyboard) {
        keyboard.innerHTML = generateKeyboardHTML(window.playlistKeyboardLayout);
        updateKeyboardFocus();
        updatePlaylistInput();
    }
}

/**
 * Confirm and create the new playlist
 */
function confirmCreatePlaylist() {
    const name = window.playlistInputText.trim();
    if (!name) return;
    
    // Check if we're in rename mode
    if (window.playlistRenameMode && window.playlistRenameId) {
        const playlist = playlistManager.getById(window.playlistRenameId);
        if (playlist) {
            playlistManager.rename(window.playlistRenameId, name);
            closeCreatePlaylistModal();
            showPlaylistToast('Playlist Renamed', 'success');
            
            // Refresh the playlist detail page
            const updatedPlaylist = playlistManager.getById(window.playlistRenameId);
            if (updatedPlaylist) {
                openPlaylistDetail(updatedPlaylist);
            }
        }
        window.playlistRenameMode = false;
        window.playlistRenameId = null;
        return;
    }
    
    const playlist = playlistManager.create(name);
    const videoPaths = window.createPlaylistForVideoPaths || [];
    
    // Add all videos to the new playlist
    videoPaths.forEach(videoPath => {
        playlistManager.addMovie(playlist.id, videoPath);
    });
    
    closeCreatePlaylistModal();
    const message = videoPaths.length > 1 
        ? `Playlist Created with ${videoPaths.length} movies`
        : 'Playlist Created';
    showPlaylistToast(message, 'success');
}

/**
 * Go back from create playlist modal to the Add to Playlist overlay
 * (Used when pressing Escape without creating a playlist)
 */
function backToPlaylistSelection() {
    const container = document.getElementById('createPlaylistModalContainer');
    if (container) {
        container.remove();
    }
    
    // Remove key handler (must match capture: true)
    if (window.createPlaylistKeyHandler) {
        document.removeEventListener('keydown', window.createPlaylistKeyHandler, true);
        window.createPlaylistKeyHandler = null;
    }
    
    window.playlistInputText = '';
    window.playlistCursorPos = 0;
    
    // If we were in rename mode from playlist detail, restore focus there
    if (window.playlistRenameMode && window.playlistRenameFromDetail) {
        window.playlistRenameMode = false;
        window.playlistRenameId = null;
        window.playlistRenameFromDetail = false;
        
        // Re-add playlist detail key handler
        setupPlaylistDetailNavigation();
        // Focus on More Options button (index 3)
        window.playlistFocusSection = 'buttons';
        window.playlistFocusedIndex = 3;
        updatePlaylistDetailFocus();
        return;
    }
    
    // If we were in rename mode from grid, just close and return to grid
    if (window.playlistRenameMode) {
        window.playlistRenameMode = false;
        window.playlistRenameId = null;
        window.playlistRenameFromDetail = false;
        return;
    }
    
    // If we came from empty playlist state (no video to add), go back there
    if (!window.createPlaylistForVideoPath) {
        // Check if we're on playlist page with empty state
        const emptyState = document.querySelector('.playlist-empty-state');
        if (emptyState) {
            setupEmptyPlaylistNavigation();
            return;
        }
    }
    
    // Keep createPlaylistForVideoPath - we're going back to selection
    
    // Re-enable the Add to Playlist overlay key handler
    setupAddToPlaylistNavigation();
}

/**
 * Close create playlist modal (after successfully creating a playlist)
 */
function closeCreatePlaylistModal() {
    const container = document.getElementById('createPlaylistModalContainer');
    if (container) {
        container.remove();
    }
    
    // Remove key handler (must match capture: true)
    if (window.createPlaylistKeyHandler) {
        document.removeEventListener('keydown', window.createPlaylistKeyHandler, true);
        window.createPlaylistKeyHandler = null;
    }
    
    // Check if we came from empty playlist state (no video path means we created from empty state)
    const fromEmptyState = !window.createPlaylistForVideoPath && (!window.createPlaylistForVideoPaths || window.createPlaylistForVideoPaths.length === 0);
    
    window.createPlaylistForVideoPath = null;
    window.createPlaylistForVideoPaths = null;
    window.playlistInputText = '';
    window.playlistCursorPos = 0;
    
    if (fromEmptyState) {
        // Re-render the playlist grid to show the new playlist
        renderPlaylistGrid();
    } else {
        // Close the Add to Playlist overlay behind it
        closeAddToPlaylistOverlay();
        
        // Restore focus
        if (window.keyboardNav) {
            setTimeout(() => window.keyboardNav.focusItem(), 50);
        }
    }
}

// Expose functions globally
window.showAddToPlaylistOverlay = showAddToPlaylistOverlay;
window.closeAddToPlaylistOverlay = closeAddToPlaylistOverlay;
window.showCreatePlaylistModal = showCreatePlaylistModal;
window.closeCreatePlaylistModal = closeCreatePlaylistModal;
window.backToPlaylistSelection = backToPlaylistSelection;
window.showPlaylistToast = showPlaylistToast;
