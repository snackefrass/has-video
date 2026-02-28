const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const util = require('util');
const execPromise = util.promisify(exec);

/**
 * Get all subtitle tracks from a video file (both embedded and external)
 * Returns array of subtitle objects with language and source info
 */
async function getSubtitles(videoPath) {
    const subtitles = [];
    
    // 1. Check for embedded subtitles in MKV/MP4 using ffprobe
    try {
        const embeddedSubs = await getEmbeddedSubtitles(videoPath);
        subtitles.push(...embeddedSubs);
    } catch (err) {
        console.error('Error getting embedded subtitles:', err);
    }
    
    // 2. Check for external .srt files
    try {
        const externalSubs = getExternalSubtitles(videoPath);
        subtitles.push(...externalSubs);
    } catch (err) {
        console.error('Error getting external subtitles:', err);
    }
    
    return subtitles;
}

/**
 * Get embedded subtitle tracks from video file using ffprobe
 */
async function getEmbeddedSubtitles(videoPath) {
    const subtitles = [];
    
    // Use ffprobe to get subtitle stream info including forced flag
    const command = `ffprobe -v error -select_streams s -show_entries stream=index:stream_tags=language:disposition=forced -of json "${videoPath}"`;
    
    try {
        const { stdout } = await execPromise(command);
        const data = JSON.parse(stdout);
        
        if (data.streams) {
            data.streams.forEach((stream, index) => {
                const language = stream.tags?.language || 'und';
                const isForced = stream.disposition?.forced === 1;
                
                subtitles.push({
                    type: 'embedded',
                    language: mapLanguageCode(language),
                    languageCode: language,
                    streamIndex: stream.index,
                    trackNumber: index,
                    forced: isForced
                });
            });
        }
    } catch (err) {
        // ffprobe might not be available or video has no embedded subs
        // This is not necessarily an error, just no embedded subtitles
    }
    
    return subtitles;
}

/**
 * Get external .srt subtitle files
 */
function getExternalSubtitles(videoPath) {
    const subtitles = [];
    const videoDir = path.dirname(videoPath);
    const videoBasename = path.basename(videoPath, path.extname(videoPath));
    
    try {
        const files = fs.readdirSync(videoDir);
        const srtFiles = files.filter(file => 
            file.endsWith('.srt') && file.startsWith(videoBasename)
        );
        
        srtFiles.forEach(srtFile => {
            // Try to extract language code from filename
            // Handles patterns like:
            // - video.eng.srt
            // - video.eng.forced.srt
            // - video.eng.sdh.srt
            // - video.en.forced.srt
            let langCode = 'und';
            
            // First try to match language code before .forced or .sdh
            let match = srtFile.match(/\.([a-z]{2,3})\.(forced|sdh)\.srt$/i);
            if (match) {
                langCode = match[1].toLowerCase();
            } else {
                // Try standard pattern: language before .srt
                match = srtFile.match(/\.([a-z]{2,3})\.srt$/i);
                if (match) {
                    langCode = match[1].toLowerCase();
                }
            }
            
            subtitles.push({
                type: 'external',
                language: mapLanguageCode(langCode),
                languageCode: langCode,
                filepath: path.join(videoDir, srtFile),
                filename: srtFile
            });
        });
    } catch (err) {
        console.error('Error reading external subtitle files:', err);
    }
    
    return subtitles;
}

/**
 * Map language codes to full language names
 */
function mapLanguageCode(code) {
    const langMap = {
        'eng': 'English',
        'en': 'English',
        'spa': 'Spanish',
        'es': 'Spanish',
        'fre': 'French',
        'fra': 'French',
        'fr': 'French',
        'ger': 'German',
        'deu': 'German',
        'de': 'German',
        'ita': 'Italian',
        'it': 'Italian',
        'jpn': 'Japanese',
        'ja': 'Japanese',
        'kor': 'Korean',
        'ko': 'Korean',
        'chi': 'Chinese',
        'zho': 'Chinese',
        'zh': 'Chinese',
        'por': 'Portuguese',
        'pt': 'Portuguese',
        'rus': 'Russian',
        'ru': 'Russian',
        'ara': 'Arabic',
        'ar': 'Arabic',
        'hin': 'Hindi',
        'hi': 'Hindi',
        'dut': 'Dutch',
        'nld': 'Dutch',
        'nl': 'Dutch',
        'pol': 'Polish',
        'pl': 'Polish',
        'swe': 'Swedish',
        'sv': 'Swedish',
        'nor': 'Norwegian',
        'no': 'Norwegian',
        'dan': 'Danish',
        'da': 'Danish',
        'fin': 'Finnish',
        'fi': 'Finnish',
        'und': 'Unknown'
    };
    
    return langMap[code.toLowerCase()] || code.toUpperCase();
}

