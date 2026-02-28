// Watch Data Manager - Local File Storage
const fs = require('fs');
const path = require('path');

class WatchDataManager {
    constructor() {
        this.watchDataPath = path.join(__dirname, '..', 'watch-data.json');
        this.watchData = {};
        this.loadWatchData();
    }

    /**
     * Load watch data from file
     */
    loadWatchData() {
        try {
            if (fs.existsSync(this.watchDataPath)) {
                const data = fs.readFileSync(this.watchDataPath, 'utf8');
                this.watchData = JSON.parse(data);
                console.log('Watch data loaded:', Object.keys(this.watchData).length, 'entries');
            } else {
                console.log('No watch data file found, starting fresh');
                this.watchData = {};
            }
        } catch (error) {
            console.error('Error loading watch data:', error);
            this.watchData = {};
        }
    }

    /**
     * Save watch data to file
     */
    saveWatchData() {
        try {
            fs.writeFileSync(this.watchDataPath, JSON.stringify(this.watchData, null, 2));
            console.log('Watch data saved');
        } catch (error) {
            console.error('Error saving watch data:', error);
        }
    }

    /**
     * Get watch status for a movie
     * @param {string} videoPath - Path to video file
     * @returns {Object} - { watched: boolean, position: number, duration: number, percentage: number }
     */
    getWatchStatus(videoPath) {
        const data = this.watchData[videoPath];
        
        if (!data) {
            return {
                watched: false,
                position: 0,
                duration: 0,
                percentage: 0
            };
        }

        const percentage = data.duration > 0 ? (data.position / data.duration) * 100 : 0;

        return {
            watched: data.watched || false,
            position: data.position || 0,
            duration: data.duration || 0,
            percentage: percentage,
            lastWatched: data.lastWatched || null
        };
    }

    /**
     * Update playback position
     * @param {string} videoPath - Path to video file
     * @param {number} position - Current position in seconds
     * @param {number} duration - Total duration in seconds
     */
    updatePosition(videoPath, position, duration) {
        if (!this.watchData[videoPath]) {
            this.watchData[videoPath] = {};
        }
        
        // Remove from exclusion list if it was excluded (user is playing it again)
        this.removeFromExcluded(videoPath);

        // Detect content type
        const isTVShow = videoPath.includes('/Season ') || videoPath.includes('\\Season ');
        
        if (isTVShow) {
            // TV shows: only save position if within tracking window (5+ min watched AND 5+ min remaining)
            const timeRemaining = duration - position;
            
            if (position >= 300 && timeRemaining > 300) {
                // Within tracking window - save position
                this.watchData[videoPath].position = position;
                this.watchData[videoPath].duration = duration;
                this.watchData[videoPath].lastWatched = new Date().toISOString();
            } else if (position < 300) {
                // Before tracking window - clear position
                this.watchData[videoPath].position = 0;
                this.watchData[videoPath].duration = duration;
            } else {
                // Near end (< 5 min remaining) - keep last saved position but don't update
                this.watchData[videoPath].duration = duration;
            }
            
            // Auto-mark as watched if 5 minutes or less remaining
            if (timeRemaining <= 300 && position >= 300) {
                this.watchData[videoPath].watched = true;
                this.watchData[videoPath].position = 0; // Clear position when auto-marked
                console.log('Auto-marking TV episode as watched (5 minutes or less remaining):', videoPath);
            }
        } else {
            // Movies: only save position if within tracking window (10+ min watched AND 10+ min remaining)
            const timeRemaining = duration - position;
            
            if (position >= 600 && timeRemaining > 600) {
                // Within tracking window - save position
                this.watchData[videoPath].position = position;
                this.watchData[videoPath].duration = duration;
                this.watchData[videoPath].lastWatched = new Date().toISOString();
            } else if (position < 600) {
                // Before tracking window - clear position
                this.watchData[videoPath].position = 0;
                this.watchData[videoPath].duration = duration;
            } else {
                // Near end (< 10 min remaining) - keep last saved position but don't update
                this.watchData[videoPath].duration = duration;
            }

            // Auto-mark as watched if 10 minutes or less remaining
            if (timeRemaining <= 600 && position >= 600) {
                this.watchData[videoPath].watched = true;
                this.watchData[videoPath].position = 0; // Clear position when auto-marked
                console.log('Auto-marking movie as watched (10 minutes or less remaining):', videoPath);
            }
        }

        this.saveWatchData();
    }

