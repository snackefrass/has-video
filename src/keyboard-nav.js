/**
 * Keyboard Navigation for TV Remote Control
 */

class KeyboardNavigation {
    constructor() {
        this.currentIndex = 0;
        this.items = [];
        this.enabled = true;
        this.mode = 'grid'; // 'grid', 'detail', 'alphabet', or 'nav'
        this.alphabetIndex = 0;
        this.alphabetItems = [];
        this.savedGridIndex = 0;
        this.navIndex = 0;
        this.navItems = [];
        this.detailSection = 'main'; // 'main' or 'cast' - which detail section is visible
        this.detailSubMode = 'buttons'; // 'buttons', 'cast-cards', or 'info-buttons'
        this.justReturnedFromDetail = false; // Flag to prevent immediate back-to-home
        
        // History stack for detail page navigation
        this.detailHistory = []; // Stack of {movie, section, cardIndex, scrollPosition}
        this.currentMovie = null; // Currently displayed movie
        
        // Carousel position memory: Map of carousel container -> card index
        this.carouselPositions = new Map();
        
        this.setupKeyboardListeners();
    }

    setupKeyboardListeners() {
        document.addEventListener('keydown', (e) => {
            if (!this.enabled) return;
            
            // Check if settings modal is active
            const settingsModal = document.getElementById('settingsModal');
            if (settingsModal && settingsModal.classList.contains('active')) {
                this.handleSettingsKeydown(e);
                return;
            }
            
            // Check if home screen is active - let it handle its own keys
            if (window.isHomeActive && window.isHomeActive()) {
                if (window.handleHomeKeydown && window.handleHomeKeydown(e)) {
                    e.preventDefault();
                    return;
                }
            }
            
            // Prevent default browser behavior for arrow keys
            if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', 'Escape'].includes(e.key)) {
                e.preventDefault();
            }

            switch(e.key) {
                case 'ArrowUp':
                    // Check if context menu is active
                    if (window.contextMenu && window.contextMenu.isActive()) {
                        window.contextMenu.handleArrowUp();
                        break;
                    }
                    
                    if (this.mode === 'alphabet') {
                        this.moveAlphabetUp();
                    } else if (this.mode === 'nav') {
                        this.moveNavUp();
                    } else if (this.mode === 'detail') {
                        // In detail mode, up switches back to main section
                        this.handleDetailArrowUp();
                    } else {
                        this.moveUp();
                    }
                    break;
                case 'ArrowDown':
                    // Check if context menu is active
                    if (window.contextMenu && window.contextMenu.isActive()) {
                        window.contextMenu.handleArrowDown();
                        break;
                    }
                    
                    if (this.mode === 'alphabet') {
                        this.moveAlphabetDown();
                    } else if (this.mode === 'nav') {
                        this.moveNavDown();
                    } else if (this.mode === 'detail') {
                        // In detail mode, down switches to cast section or navigates within
                        this.handleDetailArrowDown();
                    } else {
                        this.moveDown();
                    }
                    break;
                case 'ArrowLeft':
                    if (this.mode === 'alphabet') {
                        // Leave alphabet mode, go back to grid
                        this.exitAlphabetMode();
                    } else if (this.mode === 'nav') {
                        // Already in nav, do nothing
                    } else if (this.mode === 'grid') {
                        // Check if at leftmost column, then enter nav mode
                        this.tryEnterNavMode();
                    } else if (this.mode === 'detail') {
                        this.handleDetailArrowLeft();
                    } else {
                        this.moveLeft();
                    }
                    break;
                case 'ArrowRight':
                    if (this.mode === 'nav') {
                        // Leave nav mode, go to grid
                        this.exitNavMode();
                    } else if (this.mode === 'grid') {
                        // Check if at rightmost column, then enter alphabet mode
                        this.tryEnterAlphabetMode();
                    } else if (this.mode === 'detail') {
                        this.handleDetailArrowRight();
                    }
                    break;
                case 'Enter':
                    // Check if context menu is active
                    if (window.contextMenu && window.contextMenu.isActive()) {
                        window.contextMenu.handleEnter();
                        break;
                    }
                    
                    // Check if in multi-select mode
                    if (window.multiSelectMode && this.mode === 'grid') {
                        const focusedCard = this.items[this.currentIndex];
                        if (focusedCard && window.toggleMultiSelectItem) {
                            window.toggleMultiSelectItem(focusedCard);
                        }
                        break;
                    }
                    
                    if (this.mode === 'alphabet') {
                        this.selectAlphabetLetter();
                    } else if (this.mode === 'nav') {
                        this.selectNavItem();
                    } else {
                        this.select();
                    }
                    break;
                case 'Escape':
                case 'Backspace':
                    // Check if context menu is active
                    if (window.contextMenu && window.contextMenu.isActive()) {
                        window.contextMenu.handleBack();
                        break;
                    }
                    
                    // Check if in multi-select mode
                    if (window.multiSelectMode && this.mode === 'grid') {
                        if (window.exitMultiSelectMode) {
                            window.exitMultiSelectMode();
                        }
                        break;
                    }
                    
                    if (this.mode === 'alphabet') {
                        this.exitAlphabetMode();
                    } else if (this.mode === 'nav') {
                        this.exitNavMode();
                    } else {
                        this.back();
                    }
                    break;
                case 'o':
                case 'O':
                    // Check if context menu is active - close it
                    if (window.contextMenu && window.contextMenu.isActive()) {
                        window.contextMenu.handleBack();
                        break;
                    }
                    
                    // Check if in multi-select mode - show multi-select context menu
                    if (window.multiSelectMode && this.mode === 'grid') {
                        if (window.showMultiSelectContextMenu) {
                            window.showMultiSelectContextMenu();
                        }
                        break;
                    }
                    
                    // Open context menu for focused item
                    this.openContextMenu();
                    break;
                case 's':
                case 'S':
                    // Focus search
                    document.getElementById('searchInput').focus();
                    break;
                case 'h':
                case 'H':
                    // Go home (clear search)
                    this.goHome();
                    break;
                case 'f':
                case 'F':
                    // Toggle fullscreen
                    this.toggleFullscreen();
                    break;
            }
        });

        // Disable navigation when typing in input fields
        document.addEventListener('focusin', (e) => {
            if (e.target.tagName === 'INPUT') {
                this.enabled = false;
            }
        });

