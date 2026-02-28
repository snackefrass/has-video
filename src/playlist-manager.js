/**
 * Playlist Manager
 * Handles playlist storage and operations
 */

const fs = require('fs');
const path = require('path');

/**
 * Generate a simple unique ID
 */
function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
}

class PlaylistManager {
    constructor() {
        this.playlists = [];
        this.dataPath = path.join(__dirname, '..', 'playlists.json');
        this.load();
    }

    /**
     * Load playlists from disk
     */
    load() {
        try {
            if (fs.existsSync(this.dataPath)) {
                const data = JSON.parse(fs.readFileSync(this.dataPath, 'utf8'));
                this.playlists = data.playlists || [];
                console.log(`Loaded ${this.playlists.length} playlists`);
            } else {
                this.playlists = [];
                this.save();
            }
        } catch (err) {
            console.error('Error loading playlists:', err);
            this.playlists = [];
        }
    }

    /**
     * Save playlists to disk
     */
    save() {
        try {
            const data = { playlists: this.playlists };
            fs.writeFileSync(this.dataPath, JSON.stringify(data, null, 2));
        } catch (err) {
            console.error('Error saving playlists:', err);
        }
    }

    /**
     * Get all playlists
     * @returns {Array} Array of playlist objects
     */
    getAll() {
        return this.playlists;
    }

    /**
     * Get all playlists sorted by last modified (most recent first)
     * @returns {Array} Array of playlist objects
     */
    getAllByLastModified() {
        return this.playlists.slice().sort((a, b) => {
            const aTime = a.lastModified || a.created || '0';
            const bTime = b.lastModified || b.created || '0';
            return bTime.localeCompare(aTime); // Descending (newest first)
        });
    }

    /**
     * Get a playlist by ID
     * @param {string} id - Playlist ID
     * @returns {Object|null} Playlist object or null
     */
    getById(id) {
        return this.playlists.find(p => p.id === id) || null;
    }

    /**
     * Create a new playlist
     * @param {string} name - Playlist name
     * @returns {Object} The created playlist
     */
    create(name) {
        const now = new Date().toISOString();
        const playlist = {
            id: generateId(),
            name: name.trim(),
            created: now,
            lastModified: now,
            customThumbnail: null,
            items: []
        };
        this.playlists.push(playlist);
        this.save();
        return playlist;
    }

    /**
     * Rename a playlist
     * @param {string} id - Playlist ID
     * @param {string} newName - New name
     * @returns {boolean} Success
     */
    rename(id, newName) {
        const playlist = this.getById(id);
        if (playlist) {
            playlist.name = newName.trim();
            this.save();
            return true;
        }
        return false;
    }

    /**
     * Delete a playlist
     * @param {string} id - Playlist ID
     * @returns {boolean} Success
     */
    delete(id) {
        const index = this.playlists.findIndex(p => p.id === id);
        if (index !== -1) {
            this.playlists.splice(index, 1);
            this.save();
            return true;
        }
        return false;
    }

    /**
     * Clear all items from a playlist
     * @param {string} id - Playlist ID
     * @returns {boolean} Success
     */
    clear(id) {
        const playlist = this.getById(id);
        if (playlist) {
            playlist.items = [];
            this.save();
            return true;
        }
        return false;
    }

    /**
     * Add a movie to a playlist
     * @param {string} playlistId - Playlist ID
     * @param {string} videoPath - Path to the movie file
     * @returns {boolean} Success
     */
    addMovie(playlistId, videoPath) {
        const playlist = this.getById(playlistId);
        if (!playlist) return false;

        // Check if already in playlist
        const exists = playlist.items.some(item => item.videoPath === videoPath);
        if (exists) return false;

        playlist.items.push({
            type: 'movie',
            videoPath: videoPath,
            addedAt: new Date().toISOString()
        });
        playlist.lastModified = new Date().toISOString();
        this.save();
        return true;
    }

    /**
     * Remove a movie from a playlist
     * @param {string} playlistId - Playlist ID
     * @param {string} videoPath - Path to the movie file
     * @returns {boolean} Success
     */
    removeMovie(playlistId, videoPath) {
        const playlist = this.getById(playlistId);
        if (!playlist) return false;

        const index = playlist.items.findIndex(item => item.videoPath === videoPath);
        if (index !== -1) {
            playlist.items.splice(index, 1);
            this.save();
            return true;
        }
        return false;
    }

