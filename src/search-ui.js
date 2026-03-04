// Search UI Logic
const fs = require('fs');
const path = require('path');

// State
let searchQuery = '';
let currentMode = 'keyboard'; // 'keyboard', 'nav', 'movies', 'tvshows'
let keyboardIndex = 0; // Start on 'A' (first key)
let navIndex = 0; // Index for nav items
let movieResultIndex = 0;
let tvResultIndex = 0;
let keyButtons = [];
let navItems = [];
let movieResultCards = [];
let tvResultCards = [];
let currentMovieResults = [];
let currentTVResults = [];
let lastColumnBeforeSpaceClear = null; // Remember column when navigating to space/clear

// Load config and movies
let config = {};
let allMovies = [];
let allShows = [];

async function loadConfig() {
    try {
        const configPath = path.join(__dirname, '..', 'config.json');
        const configData = fs.readFileSync(configPath, 'utf8');
        config = JSON.parse(configData);
        console.log('Config loaded:', config);
        return config;
    } catch (error) {
        console.error('Error loading config:', error);
        return null;
    }
}

// (Old initialization removed - now using init() function below)

function setupKeyboardListeners() {
    document.addEventListener('keydown', (e) => {
        if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', 'Escape'].includes(e.key)) {
            e.preventDefault();
        }
        
        switch(e.key) {
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
            case 'h':
            case 'H':
                window.location.href = 'index.html';
                break;
            case 'n':
            case 'N':
                if (currentMode === 'nav') {
                    currentMode = 'keyboard';
                    updateNavFocus();
                    updateKeyboardFocus();
                } else {
                    currentMode = 'nav';
                    navIndex = navItems.findIndex(item => item.classList.contains('nav-item-active'));
                    if (navIndex < 0) navIndex = 0;
                    updateNavFocus();
                }
                break;
        }
    });
}

function handleArrowUp() {
    if (currentMode === 'nav') {
        // Move up in nav
        if (navIndex > 0) {
            navIndex--;
            updateNavFocus();
        }
    } else if (currentMode === 'keyboard') {
        // Special handling for SPACE and CLEAR buttons
        if (keyboardIndex === 36 || keyboardIndex === 37) {
            // Restore to the column we came from, if we saved it
            if (lastColumnBeforeSpaceClear !== null) {
                keyboardIndex = lastColumnBeforeSpaceClear;
                lastColumnBeforeSpaceClear = null; // Clear saved position
            } else {
                // Fallback if no saved position (shouldn't happen in normal use)
                keyboardIndex = (keyboardIndex === 36) ? 31 : 34;
            }
            updateKeyboardFocus();
        } else if (keyboardIndex >= 6) {
            // Normal up movement (subtract 6 for previous row)
            keyboardIndex -= 6;
            updateKeyboardFocus();
        }
    } else if (currentMode === 'tvshows') {
        // Move from TV shows carousel to movies carousel
        if (currentMovieResults.length > 0) {
            currentMode = 'movies';
            // Don't change movieResultIndex - it remembers where we left off
            updateResultsFocus();
            scrollResultIntoView('movies');
        }
    } else if (currentMode === 'movies') {
        // Already at top carousel, do nothing
    }
}

function handleArrowDown() {
    if (currentMode === 'nav') {
        // Move down in nav
        if (navIndex < navItems.length - 1) {
            navIndex++;
            updateNavFocus();
        }
    } else if (currentMode === 'keyboard') {
        // Check if we're on the last full row (indices 30-35: numbers 5-0)
        if (keyboardIndex >= 30 && keyboardIndex <= 35) {
            // Save current column position
            lastColumnBeforeSpaceClear = keyboardIndex;
            
            // From first 3 columns (indices 30-32) go to SPACE (index 36)
            // From last 3 columns (indices 33-35) go to CLEAR (index 37)
            const columnInRow = keyboardIndex % 6;
            if (columnInRow < 3) {
                keyboardIndex = 36; // SPACE
            } else {
                keyboardIndex = 37; // CLEAR
            }
            updateKeyboardFocus();
        } else if (keyboardIndex + 6 < keyButtons.length) {
            // Normal down movement (add 6 for next row)
            keyboardIndex += 6;
            updateKeyboardFocus();
        }
    } else if (currentMode === 'movies') {
        // Move from movies carousel to TV shows carousel
        if (currentTVResults.length > 0) {
            currentMode = 'tvshows';
            // Don't change tvResultIndex - it remembers where we left off
            // (starts at 0 by default, then remembers position)
            updateResultsFocus();
            scrollResultIntoView('tvshows');
        }
    } else if (currentMode === 'tvshows') {
        // Already at bottom carousel, do nothing
    }
}