/**
 * Get subtitle summary text for badges (e.g., "English, Spanish")
 */
async function getSubtitleSummary(videoPath) {
    const subtitles = await getSubtitles(videoPath);
    
    if (subtitles.length === 0) {
        return 'None';
    }
    
    // Get unique languages
    const languages = [...new Set(subtitles.map(sub => sub.language))];
    return languages.join(', ');
}

/**
 * Check if video has forced subtitles (external or embedded)
 * Returns { hasForced: boolean, trackId: number|null, isExternal: boolean }
 */
async function checkForForcedSubtitles(videoPath) {
    const result = { hasForced: false, trackId: null, isExternal: false };
    
    // First check external files for .forced.
    try {
        const path = require('path');
        const fs = require('fs');
        const videoDir = path.dirname(videoPath);
        const videoBasename = path.basename(videoPath, path.extname(videoPath));
        const files = fs.readdirSync(videoDir);
        
        const forcedSrtFile = files.find(file => {
            if (!file.endsWith('.srt')) return false;
            if (!file.includes('.forced.')) return false;
            
            const srtBasename = path.basename(file, '.srt');
            
            // Check if subtitle matches this video
            if (srtBasename.startsWith(videoBasename)) return true;
            
            // Also check by episode ID
            const episodeMatch = videoBasename.match(/S\d+E\d+/i);
            if (episodeMatch && srtBasename.includes(episodeMatch[0])) return true;
            
            return false;
        });
        
        if (forcedSrtFile) {
            result.hasForced = true;
            result.isExternal = true;
            return result;
        }
    } catch (err) {
        console.error('Error checking external forced subtitles:', err);
    }
    
    // Check embedded subtitles for forced flag
    try {
        const embeddedSubs = await getEmbeddedSubtitles(videoPath);
        
        if (embeddedSubs.length > 0) {
            console.log('Embedded subtitle tracks found:');
            embeddedSubs.forEach((sub, idx) => {
                console.log(`  Track ${idx}: language=${sub.languageCode}, forced=${sub.forced}, streamIndex=${sub.streamIndex}`);
            });
        }
        
        // Find all forced tracks
        const forcedTracks = embeddedSubs.filter(sub => sub.forced);
        
        if (forcedTracks.length > 0) {
            console.log('Found forced tracks:', forcedTracks.map(t => `${t.language} (${t.languageCode})`).join(', '));
            
            // Prioritize English forced subtitles
            let selectedTrack = forcedTracks.find(sub => 
                sub.languageCode === 'eng' || sub.languageCode === 'en'
            );
            
            // If no English forced track, use the first forced track
            if (!selectedTrack) {
                selectedTrack = forcedTracks[0];
            }
            
            console.log(`Selected forced track: ${selectedTrack.language} (streamIndex=${selectedTrack.streamIndex}, trackNumber=${selectedTrack.trackNumber})`);
            
            result.hasForced = true;
            // Use trackNumber (0-indexed position among subtitle tracks) + 1 for MPV (1-indexed)
            result.trackId = selectedTrack.trackNumber + 1;
            result.isExternal = false;
        }
    } catch (err) {
        console.error('Error checking embedded forced subtitles:', err);
    }
    
    return result;
}

module.exports = {
    getSubtitles,
    getEmbeddedSubtitles,
    getExternalSubtitles,
    getSubtitleSummary,
    mapLanguageCode,
    checkForForcedSubtitles
};
