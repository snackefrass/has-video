# TV Shows Implementation Guide

## Overview
This document tracks the implementation of TV show support for the Jellyfin Custom App.

## File Structure Expected
```
/media/seagate-8tb/Media/TV/
├── Show Name/
│   ├── tvshow.nfo
│   ├── poster.jpg
│   ├── season01-poster.jpg
│   ├── season02-poster.jpg
│   ├── Season 1/
│   │   ├── season.nfo
│   │   ├── Show Name - S01E01.mkv
│   │   ├── Show Name - S01E01.nfo
│   │   ├── Show Name - S01E01.jpg
│   │   └── ...
│   ├── Season 2/
│   │   └── ...
```

## Implementation Status

### ✅ Phase 1: Data Layer (COMPLETE)

#### 1. `tv-nfo-parser.js` - NFO Parsing
**Status:** Created
**Location:** `/src/tv-nfo-parser.js`

**Functions:**
- `parseTVShowNFO(nfoPath)` - Parses tvshow.nfo files
  - Extracts: title, year, plot, rating, actors, genres, studios, season info
  - Returns structured metadata object
  
- `parseEpisodeNFO(nfoPath)` - Parses episode NFO files
  - Extracts: title, season/episode numbers, plot, rating, actors, directors, writers
  - Includes video file metadata (codec, resolution, duration, audio)
  - Returns structured episode metadata

**Key Features:**
- Handles default ratings (IMDb)
- Parses complex actor arrays
- Extracts streamdetails for video information
- Error handling with fallbacks

#### 2. `tv-scanner.js` - Library Scanner
**Status:** Created
**Location:** `/src/tv-scanner.js`

**Functions:**
- `scanLibrary(libraryPath)` - Main entry point, scans entire TV library
- `scanShow(showPath)` - Scans individual show directory
- `scanSeasons(showPath)` - Scans all seasons in a show
- `scanEpisodes(seasonPath, seasonNumber)` - Scans all episodes in a season
- `getAllShows()` - Returns all scanned shows
- `getShow(identifier)` - Get show by title or ID
- `getSeason(showIdentifier, seasonNumber)` - Get specific season
- `getEpisode(showIdentifier, seasonNumber, episodeNumber)` - Get specific episode

**Data Structure:**
```javascript
Show {
  title, year, plot, rating, actors, genres, etc.
  showPath, posterPath,
  seasons: [
    {
      number, name, seasonPath, posterPath,
      episodes: [
        {
          title, season, episode, plot, rating,
          videoPath, nfoPath, thumbPath,
          watchStatus: { watched, position, duration, percentage }
        }
      ]
    }
  ],
  totalSeasons, totalEpisodes
}
```

**Key Features:**
- Automatically finds season/episode files
- Matches NFO files and thumbnails to videos
- Extracts episode numbers from filenames as fallback
- Sorts seasons and episodes naturally
- Tracks all file paths for rendering

#### 3. `watch-data.js` - Watch Tracking Extensions
**Status:** Extended
**Location:** `/src/watch-data.js`

**New TV-Specific Functions:**
- `getShowWatchStats(show)` - Calculate show-level statistics
  - Returns: totalEpisodes, watchedEpisodes, unwatchedEpisodes, inProgressEpisodes, nextEpisode
  
- `getSeasonWatchStats(season)` - Calculate season-level statistics
  - Returns: totalEpisodes, watchedEpisodes, unwatchedEpisodes, inProgressEpisodes
  
- `getNextEpisode(show)` - Get next episode to watch
  - Prioritizes in-progress episodes over unwatched
  - Returns null if all episodes watched

**Key Features:**
- Works with existing file-based tracking
- Each episode tracked by its videoPath
- No changes needed to core watch tracking logic

---

## 📋 Phase 2: UI Components (TODO)

### TV Show Grid
**Files to create/modify:**
- `renderer.js` - Add TV show grid rendering
- Reuse existing `.movie-grid` styles
- New card type: `.tv-show-card`

**Card Features:**
- Show poster (poster.jpg)
- Watched badge (if all episodes watched)
- Unwatched count badge (e.g., "42 episodes")
- Progress bar for in-progress shows (based on next episode)