function handleArrowLeft() {
    if (currentMode === 'keyboard') {
        // Move left within keyboard
        if (keyboardIndex % 6 > 0) {
            keyboardIndex--;
            updateKeyboardFocus();
        } else {
            // At left edge of keyboard, move to nav
            currentMode = 'nav';
            navIndex = 0; // Start at first nav item (Search)
            updateKeyboardFocus();
            updateNavFocus();
        }
    } else if (currentMode === 'nav') {
        // Already at nav, can't go further left
    } else if (currentMode === 'movies') {
        // Move left in movies carousel
        if (movieResultIndex > 0) {
            movieResultIndex--;
            updateResultsFocus();
            scrollResultIntoView('movies');
        } else {
            // At first result, go back to keyboard
            currentMode = 'keyboard';
            updateKeyboardFocus();
            updateResultsFocus();
        }
    } else if (currentMode === 'tvshows') {
        // Move left in TV shows carousel
        if (tvResultIndex > 0) {
            tvResultIndex--;
            updateResultsFocus();
            scrollResultIntoView('tvshows');
        } else {
            // At first result, go back to keyboard
            currentMode = 'keyboard';
            updateKeyboardFocus();
            updateResultsFocus();
        }
    }
}

function handleArrowRight() {
    if (currentMode === 'nav') {
        // From nav, move to keyboard
        currentMode = 'keyboard';
        updateNavFocus();
        updateKeyboardFocus();
    } else if (currentMode === 'keyboard') {
        // Check if at rightmost key in row
        if (keyboardIndex % 6 < 5 && keyboardIndex < keyButtons.length - 1) {
            // Move right within keyboard
            keyboardIndex++;
            updateKeyboardFocus();
        } else {
            // At right edge of keyboard, move to results if available
            // Prefer movies carousel first, then TV if no movies
            if (currentMovieResults.length > 0) {
                currentMode = 'movies';
                movieResultIndex = 0;
                updateKeyboardFocus();
                updateResultsFocus();
                scrollResultIntoView('movies');
            } else if (currentTVResults.length > 0) {
                currentMode = 'tvshows';
                tvResultIndex = 0;
                updateKeyboardFocus();
                updateResultsFocus();
                scrollResultIntoView('tvshows');
            }
        }
    } else if (currentMode === 'movies') {
        // Move right in movies carousel
        if (movieResultIndex < movieResultCards.length - 1) {
            movieResultIndex++;
            updateResultsFocus();
            scrollResultIntoView('movies');
        }
    } else if (currentMode === 'tvshows') {
        // Move right in TV shows carousel
        if (tvResultIndex < tvResultCards.length - 1) {
            tvResultIndex++;
            updateResultsFocus();
            scrollResultIntoView('tvshows');
        }
    }
}

function handleEnter() {
    console.log('========================================');
    console.log('ENTER PRESSED');
    console.log('Mode:', currentMode);
    console.log('KeyboardIndex:', keyboardIndex);
    console.log('========================================');
    
    if (currentMode === 'nav') {
        // Activate selected nav item
        const page = navItems[navIndex].dataset.page;
        handleNavClick(page);
    } else if (currentMode === 'keyboard') {
        const key = keyButtons[keyboardIndex].dataset.key;
        console.log('Key pressed:', key);
        console.log('Current query before:', searchQuery);
        
        if (key === 'CLEAR') {
            // Backspace
            searchQuery = searchQuery.slice(0, -1);
            console.log('Deleted character, new query:', searchQuery);
        } else {
            // Add character
            searchQuery += key;
            console.log('Added character, new query:', searchQuery);
        }
        
        updateSearchDisplay();
        performSearch();
    } else if (currentMode === 'movies') {
        // Open selected movie detail
        const movie = currentMovieResults[movieResultIndex];
        if (movie) {
            console.log('Opening movie from Enter key:', movie.metadata.title);
            openMovieDetail(movie);
        }
    } else if (currentMode === 'tvshows') {
        // Open selected TV show detail
        const show = currentTVResults[tvResultIndex];
        if (show) {
            console.log('Opening TV show from Enter key:', show.title);
            openTVShowDetail(show);
        }
    }
}

