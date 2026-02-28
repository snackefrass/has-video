// Search Module with Fuse.js Fuzzy Search

let movieFuseInstance = null;
let tvShowFuseInstance = null;

// Initialize Fuse.js with movie data
function initializeSearch(movies) {
    const options = {
        keys: [
            { name: 'metadata.title', weight: 2 }, // Title is most important
            { name: 'metadata.sortTitle', weight: 1.5 },
            { name: 'metadata.actors', weight: 1 },
            { name: 'metadata.director', weight: 0.8 },
            { name: 'metadata.year', weight: 0.5 },
            { name: 'metadata.genre', weight: 0.5 }
        ],
        threshold: 0.3, // Slightly stricter matching
        includeScore: true,
        minMatchCharLength: 1, // Allow single character searches
        ignoreLocation: true, // Match anywhere in the string
        useExtendedSearch: true // Enable extended search patterns
    };
    
    movieFuseInstance = new Fuse(movies, options);
    console.log('Movie search initialized with', movies.length, 'movies');
}

// Initialize Fuse.js with TV show data
function initializeTVSearch(tvShows) {
    const options = {
        keys: [
            { name: 'title', weight: 2 }, // Title is most important
            { name: 'sortTitle', weight: 1.5 },
            { name: 'metadata.actors', weight: 1 },
            { name: 'year', weight: 0.5 },
            { name: 'metadata.genre', weight: 0.5 }
        ],
        threshold: 0.3,
        includeScore: true,
        minMatchCharLength: 1,
        ignoreLocation: true,
        useExtendedSearch: true
    };
    
    tvShowFuseInstance = new Fuse(tvShows, options);
    console.log('TV show search initialized with', tvShows.length, 'shows');
}

// Custom search that matches start of any word
function searchWithWordStart(fuseInstance, query) {
    if (!fuseInstance || !query || query.length < 1) {
        return [];
    }
    
    // First try exact word-start matching manually
    const queryLower = query.toLowerCase();
    
    // Get all items and filter for word-start matches
    const allItems = fuseInstance.getIndex().docs;
    const wordStartMatches = [];
    
    allItems.forEach((item, index) => {
        // Get title from either movie or TV show structure
        const title = item.metadata?.title || item.title || '';
        const titleLower = title.toLowerCase();
        
        // Split title into words and check if query matches start of any word
        const words = titleLower.split(/\s+/);
        const matchesWordStart = words.some(word => word.startsWith(queryLower));
        
        if (matchesWordStart) {
            wordStartMatches.push({ item, score: 0 }); // Perfect score for word-start match
        }
    });
    
    // If we found word-start matches, return those
    if (wordStartMatches.length > 0) {
        // Sort alphabetically by title
        wordStartMatches.sort((a, b) => {
            const titleA = (a.item.metadata?.title || a.item.title || '').toLowerCase();
            const titleB = (b.item.metadata?.title || b.item.title || '').toLowerCase();
            return titleA.localeCompare(titleB);
        });
        return wordStartMatches.map(r => r.item);
    }
    
    // Fall back to fuzzy search if no word-start matches
    const results = fuseInstance.search(query);
    return results.map(result => result.item);
}

// Perform movie search
function search(query) {
    return searchWithWordStart(movieFuseInstance, query);
}

// Perform TV show search
function searchTVShows(query) {
    return searchWithWordStart(tvShowFuseInstance, query);
}

// Export functions
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        initializeSearch,
        initializeTVSearch,
        search,
        searchTVShows
    };
}
