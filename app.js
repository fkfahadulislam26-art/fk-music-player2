const $ = id => document.getElementById(id);
const audio = $("audio");
const titleEl = $("title"), artistEl = $("artist"), albumEl = $("album"), coverEl = $("cover");
const playBtn = $("playBtn"), prevBtn = $("prevBtn"), nextBtn = $("nextBtn"), shuffleBtn = $("shuffleBtn"), repeatBtn = $("repeatBtn");
const progress = $("progress"), volume = $("volume"), currentTimeEl = $("currentTime"), durationEl = $("duration");
const songList = $("songList"), emptyState = $("emptyState"), fileInput = $("fileInput"), search = $("search");
const favoriteNowBtn = $("favoriteNowBtn"), favoriteList = $("favoriteList"), favoriteEmpty = $("favoriteEmpty");
const playlistList = $("playlistList"), playlistEmpty = $("playlistEmpty"), newPlaylistBtn = $("newPlaylistBtn");
const playlistDialog = $("playlistDialog"), playlistPickerDialog = $("playlistPickerDialog"), playlistForm = $("playlistForm"), playlistName = $("playlistName"), playlistPicker = $("playlistPicker");
const themeBtn = $("themeBtn"), themeBtn2 = $("themeBtn2"), installBtn = $("installBtn"), playerCard = $("playerCard"), songCount = $("songCount");

const DB_NAME = "fk-music-db";
const DB_VERSION = 1;
let db;
let songs = [];
let playlists = [];
let currentIndex = -1;
let currentObjectUrl = null;
let currentCoverUrl = null;
let shuffle = false;
let repeat = false;
let deferredPrompt = null;
let activePlaylistForSong = null;

const formatTime = seconds => {
  if (!Number.isFinite(seconds)) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
};

function openDB(){
  return new Promise((resolve,reject)=>{
    const req=indexedDB.open(DB_NAME,DB_VERSION);
    req.onupgradeneeded=()=>{
      const d=req.result;
      if(!d.objectStoreNames.contains("songs")) d.createObjectStore("songs",{keyPath:"id"});
      if(!d.objectStoreNames.contains("playlists")) d.createObjectStore("playlists",{keyPath:"id"});
    };
    req.onsuccess=()=>resolve(req.result);
    req.onerror=()=>reject(req.error);
  });
}
function idbAll(store){return new Promise((res,rej)=>{const r=db.transaction(store,"readonly").objectStore(store).getAll();r.onsuccess=()=>res(r.result||[]);r.onerror=()=>rej(r.error);});}
function idbPut(store,val){return new Promise((res,rej)=>{const r=db.transaction(store,"readwrite").objectStore(store).put(val);r.onsuccess=()=>res();r.onerror=()=>rej(r.error);});}
function idbDelete(store,key){return new Promise((res,rej)=>{const r=db.transaction(store,"readwrite").objectStore(store).delete(key);r.onsuccess=()=>res();r.onerror=()=>rej(r.error);});}
function idbClear(store){return new Promise((res,rej)=>{const r=db.transaction(store,"readwrite").objectStore(store).clear();r.onsuccess=()=>res();r.onerror=()=>rej(r.error);});}