function handleBack() {
    if (searchQuery.length > 0) {
        // Backspace
        searchQuery = searchQuery.slice(0, -1);
        console.log('Backspace, new query:', searchQuery);
        updateSearchDisplay();
        performSearch();
    } else {
        // Go back to main page
        console.log('Going back to main page');
        window.location.href = 'index.html';
    }
}

function updateKeyboardFocus() {
    keyButtons.forEach((btn, i) => {
        btn.classList.toggle('focused', i === keyboardIndex && currentMode === 'keyboard');
    });
    console.log('Keyboard focus updated, index:', keyboardIndex, 'mode:', currentMode);
}

function updateResultsFocus() {
    // Update movie results focus
    movieResultCards.forEach((card, i) => {
        card.classList.toggle('focused', i === movieResultIndex && currentMode === 'movies');
    });
    
    // Update TV results focus
    tvResultCards.forEach((card, i) => {
        card.classList.toggle('focused', i === tvResultIndex && currentMode === 'tvshows');
    });
    
    console.log('Results focus updated, movieIndex:', movieResultIndex, 'tvIndex:', tvResultIndex, 'mode:', currentMode);
}

function updateNavFocus() {
    const sideNav = document.querySelector('.side-nav');
    
    // Expand nav when in nav mode, collapse otherwise
    if (currentMode === 'nav') {
        sideNav.classList.add('expanded');
    } else {
        sideNav.classList.remove('expanded');
    }
    
    navItems.forEach((item, i) => {
        item.classList.toggle('focused', i === navIndex && currentMode === 'nav');
    });
    console.log('Nav focus updated, index:', navIndex, 'mode:', currentMode);
}

function scrollResultIntoView(carouselType) {
    const isMovies = carouselType === 'movies';
    const currentIndex = isMovies ? movieResultIndex : tvResultIndex;
    const cards = isMovies ? movieResultCards : tvResultCards;
    const currentCard = cards[currentIndex];
    
    if (currentCard) {
        const carouselId = isMovies ? 'moviesCarousel' : 'tvShowsCarousel';
        const gridId = isMovies ? 'moviesGrid' : 'tvShowsGrid';
        const scrollContainer = document.getElementById(carouselId);
        const grid = document.getElementById(gridId);
        
        if (scrollContainer && grid) {
            if (currentIndex === 0) {
                // First card - scroll to start
                scrollContainer.scrollLeft = 0;
            } else {
                // Card 2+ - scroll to show quarter of previous card
                const cardWidth = currentCard.offsetWidth;
                const gap = window.innerHeight * 0.0222; // 2.22vh
                const peekAmount = (cardWidth / 4) + gap;
                // Use offsetLeft relative to the grid, not the scroll container
                const cardOffsetInGrid = currentCard.offsetLeft - grid.offsetLeft;
                scrollContainer.scrollLeft = cardOffsetInGrid - peekAmount;
            }
        }
    }
}

function updateSearchDisplay() {
    const display = document.getElementById('searchQuery');
    display.textContent = searchQuery || ' '; // Space to keep height
    console.log('Search display updated:', searchQuery);
}

function performSearch() {
    console.log('Performing search for:', searchQuery);
    
    const moviesTitle = document.querySelector('#moviesSection .results-title');
    const tvTitle = document.querySelector('#tvShowsSection .results-title');
    
    if (!searchQuery || searchQuery.length < 1) {
        clearResults();
        return;
    }
    
    // Perform movie search
    if (typeof search === 'function') {
        const movieResults = search(searchQuery);
        currentMovieResults = movieResults;
        console.log('Movie search found', movieResults.length, 'results');
        displayMovieResults(movieResults);
    }
    
    // Perform TV show search
    if (typeof searchTVShows === 'function') {
        const tvResults = searchTVShows(searchQuery);
        currentTVResults = tvResults;
        console.log('TV show search found', tvResults.length, 'results');
        displayTVResults(tvResults);
    }
}

