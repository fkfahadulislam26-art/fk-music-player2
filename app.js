const audio = document.getElementById("audio");
const titleEl = document.getElementById("title");
const artistEl = document.getElementById("artist");
const playBtn = document.getElementById("playBtn");
const prevBtn = document.getElementById("prevBtn");
const nextBtn = document.getElementById("nextBtn");
const shuffleBtn = document.getElementById("shuffleBtn");
const repeatBtn = document.getElementById("repeatBtn");
const progress = document.getElementById("progress");
const volume = document.getElementById("volume");
const currentTimeEl = document.getElementById("currentTime");
const durationEl = document.getElementById("duration");
const songList = document.getElementById("songList");
const emptyState = document.getElementById("emptyState");
const fileInput = document.getElementById("fileInput");
const search = document.getElementById("search");
const installBtn = document.getElementById("installBtn");

let songs = JSON.parse(localStorage.getItem("music-player-songs") || "[]");
let currentIndex = -1;
let objectUrls = [];
let shuffle = false;
let repeat = false;
let deferredPrompt = null;

const formatTime = seconds => {
  if (!Number.isFinite(seconds)) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
};

function renderSongs(filter = "") {
  songList.innerHTML = "";
  const q = filter.toLowerCase().trim();
  const visible = songs.map((s, i) => ({...s, index:i}))
    .filter(s => s.name.toLowerCase().includes(q));

  emptyState.classList.toggle("hidden", visible.length !== 0);

  visible.forEach(song => {
    const row = document.createElement("div");
    row.className = "song" + (song.index === currentIndex ? " active" : "");
    row.innerHTML = `
      <div class="song-icon">♫</div>
      <div>
        <div class="song-name">${escapeHtml(song.name)}</div>
        <div class="song-meta">Local audio file</div>
      </div>
      <button class="remove" title="Remove">✕</button>
    `;
    row.addEventListener("click", e => {
      if (e.target.closest(".remove")) return;
      loadSong(song.index, true);
    });
    row.querySelector(".remove").addEventListener("click", e => {
      e.stopPropagation();
      removeSong(song.index);
    });
    songList.appendChild(row);
  });
}

function escapeHtml(str) {
  return str.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
}

function saveSongs() {
  localStorage.setItem("music-player-songs", JSON.stringify(songs));
}

function loadSong(index, autoplay = false) {
  if (!songs[index]) return;
  currentIndex = index;
  cleanupUrls();
  const song = songs[index];

  // Local files are represented by object URLs in this browser session.
  // Imported file bytes are kept in memory while the page is open.
  if (song.file) {
    const url = URL.createObjectURL(song.file);
    objectUrls.push(url);
    audio.src = url;
  } else {
    audio.src = song.src;
  }

  titleEl.textContent = song.name;
  artistEl.textContent = "Local audio file";
  progress.value = 0;
  currentTimeEl.textContent = "0:00";
  durationEl.textContent = "0:00";
  renderSongs(search.value);

  if (autoplay) audio.play().catch(() => {});
}

function cleanupUrls() {
  objectUrls.forEach(url => URL.revokeObjectURL(url));
  objectUrls = [];
}

function removeSong(index) {
  if (index === currentIndex) {
    audio.pause();
    audio.removeAttribute("src");
    currentIndex = -1;
    titleEl.textContent = "No song selected";
    artistEl.textContent = "Choose a song from your library";
  } else if (index < currentIndex) {
    currentIndex--;
  }
  songs.splice(index, 1);
  saveSongs();
  renderSongs(search.value);
}

fileInput.addEventListener("change", e => {
  const files = [...e.target.files];
  files.forEach(file => {
    songs.push({
      id: crypto.randomUUID ? crypto.randomUUID() : Date.now() + Math.random(),
      name: file.name.replace(/\.[^/.]+$/, ""),
      file
    });
  });
  // File objects cannot be persisted in localStorage, so they are session-only.
  // Keep the in-memory list usable; the metadata is not saved for reload.
  renderSongs(search.value);
  fileInput.value = "";
});

playBtn.addEventListener("click", () => {
  if (!audio.src && songs.length) loadSong(0);
  if (!audio.src) return;
  audio.paused ? audio.play() : audio.pause();
});

prevBtn.addEventListener("click", () => {
  if (!songs.length) return;
  const index = currentIndex <= 0 ? songs.length - 1 : currentIndex - 1;
  loadSong(index, true);
});

nextBtn.addEventListener("click", nextSong);

function nextSong() {
  if (!songs.length) return;
  let index;
  if (shuffle && songs.length > 1) {
    do index = Math.floor(Math.random() * songs.length);
    while (index === currentIndex);
  } else {
    index = (currentIndex + 1) % songs.length;
  }
  loadSong(index, true);
}

shuffleBtn.addEventListener("click", () => {
  shuffle = !shuffle;
  shuffleBtn.style.opacity = shuffle ? "1" : ".55";
});

repeatBtn.addEventListener("click", () => {
  repeat = !repeat;
  repeatBtn.style.opacity = repeat ? "1" : ".55";
});

audio.addEventListener("play", () => playBtn.textContent = "⏸");
audio.addEventListener("pause", () => playBtn.textContent = "▶");
audio.addEventListener("loadedmetadata", () => {
  durationEl.textContent = formatTime(audio.duration);
});
audio.addEventListener("timeupdate", () => {
  if (audio.duration) progress.value = (audio.currentTime / audio.duration) * 100;
  currentTimeEl.textContent = formatTime(audio.currentTime);
});
audio.addEventListener("ended", () => {
  if (repeat) loadSong(currentIndex, true);
  else nextSong();
});
progress.addEventListener("input", () => {
  if (audio.duration) audio.currentTime = (progress.value / 100) * audio.duration;
});
volume.addEventListener("input", () => audio.volume = Number(volume.value));
audio.volume = .8;
search.addEventListener("input", () => renderSongs(search.value));

window.addEventListener("beforeunload", cleanupUrls);
window.addEventListener("beforeinstallprompt", e => {
  e.preventDefault();
  deferredPrompt = e;
  installBtn.hidden = false;
});
installBtn.addEventListener("click", async () => {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  await deferredPrompt.userChoice;
  deferredPrompt = null;
  installBtn.hidden = true;
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("pwabuilder-sw.js"));
}

renderSongs();