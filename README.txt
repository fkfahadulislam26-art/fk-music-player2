# Music Player PWA

## Run it
A service worker requires HTTPS or localhost. Do not open index.html directly with file://.

Example:
- Python: `python -m http.server 8080`
- Open: `http://localhost:8080`

## Add music
Click "Add Music" and select one or more audio files.

## Install
Use a supported browser's install option after serving the app over HTTPS (or localhost for testing).

## Important
Selected local files are available during the current browser session. For permanent bundled songs, put MP3 files in the `music/` folder and add them as predefined tracks in `app.js`.
