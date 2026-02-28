const fs = require('fs');
const path = require('path');
const { parseNFO } = require('./nfo-parser');

/**
 * Scan a movies directory and find all movies with NFO files
 * @param {string} moviesPath - Path to movies directory
 * @returns {Array} Array of movie objects
 */
function scanMoviesFolder(moviesPath) {
    const movies = [];
    
    try {
        const folders = fs.readdirSync(moviesPath, { withFileTypes: true });
        
        folders.forEach(dirent => {
            if (!dirent.isDirectory()) return;
            
            const folderName = dirent.name;
            const folderPath = path.join(moviesPath, folderName);
            
            try {
                const files = fs.readdirSync(folderPath);
                
                // Find video file (ignore macOS metadata files)
                const videoFile = files.find(f => 
                    !f.startsWith('._') && (
                        f.endsWith('.mkv') || 
                        f.endsWith('.mp4') || 
                        f.endsWith('.avi') ||
                        f.endsWith('.m4v') ||
                        f.endsWith('.mov')
                    )
                );
                
                // Find NFO file (ignore macOS metadata files starting with ._ )
                const nfoFile = files.find(f => 
                    f.endsWith('.nfo') && !f.startsWith('._')
                );
                
                // Find images (ignore macOS metadata files)
                const posterFile = files.find(f => 
                    !f.startsWith('._') && (
                        f === 'poster.jpg' || 
                        f === 'folder.jpg' ||
                        f === 'poster.png'
                    )
                );
                
                const fanartFile = files.find(f => 
                    !f.startsWith('._') && (
                        f === 'fanart.jpg' ||
                        f === 'backdrop.jpg' ||
                        f === 'fanart.png'
                    )
                );
                
                // Find .actors_img folder
                const actorsImgFolder = files.includes('.actors_img') ? 
                    path.join(folderPath, '.actors_img') : null;
                
                if (videoFile && nfoFile) {
                    movies.push({
                        folderName: folderName,
                        videoPath: path.join(folderPath, videoFile),
                        nfoPath: path.join(folderPath, nfoFile),
                        posterPath: posterFile ? path.join(folderPath, posterFile) : null,
                        fanartPath: fanartFile ? path.join(folderPath, fanartFile) : null,
                        actorsImgPath: actorsImgFolder,
                        folderPath: folderPath
                    });
                }
            } catch (err) {
                console.error('Error reading folder:', folderName, err);
            }
        });
        
        console.log(`Found ${movies.length} movies in ${moviesPath}`);
        return movies;
        
    } catch (error) {
        console.error('Error scanning movies folder:', error);
        return [];
    }
}

/**
 * Normalize edition string - convert to title case with spaces
 * e.g., "DIRECTORS_CUT" -> "Director's Cut", "extended_edition" -> "Extended Edition"
 * @param {string} edition - Raw edition string
 * @returns {string} Normalized edition string
 */
