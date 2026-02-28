# Jellyfin Custom Client - VLC Edition

A custom Jellyfin client that reads local .nfo files and plays movies directly in VLC with no transcoding.

## 🎯 Features

- ✅ **Local NFO Files** - Reads metadata from .nfo files (Kodi/Emby format)
- ✅ **VLC Playback** - Direct playback with VLC (no transcoding ever!)
- ✅ **Jellyfin Sync** - Optional sync for watch status and progress
- ✅ **Custom UI** - Cyan-themed modern interface
- ✅ **Resume Playback** - Continues where you left off
- ✅ **Search & Filter** - Find movies quickly
- ✅ **100% Local** - Works offline

## 📋 Requirements

- **Linux Mint** (or any Linux distro)
- **Node.js** 20+ and npm
- **VLC Media Player** installed
- **Jellyfin Server** (optional - for watch status sync only)

## 🚀 Quick Start

### 1. Install Dependencies

```bash
cd ~/jellyfin-custom-app
npm install
```

### 2. Configure Your Movies Path

Edit `config.json`:

```json
{
  "moviesPath": "/home/marcus/Movies",
  "jellyfinEnabled": false
}
```

Or use the Settings UI (⚙️ button) after starting the app.

### 3. Run the App

```bash
npm start
```

## 📁 Expected Movie Folder Structure

```
/home/marcus/Movies/
├── Inception (2010)/
│   ├── Inception.mkv
│   ├── Inception.nfo
│   ├── poster.jpg
│   └── fanart.jpg
├── The Matrix (1999)/
│   ├── The Matrix.mkv
│   ├── The Matrix.nfo
│   ├── poster.jpg
│   └── fanart.jpg
└── ...
```

### NFO File Format

Standard Kodi/Emby XML format:

```xml
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<movie>
    <title>Inception</title>
    <originaltitle>Inception</originaltitle>
    <year>2010</year>
    <rating>8.8</rating>
    <plot>A thief who steals corporate secrets...</plot>
    <tagline>Your mind is the scene of the crime</tagline>
    <runtime>148</runtime>
    <genre>Action</genre>
    <genre>Sci-Fi</genre>
    <director>Christopher Nolan</director>
    <actor>
        <name>Leonardo DiCaprio</name>
        <role>Dom Cobb</role>
    </actor>
</movie>
```

## 🔧 Jellyfin Sync (Optional)

To sync watch status across devices:

### 1. Get Your Jellyfin API Key

- Open Jellyfin Dashboard
- Go to **API Keys**
- Click **+** to create new key
- Copy the key

### 2. Get Your User ID

- In Jellyfin, go to your profile
- Look in the URL: `http://localhost:8096/web/index.html#!/users/USER_ID_HERE`
- Copy the USER_ID

### 3. Configure in Settings

Open app → Click ⚙️ → Enable Jellyfin Sync → Enter:
- Server: `http://localhost:8096`
- API Key: (paste your key)
- User ID: (paste your user ID)

## 🎮 Usage

### Browse Movies
- Scroll through your movie grid
- Click any movie to see details

### Play Movie
- Click movie → Click "▶ Play Movie"
- VLC opens fullscreen
- Press ESC to exit VLC and return to app

### Resume Playback
- If you stop mid-movie, app remembers position
- Next time: "▶ Resume" or "↻ Play from Start"

### Search
- Use search bar at top
- Searches title, year, and genres

## 📦 Building for Distribution

### Create AppImage (Portable)

```bash
npm run build:linux
```

Output: `dist/jellyfin-custom-app-*.AppImage`

**To use:**
```bash
chmod +x dist/jellyfin-custom-app-*.AppImage
./dist/jellyfin-custom-app-*.AppImage
```

### Create .deb Package

```bash
npm run build:linux
```

Output: `dist/jellyfin-custom-app_*_amd64.deb`

**To install:**
```bash
sudo dpkg -i dist/jellyfin-custom-app_*_amd64.deb
```

## 🎨 Customization

### Change Theme Colors

Edit `src/styles.css`:

```css
/* Change cyan accent to any color */
--accent-color: #00BCD4;  /* Change this */
```

### Grid Layout

In `src/styles.css`, find `.movie-grid`:

```css
.movie-grid {
    grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
    /* Change 200px to adjust card size */
}
```

### VLC Options

Edit `src/main.js`, line ~52:

```javascript
const vlcArgs = [
    '--fullscreen',
    '--no-video-title-show',
    // Add more VLC options here
];
```

## 🐛 Troubleshooting

### Movies Not Loading

**Check:**
1. Movies path is correct in config.json
2. Each movie folder has a .nfo file
3. Check console for errors (Ctrl+Shift+I)

### VLC Not Opening

**Check:**
1. VLC is installed: `which vlc`
2. Install if missing: `sudo apt install vlc`

### Jellyfin Sync Not Working

**Check:**
1. Jellyfin server is running
2. API key is correct
3. User ID is correct
4. Check console for error messages

### Progress Not Saving

**Note:** VLC progress tracking requires VLC HTTP interface. Current version marks movies as "watched" after playback ends, but doesn't track exact position during playback.

**To enable position tracking:**
- Requires additional VLC HTTP interface setup
- Will be added in future version

## 📝 Development

### Project Structure

```
jellyfin-custom-app/
├── src/
│   ├── main.js              # Electron main process
│   ├── renderer.js          # UI logic
│   ├── index.html           # Main UI
│   ├── styles.css           # Styling
│   ├── nfo-parser.js        # NFO file parser
│   ├── movie-scanner.js     # Movie folder scanner
│   └── jellyfin-sync.js     # Jellyfin API integration
├── config.json              # User configuration
└── package.json             # Dependencies
```

### Run in Development

```bash
npm start
```

### Enable DevTools

In `src/main.js`, line ~21:
```javascript
mainWindow.webContents.openDevTools();  // Already enabled
```

## 🚀 Roadmap

- [ ] Real-time playback position tracking
- [ ] Collections support
- [ ] TV shows support
- [ ] Custom backgrounds
- [ ] Keyboard shortcuts
- [ ] Remote control support

## 📄 License

MIT

## 🙏 Credits

- Jellyfin Team for the amazing media server
- VLC Team for the best video player
- You for using this app!

---

**Enjoy your movies! 🎬**