function clearResults() {
    currentMovieResults = [];
    currentTVResults = [];
    
    const moviesGrid = document.getElementById('moviesGrid');
    if (moviesGrid) {
        moviesGrid.innerHTML = '';
    }
    
    const tvGrid = document.getElementById('tvShowsGrid');
    if (tvGrid) {
        tvGrid.innerHTML = '';
    }
    
    // Hide titles
    const moviesTitle = document.querySelector('#moviesSection .results-title');
    const tvTitle = document.querySelector('#tvShowsSection .results-title');
    if (moviesTitle) moviesTitle.classList.remove('visible');
    if (tvTitle) tvTitle.classList.remove('visible');
    
    movieResultCards = [];
    tvResultCards = [];
}

function displayMovieResults(movies) {
    const moviesGrid = document.getElementById('moviesGrid');
    const moviesTitle = document.querySelector('#moviesSection .results-title');
    if (!moviesGrid) return;
    
    // Clear existing
    moviesGrid.innerHTML = '';
    movieResultCards = [];
    
    // Show/hide title based on results
    if (moviesTitle) {
        moviesTitle.classList.toggle('visible', movies.length > 0);
    }
    
    // Create movie cards
    movies.forEach((movie, index) => {
        const card = createMovieCard(movie, index);
        moviesGrid.appendChild(card);
        movieResultCards.push(card);
    });
    
    console.log('Rendered', movies.length, 'movie cards');
}

function displayTVResults(shows) {
    const tvGrid = document.getElementById('tvShowsGrid');
    const tvTitle = document.querySelector('#tvShowsSection .results-title');
    if (!tvGrid) return;
    
    // Clear existing
    tvGrid.innerHTML = '';
    tvResultCards = [];
    
    // Show/hide title based on results
    if (tvTitle) {
        tvTitle.classList.toggle('visible', shows.length > 0);
    }
    
    // Create TV show cards
    shows.forEach((show, index) => {
        const card = createTVShowCard(show, index);
        tvGrid.appendChild(card);
        tvResultCards.push(card);
    });
    
    console.log('Rendered', shows.length, 'TV show cards');
}

function createMovieCard(movie, index) {
    const card = document.createElement('div');
    card.className = 'cast-card'; // Use cast-card class!
    card.dataset.index = index;
    card.dataset.type = 'movie';
    
    // Add click handler to open detail page
    card.onclick = () => {
        openMovieDetail(movie);
    };
    
    const metadata = movie.metadata;
    const watchStatus = movie.watchStatus || { watched: false, percentage: 0 };
    
    // Image container with cast-card structure
    const imageContainer = document.createElement('div');
    imageContainer.className = 'cast-card-image-container';
    
    const outerStroke = document.createElement('div');
    outerStroke.className = 'cast-card-outer-stroke';
    
    const innerStroke = document.createElement('div');
    innerStroke.className = 'cast-card-inner-stroke';
    
    const img = document.createElement('img');
    img.className = 'cast-card-image';
    img.src = movie.posterPath 
        ? `file://${movie.posterPath}` 
        : 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>';
    img.alt = metadata.title;
    img.onerror = () => {
        img.className = 'cast-card-image cast-card-placeholder';
    };
    
    innerStroke.appendChild(img);
    outerStroke.appendChild(innerStroke);
    imageContainer.appendChild(outerStroke);
    
    // Watched badge (only show if fully watched) - add to imageContainer
    if (watchStatus.watched) {
        const badge = document.createElement('div');
        badge.className = 'watched-badge';
        const icon = document.createElement('img');
        icon.src = 'assets/icons/watched.svg';
        icon.alt = 'Watched';
        badge.appendChild(icon);
        imageContainer.appendChild(badge);
    }
    
    // Progress bar (show if 10+ min watched AND 10+ min remaining) - add to imageContainer
    const timeRemaining = watchStatus.duration - watchStatus.position;
    if (watchStatus.position >= 600 && timeRemaining > 600) {
        const progressBar = document.createElement('div');
        progressBar.className = 'progress-bar';
        const progressFill = document.createElement('div');
        progressFill.className = 'progress-bar-fill';
        progressFill.style.width = `${Math.min(watchStatus.percentage, 100)}%`;
        progressBar.appendChild(progressFill);
        imageContainer.appendChild(progressBar);
    }
    
    card.appendChild(imageContainer);
    
    // Info (using cast-card-info structure)
    const info = document.createElement('div');
    info.className = 'cast-card-info';
    
    const title = document.createElement('div');
    title.className = 'cast-card-name'; // Reuse cast-card-name for title
    title.textContent = metadata.title;
    info.appendChild(title);
    
    const year = document.createElement('div');
    year.className = 'cast-card-role'; // Reuse cast-card-role for year
    year.textContent = metadata.year || '';
    info.appendChild(year);
    
    card.appendChild(info);
    
    return card;
}