**Mockup Reference:** Main library view (not provided but similar to movies)

### TV Show Detail Page
**Files to create/modify:**
- `renderer.js` - Add `showTVShowDetail(show)` function
- `keyboard-nav.js` - Add TV show detail navigation
- Reuse `.detail-*` CSS classes

**Components:**
- Show title, year, rating, IMDb score
- Plot description
- "Next Episode" button (prominent, like Play/Resume)
- Mark watched/favorite buttons
- Horizontal season carousel (similar to cast/recommendations)

**Season Cards:**
- Season poster (season01-poster.jpg)
- Season number label ("SEASON 1")
- Episode count ("65 Episodes")
- Watched badge or unwatched count

**Mockup Reference:** `Detail_-_TV_Show.png`

### Season Detail Page
**Files to create/modify:**
- `renderer.js` - Add `showSeasonDetail(show, seasonNumber)` function
- `keyboard-nav.js` - Add season detail navigation

**Components:**
- Show title (breadcrumb behavior)
- Season tabs at top (Season 1, Season 2, etc.)
- Episode title below tabs
- Episode metadata (S02 E55, date, runtime, rating, "Ends at HH:MM")
- Episode plot description
- "Next Episode" / "Resume" / "Play From Beginning" buttons (adaptive like movies)
- Mark watched/favorite buttons
- Resolution/audio badges
- Horizontal episode carousel (episode thumbnails)

**Episode Cards:**
- Episode thumbnail (<episodename>.jpg)
- Episode number badge (top-right: "E55")
- Watched badge (top-left checkmark)
- Progress bar (bottom, if in progress)

**Mockup Reference:** `Detail_-_TV_Show_-_Season.png`

### Search Integration
**Files to modify:**
- `search-ui.js` - Add TV shows carousel
- `search.js` - Update search to include TV shows

**Changes:**
- Keep "Movies" carousel at top
- Add "TV Shows" carousel below
- Use same card styling as movies
- Filter TV shows by title, actors, genres

---

## 📋 Phase 3: Settings & Navigation (TODO)

### Settings Page
**Files to modify:**
- `settings.html` - Add TV library section
- `settings.js` - Add TV library path handling

**New Settings:**
- TV Library Path (directory picker)
- Scan TV Library button
- Last scan timestamp
- Show count display

**Actions:**
- Save TV library path to config.json
- Trigger TV library scan
- Display scan progress/results

### Side Navigation
**Files to modify:**
- `index.html` - Wire up TV Shows nav button
- `main.js` - Add view switching logic
- `keyboard-nav.js` - Add TV Shows nav handling

**Changes:**
- Make "Movies" button switch to movie grid
- Make "TV Shows" button switch to TV show grid
- Highlight active library type
- Separate data arrays (allMovies vs allShows)

---

## 📋 Phase 4: Player Integration (TODO)

### OSD for Episodes
**Files to modify:**
- `osd.js` - Add episode metadata display
- `player.js` - Add episode tracking

**Episode OSD Additions:**
- Show name
- Season/Episode number (e.g., "S02 E55")
- Episode title
- End time calculation (same as movies)

**Next Episode:**
- Auto-advance to next episode after credits
- "Next Episode" button in OSD (optional)

---

## Integration Checklist

### In renderer.js
- [ ] Import tv-scanner and tv-nfo-parser
- [ ] Add `let allShows = []` global variable
- [ ] Add `loadTVLibrary()` function (calls tv-scanner.scanLibrary())
- [ ] Add `renderTVShowGrid()` function
- [ ] Add `showTVShowDetail(show)` function
- [ ] Add `showSeasonDetail(show, seasonNumber)` function
- [ ] Update watch status tracking for episodes

### In main.js
- [ ] Load TV library on startup (if path configured)
- [ ] Add view state for TV shows
- [ ] Wire up TV Shows nav button
- [ ] Add keyboard shortcuts for library switching

### In keyboard-nav.js
- [ ] Add TV show detail mode
- [ ] Add season detail mode
- [ ] Handle season tabs navigation
- [ ] Handle episode carousel navigation
- [ ] Handle adaptive buttons (Next Episode vs Resume vs Play)

### In search-ui.js
- [ ] Add TV shows to search index
- [ ] Render TV shows carousel in results
- [ ] Handle TV show card clicks

