const fs = require('fs');
const path = require('path');
const tvNFOParser = require('./tv-nfo-parser');

class TVScanner {
    constructor() {
        this.shows = [];
    }

    /**
     * Scan the TV library directory and build the TV shows data structure
     * @param {string} libraryPath - Path to the TV library root
     * @returns {Array} Array of TV show objects with all seasons and episodes
     */
    scanLibrary(libraryPath) {
        console.log('Starting TV library scan:', libraryPath);
        this.shows = [];

        try {
            if (!fs.existsSync(libraryPath)) {
                console.error('TV library path does not exist:', libraryPath);
                return [];
            }

            // Get all show directories
            const showDirs = fs.readdirSync(libraryPath)
                .filter(item => {
                    const fullPath = path.join(libraryPath, item);
                    return fs.statSync(fullPath).isDirectory();
                })
                .filter(item => !item.startsWith('.'));

            console.log(`Found ${showDirs.length} TV show directories`);

            // Process each show
            for (const showDir of showDirs) {
                const showPath = path.join(libraryPath, showDir);
                const show = this.scanShow(showPath);
                if (show) {
                    this.shows.push(show);
                }
            }

            console.log(`Scan complete: ${this.shows.length} TV shows loaded`);
            return this.shows;

        } catch (err) {
            console.error('Error scanning TV library:', err);
            return [];
        }
    }

    /**
     * Scan a single TV show directory
     * @param {string} showPath - Path to the TV show directory
     * @returns {Object|null} TV show object with metadata and seasons
     */
    scanShow(showPath) {
        try {
            const showName = path.basename(showPath);
            console.log(`Scanning show: ${showName}`);

            // Look for tvshow.nfo
            const nfoPath = path.join(showPath, 'tvshow.nfo');
            if (!fs.existsSync(nfoPath)) {
                console.warn(`No tvshow.nfo found for ${showName}`);
                return null;
            }

            // Parse show metadata
            const metadata = tvNFOParser.parseTVShowNFO(nfoPath);
            if (!metadata) {
                console.warn(`Failed to parse NFO for ${showName}`);
                return null;
            }

            // Look for poster.jpg
            const posterPath = path.join(showPath, 'poster.jpg');
            const posterExists = fs.existsSync(posterPath);

            // Scan seasons
            const seasons = this.scanSeasons(showPath);

            // Build show object
            const show = {
                title: metadata.title || showName,
                originalTitle: metadata.originalTitle,
                showTitle: metadata.showTitle,
                year: metadata.year,
                plot: metadata.plot,
                runtime: metadata.runtime,
                rating: metadata.rating,
                votes: metadata.votes,
                mpaa: metadata.mpaa,
                certification: metadata.certification,
                premiered: metadata.premiered,
                status: metadata.status,
                imdbid: metadata.imdbid,
                tmdbid: metadata.tmdbid,
                tvdbid: metadata.tvdbid,
                actors: metadata.actors,
                genres: metadata.genres,
                studios: metadata.studios,
                thumb: metadata.thumb,
                fanart: metadata.fanart,
                banner: metadata.banner,
                clearlogo: metadata.clearlogo,
                clearart: metadata.clearart,
                // Local paths
                showPath: showPath,
                posterPath: posterExists ? posterPath : null,
                seasons: seasons,
                // Computed properties
                totalSeasons: seasons.length,
                totalEpisodes: seasons.reduce((sum, s) => sum + s.episodes.length, 0)
            };

            return show;

        } catch (err) {
            console.error('Error scanning show:', showPath, err);
            return null;
        }
    }