    /**
     * Mark movie as watched and clear position
     * Used when user manually marks as watched via button
     * @param {string} videoPath - Path to video file
     * @param {number} duration - Total duration in seconds (optional)
     */
    markWatched(videoPath, duration = 0) {
        if (!this.watchData[videoPath]) {
            this.watchData[videoPath] = {};
        }

        this.watchData[videoPath].watched = true;
        this.watchData[videoPath].position = 0; // Clear position when manually marked
        this.watchData[videoPath].duration = duration;
        this.watchData[videoPath].lastWatched = new Date().toISOString();

        this.saveWatchData();
        console.log('Marked as watched (position cleared):', videoPath);
    }

    /**
     * Mark movie as unwatched and clear progress
     * @param {string} videoPath - Path to video file
     */
    markUnwatched(videoPath) {
        if (this.watchData[videoPath]) {
            delete this.watchData[videoPath];
            this.saveWatchData();
            console.log('Marked as unwatched and cleared progress:', videoPath);
        }
    }

    /**
     * Clear position but keep watched status
     * @param {string} videoPath - Path to video file
     */
    clearPosition(videoPath) {
        if (this.watchData[videoPath]) {
            this.watchData[videoPath].position = 0;
            this.watchData[videoPath].percentage = 0;
            this.saveWatchData();
        }
    }

    /**
     * Get all watch data (for debugging)
     */
    getAllWatchData() {
        return this.watchData;
    }

    /**
     * Calculate watch statistics for a TV show
     * @param {Object} show - TV show object with seasons and episodes
     * @returns {Object} - { totalEpisodes, watchedEpisodes, unwatchedEpisodes, inProgressEpisodes, nextEpisode }
     */
    getShowWatchStats(show) {
        let totalEpisodes = 0;
        let watchedEpisodes = 0;
        let inProgressEpisodes = 0;
        let nextEpisode = null;

        for (const season of show.seasons) {
            for (const episode of season.episodes) {
                totalEpisodes++;
                const status = this.getWatchStatus(episode.videoPath);
                
                if (status.watched) {
                    watchedEpisodes++;
                } else if (status.position > 0) {
                    inProgressEpisodes++;
                    // Track the first in-progress episode
                    if (!nextEpisode) {
                        nextEpisode = episode;
                    }
                } else if (!nextEpisode && watchedEpisodes === totalEpisodes - 1) {
                    // This is the next unwatched episode after all previous are watched
                    nextEpisode = episode;
                }
            }
        }

        const unwatchedEpisodes = totalEpisodes - watchedEpisodes;

        return {
            totalEpisodes,
            watchedEpisodes,
            unwatchedEpisodes,
            inProgressEpisodes,
            nextEpisode
        };
    }

    /**
     * Calculate watch statistics for a season
     * @param {Object} season - Season object with episodes
     * @returns {Object} - { totalEpisodes, watchedEpisodes, unwatchedEpisodes, inProgressEpisodes }
     */
    getSeasonWatchStats(season) {
        let totalEpisodes = season.episodes.length;
        let watchedEpisodes = 0;
        let inProgressEpisodes = 0;

        for (const episode of season.episodes) {
            const status = this.getWatchStatus(episode.videoPath);
            
            if (status.watched) {
                watchedEpisodes++;
            } else if (status.position > 0) {
                inProgressEpisodes++;
            }
        }

        const unwatchedEpisodes = totalEpisodes - watchedEpisodes;

        return {
            totalEpisodes,
            watchedEpisodes,
            unwatchedEpisodes,
            inProgressEpisodes
        };
    }

    /**
     * Get the next episode to watch in a show
     * Returns the first unwatched episode, or the first in-progress episode
     * @param {Object} show - TV show object
     * @returns {Object|null} - Episode object or null if all watched
     */
    getNextEpisode(show) {
        let firstUnwatched = null;
        let firstInProgress = null;

        for (const season of show.seasons) {
            for (const episode of season.episodes) {
                const status = this.getWatchStatus(episode.videoPath);
                
                // Track first in-progress episode
                if (!firstInProgress && status.position > 0 && !status.watched) {
                    firstInProgress = episode;
                }
                
                // Track first completely unwatched episode
                if (!firstUnwatched && !status.watched && status.position === 0) {
                    firstUnwatched = episode;
                }

                // If we found both, we can stop looking
                if (firstInProgress && firstUnwatched) {
                    break;
                }
            }
            if (firstInProgress && firstUnwatched) {
                break;
            }
        }

        // Prioritize in-progress over unwatched
        return firstInProgress || firstUnwatched;
    }