function createTVShowCard(show, index) {
    const card = document.createElement('div');
    card.className = 'cast-card';
    card.dataset.index = index;
    card.dataset.type = 'tvshow';
    
    // Add click handler to open detail page
    card.onclick = () => {
        openTVShowDetail(show);
    };
    
    // Image container with cast-card structure
    const imageContainer = document.createElement('div');
    imageContainer.className = 'cast-card-image-container';
    
    const outerStroke = document.createElement('div');
    outerStroke.className = 'cast-card-outer-stroke';
    
    const innerStroke = document.createElement('div');
    innerStroke.className = 'cast-card-inner-stroke';
    
    const img = document.createElement('img');
    img.className = 'cast-card-image';
    img.src = show.posterPath 
        ? `file://${show.posterPath}` 
        : 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>';
    img.alt = show.title;
    img.onerror = () => {
        img.className = 'cast-card-image cast-card-placeholder';
    };
    
    innerStroke.appendChild(img);
    outerStroke.appendChild(innerStroke);
    imageContainer.appendChild(outerStroke);
    
    card.appendChild(imageContainer);
    
    // Info
    const info = document.createElement('div');
    info.className = 'cast-card-info';
    
    const title = document.createElement('div');
    title.className = 'cast-card-name';
    title.textContent = show.title;
    info.appendChild(title);
    
    const year = document.createElement('div');
    year.className = 'cast-card-role';
    year.textContent = show.year || '';
    info.appendChild(year);
    
    card.appendChild(info);
    
    return card;
}

function openMovieDetail(movie) {
    console.log('========================================');
    console.log('SEARCH: Opening movie detail for:', movie.metadata.title);
    console.log('========================================');
    
    // Save current search state
    const searchState = {
        query: searchQuery,
        movieResultIndex: movieResultIndex,
        tvResultIndex: tvResultIndex,
        keyboardIndex: keyboardIndex,
        currentMode: currentMode,
        movieScrollPosition: document.getElementById('moviesCarousel')?.scrollLeft || 0,
        tvScrollPosition: document.getElementById('tvShowsCarousel')?.scrollLeft || 0
    };
    console.log('SEARCH: Saving search state:', searchState);
    localStorage.setItem('searchState', JSON.stringify(searchState));
    
    // Save movie to open and navigate to index
    console.log('SEARCH: Saving movie to localStorage:', {
        title: movie.metadata.title,
        videoPath: movie.videoPath
    });
    localStorage.setItem('openMovieDetail', JSON.stringify(movie));
    
    console.log('SEARCH: Navigating to index.html');
    window.location.href = 'index.html';
}

function openTVShowDetail(show) {
    console.log('========================================');
    console.log('SEARCH: Opening TV show detail for:', show.title);
    console.log('========================================');
    
    // Save current search state
    const searchState = {
        query: searchQuery,
        movieResultIndex: movieResultIndex,
        tvResultIndex: tvResultIndex,
        keyboardIndex: keyboardIndex,
        currentMode: currentMode,
        movieScrollPosition: document.getElementById('moviesCarousel')?.scrollLeft || 0,
        tvScrollPosition: document.getElementById('tvShowsCarousel')?.scrollLeft || 0
    };
    console.log('SEARCH: Saving search state:', searchState);
    localStorage.setItem('searchState', JSON.stringify(searchState));
    
    // Save TV show to open and navigate to index
    console.log('SEARCH: Saving TV show to localStorage:', {
        title: show.title,
        showPath: show.showPath
    });
    localStorage.setItem('openTVShowDetail', JSON.stringify(show));
    localStorage.setItem('lastLibrary', 'tv');
    
    console.log('SEARCH: Navigating to index.html');
    window.location.href = 'index.html';
}