    /**
     * Scan all seasons in a show directory
     * @param {string} showPath - Path to the TV show directory
     * @returns {Array} Array of season objects with episodes
     */
    scanSeasons(showPath) {
        const seasons = [];

        try {
            // Get all season directories
            const seasonDirs = fs.readdirSync(showPath)
                .filter(item => {
                    const fullPath = path.join(showPath, item);
                    return fs.statSync(fullPath).isDirectory() && item.toLowerCase().startsWith('season');
                });

            // Sort season directories naturally
            seasonDirs.sort((a, b) => {
                const numA = parseInt(a.match(/\d+/)?.[0] || '0');
                const numB = parseInt(b.match(/\d+/)?.[0] || '0');
                return numA - numB;
            });

            // Process each season
            for (const seasonDir of seasonDirs) {
                const seasonPath = path.join(showPath, seasonDir);
                const seasonNumber = parseInt(seasonDir.match(/\d+/)?.[0] || '0');
                
                // Skip Season 0 here - we'll handle Specials separately at the end
                if (seasonNumber === 0) continue;

                // Look for season poster in the main show directory
                const seasonPosterFilename = `season${seasonNumber.toString().padStart(2, '0')}-poster.jpg`;
                const seasonPosterPath = path.join(showPath, seasonPosterFilename);
                const seasonPosterExists = fs.existsSync(seasonPosterPath);

                // Scan episodes in this season
                const episodes = this.scanEpisodes(seasonPath, seasonNumber);
                
                console.log(`Season ${seasonNumber}: Found ${episodes.length} episodes`);

                if (episodes.length > 0) {
                    seasons.push({
                        number: seasonNumber,
                        name: `Season ${seasonNumber}`,
                        seasonPath: seasonPath,
                        posterPath: seasonPosterExists ? seasonPosterPath : null,
                        episodes: episodes,
                        totalEpisodes: episodes.length
                    });
                }
            }
            
            // Check for Specials folder (add at the end)
            const specialsPath = path.join(showPath, 'Specials');
            const season0Path = path.join(showPath, 'Season 0');
            const season00Path = path.join(showPath, 'Season 00');
            
            let specialsFolderPath = null;
            if (fs.existsSync(specialsPath) && fs.statSync(specialsPath).isDirectory()) {
                specialsFolderPath = specialsPath;
            } else if (fs.existsSync(season0Path) && fs.statSync(season0Path).isDirectory()) {
                specialsFolderPath = season0Path;
            } else if (fs.existsSync(season00Path) && fs.statSync(season00Path).isDirectory()) {
                specialsFolderPath = season00Path;
            }
            
            if (specialsFolderPath) {
                // Look for specials poster
                const specialsPosterPath = path.join(showPath, 'season-specials-poster.jpg');
                const season00PosterPath = path.join(showPath, 'season00-poster.jpg');
                let posterPath = null;
                if (fs.existsSync(specialsPosterPath)) {
                    posterPath = specialsPosterPath;
                } else if (fs.existsSync(season00PosterPath)) {
                    posterPath = season00PosterPath;
                }
                
                // Scan episodes in Specials
                const episodes = this.scanEpisodes(specialsFolderPath, 0);
                
                console.log(`Specials: Found ${episodes.length} episodes`);
                
                if (episodes.length > 0) {
                    seasons.push({
                        number: 0,
                        name: 'Specials',
                        seasonPath: specialsFolderPath,
                        posterPath: posterPath,
                        episodes: episodes,
                        totalEpisodes: episodes.length
                    });
                }
            }

        } catch (err) {
            console.error('Error scanning seasons:', showPath, err);
        }

        return seasons;
    }