    /**
     * Clear all items from a playlist
     * @param {string} playlistId - Playlist ID
     * @returns {boolean} Success
     */
    clearPlaylist(playlistId) {
        const playlist = this.getById(playlistId);
        if (!playlist) return false;

        playlist.items = [];
        this.save();
        return true;
    }

    /**
     * Delete a playlist entirely
     * @param {string} playlistId - Playlist ID
     * @returns {boolean} Success
     */
    deletePlaylist(playlistId) {
        const index = this.playlists.findIndex(p => p.id === playlistId);
        if (index !== -1) {
            this.playlists.splice(index, 1);
            this.save();
            return true;
        }
        return false;
    }

    /**
     * Reorder an item in a playlist
     * @param {string} playlistId - Playlist ID
     * @param {number} fromIndex - Current index
     * @param {number} toIndex - New index
     * @returns {boolean} Success
     */
    reorderItem(playlistId, fromIndex, toIndex) {
        const playlist = this.getById(playlistId);
        if (!playlist) return false;

        if (fromIndex < 0 || fromIndex >= playlist.items.length) return false;
        if (toIndex < 0 || toIndex >= playlist.items.length) return false;

        const [item] = playlist.items.splice(fromIndex, 1);
        playlist.items.splice(toIndex, 0, item);
        this.save();
        return true;
    }

    /**
     * Set custom thumbnail for a playlist
     * @param {string} id - Playlist ID
     * @param {string|null} thumbnailPath - Path to thumbnail image or null to remove
     * @returns {boolean} Success
     */
    setCustomThumbnail(id, thumbnailPath) {
        const playlist = this.getById(id);
        if (playlist) {
            playlist.customThumbnail = thumbnailPath;
            this.save();
            return true;
        }
        return false;
    }

    /**
     * Get the poster paths for auto-generated thumbnail (first 4 movies)
     * @param {string} playlistId - Playlist ID
     * @param {Array} allMovies - Array of all movie objects to look up posters
     * @returns {Array} Array of up to 4 poster paths
     */
    getThumbnailPosters(playlistId, allMovies) {
        const playlist = this.getById(playlistId);
        if (!playlist) return [];

        const posters = [];
        for (let i = 0; i < Math.min(4, playlist.items.length); i++) {
            const item = playlist.items[i];
            const movie = allMovies.find(m => m.videoPath === item.videoPath);
            if (movie && movie.posterPath) {
                posters.push(movie.posterPath);
            } else {
                posters.push(null); // Placeholder for missing poster
            }
        }
        return posters;
    }

    /**
     * Get total runtime of a playlist in minutes
     * @param {string} playlistId - Playlist ID
     * @param {Array} allMovies - Array of all movie objects
     * @returns {number} Total runtime in minutes
     */
    getTotalRuntime(playlistId, allMovies) {
        const playlist = this.getById(playlistId);
        if (!playlist) return 0;

        let totalMinutes = 0;
        playlist.items.forEach(item => {
            const movie = allMovies.find(m => m.videoPath === item.videoPath);
            if (movie && movie.metadata && movie.metadata.runtime) {
                totalMinutes += movie.metadata.runtime;
            }
        });
        return totalMinutes;
    }

    /**
     * Check if a movie is in any playlist
     * @param {string} videoPath - Path to the movie file
     * @returns {Array} Array of playlist IDs containing this movie
     */
    getPlaylistsContaining(videoPath) {
        return this.playlists
            .filter(p => p.items.some(item => item.videoPath === videoPath))
            .map(p => p.id);
    }

    /**
     * Mark all movies in a playlist as watched
     * @param {string} playlistId - Playlist ID
     * @param {Object} watchDataManager - Watch data manager instance
     * @returns {boolean} Success
     */
    markAllWatched(playlistId, watchDataManager) {
        const playlist = this.getById(playlistId);
        if (!playlist || !watchDataManager) return false;

        playlist.items.forEach(item => {
            watchDataManager.markWatched(item.videoPath);
        });
        return true;
    }

    /**
     * Mark all movies in a playlist as unwatched
     * @param {string} playlistId - Playlist ID
     * @param {Object} watchDataManager - Watch data manager instance
     * @returns {boolean} Success
     */
    markAllUnwatched(playlistId, watchDataManager) {
        const playlist = this.getById(playlistId);
        if (!playlist || !watchDataManager) return false;

        playlist.items.forEach(item => {
            watchDataManager.markUnwatched(item.videoPath);
        });
        return true;
    }
}

// Export singleton instance
const playlistManager = new PlaylistManager();
module.exports = playlistManager;