        document.addEventListener('focusout', (e) => {
            if (e.target.tagName === 'INPUT') {
                this.enabled = true;
            }
        });
    }

    updateItems(selector = '.movie-card') {
        console.log('updateItems called with selector:', selector);
        this.items = Array.from(document.querySelectorAll(selector));
        console.log('Found items:', this.items.length);
        
        // Don't reset currentIndex - it may have been set intentionally (e.g., returning from detail)
        // Just ensure it's within bounds
        if (this.currentIndex >= this.items.length) {
            this.currentIndex = Math.max(0, this.items.length - 1);
        }
    }

    getColumnsCount() {
        if (this.items.length === 0) return 0;
        
        const firstItem = this.items[0];
        const container = firstItem.parentElement;
        const containerWidth = container.offsetWidth;
        const itemWidth = firstItem.offsetWidth;
        const gap = parseInt(getComputedStyle(container).gap) || 20;
        
        return Math.floor(containerWidth / (itemWidth + gap));
    }

    moveUp() {
        const columns = this.getColumnsCount();
        const currentRow = Math.floor(this.currentIndex / columns);
        const currentCol = this.currentIndex % columns;
        
        if (currentRow > 0) {
            // Go to same column in previous row
            this.currentIndex = (currentRow - 1) * columns + currentCol;
            this.focusItem();
        }
    }

    moveDown() {
        const columns = this.getColumnsCount();
        const currentRow = Math.floor(this.currentIndex / columns);
        const currentCol = this.currentIndex % columns;
        const totalRows = Math.ceil(this.items.length / columns);
        
        if (currentRow < totalRows - 1) {
            // Try same column in next row
            let targetIndex = (currentRow + 1) * columns + currentCol;
            // If that doesn't exist, go to last item in next row
            if (targetIndex >= this.items.length) {
                targetIndex = this.items.length - 1;
            }
            this.currentIndex = targetIndex;
            this.focusItem();
        }
    }

    moveLeft() {
        if (this.currentIndex > 0) {
            this.currentIndex--;
            this.focusItem();
        }
    }

    moveRight() {
        if (this.currentIndex < this.items.length - 1) {
            this.currentIndex++;
            this.focusItem();
        }
    }

    focusItem() {
        // Remove focus from all items
        this.items.forEach(item => item.classList.remove('focused'));
        
        console.log('focusItem called - currentIndex:', this.currentIndex, 'items.length:', this.items.length);
        
        // Add focus to current item
        if (this.items[this.currentIndex]) {
            const item = this.items[this.currentIndex];
            item.classList.add('focused');
            
            // Track last episode index when focusing episodes
            if (this.mode === 'detail' && this.detailSubMode === 'episodes') {
                this.lastEpisodeIndex = this.currentIndex;
            }
            
            console.log('Focusing item at index', this.currentIndex, 'scrolling into view');
            
            // Only scroll into view for grid mode, not detail mode
            if (this.mode !== 'detail') {
                item.scrollIntoView({
                    behavior: 'auto',
                    block: 'center',
                    inline: 'nearest'
                });
            }
        } else {
            console.log('No item at index', this.currentIndex);
        }
    }

    select() {
        if (this.items[this.currentIndex]) {
            // Check if we're selecting a season tab
            if (this.mode === 'detail' && this.detailSubMode === 'season-tabs') {
                const tab = this.items[this.currentIndex];
                // Trigger the onclick that's already on the tab
                tab.click();
                return;
            }
            
            // Check if we're selecting an episode thumbnail in season detail
            if (this.mode === 'detail' && this.detailSubMode === 'episodes') {
                const card = this.items[this.currentIndex];
                const videoPath = card.dataset.videoPath;
                
                // Unescape HTML entities before parsing
                const episodeDataString = card.dataset.episodeData
                    .replace(/&quot;/g, '"')
                    .replace(/&#39;/g, "'");
                const episodeData = JSON.parse(episodeDataString);
                
                if (videoPath && episodeData && window.currentShow && window.currentSeason) {
                    const watchStatus = watchDataManager.getWatchStatus(videoPath);
                    const startPosition = watchStatus ? watchStatus.position : 0;
                    const seasonEp = `S${window.currentSeason.number.toString().padStart(2, '0')} E${episodeData.episode.toString().padStart(2, '0')}`;
                    
                    window.playTVEpisode(videoPath, startPosition, window.currentShow.title, seasonEp, episodeData.title);
                }
                return;
            }
            
            // Check if we're selecting a carousel movie card (collection, tag, or recommendation)
            if (this.mode === 'detail' && 
                (this.detailSubMode === 'collection-cards' || 
                 this.detailSubMode === 'recommendation-cards' ||
                 this.detailSubMode === 'carousel-cards')) {
                // Get the movie data from the card
                const card = this.items[this.currentIndex];
                const movieTitle = card.querySelector('.recommendation-card-title')?.textContent;
                
                if (movieTitle) {
                    // Find the movie in the global movies array
                    const movie = window.allMovies?.find(m => m.metadata.title === movieTitle);
                    if (movie) {
                        this.openDetailFromCarousel(movie);
                        return;
                    }
                }
            }
            
            // Default behavior - click the element
            this.items[this.currentIndex].click();
        }
    }

    back() {
        // Check if detail page is open
        const detailPage = document.getElementById('detailPage');
        const settingsModal = document.getElementById('settingsModal');
        
        if (detailPage && detailPage.style.display !== 'none') {
            // Check if we're on season detail page
            const seasonDetail = document.querySelector('.season-detail-wrapper');
            if (seasonDetail && window.currentShow && window.currentSeason) {
                // Check if we came directly from home screen
                if (window.cameToSeasonFromHome) {
                    console.log('Returning from season detail to home screen');
                    window.cameToSeasonFromHome = false;
                    
                    // Also clear the localStorage flag
                    localStorage.removeItem('cameFromHome');
                    
                    // Clear episode position tracking
                    this.lastEpisodeIndex = undefined;
                    this.savedEpisodeIndex = undefined;
                    this.savedDetailReturnIndex = undefined; // Clear so next detail open saves new position
                    window.currentShow = null;
                    window.currentSeason = null;
                    
                    // Hide the detail page first
                    detailPage.style.display = 'none';
                    
                    // Return to home screen with restored state
                    if (window.showHomeScreen) {
                        window.showHomeScreen(true); // restore state
                    }
                    return;
                }
                
                // Return to show detail page with saved season position
                console.log('Returning from season detail to show detail');
                const savedSeasonIndex = this.savedSeasonIndex || 0;
                
                // Clear episode position tracking
                this.lastEpisodeIndex = undefined;
                this.savedEpisodeIndex = undefined;
                
                // Re-open the show detail using the global function
                if (window.openTVShowDetail) {
                    window.openTVShowDetail(window.currentShow);
                    
                    // Use requestAnimationFrame for immediate positioning after render
                    requestAnimationFrame(() => {
                        this.enterTVDetailMode();
                        
                        // Switch to seasons carousel with skipFocus
                        this.detailSubMode = 'buttons';
                        this.switchToTVSeasons(true); // Skip default focus behavior
                        
                        // Restore saved season position
                        this.currentIndex = savedSeasonIndex;
                        this.focusItem();
                        
                        // Disable smooth scrolling for instant positioning
                        const carousel = document.querySelector('.tv-seasons-scroll');
                        if (carousel) {
                            carousel.style.scrollBehavior = 'auto';
                            this.scrollCarouselCardIntoView();
                            
                            // Re-enable smooth scrolling after positioning
                            setTimeout(() => {
                                carousel.style.scrollBehavior = '';
                            }, 50);
                        }
                    });
                }
                return;
            }
            
            // Check if we have history to go back to
            if (this.detailHistory.length > 0) {
                this.goBackInDetailHistory();
            } else {
                // No history - close detail and go to grid
                closeDetail();
                this.detailHistory = []; // Clear history
                this.currentMovie = null;
                this.savedSeasonIndex = undefined; // Clear saved season position
            }
        } else if (settingsModal && settingsModal.classList.contains('active')) {
            closeSettings();
        } else {
            // On movie/TV grid
            if (this.mode === 'grid' && this.items.length > 0) {
                // If we just returned from detail, don't go home on first back press
                // Instead, require a second back press from index 0
                if (this.justReturnedFromDetail) {
                    // First back after returning from detail - just scroll to top if needed
                    this.justReturnedFromDetail = false;
                    if (this.currentIndex !== 0) {
                        this.currentIndex = 0;
                        this.focusItem();
                        const contentArea = document.getElementById('contentArea');
                        if (contentArea) {
                            contentArea.scrollTop = 0;
                        }
                    }
                    // Don't go home yet
                } else if (this.currentIndex === 0) {
                    // Already at index 0 and not just returned from detail - go to home screen
                    if (window.showHomeScreen) {
                        window.showHomeScreen();
                    }
                } else {
                    // Not at index 0 - go to index 0
                    this.currentIndex = 0;
                    this.focusItem();
                    
                    // Scroll to top of grid
                    const contentArea = document.getElementById('contentArea');
                    if (contentArea) {
                        contentArea.scrollTop = 0;
                    }
                }
            } else {
                // Clear search if active (fallback)
                const searchInput = document.getElementById('searchInput');
                if (searchInput && searchInput.value) {
                    searchInput.value = '';
                    searchInput.dispatchEvent(new Event('input'));
                }
            }
        }
    }
    
    openDetailFromCarousel(movie) {
        console.log('openDetailFromCarousel called for:', movie.metadata.title);
        console.log('currentMovie is:', this.currentMovie ? this.currentMovie.metadata.title : 'null');
        
        // Save current state to history
        if (this.currentMovie) {
            const state = {
                movie: this.currentMovie,
                section: this.detailSection,
                selectedMovieTitle: movie.metadata.title, // Save which movie was selected to navigate away
                cardIndex: this.currentIndex,
                subMode: this.detailSubMode,
                // Save carousel container reference if in carousel mode
                carouselContainer: this.detailSection === 'carousel' ? 
                    this.items[this.currentIndex]?.closest('.detail-info-container') : null
            };
            this.detailHistory.push(state);
            console.log('Pushed to history:', state);
            console.log('History stack length:', this.detailHistory.length);
            console.log('Full history:', this.detailHistory.map(s => s.movie.metadata.title));
        } else {
            console.log('NOT pushing to history because currentMovie is null/undefined');
        }
        
        // Open new movie detail
        this.currentMovie = movie;
        openDetail(movie, true); // Pass true to indicate from carousel
        
        // enableDetailNavigation will be called by openDetail
    }
    
    goBackInDetailHistory() {
        if (this.detailHistory.length === 0) return;
        
        console.log('Going back - history length before pop:', this.detailHistory.length);
        
        const previousState = this.detailHistory.pop();
        console.log('Popped from history:', previousState);
        console.log('History length after pop:', this.detailHistory.length);
        console.log('Remaining history:', this.detailHistory.map(s => s.movie.metadata.title));
        
        // Set current movie
        this.currentMovie = previousState.movie;
        
        // Hide detail page temporarily during restoration
        const detailPage = document.getElementById('detailPage');
        if (detailPage) {
            detailPage.style.visibility = 'hidden';
        }
        
        // Open the previous movie's detail page (pass true to not clear history)
        openDetail(previousState.movie, true);
        
        // After detail page loads, restore the section and focus
        setTimeout(() => {
            this.restoreDetailState(previousState);
            // Show detail page after restoration
            if (detailPage) {
                detailPage.style.visibility = 'visible';
            }
        }, 100);
    }
    
    restoreDetailState(state) {
        console.log('Restoring state:', state);
        
        // Disable transition temporarily for instant positioning
        const track = document.querySelector('.detail-content-track');
        if (track) {
            track.style.transition = 'none';
        }
        
        // Disable scroll animation temporarily
        const castScroll = document.querySelector('.detail-cast-scroll-container');
        const allScrollContainers = document.querySelectorAll('[class*="-scroll-container"]');
        
        [castScroll, ...allScrollContainers].forEach(container => {
            if (container) {
                container.style.scrollBehavior = 'auto';
            }
        });
        
        // Navigate to the correct section (skip default focus behavior)
        switch(state.section) {
            case 'cast':
                this.switchToCastSection(true); // Pass true to skip focus
                break;
            case 'collection':
                this.switchToCollectionSection(true);
                break;
            case 'recommendations':
                this.switchToRecommendationsSection(true);
                break;
            case 'carousel':
                // Restore specific carousel container
                if (state.carouselContainer) {
                    // Find the matching container in the new page by class names
                    const isCollection = state.carouselContainer.classList.contains('detail-collection-container');
                    const isTag = state.carouselContainer.classList.contains('detail-tag-container');
                    const isRecommendations = state.carouselContainer.classList.contains('detail-recommendations-container');
                    
                    let targetContainer = null;
                    if (isCollection) {
                        targetContainer = document.querySelector('.detail-collection-container');
                    } else if (isRecommendations) {
                        targetContainer = document.querySelector('.detail-recommendations-container');
                    } else if (isTag) {
                        // For tags, we need to find which tag container by comparing the title
                        const savedTitle = state.carouselContainer.querySelector('.detail-section-title')?.textContent;
                        const tagContainers = document.querySelectorAll('.detail-tag-container');
                        for (const container of tagContainers) {
                            const title = container.querySelector('.detail-section-title')?.textContent;
                            if (title === savedTitle) {
                                targetContainer = container;
                                break;
                            }
                        }
                    }
                    
                    if (targetContainer) {
                        this.switchToCarousel(targetContainer);
                    }
                }
                break;
            default:
                // Stay on main
                break;
        }
        
        // Wait for items to be updated by the switch function, then restore focus
        setTimeout(() => {
            // Find the card index by looking for the movie title we selected
            let targetIndex = state.cardIndex || 0; // Use saved index as fallback
            if (state.selectedMovieTitle) {
                for (let i = 0; i < this.items.length; i++) {
                    const card = this.items[i];
                    const titleEl = card.querySelector('.recommendation-card-title, .cast-card-name');
                    if (titleEl && titleEl.textContent === state.selectedMovieTitle) {
                        targetIndex = i;
                        console.log('Found card for movie:', state.selectedMovieTitle, 'at index:', i);
                        break;
                    }
                }
                console.log('Final targetIndex:', targetIndex, 'out of', this.items.length, 'items');
            } else {
                console.log('Using saved cardIndex:', targetIndex);
            }
            
            this.currentIndex = targetIndex;
            this.focusItem();
            
            // Scroll the carousel to show the focused card (instant, no smooth scroll)
            if (state.section === 'cast') {
                this.scrollCastCardIntoView();
            } else if (state.section === 'collection') {
                this.scrollCollectionCardIntoView();
            } else if (state.section === 'recommendations') {
                this.scrollRecommendationCardIntoView();
            } else if (state.section === 'carousel') {
                this.scrollCarouselCardIntoView();
            }
            
            // Re-enable transitions and scroll behavior after restoration
            setTimeout(() => {
                if (track) {
                    track.style.transition = '';
                }
                allScrollContainers.forEach(container => {
                    if (container) {
                        container.style.scrollBehavior = '';
                    }
                });
            }, 50);
        }, 120); // Wait for switchTo* setTimeout (100ms) + small buffer
    }

    goHome() {
        const searchInput = document.getElementById('searchInput');
        searchInput.value = '';
        searchInput.dispatchEvent(new Event('input'));
        
        // Close any open modals
        const detailModal = document.getElementById('detailModal');
        const settingsModal = document.getElementById('settingsModal');
        if (detailModal) detailModal.classList.remove('active');
        if (settingsModal) settingsModal.classList.remove('active');
        
        // Reset to first item
        this.currentIndex = 0;
        this.updateItems();
    }

    toggleFullscreen() {
        if (!document.fullscreenElement) {
            document.documentElement.requestFullscreen();
        } else {
            if (document.exitFullscreen) {
                document.exitFullscreen();
            }
        }
    }

    // Update navigation when detail modal opens
    enableDetailNavigation() {
        this.mode = 'detail';
        this.detailSection = 'main'; // Reset to main section
        this.detailSubMode = 'buttons'; // Start with buttons
        
        // Clear carousel position memory for new detail page
        this.carouselPositions.clear();
        
        const track = document.querySelector('.detail-content-track');
        if (track) {
            // Set to main section (index 0) using dynamic transform
            track.style.transform = 'translateY(0vh)';
            console.log('Detail page opening - set to main section, translateY: 0vh');
        }
        
        // Update items to detail buttons - use correct class selector
        this.updateItems('.detail-button');
        this.currentIndex = 0;
        this.focusItem();
    }
    
    // Detail section navigation handlers
    handleDetailArrowDown() {
        console.log('handleDetailArrowDown - current section:', this.detailSection, 'subMode:', this.detailSubMode);
        
        if (this.detailSection === 'main' && this.detailSubMode === 'season-tabs') {
            // Season detail - switch from tabs to episodes
            console.log('Switching from season tabs to episodes');
            // Clear focus from tabs
            document.querySelectorAll('.season-tab').forEach(tab => tab.classList.remove('focused'));
            
            this.detailSubMode = 'episodes';
            this.updateItems('.season-episode-card');
            this.currentIndex = this.lastEpisodeIndex !== undefined ? this.lastEpisodeIndex : 0;
            this.focusItem();
            this.scrollCarouselCardIntoView();
            this.updateSeasonEpisodeInfo();
        } else if (this.detailSection === 'main' && this.detailSubMode === 'buttons') {
            // Check if we're on TV detail page (has seasons) or movie detail (has cast)
            const seasons = document.querySelectorAll('.tv-season-card');
            const castCards = document.querySelectorAll('.cast-card');
            
            if (seasons.length > 0) {
                // TV show - clear button focus and switch to seasons
                console.log('Switching from buttons to TV seasons');
                // Clear focus from buttons
                document.querySelectorAll('.detail-button').forEach(btn => btn.classList.remove('focused'));
                this.switchToTVSeasons();
            } else if (castCards.length > 0) {
                // Movie - switch to cast
                console.log('Switching from main to cast');
                this.switchToCastSection();
            }
        } else if (this.detailSection === 'main' && this.detailSubMode === 'episodes') {
            // Season detail - switch from episodes to buttons
            console.log('Switching from episodes to buttons');
            // Clear focus from episode cards
            document.querySelectorAll('.season-episode-card').forEach(card => card.classList.remove('focused'));
            this.detailSubMode = 'buttons';
            this.updateItems('.detail-button');
            this.currentIndex = 0;
            this.focusItem();
        } else if (this.detailSection === 'cast') {
            // Find the next available carousel (collection, tags, or recommendations)
            console.log('In cast section, finding next carousel');
            const nextCarousel = this.findNextCarousel('cast');
            console.log('Next carousel found:', nextCarousel);
            if (nextCarousel) {
                this.switchToCarousel(nextCarousel);
            }
        } else if (this.detailSection === 'carousel') {
            // Save current carousel position before switching
            this.saveCurrentCarouselPosition();
            
            // We're in a carousel, find the next one
            console.log('In carousel section, finding next carousel');
            const nextCarousel = this.findNextCarousel('carousel');
            console.log('Next carousel found:', nextCarousel);
            if (nextCarousel) {
                this.switchToCarousel(nextCarousel);
            }
        }
        console.log('handleDetailArrowDown complete');
        // If already at the last section, Down does nothing
    }
    
    handleDetailArrowUp() {
        if (this.detailSection === 'main' && this.detailSubMode === 'episodes') {
            // Season detail - switch from episodes to season tabs
            console.log('Switching from episodes to season tabs');
            // Clear focus from episode cards
            document.querySelectorAll('.season-episode-card').forEach(card => card.classList.remove('focused'));
            
            // Save episode position
            this.savedEpisodeIndex = this.currentIndex;
            
            this.detailSubMode = 'season-tabs';
            this.updateItems('.season-tab');
            // Focus the active tab
            const activeTabs = document.querySelectorAll('.season-tab-active');
            if (activeTabs.length > 0) {
                this.currentIndex = Array.from(this.items).indexOf(activeTabs[0]);
            } else {
                this.currentIndex = 0;
            }
            this.focusItem();
        } else if (this.detailSection === 'main' && this.detailSubMode === 'buttons') {
            // Check if we're on season detail (has episode cards) or show detail (no episode cards)
            const episodeCards = document.querySelectorAll('.season-episode-card');
            if (episodeCards.length > 0) {
                // Season detail - go back to episodes
                console.log('Going from buttons back to episodes');
                // Clear button focus
                document.querySelectorAll('.detail-button').forEach(btn => btn.classList.remove('focused'));
                
                this.detailSubMode = 'episodes';
                this.updateItems('.season-episode-card');
                this.currentIndex = this.lastEpisodeIndex !== undefined ? this.lastEpisodeIndex : 0;
                this.focusItem();
                this.scrollCarouselCardIntoView();
                this.updateSeasonEpisodeInfo();
            }
            // Otherwise do nothing (already at top on show detail)
        } else if (this.detailSection === 'cast') {
            // Switch back to main section
            this.switchToMainSection();
        } else if (this.detailSection === 'carousel') {
            // Check if we're on TV seasons or a regular carousel
            const seasons = document.querySelectorAll('.tv-season-card');
            
            if (seasons.length > 0) {
                // TV show - save season position and go back to buttons
                console.log('Going from TV seasons back to buttons');
                
                // Save current season position
                this.savedSeasonIndex = this.currentIndex;
                
                // Clear focus from all season cards
                seasons.forEach(card => card.classList.remove('focused'));
                
                this.detailSection = 'main';
                this.detailSubMode = 'buttons';
                this.updateItems('.detail-button');
                this.currentIndex = 0;
                this.focusItem();
            } else {
                // Save current carousel position before switching
                this.saveCurrentCarouselPosition();
                
                // Find the previous carousel or go back to cast
                const prevCarousel = this.findPreviousCarousel();
                if (prevCarousel) {
                    this.switchToCarousel(prevCarousel);
                } else {
                    // No previous carousel, go to cast
                    this.switchToCastSection();
                }
            }
        }
        // If already in main section, Up does nothing
    }
    
    findNextCarousel(fromSection) {
        // Get all carousel containers in order
        const carousels = [
            document.querySelector('.detail-collection-container'),
            ...document.querySelectorAll('.detail-tag-container'),
            document.querySelector('.detail-recommendations-container')
        ].filter(Boolean); // Remove null entries
        
        console.log('findNextCarousel - fromSection:', fromSection, 'total carousels:', carousels.length);
        
        if (fromSection === 'cast') {
            // Return first carousel
            console.log('Returning first carousel');
            return carousels.length > 0 ? carousels[0] : null;
        } else if (fromSection === 'carousel') {
            // Find current carousel by looking at which container has the focused item
            const focusedItem = this.items[this.currentIndex];
            let currentContainer = null;
            
            if (focusedItem) {
                // Find which carousel container this item belongs to
                currentContainer = focusedItem.closest('.detail-collection-container, .detail-tag-container, .detail-recommendations-container');
            }
            
            console.log('Current container:', currentContainer);
            const currentIndex = carousels.indexOf(currentContainer);
            console.log('Current carousel index:', currentIndex, 'of', carousels.length);
            
            if (currentIndex >= 0 && currentIndex < carousels.length - 1) {
                console.log('Returning next carousel at index:', currentIndex + 1);
                return carousels[currentIndex + 1];
            } else {
                console.log('No next carousel available');
            }
        }
        return null;
    }
    
    findPreviousCarousel() {
        // Get all carousel containers in order
        const carousels = [
            document.querySelector('.detail-collection-container'),
            ...document.querySelectorAll('.detail-tag-container'),
            document.querySelector('.detail-recommendations-container')
        ].filter(Boolean);
        
        // Find current carousel and return previous
        const currentContainer = this.items[0]?.closest('.detail-info-container');
        const currentIndex = carousels.indexOf(currentContainer);
        if (currentIndex > 0) {
            return carousels[currentIndex - 1];
        }
        return null;
    }
    
    switchToCarousel(container) {
        const track = document.querySelector('.detail-content-track');
        if (!track || !container) return;
        
        // Remove focused class from all items before switching
        this.items.forEach(item => item.classList.remove('focused'));
        
        // Calculate the position of this carousel in the track
        const allContainers = Array.from(track.querySelectorAll('.detail-info-container'));
        const containerIndex = allContainers.indexOf(container);
        
        if (containerIndex >= 0) {
            // Each container is 840px (77.78vh) tall with 192px (17.78vh) gap
            // Formula: -(containerHeight + gap) * containerIndex
            const translateY = -(77.78 + 17.78) * containerIndex;
            track.style.transform = `translateY(${translateY}vh)`;
            console.log(`Switching to carousel at index ${containerIndex}, translateY: ${translateY}vh`);
        }
        
        this.detailSection = 'carousel';
        this.detailSubMode = 'carousel-cards';
        
        // Update items to cards within this specific carousel
        setTimeout(() => {
            // Query cards within this specific container only
            const cards = container.querySelectorAll('.recommendation-card');
            this.items = Array.from(cards);
            
            console.log('Updated items from container, count:', this.items.length);
            
            // Check if we have a saved position for this carousel
            const savedIndex = this.carouselPositions.get(container);
            if (savedIndex !== undefined && savedIndex < this.items.length) {
                this.currentIndex = savedIndex;
                console.log('Restoring saved carousel position:', savedIndex);
            } else {
                this.currentIndex = 0;
                console.log('No saved position, focusing first item at index 0');
            }
            
            this.focusItem();
            this.scrollCarouselCardIntoView();
        }, 100);
    }
    
    saveCurrentCarouselPosition() {
        // Save the current index for the current carousel container
        if (this.detailSection === 'carousel' && this.items.length > 0) {
            const currentContainer = this.items[0].closest('.detail-info-container');
            if (currentContainer) {
                this.carouselPositions.set(currentContainer, this.currentIndex);
                console.log('Saved carousel position:', this.currentIndex, 'for container');
            }
        }
    }
    
    handleDetailArrowLeft() {
        if (this.detailSection === 'main' && this.detailSubMode === 'season-tabs') {
            // Season tabs - move left through tabs, or go to nav at first tab
            if (this.currentIndex === 0) {
                this.enterNavModeFromDetail();
            } else {
                this.moveLeft();
                this.scrollSeasonTabIntoView();
            }
        } else if (this.detailSection === 'main' && this.detailSubMode === 'buttons') {
            // Main section buttons
            if (this.currentIndex === 0) {
                this.enterNavModeFromDetail();
            } else {
                this.moveLeft();
            }
        } else if (this.detailSection === 'main' && this.detailSubMode === 'episodes') {
            // Season detail episodes - move left, scroll, and update info
            if (this.currentIndex > 0) {
                this.moveLeft();
                this.scrollCarouselCardIntoView();
                this.updateSeasonEpisodeInfo();
            } else {
                // At first episode - go to nav
                this.enterNavModeFromDetail();
            }
        } else if (this.detailSection === 'cast' && this.detailSubMode === 'cast-cards') {
            // Cast cards - move left and scroll
            this.moveCastCardLeft();
        } else if (this.detailSection === 'cast' && this.detailSubMode === 'info-buttons') {
            // More info buttons - just move left
            this.moveLeft();
        } else if (this.detailSection === 'carousel' && this.detailSubMode === 'carousel-cards') {
            // Any carousel cards - move left and scroll
            this.moveCarouselCardLeft();
        } else if (this.detailSection === 'collection' && this.detailSubMode === 'collection-cards') {
            // Legacy collection handling
            this.moveCollectionCardLeft();
        } else if (this.detailSection === 'recommendations' && this.detailSubMode === 'recommendation-cards') {
            // Legacy recommendations handling
            this.moveRecommendationCardLeft();
        }
    }
    
    handleDetailArrowRight() {
        console.log('handleDetailArrowRight - section:', this.detailSection, 'subMode:', this.detailSubMode);
        
        if (this.detailSection === 'main' && this.detailSubMode === 'season-tabs') {
            // Season tabs - move right through tabs
            this.moveRight();
            this.scrollSeasonTabIntoView();
        } else if (this.detailSection === 'main' && this.detailSubMode === 'buttons') {
            // Main section buttons - just move right
            this.moveRight();
        } else if (this.detailSection === 'main' && this.detailSubMode === 'episodes') {
            // Season detail episodes - move right, scroll, and update info
            if (this.currentIndex < this.items.length - 1) {
                this.moveRight();
                this.scrollCarouselCardIntoView();
                this.updateSeasonEpisodeInfo();
            }
        } else if (this.detailSection === 'cast' && this.detailSubMode === 'cast-cards') {
            // Cast cards - move right and scroll
            this.moveCastCardRight();
        } else if (this.detailSection === 'cast' && this.detailSubMode === 'info-buttons') {
            // More info buttons - just move right
            this.moveRight();
        } else if (this.detailSection === 'carousel' && this.detailSubMode === 'carousel-cards') {
            // Any carousel cards - move right and scroll
            console.log('Calling moveCarouselCardRight');
            this.moveCarouselCardRight();
        } else if (this.detailSection === 'collection' && this.detailSubMode === 'collection-cards') {
            // Legacy collection handling
            this.moveCollectionCardRight();
        } else if (this.detailSection === 'recommendations' && this.detailSubMode === 'recommendation-cards') {
            // Legacy recommendations handling
            this.moveRecommendationCardRight();
        }
    }
    
    switchToCastSection(skipFocus = false) {
        console.log('switchToCastSection called, skipFocus:', skipFocus);
        const track = document.querySelector('.detail-content-track');
        const castContainer = document.querySelector('.detail-cast-info-container');
        
        console.log('track found:', !!track, 'castContainer found:', !!castContainer);
        
        if (track && castContainer) {
            // Calculate position for cast container (index 1)
            const allContainers = Array.from(track.querySelectorAll('.detail-info-container'));
            console.log('Total containers found:', allContainers.length);
            const containerIndex = allContainers.indexOf(castContainer);
            console.log('Cast container index:', containerIndex);
            
            if (containerIndex >= 0) {
                const translateY = -(77.78 + 17.78) * containerIndex;
                track.style.transform = `translateY(${translateY}vh)`;
                console.log(`Switching to CAST section at index ${containerIndex}, translateY: ${translateY}vh`);
            } else {
                console.log('ERROR: Cast container not found in containers array!');
            }
            
            this.detailSection = 'cast';
            this.detailSubMode = 'cast-cards';
            
            // Update items to cast cards
            setTimeout(() => {
                this.updateItems('.cast-card');
                console.log('Cast cards updated, count:', this.items.length);
                if (!skipFocus) {
                    this.currentIndex = 0; // Start on first card
                    this.focusItem();
                    
                    // Reset scroll to 0 for first card
                    const scrollContainer = document.querySelector('.detail-cast-scroll-container');
                    if (scrollContainer) {
                        scrollContainer.scrollLeft = 0;
                    }
                }
            }, 100);
        }
    }
    
    switchToTVSeasons(skipFocus = false) {
        console.log('switchToTVSeasons called, skipFocus:', skipFocus);
        
        // Clear button focus immediately
        document.querySelectorAll('.detail-button').forEach(btn => btn.classList.remove('focused'));
        
        // TV shows don't have the scrolling track system - seasons are on the same page
        this.detailSection = 'carousel'; // Treat seasons as a carousel
        this.detailSubMode = 'carousel-cards'; // Use carousel-cards mode for proper navigation
        
        // Update items to season cards
        if (!skipFocus) {
            setTimeout(() => {
                this.updateItems('.tv-season-card');
                console.log('Season cards updated, count:', this.items.length);
                
                // Restore saved position if available, otherwise start at 0
                if (this.savedSeasonIndex !== undefined && this.savedSeasonIndex < this.items.length) {
                    this.currentIndex = this.savedSeasonIndex;
                    console.log('Restoring saved season index:', this.savedSeasonIndex);
                } else {
                    this.currentIndex = 0; // Start on first season
                }
                
                this.focusItem();
                this.scrollCarouselCardIntoView();
            }, 100);
        } else {
            // Just update items, caller will handle focus
            this.updateItems('.tv-season-card');
        }
    }
    
    switchToMainSection() {
        const track = document.querySelector('.detail-content-track');
        // Main container is the first detail-info-container (no additional class)
        const allContainers = track?.querySelectorAll('.detail-info-container');
        const mainContainer = allContainers?.[0];
        
        if (track && mainContainer) {
            // Main is always at index 0
            track.style.transform = 'translateY(0vh)';
            console.log('Switching to MAIN section, translateY: 0vh');
            
            this.detailSection = 'main';
            this.detailSubMode = 'buttons';
            
            // Update items back to detail buttons
            setTimeout(() => {
                this.updateItems('.detail-button');
                this.currentIndex = 0;
                this.focusItem();
            }, 100);
        }
    }
    
    switchToCollectionSection(skipFocus = false) {
        const collectionContainer = document.querySelector('.detail-collection-container');
        if (collectionContainer) {
            this.switchToCarousel(collectionContainer);
        }
    }
    
    switchToRecommendationsSection(skipFocus = false) {
        const recommendationsContainer = document.querySelector('.detail-recommendations-container');
        if (recommendationsContainer) {
            this.switchToCarousel(recommendationsContainer);
        }
    }
    
    moveCastCardLeft() {
        if (this.currentIndex > 0) {
            this.moveLeft();
            // Scroll the cast card into view
            this.scrollCastCardIntoView();
        } else {
            // At first card - go to nav
            this.enterNavModeFromDetail();
        }
    }
    
    moveCastCardRight() {
        if (this.currentIndex < this.items.length - 1) {
            this.moveRight();
            // Scroll the cast card into view
            this.scrollCastCardIntoView();
        }
    }
    
    moveCollectionCardLeft() {
        if (this.currentIndex > 0) {
            this.moveLeft();
            this.scrollCollectionCardIntoView();
        } else {
            // At first card - go to nav
            this.enterNavModeFromDetail();
        }
    }
    
    moveCollectionCardRight() {
        if (this.currentIndex < this.items.length - 1) {
            this.moveRight();
            this.scrollCollectionCardIntoView();
        }
    }
    
    moveRecommendationCardLeft() {
        if (this.currentIndex > 0) {
            this.moveLeft();
            // Scroll the recommendation card into view
            this.scrollRecommendationCardIntoView();
        } else {
            // At first card - go to nav
            this.enterNavModeFromDetail();
        }
    }
    
    moveRecommendationCardRight() {
        if (this.currentIndex < this.items.length - 1) {
            this.moveRight();
            // Scroll the recommendation card into view
            this.scrollRecommendationCardIntoView();
        }
    }
    
    moveCarouselCardLeft() {
        if (this.currentIndex > 0) {
            this.moveLeft();
            this.scrollCarouselCardIntoView();
        } else {
            // At first card - go to nav
            this.enterNavModeFromDetail();
        }
    }
    
    moveCarouselCardRight() {
        if (this.currentIndex < this.items.length - 1) {
            this.moveRight();
            this.scrollCarouselCardIntoView();
        }
    }
    
    scrollCarouselCardIntoView() {
        const currentCard = this.items[this.currentIndex];
        console.log('scrollCarouselCardIntoView - currentIndex:', this.currentIndex, 'card:', currentCard);
        
        if (currentCard) {
            // Check card type
            const isTVSeason = currentCard.classList.contains('tv-season-card');
            const isEpisode = currentCard.classList.contains('season-episode-card');
            let scrollContainer;
            let gap;
            
            if (isTVSeason) {
                scrollContainer = document.querySelector('.tv-seasons-scroll');
                gap = 20; // 1.85vh gap for TV seasons
                console.log('TV Season card detected, scrollContainer found:', !!scrollContainer);
            } else if (isEpisode) {
                scrollContainer = document.querySelector('.season-episodes-scroll');
                gap = 20; // 1.85vh gap for episodes
                console.log('Episode card detected, scrollContainer found:', !!scrollContainer);
            } else {
                const container = currentCard.closest('.detail-info-container');
                scrollContainer = container?.querySelector('[class*="-scroll-container"]');
                gap = 24; // 2.22vh gap for other carousels
                console.log('Regular carousel card, scrollContainer found:', !!scrollContainer);
            }
            
            if (scrollContainer) {
                if (isTVSeason) {
                    // TV seasons - use smart "keep in view" scrolling
                    const containerRect = scrollContainer.getBoundingClientRect();
                    const cardRect = currentCard.getBoundingClientRect();
                    
                    // Check if card is fully visible
                    const isFullyVisible = cardRect.left >= containerRect.left && cardRect.right <= containerRect.right;
                    
                    if (!isFullyVisible) {
                        const padding = 48; // 48px padding from edge
                        
                        if (cardRect.left < containerRect.left) {
                            // Card is off to the left, scroll left to show it
                            const scrollAmount = cardRect.left - containerRect.left - padding;
                            scrollContainer.scrollLeft += scrollAmount;
                        } else if (cardRect.right > containerRect.right) {
                            // Card is off to the right, scroll right to show it
                            const scrollAmount = cardRect.right - containerRect.right + padding;
                            scrollContainer.scrollLeft += scrollAmount;
                        }
                    }
                } else if (isEpisode) {
                    // Episodes - flush left positioning (no gap offset)
                    if (this.currentIndex === 0) {
                        // First card - scroll to start
                        console.log('First card - scrolling to 0');
                        scrollContainer.scrollLeft = 0;
                    } else {
                        // All other cards - flush left (use offsetLeft directly)
                        const targetScrollLeft = currentCard.offsetLeft;
                        console.log('Scrolling - offsetLeft:', currentCard.offsetLeft, 'target:', targetScrollLeft);
                        scrollContainer.scrollLeft = targetScrollLeft;
                    }
                } else {
                    // Regular carousels - keep 1/4 positioning
                    if (this.currentIndex === 0) {
                        // First card - scroll to start
                        console.log('First card - scrolling to 0');
                        scrollContainer.scrollLeft = 0;
                    } else {
                        // All other cards - always position with quarter of previous card visible
                        const cardWidth = currentCard.offsetWidth;
                        const targetScrollLeft = currentCard.offsetLeft - (cardWidth / 4) - gap;
                        console.log('Scrolling - cardWidth:', cardWidth, 'offsetLeft:', currentCard.offsetLeft, 'target:', targetScrollLeft);
                        scrollContainer.scrollLeft = targetScrollLeft;
                    }
                }
            } else {
                console.log('ERROR: scrollContainer not found!');
            }
        }
    }
    
    scrollCastCardIntoView() {
        const currentCard = this.items[this.currentIndex];
        if (currentCard) {
            const scrollContainer = document.querySelector('.detail-cast-scroll-container');
            if (scrollContainer) {
                if (this.currentIndex === 0) {
                    // First card - scroll to start
                    scrollContainer.scrollLeft = 0;
                } else {
                    // All other cards - always position with quarter of previous card visible
                    const cardWidth = currentCard.offsetWidth;
                    const gap = parseFloat(getComputedStyle(document.documentElement).fontSize) * 2.22; // Get actual gap in px
                    const peekAmount = (cardWidth / 4) + gap;
                    scrollContainer.scrollLeft = currentCard.offsetLeft - peekAmount;
                }
            }
        }
    }
    
    scrollCollectionCardIntoView() {
        const currentCard = this.items[this.currentIndex];
        if (currentCard) {
            const scrollContainer = document.querySelector('.detail-collection-scroll-container');
            if (scrollContainer) {
                if (this.currentIndex === 0) {
                    // First card - scroll to start
                    scrollContainer.scrollLeft = 0;
                } else {
                    // All other cards - always position with quarter of previous card visible
                    const cardWidth = currentCard.offsetWidth;
                    const gap = 24; // 2.22vh gap between cards
                    scrollContainer.scrollLeft = currentCard.offsetLeft - (cardWidth / 4) - gap;
                }
            }
        }
    }
    
    scrollRecommendationCardIntoView() {
        const currentCard = this.items[this.currentIndex];
        if (currentCard) {
            // Find the recommendations scroll container
            const scrollContainer = document.querySelector('.detail-recommendations-scroll-container');
            
            if (scrollContainer) {
                if (this.currentIndex === 0) {
                    // First card - scroll to start
                    scrollContainer.scrollLeft = 0;
                } else {
                    // All other cards - always position with quarter of previous card visible
                    const cardWidth = currentCard.offsetWidth;
                    const gap = 24; // 2.22vh gap between cards
                    scrollContainer.scrollLeft = currentCard.offsetLeft - (cardWidth / 4) - gap;
                }
            }
        }
    }
    
    // Alias for page-based detail navigation
    enterDetailMode() {
        // Clear the justReturnedFromDetail flag (only applies to grid navigation)
        this.justReturnedFromDetail = false;
        
        // Calculate and save which row we're in BEFORE switching modes
        // Get columns from current grid state
        const container = this.items.length > 0 ? this.items[0].parentElement : null;
        let columns = 6; // Default fallback
        
        if (container) {
            const containerWidth = container.offsetWidth;
            const itemWidth = this.items[0].offsetWidth;
            const gap = parseInt(getComputedStyle(container).gap) || 20;
            columns = Math.floor(containerWidth / (itemWidth + gap)) || 6;
        }
        
        const row = Math.floor(this.currentIndex / columns);
        this.savedDetailReturnRow = row;
        this.savedDetailReturnColumns = columns; // Save columns too
        console.log('Entering detail mode - currentIndex:', this.currentIndex, 'columns:', columns, 'row:', row);
        
        // Only save the index if not already saved (preserve original grid position)
        if (this.savedDetailReturnIndex === undefined) {
            this.savedDetailReturnIndex = this.currentIndex; // Keep for ESC
            console.log('Saved detail return index:', this.currentIndex);
        } else {
            console.log('Preserving existing savedDetailReturnIndex:', this.savedDetailReturnIndex);
        }
        this.enableDetailNavigation();
    }

    // Enter TV show detail mode
    enterTVDetailMode() {
        console.log('Entering TV detail mode');
        console.log('savedSeasonIndex before check:', this.savedSeasonIndex);
        
        // Clear the justReturnedFromDetail flag (only applies to grid navigation)
        this.justReturnedFromDetail = false;
        
        // Don't clear savedSeasonIndex if it's already set
        // (it might be set from context menu marking a season watched)
        // Only clear if we're truly opening fresh (no saved index exists)
        
        // Save current grid position
        if (this.savedDetailReturnIndex === undefined) {
            this.savedDetailReturnIndex = this.currentIndex;
            console.log('Saved TV detail return index:', this.currentIndex);
        }
        
        // Set up detail mode
        this.mode = 'detail';
        this.detailSection = 'main';
        this.detailSubMode = 'buttons';
        
        // Focus on first button
        this.updateItems('.detail-button');
        this.currentIndex = 0;
        this.focusItem();
    }

    // Enter season detail mode
    enterSeasonDetailMode(restoreEpisodePosition = false, fromTabSelection = false) {
        console.log('Entering season detail mode, restoreEpisodePosition:', restoreEpisodePosition, 'fromTabSelection:', fromTabSelection);
        
        // If NOT restoring position (entering fresh), clear episode tracking
        if (!restoreEpisodePosition) {
            this.lastEpisodeIndex = undefined;
            this.savedEpisodeIndex = undefined;
            console.log('Cleared episode indices (entering fresh season detail)');
        }
        
        // Save current grid position if not already saved
        if (this.savedDetailReturnIndex === undefined) {
            this.savedDetailReturnIndex = this.currentIndex;
            console.log('Saved season detail return index:', this.currentIndex);
        }
        
        // Set up detail mode
        this.mode = 'detail';
        this.detailSection = 'main';
        
        // If selecting from tabs OR (restoring and we were on tabs), stay on tabs
        if (fromTabSelection || (restoreEpisodePosition && this.detailSubMode === 'season-tabs')) {
            // Clear saved episode index when switching to different season from tabs
            if (fromTabSelection) {
                this.savedEpisodeIndex = undefined;
                this.lastEpisodeIndex = undefined;
                console.log('Cleared saved episode index (switching to different season from tabs)');
            }
            
            this.detailSubMode = 'season-tabs';
            this.updateItems('.season-tab');
            // Focus the active tab
            const activeTabs = document.querySelectorAll('.season-tab-active');
            if (activeTabs.length > 0) {
                this.currentIndex = Array.from(this.items).indexOf(activeTabs[0]);
            } else {
                this.currentIndex = 0;
            }
            this.focusItem();
            // Only scroll if NOT selecting from tabs (i.e. coming from keyboard nav)
            if (!fromTabSelection) {
                this.scrollSeasonTabIntoView();
            }
        } else {
            // Otherwise go to episodes
            this.detailSubMode = 'episodes';
            
            // Focus on episode thumbnail
            this.updateItems('.season-episode-card');
            
            // Restore saved episode position if switching seasons, otherwise start at 0
            if (restoreEpisodePosition && this.savedEpisodeIndex !== undefined) {
                this.currentIndex = this.savedEpisodeIndex;
            } else {
                this.currentIndex = 0;
            }
            
            // Check if we're about to return to buttons (don't focus episodes in that case)
            const willReturnToButtons = this.contextMenuReturnMode === 'buttons';
            
            if (!willReturnToButtons) {
                this.focusItem();
            }
            
            // Always scroll to show the correct episode (even if not focusing)
            // Use instant scroll when restoring position (e.g. after marking watched)
            if (restoreEpisodePosition && this.savedEpisodeIndex !== undefined) {
                const scrollContainer = document.querySelector('.season-episodes-scroll');
                if (scrollContainer) {
                    scrollContainer.style.scrollBehavior = 'auto';
                    this.scrollCarouselCardIntoView();
                    setTimeout(() => {
                        scrollContainer.style.scrollBehavior = '';
                    }, 50);
                }
            } else {
                this.scrollCarouselCardIntoView();
            }
            
            // Update episode info
            this.updateSeasonEpisodeInfo();
        }
    }
    
    // Scroll season tab into view (keep visible, not carousel positioning)
    scrollSeasonTabIntoView() {
        const container = document.querySelector('.season-tabs-container');
        const tab = this.items[this.currentIndex];
        
        if (!container || !tab) return;
        
        const containerRect = container.getBoundingClientRect();
        const tabRect = tab.getBoundingClientRect();
        
        // Check if tab is fully visible
        const isFullyVisible = tabRect.left >= containerRect.left && tabRect.right <= containerRect.right;
        
        if (!isFullyVisible) {
            // Scroll to bring tab into view with some padding
            const padding = 48; // 48px padding from edge
            
            if (tabRect.left < containerRect.left) {
                // Tab is off to the left, scroll left to show it
                const scrollAmount = tabRect.left - containerRect.left - padding;
                container.scrollLeft += scrollAmount;
            } else if (tabRect.right > containerRect.right) {
                // Tab is off to the right, scroll right to show it
                const scrollAmount = tabRect.right - containerRect.right + padding;
                container.scrollLeft += scrollAmount;
            }
        }
    }
    
    // Update episode info when focus changes
    updateSeasonEpisodeInfo() {
        const currentCard = this.items[this.currentIndex];
        if (!currentCard) return;
        
        // Check if episodeData exists
        if (!currentCard.dataset.episodeData) {
            console.error('No episode data found on card');
            return;
        }
        
        try {
            // Unescape HTML entities before parsing
            const episodeDataString = currentCard.dataset.episodeData
                .replace(/&quot;/g, '"')
                .replace(/&#39;/g, "'");
            const episodeData = JSON.parse(episodeDataString);
            
            // Update title
            const titleEl = document.getElementById('seasonEpisodeTitle');
            if (titleEl) titleEl.textContent = episodeData.title;
            
            // Update metadata
            const metaEl = document.getElementById('seasonEpisodeMeta');
            if (metaEl && window.currentSeason) {
                let metaHTML = `<span>S${window.currentSeason.number.toString().padStart(2, '0')} E${episodeData.episode.toString().padStart(2, '0')}</span>`;
                metaHTML += '<div class="detail-meta-divider"></div>';
                
                // Format air date
                if (episodeData.aired) {
                    try {
                        const date = new Date(episodeData.aired);
                        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
                        const month = months[date.getMonth()];
                        const day = date.getDate();
                        const year = date.getFullYear();
                        metaHTML += `<span>${month} ${day}, ${year}</span>`;
                        metaHTML += '<div class="detail-meta-divider"></div>';
                    } catch (err) {
                        // Skip air date if parsing fails
                    }
                }
                
                // Format runtime
                let runtimeDisplay = '21m';
                if (episodeData.runtime) {
                    if (typeof episodeData.runtime === 'string') {
                        runtimeDisplay = episodeData.runtime;
                    } else {
                        const hours = Math.floor(episodeData.runtime / 60);
                        const mins = episodeData.runtime % 60;
                        if (hours > 0 && mins > 0) {
                            runtimeDisplay = `${hours}h ${mins}m`;
                        } else if (hours > 0) {
                            runtimeDisplay = `${hours}h`;
                        } else {
                            runtimeDisplay = `${mins}m`;
                        }
                    }
                }
                metaHTML += `<span>${runtimeDisplay}</span>`;
                
                if (episodeData.contentRating) {
                    metaHTML += '<div class="detail-meta-divider"></div>';
                    metaHTML += `<span>${episodeData.contentRating}</span>`;
                }
                if (episodeData.rating) {
                    metaHTML += '<div class="detail-meta-divider"></div>';
                    metaHTML += `<span>IMDb ${episodeData.rating}</span>`;
                }
                
                // Calculate end time based on runtime minus watch progress
                if (episodeData.runtime) {
                    const runtimeMinutes = typeof episodeData.runtime === 'string' 
                        ? parseInt(episodeData.runtime) || 21 
                        : episodeData.runtime;
                    
                    // Get watch progress and subtract from runtime (even for watched episodes)
                    let remainingMinutes = runtimeMinutes;
                    if (window.watchDataManager && episodeData.videoPath) {
                        const watchStatus = window.watchDataManager.getWatchStatus(episodeData.videoPath);
                        if (watchStatus && watchStatus.position > 0) {
                            const watchedMinutes = Math.floor(watchStatus.position / 60);
                            remainingMinutes = Math.max(0, runtimeMinutes - watchedMinutes);
                        }
                    }
                    
                    const now = new Date();
                    const endTime = new Date(now.getTime() + remainingMinutes * 60000);
                    const endHours = endTime.getHours().toString().padStart(2, '0');
                    const endMins = endTime.getMinutes().toString().padStart(2, '0');
                    metaHTML += `<div class="detail-meta-divider"></div>`;
                    metaHTML += `<span>Ends at ${endHours}:${endMins}</span>`;
                }
                metaEl.innerHTML = metaHTML;
            }
            
            // Update plot
            const plotEl = document.getElementById('seasonEpisodePlot');
            if (plotEl) plotEl.textContent = episodeData.plot || '';
            
            // Update media badges - read from NFO like movies
            const badgesEl = document.getElementById('seasonMediaBadges');
            if (badgesEl) {
                let badgesHTML = '';
                
                // Resolution badge - read from NFO streamdetails
                let resolutionText = 'SD';
                let resolutionIcon = 'sd';
                
                if (episodeData.videoPath) {
                    const path = require('path');
                    const fs = require('fs');
                    const baseName = path.basename(episodeData.videoPath, path.extname(episodeData.videoPath));
                    const nfoPath = path.join(path.dirname(episodeData.videoPath), `${baseName}.nfo`);
                    
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
                
                badgesHTML += `
                    <div class="detail-badge">
                        <img src="assets/icons/${resolutionIcon}.svg" class="detail-badge-icon" alt="">
                        <span class="detail-badge-text">${resolutionText}</span>
                    </div>
                `;
                
                // Language badge - read from NFO
                let languageText = 'English'; // Default
                
                if (episodeData.videoPath) {
                    const path = require('path');
                    const fs = require('fs');
                    const baseName = path.basename(episodeData.videoPath, path.extname(episodeData.videoPath));
                    const nfoPath = path.join(path.dirname(episodeData.videoPath), `${baseName}.nfo`);
                    
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
                
                badgesHTML += `
                    <div class="detail-badge">
                        <img src="assets/icons/language.svg" class="detail-badge-icon" alt="">
                        <span class="detail-badge-text">${languageText}</span>
                    </div>
                `;
                
                // Subtitle badge - check for .srt files
                let subtitleText = 'None';
                
                if (episodeData.videoPath) {
                    const fs = require('fs');
                    const path = require('path');
                    
                    try {
                        const videoDir = path.dirname(episodeData.videoPath);
                        const videoBasename = path.basename(episodeData.videoPath, path.extname(episodeData.videoPath));
                        const files = fs.readdirSync(videoDir);
                        
                        // Match subtitle files leniently
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
                        
                        if (srtFiles.length > 0) {
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
                        console.error('Error checking for episode subtitles:', err);
                    }
                }
                
                badgesHTML += `
                    <div class="detail-badge">
                        <img src="assets/icons/subtitles.svg" class="detail-badge-icon" alt="">
                        <span class="detail-badge-text">${subtitleText}</span>
                    </div>
                `;
                
                badgesEl.innerHTML = badgesHTML;
            }
            
            // Update Play button text based on watch status
            const playButtonText = document.getElementById('seasonPlayButtonText');
            if (playButtonText && window.watchDataManager) {
                const ws = window.watchDataManager.getWatchStatus(episodeData.videoPath);
                const buttonText = ws && ws.position > 0 ? 'Resume' : 'Play';
                playButtonText.textContent = buttonText;
            }
            
            // Update Watched button based on episode watched status
            const watchedIcon = document.getElementById('seasonWatchedIcon');
            const watchedText = document.getElementById('seasonWatchedText');
            if (watchedIcon && watchedText && window.watchDataManager) {
                const isWatched = window.watchDataManager.getWatchStatus(episodeData.videoPath)?.watched;
                watchedIcon.src = isWatched ? 'assets/icons/unwatched.svg' : 'assets/icons/watched.svg';
                watchedText.textContent = isWatched ? 'Mark Unwatched' : 'Mark Watched';
            }
        } catch (err) {
            console.error('Error updating episode info:', err);
            console.error('Episode data string:', currentCard.dataset.episodeData);
        }
    }

    // Return to grid navigation
    enableGridNavigation() {
        this.mode = 'grid';
        // Check which library is active by looking at nav items
        const activeNavItem = document.querySelector('.nav-item-active');
        const activePage = activeNavItem ? activeNavItem.dataset.page : 'movies';
        
        console.log('enableGridNavigation - activePage:', activePage);
        
        if (activePage === 'tv') {
            console.log('Returning to TV grid');
            this.updateItems('.tv-show-card');
        } else if (activePage === 'playlists') {
            console.log('Returning to playlists grid');
            this.updateItems('.playlist-card');
        } else {
            console.log('Returning to movie grid');
            this.updateItems('.movie-card');
        }
    }
    
    // Alias for page-based detail exit
    exitDetailMode() {
        this.enableGridNavigation();
    }
    
    // Alphabet sidebar navigation methods
    tryEnterAlphabetMode() {
        // Check if we're at the rightmost column
        const columns = this.getColumnsCount();
        const row = Math.floor(this.currentIndex / columns);
        const col = this.currentIndex % columns;
        
        // If at right edge, enter alphabet mode
        if (col === columns - 1) {
            this.enterAlphabetMode();
        } else {
            this.moveRight();
        }
    }
    
    enterAlphabetMode() {
        // Save current grid position
        this.savedGridIndex = this.currentIndex;
        
        this.mode = 'alphabet';
        this.alphabetIndex = 0;
        
        // Remove focus from grid items BEFORE focusing alphabet
        this.items.forEach(item => item.classList.remove('focused'));
        
        this.updateAlphabetItems();
        // Don't call focusAlphabetItem on entry - just add the class without scrolling
        if (this.alphabetItems[this.alphabetIndex]) {
            this.alphabetItems[this.alphabetIndex].classList.add('focused');
        }
    }
    
    exitAlphabetMode() {
        console.log('Exiting alphabet mode, savedGridIndex:', this.savedGridIndex);
        
        this.mode = 'grid';
        
        // Remove focus from alphabet items
        this.alphabetItems.forEach(item => item.classList.remove('focused'));
        
        // Clear active state when leaving alphabet scroll
        this.alphabetItems.forEach(item => item.classList.remove('active'));
        
        // Restore grid position
        if (this.savedGridIndex !== undefined) {
            this.currentIndex = this.savedGridIndex;
            console.log('Restored currentIndex to:', this.currentIndex);
        }
        
        // DON'T call updateItems() - it re-queries and can mess up the indices
        // Just use the existing items array
        console.log('Using existing items array, total:', this.items.length);
        
        // Use current library selector
        let cardSelector;
        if (window.currentLibrary === 'tv') {
            cardSelector = '.tv-show-card';
        } else if (window.currentLibrary === 'playlists') {
            cardSelector = '.playlist-card';
        } else {
            cardSelector = '.movie-card';
        }
        const allCards = document.querySelectorAll(cardSelector);
        allCards.forEach(card => card.classList.remove('focused'));
        
        // Add focus to the saved card
        if (allCards[this.currentIndex]) {
            allCards[this.currentIndex].classList.add('focused');
            let titleSelector;
            if (window.currentLibrary === 'tv') {
                titleSelector = '.tv-show-card-title';
            } else if (window.currentLibrary === 'playlists') {
                titleSelector = '.playlist-card-title';
            } else {
                titleSelector = '.movie-card-title';
            }
            const titleElement = allCards[this.currentIndex].querySelector(titleSelector);
            console.log('Focused on:', titleElement?.textContent);
        }
    }
    
    updateAlphabetItems() {
        this.alphabetItems = Array.from(document.querySelectorAll('.alphabet-item'));
    }
    
    moveAlphabetUp() {
        if (this.alphabetIndex > 0) {
            this.alphabetIndex--;
            this.focusAlphabetItem();
        }
    }
    
    moveAlphabetDown() {
        if (this.alphabetIndex < this.alphabetItems.length - 1) {
            this.alphabetIndex++;
            this.focusAlphabetItem();
        }
    }
    
    focusAlphabetItem() {
        // Remove focus from all items
        this.alphabetItems.forEach(item => item.classList.remove('focused'));
        
        // Add focus to current item
        if (this.alphabetItems[this.alphabetIndex]) {
            const item = this.alphabetItems[this.alphabetIndex];
            item.classList.add('focused');
            
            // Scroll into view only if needed - use auto to prevent grid jump
            item.scrollIntoView({
                behavior: 'auto', // Instant scroll to prevent grid jump
                block: 'nearest'
            });
        }
    }
    
    selectAlphabetLetter() {
        if (this.alphabetItems[this.alphabetIndex]) {
            const letter = this.alphabetItems[this.alphabetIndex].dataset.letter;
            console.log('Selecting letter:', letter);
            
            // Scroll to the letter
            if (typeof scrollToLetter !== 'undefined') {
                scrollToLetter(letter);
            }
            
            // Find the first card starting with this letter - use current library
            const cardSelector = window.currentLibrary === 'tv' ? '.tv-show-card' : '.movie-card';
            const titleSelector = window.currentLibrary === 'tv' ? '.tv-show-card-title' : '.movie-card-title';
            const cards = document.querySelectorAll(cardSelector);
            console.log('Total cards:', cards.length, 'Library:', window.currentLibrary);
            
            let found = false;
            for (let i = 0; i < cards.length; i++) {
                const card = cards[i];
                const titleElement = card.querySelector(titleSelector);
                // Use data-sort-title which already has "The" removed
                const title = titleElement?.getAttribute('data-sort-title') || titleElement?.textContent || '';
                const displayTitle = titleElement?.textContent || '';
                const firstChar = title.charAt(0).toUpperCase();
                
                if (letter === '#' && firstChar.match(/[0-9]/)) {
                    this.savedGridIndex = i;
                    console.log('Found number at index:', i, 'Display:', displayTitle, 'Sort:', title);
                    found = true;
                    break;
                } else if (firstChar === letter) {
                    this.savedGridIndex = i;
                    console.log('Found letter', letter, 'at index:', i, 'Display:', displayTitle, 'Sort:', title);
                    found = true;
                    break;
                }
            }
            
            if (!found) {
                console.log('No item found for letter:', letter);
            }
            
            // Stay in alphabet mode after selecting
        }
    }
    
    // Nav sidebar navigation methods
    tryEnterNavMode() {
        // Check if we're at the leftmost column
        const columns = this.getColumnsCount();
        const col = this.currentIndex % columns;
        
        // If at left edge, enter nav mode
        if (col === 0) {
            this.enterNavMode();
        } else {
            this.moveLeft();
        }
    }
    
    enterNavMode() {
        // Save current grid position
        this.savedGridIndex = this.currentIndex;
        
        this.mode = 'nav';
        
        // Find the active nav item instead of always starting at 0
        this.updateNavItems();
        const activeIndex = this.navItems.findIndex(item => item.classList.contains('nav-item-active'));
        this.navIndex = activeIndex >= 0 ? activeIndex : 0;
        
        this.focusNavItem();
        
        // Expand nav
        const nav = document.getElementById('sideNav');
        nav.classList.add('expanded');
        
        // Remove focus from grid items
        this.items.forEach(item => item.classList.remove('focused'));
    }
    
    enterNavModeFromDetail() {
        // Save current detail state
        this.savedDetailIndex = this.currentIndex;
        this.savedDetailSection = this.detailSection;
        this.savedDetailSubMode = this.detailSubMode;
        // Save carousel container if in carousel mode
        if (this.detailSection === 'carousel' && this.items.length > 0) {
            this.savedCarouselContainer = this.items[0].closest('.detail-info-container');
        }
        this.previousMode = 'detail';
        
        this.mode = 'nav';
        
        // Find the active nav item
        this.updateNavItems();
        const activeIndex = this.navItems.findIndex(item => item.classList.contains('nav-item-active'));
        this.navIndex = activeIndex >= 0 ? activeIndex : 0;
        
        this.focusNavItem();
        
        // Expand nav
        const nav = document.getElementById('sideNav');
        nav.classList.add('expanded');
        
        // Remove focus from detail buttons
        this.items.forEach(item => item.classList.remove('focused'));
    }
    
    exitNavMode() {
        // Check if we came from home screen
        if (this.previousMode === 'home' || (window.isHomeActive && window.isHomeActive())) {
            // Exit nav back to home screen
            this.mode = 'grid'; // Reset mode
            this.previousMode = null;
            
            // Collapse nav
            const nav = document.getElementById('sideNav');
            nav.classList.remove('expanded');
            
            // Remove focus from nav items
            this.navItems.forEach(item => item.classList.remove('focused'));
            
            // Restore focus to home carousel
            if (window.exitHomeNavMode) {
                window.exitHomeNavMode();
            }
            return;
        }
        
        // Check if we came from detail mode
        if (this.previousMode === 'detail') {
            this.mode = 'detail';
            this.previousMode = null;
            
            // Collapse nav
            const nav = document.getElementById('sideNav');
            nav.classList.remove('expanded');
            
            // Remove focus from nav items
            this.navItems.forEach(item => item.classList.remove('focused'));
            
            // Restore detail section and subMode
            if (this.savedDetailSection) {
                this.detailSection = this.savedDetailSection;
            }
            if (this.savedDetailSubMode) {
                this.detailSubMode = this.savedDetailSubMode;
            }
            
            // Update items based on saved subMode
            if (this.savedDetailSubMode === 'episodes') {
                this.updateItems('.season-episode-card');
            } else if (this.savedDetailSubMode === 'season-tabs') {
                this.updateItems('.season-tab');
            } else if (this.savedDetailSubMode === 'cast-cards') {
                this.updateItems('.cast-card');
            } else if (this.savedDetailSubMode === 'collection-cards') {
                this.updateItems('.detail-collection-container .recommendation-card');
            } else if (this.savedDetailSubMode === 'recommendation-cards') {
                this.updateItems('.detail-recommendations-container .recommendation-card');
            } else if (this.savedDetailSubMode === 'carousel-cards') {
                // Check if we're on TV seasons (no carousel container) or regular carousel
                const tvSeasonCards = document.querySelectorAll('.tv-season-card');
                
                if (tvSeasonCards.length > 0) {
                    // TV seasons - just update to season cards
                    this.updateItems('.tv-season-card');
                    console.log('Restored TV season cards, count:', this.items.length);
                } else if (this.savedCarouselContainer) {
                    // Regular carousel - restore from container
                    const cards = this.savedCarouselContainer.querySelectorAll('.recommendation-card');
                    this.items = Array.from(cards);
                    console.log('Restored carousel items, count:', this.items.length);
                } else {
                    console.error('No saved carousel container found!');
                    this.updateItems('.detail-button');
                }
            } else if (this.savedDetailSubMode === 'info-buttons') {
                this.updateItems('.detail-info-button');
            } else {
                // Default to main buttons
                this.updateItems('.detail-button');
            }
            
            // Restore saved index
            if (this.savedDetailIndex !== undefined) {
                this.currentIndex = this.savedDetailIndex;
            }
            this.focusItem();
            
            // Update episode info if we're on episodes
            if (this.savedDetailSubMode === 'episodes') {
                this.updateSeasonEpisodeInfo();
            }
            
            return;
        }
        
        // Check if we came from playlist detail mode
        if (this.previousMode === 'playlist') {
            this.previousMode = null;
            
            // Collapse nav
            const nav = document.getElementById('sideNav');
            nav.classList.remove('expanded');
            
            // Remove focus from nav items
            this.navItems.forEach(item => item.classList.remove('focused'));
            
            // Restore playlist key handler
            if (window.playlistDetailKeyHandler) {
                document.addEventListener('keydown', window.playlistDetailKeyHandler, true);
            }
            
            // Restore playlist focus state
            if (window.playlistNavState) {
                window.playlistFocusSection = window.playlistNavState.section;
                window.playlistFocusedIndex = window.playlistNavState.focusedIndex;
                window.playlistItemButtonIndex = window.playlistNavState.buttonIndex;
            }
            
            // Update the visual focus
            if (window.updatePlaylistDetailFocus) {
                window.updatePlaylistDetailFocus();
            }
            
            return;
        }
        
        this.mode = 'grid';
        
        // Collapse nav
        const nav = document.getElementById('sideNav');
        nav.classList.remove('expanded');
        
        // Remove focus from nav items
        this.navItems.forEach(item => item.classList.remove('focused'));
        
        // Restore grid position
        // If coming from detail page, focus first card in that row
        if (this.savedDetailReturnRow !== undefined && this.savedDetailReturnColumns !== undefined) {
            this.currentIndex = this.savedDetailReturnRow * this.savedDetailReturnColumns; // First card in row
            console.log('Exiting nav from detail - row:', this.savedDetailReturnRow, 'columns:', this.savedDetailReturnColumns, 'newIndex:', this.currentIndex);
            // Don't clear - keep it until ESC is used
        } else if (this.savedGridIndex !== undefined) {
            this.currentIndex = this.savedGridIndex;
            console.log('Exiting nav - using savedGridIndex:', this.savedGridIndex);
        } else {
            console.log('Exiting nav - no saved position');
        }
        
        // Update items based on current library
        let cardSelector;
        if (window.currentLibrary === 'tv') {
            cardSelector = '.tv-show-card';
        } else if (window.currentLibrary === 'playlists') {
            cardSelector = '.playlist-card';
            
            // Check for empty playlist state
            const emptyState = document.querySelector('.playlist-empty-state');
            if (emptyState) {
                // Setup empty playlist navigation instead
                if (window.setupEmptyPlaylistNavigation) {
                    window.setupEmptyPlaylistNavigation();
                }
                return;
            }
        } else {
            cardSelector = '.movie-card';
        }
        this.updateItems(cardSelector);
        console.log('After updateItems - items.length:', this.items.length, 'currentIndex:', this.currentIndex, 'library:', window.currentLibrary);
        
        // Focus on grid
        this.focusItem();
        console.log('After focusItem - focused card index:', this.currentIndex);
    }
    
    updateNavItems() {
        this.navItems = Array.from(document.querySelectorAll('.nav-item'));
    }
    
    moveNavUp() {
        if (this.navIndex > 0) {
            this.navIndex--;
            this.focusNavItem();
        }
    }
    
    moveNavDown() {
        if (this.navIndex < this.navItems.length - 1) {
            this.navIndex++;
            this.focusNavItem();
        }
    }
    
    focusNavItem() {
        // Remove focus from all items
        this.navItems.forEach(item => item.classList.remove('focused'));
        
        // Add focus to current item
        if (this.navItems[this.navIndex]) {
            this.navItems[this.navIndex].classList.add('focused');
        }
    }
    
    selectNavItem() {
        if (this.navItems[this.navIndex]) {
            this.navItems[this.navIndex].click();
        }
    }
    
    openContextMenu() {
        // Home screen - when on home cards
        if (window.isHomeActive && window.isHomeActive() && window.showHomeContextMenu) {
            window.showHomeContextMenu();
            return;
        }
        // Movie grid - when on movie cards
        if (this.mode === 'grid' && this.items[this.currentIndex]) {
            const focusedItem = this.items[this.currentIndex];
            if (focusedItem.classList.contains('movie-card') && window.showMovieContextMenu) {
                window.showMovieContextMenu(focusedItem);
                return;
            }
            // TV show grid - when on TV show cards
            if (focusedItem.classList.contains('tv-show-card') && window.showTVShowGridContextMenu) {
                window.showTVShowGridContextMenu(focusedItem);
                return;
            }
            // Playlist grid - when on playlist cards
            if (focusedItem.classList.contains('playlist-card') && window.showPlaylistGridContextMenu) {
                window.showPlaylistGridContextMenu(focusedItem);
                return;
            }
        }
        // Movie detail page - when on buttons
        if (this.mode === 'detail' && this.detailSubMode === 'buttons' && window.currentMovie && window.showMovieDetailContextMenu) {
            window.showMovieDetailContextMenu();
            return;
        }
        // Movie detail page - when on carousel cards (recommended, collections, tags, etc.)
        const movieCarouselModes = ['carousel-cards', 'collection-cards', 'recommendation-cards', 'tag-cards'];
        if (this.mode === 'detail' && movieCarouselModes.includes(this.detailSubMode) && window.currentMovie && window.showMovieCarouselContextMenu) {
            const focusedItem = this.items[this.currentIndex];
            if (focusedItem) {
                window.showMovieCarouselContextMenu(focusedItem);
                return;
            }
        }
        // TV show detail page - when on buttons
        if (this.mode === 'detail' && this.detailSubMode === 'buttons' && window.currentShow && window.showTVShowDetailContextMenu) {
            window.showTVShowDetailContextMenu();
            return;
        }
        // TV show detail - when on seasons carousel
        if (this.mode === 'detail' && this.detailSection === 'carousel' && this.detailSubMode === 'carousel-cards' && window.showTVSeasonContextMenu) {
            const focusedSeason = this.items[this.currentIndex];
            if (focusedSeason && focusedSeason.classList.contains('tv-season-card')) {
                const seasonNumber = parseInt(focusedSeason.dataset.season);
                window.showTVSeasonContextMenu(seasonNumber);
                return;
            }
        }
        // For season detail page, only when on episodes carousel
        if (this.mode === 'detail' && this.detailSubMode === 'episodes' && window.showSeasonContextMenu) {
            window.showSeasonContextMenu();
            return;
        }
    }
    
    handleSettingsKeydown(e) {
        e.preventDefault();
        
        const rows = document.querySelectorAll('.settings-row');
        const rowCount = rows.length;
        let focusedRow = window.getSettingsFocusedRow ? window.getSettingsFocusedRow() : -1;
        
        switch (e.key) {
            case 'ArrowUp':
                if (focusedRow > 0) {
                    focusedRow--;
                } else if (focusedRow === 0) {
                    // Go back to input field
                    focusedRow = -1;
                    document.getElementById('moviesPathInput').focus();
                }
                if (window.setSettingsFocusedRow) window.setSettingsFocusedRow(focusedRow);
                if (window.updateSettingsRowFocus) window.updateSettingsRowFocus();
                break;
                
            case 'ArrowDown':
                if (focusedRow < rowCount - 1) {
                    focusedRow++;
                    // Blur input if leaving it
                    document.getElementById('moviesPathInput').blur();
                }
                if (window.setSettingsFocusedRow) window.setSettingsFocusedRow(focusedRow);
                if (window.updateSettingsRowFocus) window.updateSettingsRowFocus();
                break;
                
            case 'ArrowLeft':
                if (focusedRow >= 0 && window.adjustSettingsOption) {
                    window.adjustSettingsOption('left');
                }
                break;
                
            case 'ArrowRight':
                if (focusedRow >= 0 && window.adjustSettingsOption) {
                    window.adjustSettingsOption('right');
                }
                break;
                
            case 'Escape':
            case 'Backspace':
                if (window.closeSettings) {
                    window.closeSettings();
                }
                break;
                
            case 'Enter':
                // Could be used to save settings or activate buttons
                break;
        }
    }
}

// Create global instance
const keyboardNav = new KeyboardNavigation();
window.keyboardNav = keyboardNav; // Expose on window for renderer.js

// Export for use in renderer
if (typeof module !== 'undefined' && module.exports) {
    module.exports = KeyboardNavigation;
}
