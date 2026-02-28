const fs = require('fs');
const xml2js = require('xml2js');

/**
 * Parse a .nfo file and extract movie metadata
 * @param {string} nfoPath - Path to the .nfo file
 * @returns {Object} Parsed movie metadata
 */
async function parseNFO(nfoPath) {
    try {
        let xml = fs.readFileSync(nfoPath, 'utf8');
        
        // Log first 100 chars for debugging
        const preview = xml.substring(0, 100).replace(/\n/g, '\\n').replace(/\r/g, '\\r');
        console.log(`Parsing NFO: ${path.basename(nfoPath)}`);
        console.log(`First 100 chars: "${preview}"`);
        
        // Strip BOM (Byte Order Mark)
        xml = xml.replace(/^\uFEFF/, '');
        xml = xml.replace(/^\ufeff/, '');
        
        // Remove any leading whitespace and invisible characters
        xml = xml.replace(/^[\s\uFEFF\xA0\x00-\x1F]+/, '');
        
        // Find the start of actual XML content
        const xmlStart = xml.indexOf('<?xml');
        if (xmlStart > 0) {
            console.log(`Found XML at position ${xmlStart}, stripping ${xmlStart} chars`);
            xml = xml.substring(xmlStart);
        } else if (xmlStart === -1) {
            // No <?xml declaration, look for <movie> tag
            const movieStart = xml.indexOf('<movie');
            if (movieStart > 0) {
                console.log(`No <?xml found, using <movie> at position ${movieStart}`);
                xml = xml.substring(movieStart);
            }
        }
        
        // Trim any remaining whitespace
        xml = xml.trim();
        
        const parser = new xml2js.Parser({ 
            explicitArray: false,
            trim: true,
            normalize: true,
            normalizeTags: false
        });
        const result = await parser.parseStringPromise(xml);
        
        const movie = result.movie || {};
        
        // Extract rating (prefer IMDB rating marked as default)
        let rating = 0;
        if (movie.ratings && movie.ratings.rating) {
            const ratings = Array.isArray(movie.ratings.rating) ? movie.ratings.rating : [movie.ratings.rating];
            const defaultRating = ratings.find(r => r.$ && r.$.default === 'true');
            if (defaultRating && defaultRating.value) {
                rating = parseFloat(defaultRating.value);
            }
        }
        
        // Extract writers from credits tag
        let writers = [];
        if (movie.credits) {
            writers = Array.isArray(movie.credits) ? movie.credits : [movie.credits];
            writers = writers.map(w => {
                if (typeof w === 'string') return w;
                if (w._ !== undefined) return w._;
                if (w.n !== undefined) return w.n;
                return String(w);
            }).filter(w => w && w.trim());
        }
        
        // Extract director(s)
        let director = '';
        if (movie.director) {
            const directors = Array.isArray(movie.director) ? movie.director : [movie.director];
            director = directors.map(d => {
                if (typeof d === 'string') return d;
                if (d._ !== undefined) return d._;
                if (d.n !== undefined) return d.n;
                return String(d);
            }).filter(d => d && d.trim()).join(', ');
        }
        
        // Extract data with fallbacks
        return {
            title: movie.title || 'Unknown',
            sortTitle: movie.sorttitle || null, // Use sorttitle if available, otherwise null
            originalTitle: movie.originaltitle || movie.title || 'Unknown',
            edition: movie.edition || null, // Edition info (e.g., "Director's Cut")
            year: movie.year || '',
            plot: movie.plot || 'No description available.',
            tagline: movie.tagline || '',
            rating: rating,
            votes: movie.votes || 0,
            runtime: parseInt(movie.runtime) || 0,
            mpaa: movie.mpaa || movie.certification || '',
            
            // Language
            language: movie.languages || '',
            
            // Arrays
            genre: Array.isArray(movie.genre) ? movie.genre : (movie.genre ? [movie.genre] : []),
            country: Array.isArray(movie.country) ? movie.country : (movie.country ? [movie.country] : []),
            studio: Array.isArray(movie.studio) ? movie.studio : (movie.studio ? [movie.studio] : []),
            
            // Tags
            tags: parseTags(movie.tag),
            
            // People
            director: director,
            writers: writers,
            credits: movie.credits || '',
            
            // Actors
            actors: parseActors(movie.actor),
            
            // Collection/Set
            collection: parseCollection(movie.set),
            
            // File info (for resolution detection)
            fileinfo: movie.fileinfo || null,
            
            // IDs
            imdb: movie.id || movie.imdbid || '',
            tmdb: movie.tmdbid || ''
        };
    } catch (error) {
        console.error('Error parsing NFO:', nfoPath, error);
        console.error('Error details:', error.message);
        return {
            title: 'Error parsing NFO',
            year: '',
            plot: `Could not read movie information. Error: ${error.message}`,
            rating: 0,
            runtime: 0,
            mpaa: '',
            genre: [],
            actors: [],
            director: '',
            writers: [],
            collection: null,
            tags: []
        };
    }
}

/**
 * Parse collection/set information from NFO
 */
function parseCollection(setData) {
    if (!setData) return null;
    
    // Handle both simple string and complex object formats
    if (typeof setData === 'string') {
        return { name: setData };
    }
    
    const name = setData.name || setData.n || null;
    const overview = setData.overview || null;
    
    // Filter out empty strings for overview
    const result = {
        name: name,
        overview: overview && overview.trim() !== '' ? overview : null
    };
    
    // Only return if we have a valid name
    return result.name ? result : null;
}

/**
 * Parse actor information from NFO
 */
function parseActors(actorData) {
    if (!actorData) return [];
    
    const actors = Array.isArray(actorData) ? actorData : [actorData];
    
    return actors.map(actor => {
        // Handle both simple and complex actor formats
        if (typeof actor === 'string') {
            return { name: actor, role: '', thumb: '', tmdbid: '' };
        }
        
        // Extract TMDB ID for filename matching
        let tmdbid = '';
        if (actor.tmdbid) {
            tmdbid = typeof actor.tmdbid === 'string' ? actor.tmdbid : actor.tmdbid._;
        } else if (actor.$ && actor.$.tmdbid) {
            tmdbid = actor.$.tmdbid;
        }
        
        return {
            name: actor.n || actor.name || 'Unknown',
            role: actor.role || '',
            thumb: actor.thumb || '',
            tmdbid: tmdbid
        };
    });
}

/**
 * Parse tags from NFO
 * Tags are stored as lowercase for consistency
 */
function parseTags(tagData) {
    if (!tagData) return [];
    
    // Handle single tag as string
    if (typeof tagData === 'string') {
        return [tagData.toLowerCase()];
    }
    
    // Handle array of tags
    if (Array.isArray(tagData)) {
        return tagData
            .filter(tag => tag && typeof tag === 'string')
            .map(tag => tag.toLowerCase());
    }
    
    return [];
}

module.exports = { parseNFO };