// Update clock in top bar
function updateClock() {
    const now = new Date();
    const hours = now.getHours().toString().padStart(2, '0');
    const minutes = now.getMinutes().toString().padStart(2, '0');
    const timeElement = document.getElementById('topBarTime');
    if (timeElement) {
        timeElement.textContent = `${hours}:${minutes}`;
    }
}

// Restore search state when returning from detail page
function restoreSearchState() {
    console.log('========================================');
    console.log('SEARCH: Attempting to restore search state');
    console.log('========================================');
    
    const savedState = localStorage.getItem('searchState');
    const cameFromDetail = localStorage.getItem('cameFromDetail');
    
    console.log('SEARCH: localStorage searchState:', savedState ? 'FOUND' : 'NOT FOUND');
    console.log('SEARCH: cameFromDetail flag:', cameFromDetail ? 'YES' : 'NO');
    
    // Only restore if we came from detail page
    if (savedState && cameFromDetail) {
        try {
            const state = JSON.parse(savedState);
            console.log('SEARCH: Parsed state:', state);
            
            // Hide results column until we're done restoring
            const resultsColumn = document.querySelector('.search-results-column');
            if (resultsColumn) {
                resultsColumn.style.visibility = 'hidden';
            }
            
            // Restore search query
            searchQuery = state.query || '';
            console.log('SEARCH: Restored query:', searchQuery);
            updateSearchDisplay();
            
            // Perform search to restore results
            if (searchQuery) {
                console.log('SEARCH: Performing search for:', searchQuery);
                performSearch();
                
                // Restore focus position after results are rendered
                setTimeout(() => {
                    console.log('SEARCH: Restoring focus and scroll');
                    
                    // Restore the mode and indices
                    currentMode = state.currentMode || 'keyboard';
                    
                    if (state.movieResultIndex !== undefined) {
                        movieResultIndex = Math.min(state.movieResultIndex, movieResultCards.length - 1);
                    }
                    if (state.tvResultIndex !== undefined) {
                        tvResultIndex = Math.min(state.tvResultIndex, tvResultCards.length - 1);
                    }
                    if (state.keyboardIndex !== undefined) {
                        keyboardIndex = state.keyboardIndex;
                    }
                    
                    console.log('SEARCH: Restored mode:', currentMode, 'movieIndex:', movieResultIndex, 'tvIndex:', tvResultIndex);
                    
                    updateKeyboardFocus();
                    updateResultsFocus();
                    
                    // Restore scroll positions with instant scroll (no animation)
                    const moviesCarousel = document.getElementById('moviesCarousel');
                    const tvCarousel = document.getElementById('tvShowsCarousel');
                    
                    if (moviesCarousel && state.movieScrollPosition !== undefined) {
                        // Disable smooth scrolling for instant positioning
                        moviesCarousel.style.scrollBehavior = 'auto';
                        moviesCarousel.scrollLeft = state.movieScrollPosition;
                        // Re-enable smooth scrolling after positioning
                        setTimeout(() => {
                            moviesCarousel.style.scrollBehavior = '';
                        }, 50);
                        console.log('SEARCH: Restored movie scroll position:', state.movieScrollPosition);
                    }
                    
                    if (tvCarousel && state.tvScrollPosition !== undefined) {
                        // Disable smooth scrolling for instant positioning
                        tvCarousel.style.scrollBehavior = 'auto';
                        tvCarousel.scrollLeft = state.tvScrollPosition;
                        // Re-enable smooth scrolling after positioning
                        setTimeout(() => {
                            tvCarousel.style.scrollBehavior = '';
                        }, 50);
                        console.log('SEARCH: Restored TV scroll position:', state.tvScrollPosition);
                    }
                    
                    // Show results column now that everything is positioned
                    if (resultsColumn) {
                        resultsColumn.style.visibility = '';
                    }
                    
                    // Clear flags AFTER restoration is complete
                    localStorage.removeItem('searchState');
                    localStorage.removeItem('cameFromDetail');
                    console.log('SEARCH: Cleared searchState and cameFromDetail from localStorage');
                }, 50);
            } else {
                // No query, just clear the state and show results
                if (resultsColumn) {
                    resultsColumn.style.visibility = '';
                }
                localStorage.removeItem('searchState');
                localStorage.removeItem('cameFromDetail');
            }
        } catch (err) {
            console.error('SEARCH: Error restoring search state:', err);
            const resultsColumn = document.querySelector('.search-results-column');
            if (resultsColumn) {
                resultsColumn.style.visibility = '';
            }
            localStorage.removeItem('searchState');
            localStorage.removeItem('cameFromDetail');
        }
    } else {
        // Not coming from detail, clear any old state
        console.log('SEARCH: Not from detail, clearing any old state');
        localStorage.removeItem('searchState');
        localStorage.removeItem('cameFromDetail');
    }
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}