    /**
     * Scan all episodes in a season directory
     * @param {string} seasonPath - Path to the season directory
     * @param {number} seasonNumber - Season number
     * @returns {Array} Array of episode objects
     */
    scanEpisodes(seasonPath, seasonNumber) {
        const episodes = [];

        try {
            // Get all files in the season directory
            const files = fs.readdirSync(seasonPath);

            // Find all video files
            const videoExtensions = ['.mkv', '.mp4', '.avi', '.m4v', '.mov'];
            const videoFiles = files.filter(file => {
                const ext = path.extname(file).toLowerCase();
                const basename = path.basename(file);
                // Filter out hidden files (starting with . or ._)
                if (basename.startsWith('.') || basename.startsWith('._')) {
                    return false;
                }
                return videoExtensions.includes(ext);
            });

            // Process each video file
            for (const videoFile of videoFiles) {
                const videoPath = path.join(seasonPath, videoFile);
                const baseName = path.basename(videoFile, path.extname(videoFile));
                
                console.log(`  Found video file: ${videoFile}`);
                
                // Look for matching NFO file
                const nfoPath = path.join(seasonPath, `${baseName}.nfo`);
                const nfoExists = fs.existsSync(nfoPath);

                // Look for matching thumbnail
                const thumbPath = path.join(seasonPath, `${baseName}.jpg`);
                const thumbExists = fs.existsSync(thumbPath);

                // Parse episode metadata if NFO exists
                let metadata = null;
                if (nfoExists) {
                    metadata = tvNFOParser.parseEpisodeNFO(nfoPath);
                }

                // Try to extract episode number from filename if metadata missing
                let episodeNumber = 0;
                if (metadata && metadata.episode) {
                    episodeNumber = metadata.episode;
                } else {
                    // Try to extract from filename (e.g., S01E05, s01e05, 1x05, etc.)
                    const match = baseName.match(/[Ss]0*(\d+)[Ee]0*(\d+)|(\d+)[xX](\d+)/);
                    if (match) {
                        episodeNumber = parseInt(match[2] || match[4]);
                    }
                }

                // Build episode object
                const episode = {
                    title: metadata?.title || baseName,
                    originalTitle: metadata?.originalTitle,
                    season: seasonNumber,
                    episode: episodeNumber,
                    plot: metadata?.plot || '',
                    runtime: metadata?.runtime || 0,
                    rating: metadata?.rating || '',
                    votes: metadata?.votes || '',
                    mpaa: metadata?.mpaa || '',
                    premiered: metadata?.premiered || '',
                    aired: metadata?.aired || '',
                    imdbid: metadata?.imdbid || '',
                    tmdbid: metadata?.tmdbid || '',
                    tvdbid: metadata?.tvdbid || '',
                    actors: metadata?.actors || [],
                    directors: metadata?.directors || [],
                    writers: metadata?.writers || [],
                    studio: metadata?.studio || '',
                    thumb: metadata?.thumb || '',
                    // Video file details
                    videoCodec: metadata?.videoCodec || '',
                    resolution: metadata?.resolution || '',
                    audioCodec: metadata?.audioCodec || '',
                    audioChannels: metadata?.audioChannels || '',
                    duration: metadata?.duration || 0,
                    // Local paths
                    videoPath: videoPath,
                    nfoPath: nfoExists ? nfoPath : null,
                    thumbPath: thumbExists ? thumbPath : null,
                    // For watch status tracking
                    watchStatus: {
                        watched: false,
                        position: 0,
                        duration: metadata?.duration || 0,
                        percentage: 0
                    }
                };

                episodes.push(episode);
            }

            // Sort episodes by episode number
            episodes.sort((a, b) => a.episode - b.episode);

        } catch (err) {
            console.error('Error scanning episodes:', seasonPath, err);
        }

        return episodes;
    }

    /**
     * Get all TV shows
     * @returns {Array} Array of all TV shows
     */
    getAllShows() {
        return this.shows;
    }

    /**
     * Get a specific show by title or ID
     * @param {string} identifier - Show title, IMDb ID, TMDB ID, or TVDB ID
     * @returns {Object|null} TV show object or null if not found
     */
    getShow(identifier) {
        return this.shows.find(show => 
            show.title === identifier ||
            show.imdbid === identifier ||
            show.tmdbid === identifier ||
            show.tvdbid === identifier
        ) || null;
    }

    /**
     * Get a specific season from a show
     * @param {string} showIdentifier - Show identifier
     * @param {number} seasonNumber - Season number
     * @returns {Object|null} Season object or null if not found
     */
    getSeason(showIdentifier, seasonNumber) {
        const show = this.getShow(showIdentifier);
        if (!show) return null;

        return show.seasons.find(s => s.number === seasonNumber) || null;
    }

    /**
     * Get a specific episode
     * @param {string} showIdentifier - Show identifier
     * @param {number} seasonNumber - Season number
     * @param {number} episodeNumber - Episode number
     * @returns {Object|null} Episode object or null if not found
     */
    getEpisode(showIdentifier, seasonNumber, episodeNumber) {
        const season = this.getSeason(showIdentifier, seasonNumber);
        if (!season) return null;

        return season.episodes.find(e => e.episode === episodeNumber) || null;
    }
}

module.exports = new TVScanner();