function escapeHtml(str=""){return str.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));}
function escapeAttr(str=""){return escapeHtml(str).replace(/`/g,"&#096;");}
function placeholderData(){return "";}
function coverStyle(song){return song.coverBlob ? "" : "background-image:linear-gradient(135deg,#7c3aed,#06b6d4)";}

function decodeText(bytes, encoding=3){
  try{
    if(encoding===1 || encoding===2) return new TextDecoder(encoding===1?"utf-16":"utf-16be").decode(bytes).replace(/\0/g,"").trim();
    if(encoding===0) return new TextDecoder("windows-1252").decode(bytes).replace(/\0/g,"").trim();
    return new TextDecoder("utf-8").decode(bytes).replace(/\0/g,"").trim();
  }catch{return new TextDecoder().decode(bytes).replace(/\0/g,"").trim();}
}
function trimNull(s){return (s||"").replace(/\0/g,"").trim();}
function readSynchsafe(b){return (b[0]&127)<<21 | (b[1]&127)<<14 | (b[2]&127)<<7 | (b[3]&127);}
async function parseID3(file){
  if(!/^audio\/mpeg|\.mp3$/i.test(file.type||file.name)) return {};
  const buf=await file.slice(0,1024*1024).arrayBuffer();
  const b=new Uint8Array(buf);
  if(b.length<10 || String.fromCharCode(...b.slice(0,3))!=="ID3") return {};
  const major=b[3], tagSize=readSynchsafe(b.slice(6,10));
  let pos=10, end=Math.min(b.length,10+tagSize), out={};
  while(pos<end-10){
    let id, size;
    if(major===2){id=String.fromCharCode(...b.slice(pos,pos+3)); size=(b[pos+3]<<16)|(b[pos+4]<<8)|b[pos+5]; pos+=6;}
    else {id=String.fromCharCode(...b.slice(pos,pos+4)); size=major===4?readSynchsafe(b.slice(pos+4,pos+8)):((b[pos+4]<<24)>>>0)|(b[pos+5]<<16)|(b[pos+6]<<8)|b[pos+7]; pos+=10;}
    if(!id || /^\x00+$/.test(id) || !size) break;
    const frame=b.slice(pos,Math.min(end,pos+size)); pos+=size;
    if(id==="TIT2"||id==="TT2"||id==="TPE1"||id==="TP1"||id==="TALB"||id==="TAL"||id==="TPE2"){
      const key=id.startsWith("TIT")?"title":(id.startsWith("TAL")?"album":"artist");
      if(!out[key] && frame.length) out[key]=decodeText(frame.slice(1),frame[0]);
    }
    if(id==="APIC" && frame.length && !out.coverBlob){
      const enc=frame[0]; let p=1;
      while(p<frame.length && frame[p]!==0)p++;
      const mime=new TextDecoder().decode(frame.slice(1,p))||"image/jpeg"; p++;
      p++; // picture type
      if(enc===0||enc===3){while(p<frame.length&&frame[p]!==0)p++;p++;}
      else {while(p+1<frame.length&&(frame[p]!==0||frame[p+1]!==0))p+=2;p+=2;}
      out.coverBlob=new Blob([frame.slice(p)],{type:mime});
    }
  }
  return out;
}
function parseFilename(name){
  const clean=name.replace(/\.[^/.]+$/i,"");
  const parts=clean.split(" - ");
  if(parts.length>=2) return {artist:parts[0].trim(),title:parts.slice(1).join(" - ").trim()};
  return {artist:"Unknown Artist",title:clean};
}

async function addFiles(files){
  for(const file of files){
    if(!file.type.startsWith("audio/") && !/\.(mp3|m4a|aac|wav|ogg|flac|opus)$/i.test(file.name)) continue;
    const parsed=await parseID3(file);
    const fallback=parseFilename(file.name);
    const song={id:(crypto.randomUUID?crypto.randomUUID():Date.now()+Math.random()),fileBlob:file,name:parsed.title||fallback.title,artist:parsed.artist||fallback.artist||"Unknown Artist",album:parsed.album||"Unknown Album",coverBlob:parsed.coverBlob||null,favorite:false,addedAt:Date.now(),mime:file.type||"audio/mpeg"};
    songs.push(song);
    await idbPut("songs",song);
  }
  renderAll();
  toast(`${files.length} song${files.length===1?"":"s"} added`);
}

function songCoverMarkup(song,cls="song-cover"){
  if(song.coverBlob){
    const url=URL.createObjectURL(song.coverBlob);
    setTimeout(()=>URL.revokeObjectURL(url),60000);
    return `<img class="${cls}" src="${url}" alt="">`;
  }
  return `<div class="${cls}">♫</div>`;
}

function renderSongs(filter=""){
  songList.innerHTML="";
  const q=filter.toLowerCase().trim();
  const visible=songs.map((s,i)=>({...s,index:i})).filter(s=>`${s.name} ${s.artist} ${s.album}`.toLowerCase().includes(q));
  emptyState.classList.toggle("hidden",visible.length!==0);
  visible.forEach(song=>{
    const row=document.createElement("div"); row.className="song"+(song.index===currentIndex?" active":"");
    const cover=songCoverMarkup(song);
    row.innerHTML=`${cover}<div><div class="song-name">${escapeHtml(song.name)}</div><div class="song-meta">${escapeHtml(song.artist)} • ${escapeHtml(song.album)}</div></div><button class="song-action favorite ${song.favorite?"active":""}" title="Favorite" aria-label="Favorite">${song.favorite?"♥":"♡"}</button><button class="song-action remove" title="Remove" aria-label="Remove">✕</button>`;
    row.addEventListener("click",e=>{if(e.target.closest(".song-action"))return;loadSong(song.index,true);});
    row.querySelector(".favorite").addEventListener("click",e=>{e.stopPropagation();toggleFavorite(song.index);});
    row.querySelector(".remove").addEventListener("click",e=>{e.stopPropagation();removeSong(song.index);});
    songList.appendChild(row);
  });
  songCount.textContent=songs.length;
}

function renderFavorites(){
  favoriteList.innerHTML="";
  const fav=songs.map((s,i)=>({...s,index:i})).filter(s=>s.favorite);
  favoriteEmpty.classList.toggle("hidden",fav.length>0);
  fav.forEach(song=>{
    const row=document.createElement("div");row.className="mini-item";row.innerHTML=`${songCoverMarkup(song,"mini-cover")}<div class="mini-main"><strong>${escapeHtml(song.name)}</strong><span>${escapeHtml(song.artist)}</span></div><button class="song-action favorite active">♥</button>`;
    row.addEventListener("click",e=>{if(e.target.closest("button"))return;loadSong(song.index,true);});
    row.querySelector("button").addEventListener("click",e=>{e.stopPropagation();toggleFavorite(song.index);});
    favoriteList.appendChild(row);
  });
}

function renderPlaylists(){
  playlistList.innerHTML="";
  playlistEmpty.classList.toggle("hidden",playlists.length>0);
  playlists.forEach(pl=>{
    const row=document.createElement("div");row.className="playlist-item";row.innerHTML=`<div class="mini-cover">📋</div><div class="mini-main"><strong>${escapeHtml(pl.name)}</strong><span class="count">${pl.songIds.length} song${pl.songIds.length===1?"":"s"}</span></div><div class="playlist-actions"><button class="song-action add-song" title="Add song">＋</button><button class="song-action delete-playlist" title="Delete">✕</button></div>`;
    row.querySelector(".add-song").addEventListener("click",e=>{e.stopPropagation();openPicker(pl.id);});
    row.querySelector(".delete-playlist").addEventListener("click",async e=>{e.stopPropagation();if(confirm(`Delete playlist “${pl.name}”?`)){playlists=playlists.filter(x=>x.id!==pl.id);await idbDelete("playlists",pl.id);renderPlaylists();toast("Playlist deleted");}});
    row.addEventListener("click",e=>{if(e.target.closest("button"))return;playPlaylist(pl);});
    playlistList.appendChild(row);
  });
}

async function playPlaylist(pl){
  const first=pl.songIds.map(id=>songs.findIndex(s=>s.id===id)).find(i=>i>=0);
  if(first!==undefined) loadSong(first,true);
  else toast("This playlist has no available songs");
}
function openPicker(playlistId){
  activePlaylistForSong=playlistId; playlistPicker.innerHTML="";
  const pl=playlists.find(p=>p.id===playlistId); if(!pl)return;
  songs.forEach(song=>{
    const btn=document.createElement("button");btn.type="button";btn.className=pl.songIds.includes(song.id)?"active":"";btn.innerHTML=`<span>${escapeHtml(song.name)}<small>${escapeHtml(song.artist)}</small></span><span>${pl.songIds.includes(song.id)?"✓":"＋"}</span>`;
    btn.addEventListener("click",async()=>{if(pl.songIds.includes(song.id))pl.songIds=pl.songIds.filter(id=>id!==song.id);else pl.songIds.push(song.id);await idbPut("playlists",pl);openPicker(playlistId);renderPlaylists();});
    playlistPicker.appendChild(btn);
  });
  if(songs.length===0)playlistPicker.innerHTML='<p class="empty small">Add songs to your library first.</p>';
  playlistPickerDialog.showModal();
}

async function createPlaylist(name){const pl={id:(crypto.randomUUID?crypto.randomUUID():Date.now()+Math.random()),name,songIds:[],createdAt:Date.now()};playlists.push(pl);await idbPut("playlists",pl);renderPlaylists();toast("Playlist created");}

function applyTheme(theme){document.body.classList.toggle("light",theme==="light");localStorage.setItem("fk-music-theme",theme);themeBtn.textContent=theme==="light"?"🌙":"☀️";}
function toggleTheme(){applyTheme(document.body.classList.contains("light")?"dark":"light");}
function setCurrentCover(song){
  if(currentCoverUrl){URL.revokeObjectURL(currentCoverUrl);currentCoverUrl=null;}
  if(song?.coverBlob){currentCoverUrl=URL.createObjectURL(song.coverBlob);coverEl.style.backgroundImage=`url("${currentCoverUrl}")`;coverEl.querySelector("span").style.display="none";}
  else {coverEl.style.backgroundImage="linear-gradient(135deg,#7c3aed,#06b6d4)";coverEl.querySelector("span").style.display="block";}
}
function setPlayingUI(){const playing=!audio.paused&&!audio.ended;coverEl.classList.toggle("playing",playing);playerCard.classList.toggle("is-playing",playing);playBtn.textContent=playing?"⏸":"▶";}
async function loadSong(index,autoplay=false){
  if(!songs[index])return;
  currentIndex=index;
  const song=songs[index];
  if(currentObjectUrl)URL.revokeObjectURL(currentObjectUrl);
  currentObjectUrl=URL.createObjectURL(song.fileBlob);
  audio.src=currentObjectUrl;
  titleEl.textContent=song.name;artistEl.textContent=song.artist||"Unknown Artist";albumEl.textContent=song.album||"Unknown Album";setCurrentCover(song);favoriteNowBtn.textContent=song.favorite?"♥":"♡";favoriteNowBtn.classList.toggle("active",!!song.favorite);
  progress.value=0;currentTimeEl.textContent="0:00";durationEl.textContent="0:00";renderSongs(search.value);
  if(autoplay)audio.play().catch(()=>{});
}
function nextSong(){
  if(!songs.length)return;
  let index;
  if(shuffle&&songs.length>1){do index=Math.floor(Math.random()*songs.length);while(index===currentIndex);}else index=(currentIndex+1)%songs.length;
  loadSong(index,true);
}
async function toggleFavorite(index){const song=songs[index];if(!song)return;song.favorite=!song.favorite;await idbPut("songs",song);renderAll();if(index===currentIndex){favoriteNowBtn.textContent=song.favorite?"♥":"♡";favoriteNowBtn.classList.toggle("active",song.favorite);}toast(song.favorite?"Added to favorites":"Removed from favorites");}
async function removeSong(index){const song=songs[index];if(!song)return;if(!confirm(`Remove “${song.name}” from your library?`))return;if(index===currentIndex){audio.pause();audio.removeAttribute("src");currentIndex=-1;titleEl.textContent="No song selected";artistEl.textContent="Choose a song from your library";albumEl.textContent="—";setCurrentCover(null);}else if(index<currentIndex)currentIndex--;songs.splice(index,1);await idbDelete("songs",song.id);for(const pl of playlists){if(pl.songIds.includes(song.id)){pl.songIds=pl.songIds.filter(id=>id!==song.id);await idbPut("playlists",pl);}}renderAll();toast("Song removed");}

fileInput.addEventListener("change",async e=>{const files=[...e.target.files];await addFiles(files);fileInput.value="";});
playBtn.addEventListener("click",()=>{if(!audio.src&&songs.length)loadSong(0);if(!audio.src)return;audio.paused?audio.play():audio.pause();});
prevBtn.addEventListener("click",()=>{if(!songs.length)return;loadSong(currentIndex<=0?songs.length-1:currentIndex-1,true);});
nextBtn.addEventListener("click",nextSong);
shuffleBtn.addEventListener("click",()=>{shuffle=!shuffle;shuffleBtn.classList.toggle("active",shuffle);});
repeatBtn.addEventListener("click",()=>{repeat=!repeat;repeatBtn.classList.toggle("active",repeat);});
progress.addEventListener("input",()=>{if(audio.duration)audio.currentTime=(progress.value/100)*audio.duration;});
volume.addEventListener("input",()=>audio.volume=Number(volume.value));
audio.volume=.8;
search.addEventListener("input",()=>renderSongs(search.value));
audio.addEventListener("play",setPlayingUI);audio.addEventListener("pause",setPlayingUI);audio.addEventListener("loadedmetadata",()=>durationEl.textContent=formatTime(audio.duration));
audio.addEventListener("timeupdate",()=>{if(audio.duration)progress.value=(audio.currentTime/audio.duration)*100;currentTimeEl.textContent=formatTime(audio.currentTime);});
audio.addEventListener("ended",()=>{if(repeat)loadSong(currentIndex,true);else nextSong();});

favoriteNowBtn.addEventListener("click",()=>{if(currentIndex>=0)toggleFavorite(currentIndex);});
newPlaylistBtn.addEventListener("click",()=>{playlistName.value="";playlistDialog.showModal();setTimeout(()=>playlistName.focus(),50);});
$("cancelPlaylist").addEventListener("click",()=>playlistDialog.close());
playlistForm.addEventListener("submit",async e=>{e.preventDefault();const name=playlistName.value.trim();if(!name)return;playlistDialog.close();await createPlaylist(name);});
themeBtn.addEventListener("click",toggleTheme);themeBtn2.addEventListener("click",toggleTheme);

window.addEventListener("beforeinstallprompt",e=>{e.preventDefault();deferredPrompt=e;installBtn.hidden=false;});
installBtn.addEventListener("click",async()=>{if(!deferredPrompt)return;deferredPrompt.prompt();await deferredPrompt.userChoice;deferredPrompt=null;installBtn.hidden=true;});
window.addEventListener("appinstalled",()=>{installBtn.hidden=true;toast("FK Music installed");});
window.addEventListener("beforeunload",()=>{if(currentObjectUrl)URL.revokeObjectURL(currentObjectUrl);if(currentCoverUrl)URL.revokeObjectURL(currentCoverUrl);});

function toast(message){let el=$("toast");if(!el){el=document.createElement("div");el.id="toast";el.className="toast";document.body.appendChild(el);}el.textContent=message;el.classList.add("show");clearTimeout(window.__toast);window.__toast=setTimeout(()=>el.classList.remove("show"),2200);}
function renderAll(){renderSongs(search.value);renderFavorites();renderPlaylists();}
async function init(){
  applyTheme(localStorage.getItem("fk-music-theme")||"dark");
  try{db=await openDB();songs=await idbAll("songs");playlists=await idbAll("playlists");renderAll();}
  catch(err){console.error(err);toast("Local music storage is unavailable");}
  if("serviceWorker" in navigator)window.addEventListener("load",()=>navigator.serviceWorker.register("pwabuilder-sw.js").catch(console.error));
}
init();