async function init() {
    console.log('Search page initializing...');
    
    // Load saved accent color
    loadAccentColor();
    
    await loadConfig();
    
    // Load movies from cache (already scanned from index page)
    const cachedMovies = localStorage.getItem('allMoviesCache');
    if (cachedMovies) {
        allMovies = JSON.parse(cachedMovies);
        console.log('Loaded', allMovies.length, 'movies from cache for search');
        
        // Initialize search with loaded movies
        if (typeof initializeSearch === 'function') {
            initializeSearch(allMovies);
        } else {
            console.error('initializeSearch function not found - Fuse.js may not be loaded');
        }
    } else {
        console.warn('No cached movies found - movie search may not work properly');
    }
    
    // Load TV shows from cache
    const cachedShows = localStorage.getItem('allShowsCache');
    if (cachedShows) {
        allShows = JSON.parse(cachedShows);
        console.log('Loaded', allShows.length, 'TV shows from cache for search');
        
        // Initialize TV search
        if (typeof initializeTVSearch === 'function') {
            initializeTVSearch(allShows);
        } else {
            console.error('initializeTVSearch function not found');
        }
    } else {
        console.warn('No cached TV shows found - TV search may not work properly');
    }
    
    // Initialize keyboard
    keyButtons = Array.from(document.querySelectorAll('.key-btn'));
    updateKeyboardFocus();
    
    // Initialize nav items
    navItems = Array.from(document.querySelectorAll('.nav-item'));
    
    // Set up keyboard handlers
    setupKeyboardListeners();
    
    // Set up nav item handlers
    setupNavHandlers();
    
    // Start clock
    updateClock();
    setInterval(updateClock, 1000);
    
    // Restore search state if returning from detail
    restoreSearchState();
    
    console.log('Search initialized - ready to use');
}

function setupNavHandlers() {
    const navItems = document.querySelectorAll('.nav-item');
    navItems.forEach(item => {
        item.addEventListener('click', () => {
            const page = item.dataset.page;
            handleNavClick(page);
        });
    });
}

function handleNavClick(page) {
    console.log('Nav clicked:', page);
    
    // Clear search state when navigating away from search
    localStorage.removeItem('searchState');
    
    switch(page) {
        case 'search':
            // Already on search, do nothing
            break;
        case 'home':
            // Navigate to index.html and show home screen
            localStorage.setItem('navigateTo', 'home');
            window.location.href = 'index.html';
            break;
        case 'movies':
            // Navigate to index.html and show movies grid
            localStorage.setItem('navigateTo', 'movies');
            localStorage.setItem('lastLibrary', 'movies');
            window.location.href = 'index.html';
            break;
        case 'tv':
            // Navigate to index.html and show TV grid
            localStorage.setItem('navigateTo', 'tv');
            localStorage.setItem('lastLibrary', 'tv');
            window.location.href = 'index.html';
            break;
        case 'playlists':
            // Navigate to index.html and show playlists
            localStorage.setItem('navigateTo', 'playlists');
            window.location.href = 'index.html';
            break;
        case 'settings':
            // Navigate to settings page
            window.location.href = 'settings.html';
            break;
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
