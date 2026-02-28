/**
 * Jellyfin API integration for watch status sync
 */

class JellyfinSync {
    constructor(config) {
        this.server = config.jellyfinServer;
        this.apiKey = config.jellyfinApiKey;
        this.userId = config.jellyfinUserId;
        this.enabled = config.jellyfinEnabled !== false;
    }

    /**
     * Check if Jellyfin sync is enabled and configured
     */
    isEnabled() {
        return this.enabled && this.server && this.apiKey && this.userId;
    }

    /**
     * Find Jellyfin item ID by file path
     */
    async findItemByPath(filePath) {
        if (!this.isEnabled()) return null;

        try {
            const url = `${this.server}/Items?` + new URLSearchParams({
                Path: filePath,
                Recursive: true,
                UserId: this.userId,
                Fields: 'Path,UserData'
            });

            const response = await fetch(url, {
                headers: { 'X-Emby-Token': this.apiKey }
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const data = await response.json();
            return data.Items && data.Items.length > 0 ? data.Items[0] : null;
        } catch (error) {
            console.error('Error finding item by path:', error);
            return null;
        }
    }

    /**
     * Get watch status for a movie
     */
    async getWatchStatus(filePath) {
        const defaultStatus = {
            watched: false,
            position: 0,
            playCount: 0,
            lastPlayed: null
        };

        if (!this.isEnabled()) return defaultStatus;

        try {
            const item = await this.findItemByPath(filePath);
            
            if (!item || !item.UserData) {
                return defaultStatus;
            }

            const userData = item.UserData;

            return {
                itemId: item.Id,
                watched: userData.Played || false,
                position: userData.PlaybackPositionTicks 
                    ? Math.floor(userData.PlaybackPositionTicks / 10000000) 
                    : 0,
                playCount: userData.PlayCount || 0,
                lastPlayed: userData.LastPlayedDate || null,
                isFavorite: userData.IsFavorite || false
            };
        } catch (error) {
            console.error('Error getting watch status:', error);
            return defaultStatus;
        }
    }

    /**
     * Mark a movie as watched
     */
    async markWatched(filePath) {
        if (!this.isEnabled()) return false;

        try {
            const item = await this.findItemByPath(filePath);
            if (!item) return false;

            const url = `${this.server}/Users/${this.userId}/PlayedItems/${item.Id}`;
            
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'X-Emby-Token': this.apiKey }
            });

            return response.ok;
        } catch (error) {
            console.error('Error marking as watched:', error);
            return false;
        }
    }

    /**
     * Update playback progress
     */
    async updateProgress(filePath, positionSeconds, isPaused = false) {
        if (!this.isEnabled()) return false;

        try {
            const item = await this.findItemByPath(filePath);
            if (!item) return false;

            const url = `${this.server}/Users/${this.userId}/PlayingItems/${item.Id}/Progress`;
            
            const body = {
                PositionTicks: Math.floor(positionSeconds * 10000000),
                IsPaused: isPaused
            };

            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'X-Emby-Token': this.apiKey,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(body)
            });

            return response.ok;
        } catch (error) {
            console.error('Error updating progress:', error);
            return false;
        }
    }

    /**
     * Report playback stopped
     */
    async reportStopped(filePath, positionSeconds) {
        if (!this.isEnabled()) return false;

        try {
            const item = await this.findItemByPath(filePath);
            if (!item) return false;

            const url = `${this.server}/Users/${this.userId}/PlayingItems/${item.Id}`;
            
            const body = {
                PositionTicks: Math.floor(positionSeconds * 10000000)
            };

            const response = await fetch(url, {
                method: 'DELETE',
                headers: {
                    'X-Emby-Token': this.apiKey,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(body)
            });

            return response.ok;
        } catch (error) {
            console.error('Error reporting stopped:', error);
            return false;
        }
    }
}

module.exports = JellyfinSync;