    /**
     * Get all items with progress for Continue Watching
     * Returns items sorted by lastWatched, excludes items older than 2 weeks
     * @returns {Array} - Array of { videoPath, position, duration, percentage, lastWatched, type }
     */
    getContinueWatchingItems() {
        const twoWeeksAgo = new Date();
        twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);
        
        const items = [];
        const excludedItems = this.watchData._excludedFromContinueWatching || [];
        
        // 1. Get in-progress items (including watched movies with saved position)
        for (const [videoPath, data] of Object.entries(this.watchData)) {
            // Skip special keys
            if (videoPath === '_activeShows' || videoPath === '_excludedFromContinueWatching') continue;
            
            // Skip excluded items
            if (excludedItems.includes(videoPath)) continue;
            
            // Include items with position > 0, even if watched (for movies)
            // For TV shows, still exclude watched episodes
            const isTVShow = videoPath.includes('/Season ') || videoPath.includes('\\Season ');
            const shouldInclude = data.position > 0 && data.lastWatched && 
                                  (!data.watched || !isTVShow); // Include watched movies, exclude watched TV
            
            if (shouldInclude) {
                const lastWatchedDate = new Date(data.lastWatched);
                
                // Exclude items older than 2 weeks
                if (lastWatchedDate >= twoWeeksAgo) {
                    const percentage = data.duration > 0 ? (data.position / data.duration) * 100 : 0;
                    
                    items.push({
                        videoPath,
                        position: data.position,
                        duration: data.duration,
                        percentage,
                        lastWatched: data.lastWatched,
                        type: isTVShow ? 'tv' : 'movie'
                    });
                }
            }
        }
        
        // 2. Get "up next" episodes from active shows
        const activeShows = this.watchData._activeShows || {};
        for (const [showPath, showData] of Object.entries(activeShows)) {
            const lastWatchedDate = new Date(showData.lastWatched);
            
            // Exclude shows not watched in last 2 weeks
            if (lastWatchedDate < twoWeeksAgo) continue;
            
            // Check if next episode exists and isn't already watched
            if (showData.nextEpisodePath) {
                // Note: TV shows don't use exclusion list - they use activeShows removal instead
                
                const nextEpData = this.watchData[showData.nextEpisodePath];
                
                // Only include if not already watched and not already in items (in-progress)
                const alreadyInProgress = items.some(item => item.videoPath === showData.nextEpisodePath);
                const isWatched = nextEpData && nextEpData.watched;
                
                if (!alreadyInProgress && !isWatched) {
                    items.push({
                        videoPath: showData.nextEpisodePath,
                        position: 0,
                        duration: 0,
                        percentage: 0,
                        lastWatched: showData.lastWatched,
                        type: 'tv',
                        isUpNext: true, // Flag to identify "up next" items
                        showPath: showPath
                    });
                }
            }
        }
        
        // Sort by lastWatched, newest first
        items.sort((a, b) => new Date(b.lastWatched) - new Date(a.lastWatched));
        