### In settings.html & settings.js
- [ ] Add TV library path input
- [ ] Add scan TV library button
- [ ] Show TV library statistics
- [ ] Save/load TV library config

### In player.js & osd.js
- [ ] Handle episode playback
- [ ] Display episode metadata in OSD
- [ ] Track episode watch progress
- [ ] Auto-advance to next episode (optional)

---

## Data Flow

### Startup:
1. Load config.json (TV library path)
2. If TV library path exists:
   - Call `tvScanner.scanLibrary(path)`
   - Store in `allShows` array
   - Load watch data for all episodes
3. Render initial view (Movies or TV Shows based on last view)

### TV Show Grid:
1. Render show cards from `allShows`
2. For each show, call `watchDataManager.getShowWatchStats(show)`
3. Display badges based on watch stats
4. On card click: `showTVShowDetail(show)`

### TV Show Detail:
1. Render show metadata
2. Render season carousel
3. Calculate "Next Episode" using `watchDataManager.getNextEpisode(show)`
4. Wire up "Next Episode" button
5. On season card click: `showSeasonDetail(show, seasonNumber)`

### Season Detail:
1. Render season tabs (switch between seasons without re-scanning)
2. Render focused episode metadata
3. Render episode carousel
4. Calculate adaptive buttons (Resume vs Play vs Play From Beginning)
5. Wire up episode playback
6. On episode card click: focus that episode (update metadata/buttons)

### Playback:
1. Play episode video with OSD
2. Track position with `watchDataManager.updatePosition()`
3. On completion/manual mark: `watchDataManager.markWatched()`
4. Update show/season statistics
5. Find next episode and show "Next Episode" option

---

## Testing Checklist

### Data Layer:
- [ ] Scan library with multiple shows
- [ ] Verify all seasons detected
- [ ] Verify all episodes detected
- [ ] Verify NFO parsing for shows
- [ ] Verify NFO parsing for episodes
- [ ] Verify poster/thumbnail paths
- [ ] Verify watch status tracking

### UI:
- [ ] TV show grid renders correctly
- [ ] Show detail page renders correctly
- [ ] Season detail page renders correctly
- [ ] Season tabs switch correctly
- [ ] Episode carousel scrolls correctly
- [ ] Badges display correctly
- [ ] Progress bars display correctly

### Navigation:
- [ ] Keyboard navigation works in TV grid
- [ ] Keyboard navigation works in show detail
- [ ] Keyboard navigation works in season detail
- [ ] Back button works at all levels
- [ ] Library switching works
- [ ] Search works for TV shows

### Playback:
- [ ] Episodes play correctly
- [ ] OSD shows episode info
- [ ] Watch progress tracked
- [ ] Next episode detected
- [ ] Resume works correctly

---

## Notes

### Differences from Movies:
1. **Hierarchy**: Shows → Seasons → Episodes (3 levels vs 1 level for movies)
2. **Watch Stats**: Track at show, season, and episode level
3. **Next Episode**: Complex logic to find next unwatched/in-progress
4. **Detail Pages**: Two detail pages (show and season) vs one for movies
5. **Tabs**: Season tabs allow switching within detail page
6. **Badges**: Episode number badge in addition to watched badge

### Reusable Components:
- Grid layout and card styling
- Detail page layout
- Carousel/scrolling containers
- Badge system
- Adaptive buttons
- Keyboard navigation patterns
- Watch data tracking
- Search infrastructure

### Performance Considerations:
- TV libraries can be very large (100+ shows, 1000+ episodes)
- Use efficient data structures (Map for lookups)
- Lazy-load episode thumbnails
- Cache watch statistics
- Debounce watch position updates

---

## Next Steps

**Immediate Priority:**
1. ✅ Data layer complete
2. **Start with TV Show Detail Page** (simpler than grid, tests data flow)
3. Add Season Detail Page
4. Add TV Show Grid
5. Wire up navigation
6. Add search integration
7. Update settings page

**Why start with detail pages?**
- Tests the data structure end-to-end
- Establishes UI patterns for badges/carousels
- Easier to debug with one show than a full grid
- Verifies watch status calculations work correctly
