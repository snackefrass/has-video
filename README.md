# has-video

a local media player for movies and TV shows. it reads your existing media files and metadata, plays them through MPV, and keeps track of what you have and haven't watched — all without an internet connection.

Jellyfin sync is optional and only used to share your watch history with other devices.

---

## What It Does

- reads movie and TV show folders on your computer
- displays posters, descriptions, ratings, and cast info from your local metadata files
- plays video files through MPV (no transcoding, no quality loss)
- remembers where you stopped watching and lets you resume
- tracks which episodes and movies you've watched
- shows a "Continue Watching" row for anything you've started
- supports external and embedded subtitles with adjustable size, position, and color
- works completely offline

---

## What You Need Before Starting

install these if you don't already have them:

**Node.js** (version 20 or newer)
```
sudo apt install nodejs npm
```

**MPV** (the video player the app uses)
```
sudo apt install mpv
```

**ffprobe** (used to detect subtitles embedded in video files)
```
sudo apt install ffmpeg
```

---

## Installation

1. open a terminal in the `has-video` folder
2. run the setup script:
```
bash setup.sh
```

if there's no setup script or it doesn't work, install manually:
```
npm install
```

---

## Setting Up Your Media Folders

the app expects your movies and TV shows to be organized in a specific way. if you already use Kodi, Emby, or Jellyfin, your files are probably already compatible.

### Movies

each movie should be in its own folder:

```
/home/marcus/Movies/
    Inception (2010)/
        Inception.mkv
        Inception.nfo
        poster.jpg
        fanart.jpg
    The Matrix (1999)/
        The Matrix.mkv
        The Matrix.nfo
        poster.jpg
        fanart.jpg
```

the `.nfo` file has the movie's title, year, description, rating, cast, and tags. these get generated automatically by Kodi, Emby, or Jellyfin — if you already use one of those, you likely have them. if you don't, the app will still show the movie but without metadata.

### TV Shows

TV shows follow a Show → Season → Episode structure:

```
/home/marcus/TV Shows/
    Breaking Bad/
        tvshow.nfo
        poster.jpg
        Season 1/
            Breaking Bad - S01E01 - Pilot.mkv
            Breaking Bad - S01E01 - Pilot.nfo
            Breaking Bad - S01E01 - Pilot.jpg
        Season 2/
            ...
```

### Supported Video File Types

`.mkv`, `.mp4`, `.avi`, `.m4v`, `.mov`

---

## Running the App

```
npm start
```

the first time you open it, click the settings button (gear icon) and set the paths to your Movies and TV Shows folders. the app will scan them and build your library.

---

## Settings

open settings by clicking the gear icon in the top-right corner.

| Setting | What It Does |
|---|---|
| Movies Path | the folder where your movies are stored |
| TV Shows Path | the folder where your TV shows are stored |
| Subtitle Size | makes subtitles larger or smaller |
| Subtitle Position | moves subtitles up or down on screen |
| Subtitle Color | changes the subtitle text color |
| Auto-play Next Episode | automatically starts the next episode when one finishes |

changes take effect immediately. use the Rescan button after adding new movies or shows.

---

## Using the App

### Browsing

- movies and TV shows appear in a grid with their posters
- click any item to see its full details, description, cast, and episode list (for TV shows)

### Playing

- on a movie detail page, click "Play Movie" to start watching
- on a TV show, select a season and episode, then click Play
- the video opens fullscreen in MPV

### Resuming

- if you stopped a movie or episode partway through, a "Resume" button will appear
- you can also choose "Play from Start" to ignore the saved position

### Continue Watching

- the home screen shows a row of everything you've started but not finished
- this includes both movies and TV episodes

### Tags

tags come from the `<tag>` field in your `.nfo` files and can be used to group movies however you want (ex. directed by alfred hitchcock, rainy day favs, comfort watches, etc.). movies that share a tag will show up in each other's recommendations. i recommend not just copying tags straight from TMDb — custom tags you actually care about are way more useful — but it's up to you.

### Subtitles

- if subtitles are available (either embedded in the file or as a separate `.srt` in the same folder), the app detects them automatically
- you can choose which subtitle track to use from the playback screen
- adjust size, position, and color in Settings

### Playlists

- you can create playlists and add movies or TV episodes to them
- playlists support shuffle playback

---

## Optional: Jellyfin Sync

if you run a Jellyfin media server, the app can sync your watch history to it. marking something as watched here will also mark it as watched in Jellyfin, and vice versa.

this is entirely optional. the app works without it.

to enable it:

1. open your Jellyfin web interface
2. go to Dashboard → API Keys and create a new key
3. go to your Jellyfin profile page — your User ID is in the URL after `/users/`
4. in has-video Settings, enable Jellyfin Sync and enter:
   - Server address (ex. `http://localhost:8096`)
   - API Key
   - User ID

---

## Building a Standalone Installer

to create a file you can install on other computers without needing Node.js:

```
npm run build:linux
```

this creates two files in the `dist/` folder:
- an AppImage (portable, runs anywhere)
- a `.deb` package (installs like any other Linux program)

to run the AppImage:
```
chmod +x dist/has-video-*.AppImage
./dist/has-video-*.AppImage
```

to install the `.deb` package:
```
sudo dpkg -i dist/has-video_*_amd64.deb
```

---

## Troubleshooting

### movies or shows aren't showing up

- make sure the path in Settings points to the right folder
- each movie needs to be in its own subfolder
- the app looks for `.nfo` files for metadata — without them, items may not appear correctly
- open the developer console with Ctrl+Shift+I and check for errors

### video won't play

- make sure MPV is installed: run `which mpv` in a terminal. if nothing comes back, install it with `sudo apt install mpv`
- check that the file itself isn't corrupted by opening it directly in MPV

### subtitles aren't showing

- make sure ffmpeg is installed: run `which ffprobe` in a terminal. if nothing comes back, install it with `sudo apt install ffmpeg`
- external subtitle files should be in the same folder as the video with a matching filename

### Jellyfin sync isn't working

- confirm your Jellyfin server is running and reachable in a browser
- double-check your API key and User ID in Settings
- open the developer console with Ctrl+Shift+I to see any error messages

### watch progress isn't saving

- progress is saved to `watch-data.json` in the app folder
- make sure the app folder isn't read-only

---

## Project Structure

```
has-video/
    src/
        main.js              main application window and process management
        renderer.js          user interface logic
        player.js            MPV integration and playback control
        movie-scanner.js     scans movie folders and reads metadata
        tv-scanner.js        scans TV show folders and builds episode lists
        nfo-parser.js        reads movie .nfo metadata files
        tv-nfo-parser.js     reads TV show and episode .nfo metadata files
        watch-data.js        saves and loads watch history and progress
        jellyfin-sync.js     optional Jellyfin server integration
        settings.js          settings page logic
        search.js            search functionality
        subtitle-detector.js finds and reads subtitle tracks
        osd.js               on-screen overlay during playback
        playlist-manager.js  user playlist management
        index.html           main interface
        settings.html        settings page
    config.json              your saved settings (created on first run)
    watch-data.json          your watch history (created on first run)
    package.json             project dependencies
```

---

## License

MIT