        return items;
    }
    
    /**
     * Update active show tracking when an episode is watched
     * @param {string} videoPath - Path to the episode that was just watched
     * @param {string} showPath - Path to the show directory
     * @param {number} seasonNumber - Current season number
     * @param {number} episodeNumber - Current episode number
     * @param {string} nextEpisodePath - Path to the next episode (or null if none)
     */
    updateActiveShow(videoPath, showPath, seasonNumber, episodeNumber, nextEpisodePath) {
        if (!this.watchData._activeShows) {
            this.watchData._activeShows = {};
        }
        
        if (nextEpisodePath) {
            // There's a next episode - update active show tracking
            this.watchData._activeShows[showPath] = {
                lastWatched: new Date().toISOString(),
                lastEpisodePath: videoPath,
                lastSeasonNumber: seasonNumber,
                lastEpisodeNumber: episodeNumber,
                nextEpisodePath: nextEpisodePath
            };
            console.log('Updated active show:', showPath, '- next episode:', nextEpisodePath);
        } else {
            // No next episode - show is complete, remove from active shows
            delete this.watchData._activeShows[showPath];
            console.log('Show complete, removed from active shows:', showPath);
        }
        
        this.saveWatchData();
    }
    
    /**
     * Get active show data
     * @param {string} showPath - Path to the show directory
     * @returns {Object|null} - Active show data or null
     */
    getActiveShow(showPath) {
        if (!this.watchData._activeShows) return null;
        return this.watchData._activeShows[showPath] || null;
    }
    
    /**
     * Remove a show from active tracking
     * @param {string} showPath - Path to the show directory
     */
    removeActiveShow(showPath) {
        if (this.watchData._activeShows && this.watchData._activeShows[showPath]) {
            delete this.watchData._activeShows[showPath];
            this.saveWatchData();
            console.log('Removed show from active tracking:', showPath);
        }
    }
    
    /**
     * Manually add an episode to Continue Watching by setting it as next episode
     * @param {string} episodePath - Path to the episode to add
     * @param {string} showPath - Path to the show directory
     * @param {number} seasonNumber - Season number of the episode
     * @param {number} episodeNumber - Episode number
     */
    addEpisodeToContinueWatching(episodePath, showPath, seasonNumber, episodeNumber) {
        if (!this.watchData._activeShows) {
            this.watchData._activeShows = {};
        }
        
        // Calculate the previous episode path for lastEpisodePath
        // If this is episode 1, we'll set lastEpisodePath to null or handle appropriately
        let lastEpisodePath = null;
        let lastSeasonNumber = seasonNumber;
        let lastEpisodeNumber = episodeNumber - 1;
        
        if (lastEpisodeNumber > 0) {
            // There's a previous episode in this season
            // Construct the path by replacing the episode number
            lastEpisodePath = episodePath.replace(
                new RegExp(`E${String(episodeNumber).padStart(2, '0')}`),
                `E${String(lastEpisodeNumber).padStart(2, '0')}`
            );
        }
        // If episodeNumber is 1, lastEpisodePath stays null (first episode of season)
        
        this.watchData._activeShows[showPath] = {
            lastWatched: new Date().toISOString(),
            lastEpisodePath: lastEpisodePath,
            lastSeasonNumber: lastSeasonNumber,
            lastEpisodeNumber: lastEpisodeNumber,
            nextEpisodePath: episodePath
        };
        
        this.saveWatchData();
        console.log('Manually added episode to Continue Watching:', episodePath);
    }
    
    /**
     * Exclude an item from Continue Watching
     * Does NOT clear progress - just hides from carousel
     * @param {string} videoPath - Path to the video file
     */
    /**
     * Remove an item from Continue Watching
     * For TV: removes the show from _activeShows (doesn't affect progress)
     * For Movies: adds to exclusion list (cleared when new progress is saved)
     * @param {string} videoPath - Path to the video file
     */
    removeFromContinueWatching(videoPath) {
        const isTVShow = videoPath.includes('/Season ') || videoPath.includes('\\Season ');
        
        if (isTVShow && this.watchData._activeShows) {
            // TV: Find and remove from any active show where this is the next episode
            for (const [showPath, showData] of Object.entries(this.watchData._activeShows)) {
                if (showData.nextEpisodePath === videoPath) {
                    delete this.watchData._activeShows[showPath];
                    console.log('Removed show from Continue Watching (active shows):', showPath);
                }
            }
            this.saveWatchData();
        } else {
            // Movie: add to exclusion list (will be cleared when progress is saved again)
            if (!this.watchData._excludedFromContinueWatching) {
                this.watchData._excludedFromContinueWatching = [];
            }
            
            if (!this.watchData._excludedFromContinueWatching.includes(videoPath)) {
                this.watchData._excludedFromContinueWatching.push(videoPath);
                console.log('Added movie to Continue Watching exclusion list:', videoPath);
            }
            this.saveWatchData();
        }
    }
    
    /**
     * Legacy function - now just calls removeFromContinueWatching
     * Kept for backwards compatibility
     * @param {string} videoPath - Path to the video file
     */
    excludeFromContinueWatching(videoPath) {
        this.removeFromContinueWatching(videoPath);
    }
    
    /**
     * Remove an item from the exclusion list (called when new progress is saved)
     * @param {string} videoPath - Path to the video file
     */
    removeFromExcluded(videoPath) {
        if (this.watchData._excludedFromContinueWatching) {
            const index = this.watchData._excludedFromContinueWatching.indexOf(videoPath);
            if (index > -1) {
                this.watchData._excludedFromContinueWatching.splice(index, 1);
                this.saveWatchData();
                console.log('Removed from exclusion list (new progress saved):', videoPath);
            }
        }
    }
    
    /**
     * Check if an item is excluded from Continue Watching
     * @param {string} videoPath - Path to the video file
     * @returns {boolean}
     */
    isExcludedFromContinueWatching(videoPath) {
        const excluded = this.watchData._excludedFromContinueWatching || [];
        return excluded.includes(videoPath);
    }
}

module.exports = WatchDataManager;