function normalizeEdition(edition) {
    if (!edition) return null;
    
    // Replace underscores with spaces
    let normalized = edition.replace(/_/g, ' ');
    
    // Normalize apostrophes (curly to straight)
    normalized = normalized.replace(/['']/g, "'");
    
    // Convert to lowercase first for consistent processing
    normalized = normalized.toLowerCase();
    
    // Handle common patterns - replace with final form directly
    // Match: directors cut, director's cut, directors_cut, director cut, etc.
    normalized = normalized.replace(/\bdirector'?s?\s*cut\b/g, "Director's Cut");
    normalized = normalized.replace(/\bdirector'?s?\s*edition\b/g, "Director's Edition");
    normalized = normalized.replace(/\bcollector'?s?\s*cut\b/g, "Collector's Cut");
    normalized = normalized.replace(/\bcollector'?s?\s*edition\b/g, "Collector's Edition");
    
    // Handle standalone words (that weren't part of above patterns)
    normalized = normalized.replace(/\btheatrical\b/g, "Theatrical");
    normalized = normalized.replace(/\bextended\b/g, "Extended");
    normalized = normalized.replace(/\bunrated\b/g, "Unrated");
    normalized = normalized.replace(/\buncut\b/g, "Uncut");
    normalized = normalized.replace(/\bremastered\b/g, "Remastered");
    normalized = normalized.replace(/\bspecial\b/g, "Special");
    normalized = normalized.replace(/\blimited\b/g, "Limited");
    normalized = normalized.replace(/\bexport\b/g, "Export");
    normalized = normalized.replace(/\bversion\b/g, "Version");
    normalized = normalized.replace(/\bedition\b/g, "Edition");
    normalized = normalized.replace(/\bcut\b/g, "Cut");
    normalized = normalized.replace(/\bfinal\b/g, "Final");
    normalized = normalized.replace(/\boriginal\b/g, "Original");
    normalized = normalized.replace(/\binternational\b/g, "International");
    normalized = normalized.replace(/\bimax\b/g, "IMAX");
    normalized = normalized.replace(/\b3d\b/g, "3D");
    normalized = normalized.replace(/\b4k\b/g, "4K");
    
    // For any remaining lowercase words, convert to title case
    // Only match words at start or after space (not after apostrophe)
    normalized = normalized.replace(/(^|\s)([a-z]+)/g, (match, prefix, word) => {
        return prefix + word.charAt(0).toUpperCase() + word.slice(1);
    });
    
    return normalized.trim();
}

/**
 * Load all movies with their metadata
 * @param {string} moviesPath - Path to movies directory
 * @returns {Promise<Array>} Array of movies with metadata
 */
async function loadMovies(moviesPath) {
    const movies = scanMoviesFolder(moviesPath);
    
    // Parse NFO files for all movies
    const moviesWithMetadata = await Promise.all(
        movies.map(async movie => {
            try {
                const metadata = await parseNFO(movie.nfoPath);
                
                // Log if there's an error in the metadata
                if (metadata.title === 'Error parsing NFO') {
                    console.error(`Failed to parse NFO for: ${movie.folderName}`);
                    console.error(`NFO path: ${movie.nfoPath}`);
                }
                
                // Append edition to title if present in NFO (skip if empty or "NONE")
                if (metadata.edition && metadata.edition.toUpperCase() !== 'NONE') {
                    const normalizedEdition = normalizeEdition(metadata.edition);
                    console.log(`Edition for "${metadata.title}": raw="${metadata.edition}" normalized="${normalizedEdition}"`);
                    metadata.title = `${metadata.title} — ${normalizedEdition}`;
                }
                
                return {
                    ...movie,
                    metadata
                };
            } catch (err) {
                console.error(`Exception loading movie: ${movie.folderName}`, err);
                return {
                    ...movie,
                    metadata: {
                        title: 'Error loading movie',
                        year: '',
                        plot: `Failed to load: ${err.message}`,
                        rating: 0,
                        runtime: 0,
                        mpaa: '',
                        genre: [],
                        actors: [],
                        director: '',
                        writers: []
                    }
                };
            }
        })
    );
    
    return moviesWithMetadata;
}

/**
 * Scan a single movie folder and return movie with metadata
 * @param {string} folderPath - Path to the movie folder
 * @returns {Promise<Object|null>} Movie object with metadata or null
 */
async function scanSingleMovieFolder(folderPath) {
    try {
        const folderName = path.basename(folderPath);
        const files = fs.readdirSync(folderPath);
        
        // Find video file (ignore macOS metadata files)
        const videoFile = files.find(f => 
            !f.startsWith('._') && (
                f.endsWith('.mkv') || 
                f.endsWith('.mp4') || 
                f.endsWith('.avi') ||
                f.endsWith('.m4v') ||
                f.endsWith('.mov')
            )
        );
        
        // Find NFO file (ignore macOS metadata files starting with ._ )
        const nfoFile = files.find(f => 
            f.endsWith('.nfo') && !f.startsWith('._')
        );
        
        // Find images (ignore macOS metadata files)
        const posterFile = files.find(f => 
            !f.startsWith('._') && (
                f === 'poster.jpg' || 
                f === 'folder.jpg' ||
                f === 'poster.png'
            )
        );
        
        const fanartFile = files.find(f => 
            !f.startsWith('._') && (
                f === 'fanart.jpg' ||
                f === 'backdrop.jpg' ||
                f === 'fanart.png'
            )
        );
        
        // Find .actors_img folder
        const actorsImgFolder = files.includes('.actors_img') ? 
            path.join(folderPath, '.actors_img') : null;
        
        if (!videoFile || !nfoFile) {
            console.log(`Skipping ${folderName}: missing video or nfo file`);
            return null;
        }
        
        const movie = {
            folderName: folderName,
            videoPath: path.join(folderPath, videoFile),
            nfoPath: path.join(folderPath, nfoFile),
            posterPath: posterFile ? path.join(folderPath, posterFile) : null,
            fanartPath: fanartFile ? path.join(folderPath, fanartFile) : null,
            actorsImgPath: actorsImgFolder,
            folderPath: folderPath
        };
        
        // Parse NFO metadata
        const metadata = await parseNFO(movie.nfoPath);
        
        // Append edition to title if present in NFO (skip if empty or "NONE")
        if (metadata.edition && metadata.edition.toUpperCase() !== 'NONE') {
            const normalizedEdition = normalizeEdition(metadata.edition);
            metadata.title = `${metadata.title} — ${normalizedEdition}`;
        }
        
        return {
            ...movie,
            metadata
        };
    } catch (err) {
        console.error('Error scanning single movie folder:', folderPath, err);
        return null;
    }
}

module.exports = { 
    scanMoviesFolder,
    loadMovies,
    scanSingleMovieFolder
};
