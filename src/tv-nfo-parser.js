const fs = require('fs');
const path = require('path');

class TVNFOParser {
    /**
     * Parse a tvshow.nfo file
     * @param {string} nfoPath - Path to tvshow.nfo
     * @returns {Object} Parsed TV show metadata
     */
    parseTVShowNFO(nfoPath) {
        try {
            const xml = fs.readFileSync(nfoPath, 'utf8');
            const parser = new DOMParser();
            const doc = parser.parseFromString(xml, 'text/xml');

            // Helper function to get text content
            const getText = (tagName, defaultValue = '') => {
                const element = doc.querySelector(tagName);
                return element ? element.textContent.trim() : defaultValue;
            };

            // Helper function to get all elements
            const getAll = (tagName) => {
                return Array.from(doc.querySelectorAll(tagName));
            };

            // Get default rating (IMDb)
            let rating = '';
            let votes = '';
            const defaultRating = doc.querySelector('rating[default="true"]');
            if (defaultRating) {
                const valueEl = defaultRating.querySelector('value');
                const votesEl = defaultRating.querySelector('votes');
                rating = valueEl ? valueEl.textContent.trim() : '';
                votes = votesEl ? votesEl.textContent.trim() : '';
            }

            // Parse actors
            const actors = getAll('actor').map(actor => ({
                name: getText.call({ querySelector: (tag) => actor.querySelector(tag) }, 'n'),
                role: getText.call({ querySelector: (tag) => actor.querySelector(tag) }, 'role'),
                thumb: getText.call({ querySelector: (tag) => actor.querySelector(tag) }, 'thumb'),
                imdbid: getText.call({ querySelector: (tag) => actor.querySelector(tag) }, 'imdbid')
            })).filter(actor => actor.name);

            // Parse genres
            const genres = getAll('genre').map(g => g.textContent.trim()).filter(g => g);

            // Parse studios
            const studios = getAll('studio').map(s => s.textContent.trim()).filter(s => s);

            // Parse seasons (namedseason elements)
            const seasons = getAll('namedseason').map(season => {
                const number = season.getAttribute('number');
                return {
                    number: parseInt(number),
                    name: season.textContent.trim()
                };
            }).filter(s => s.number);

            return {
                title: getText('title'),
                originalTitle: getText('originaltitle'),
                showTitle: getText('showtitle'),
                year: getText('year'),
                plot: getText('plot'),
                runtime: getText('runtime'),
                rating: rating,
                votes: votes,
                mpaa: getText('mpaa'),
                certification: getText('certification'),
                premiered: getText('premiered'),
                status: getText('status'),
                imdbid: getText('imdbid'),
                tmdbid: getText('tmdbid'),
                tvdbid: getText('uniqueid[type="tvdb"]') || getText('id'),
                actors: actors,
                genres: genres,
                studios: studios,
                seasons: seasons,
                // We'll handle season posters separately in the scanner
                thumb: getText('thumb[aspect="poster"]'),
                fanart: getText('fanart thumb'),
                banner: getText('thumb[aspect="banner"]'),
                clearlogo: getText('thumb[aspect="clearlogo"]'),
                clearart: getText('thumb[aspect="clearart"]')
            };
        } catch (err) {
            console.error('Error parsing TV show NFO:', nfoPath, err);
            return null;
        }
    }

    /**
     * Parse an episode.nfo file
     * @param {string} nfoPath - Path to episode.nfo
     * @returns {Object} Parsed episode metadata
     */
    parseEpisodeNFO(nfoPath) {
        try {
            const xml = fs.readFileSync(nfoPath, 'utf8');
            const parser = new DOMParser();
            const doc = parser.parseFromString(xml, 'text/xml');

            // Helper function to get text content
            const getText = (tagName, defaultValue = '') => {
                const element = doc.querySelector(tagName);
                return element ? element.textContent.trim() : defaultValue;
            };

            // Helper function to get all elements
            const getAll = (tagName) => {
                return Array.from(doc.querySelectorAll(tagName));
            };

            // Get default rating (IMDb)
            let rating = '';
            let votes = '';
            const defaultRating = doc.querySelector('rating[default="true"]');
            if (defaultRating) {
                const valueEl = defaultRating.querySelector('value');
                const votesEl = defaultRating.querySelector('votes');
                rating = valueEl ? valueEl.textContent.trim() : '';
                votes = votesEl ? votesEl.textContent.trim() : '';
            }

            // Parse actors
            const actors = getAll('actor').map(actor => ({
                name: getText.call({ querySelector: (tag) => actor.querySelector(tag) }, 'n'),
                role: getText.call({ querySelector: (tag) => actor.querySelector(tag) }, 'role'),
                thumb: getText.call({ querySelector: (tag) => actor.querySelector(tag) }, 'thumb')
            })).filter(actor => actor.name);

            // Parse directors
            const directors = getAll('director').map(d => ({
                name: d.textContent.trim(),
                imdbid: d.getAttribute('imdbid') || ''
            })).filter(d => d.name);

            // Parse writers/credits
            const writers = getAll('credits').map(c => ({
                name: c.textContent.trim(),
                imdbid: c.getAttribute('imdbid') || ''
            })).filter(w => w.name);

            // Parse fileinfo for video details
            let videoCodec = '';
            let resolution = '';
            let audioCodec = '';
            let audioChannels = '';
            let duration = 0;

            const streamDetails = doc.querySelector('streamdetails');
            if (streamDetails) {
                const videoEl = streamDetails.querySelector('video');
                if (videoEl) {
                    videoCodec = getText.call({ querySelector: (tag) => videoEl.querySelector(tag) }, 'codec');
                    const width = getText.call({ querySelector: (tag) => videoEl.querySelector(tag) }, 'width');
                    const height = getText.call({ querySelector: (tag) => videoEl.querySelector(tag) }, 'height');
                    if (width && height) {
                        resolution = `${width}x${height}`;
                    }
                    const durationStr = getText.call({ querySelector: (tag) => videoEl.querySelector(tag) }, 'durationinseconds');
                    if (durationStr) {
                        duration = parseInt(durationStr);
                    }
                }

                const audioEl = streamDetails.querySelector('audio');
                if (audioEl) {
                    audioCodec = getText.call({ querySelector: (tag) => audioEl.querySelector(tag) }, 'codec');
                    audioChannels = getText.call({ querySelector: (tag) => audioEl.querySelector(tag) }, 'channels');
                }
            }

            return {
                title: getText('title'),
                originalTitle: getText('originaltitle'),
                showTitle: getText('showtitle'),
                season: parseInt(getText('season', '0')),
                episode: parseInt(getText('episode', '0')),
                plot: getText('plot'),
                runtime: parseInt(getText('runtime', '0')),
                rating: rating,
                votes: votes,
                mpaa: getText('mpaa'),
                premiered: getText('premiered'),
                aired: getText('aired'),
                imdbid: getText('uniqueid[default="true"]') || getText('id'),
                tmdbid: getText('uniqueid[type="tmdb"]'),
                tvdbid: getText('uniqueid[type="tvdb"]'),
                thumb: getText('thumb'),
                actors: actors,
                directors: directors,
                writers: writers,
                studio: getText('studio'),
                // Video file details
                videoCodec: videoCodec,
                resolution: resolution,
                audioCodec: audioCodec,
                audioChannels: audioChannels,
                duration: duration
            };
        } catch (err) {
            console.error('Error parsing episode NFO:', nfoPath, err);
            return null;
        }
    }
}

module.exports = new TVNFOParser();
