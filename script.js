let isRecording = false;
let isPlayingSeq = false;
let recordingStartTime = 0;
let recordedSequence = [];
let playbackTimers = [];

const recordBtn = document.getElementById('recordBtn');
const playBtn = document.getElementById('playBtn');
const stopSeqBtn = document.getElementById('stopSeqBtn');
const piano = document.getElementById('piano');
const startOverlay = document.getElementById('startOverlay');
const startBtn = document.getElementById('startBtn');
const lcdValue = document.getElementById('currentInstrumentName');
const volKnob = document.getElementById('volKnob');
const volContainer = document.getElementById('volKnobContainer');
const modal = document.getElementById('modalOverlay');
const showLabelsCheck = document.getElementById('showLabels');
const instrumentListEl = document.getElementById('instrumentList');

let audioCtx;
let masterGain;
const activeNotes = new Map();
let currentInstrument = instrumentDatabase[0];
let currentBuffers = {}; 
let volume = 0.5;

const notes = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const octaves = [2, 3, 4, 5, 6]; 

const keyMap = {
    'z': 'C3', 's': 'C#3', 'x': 'D3', 'd': 'D#3', 'c': 'E3', 'v': 'F3', 
    'g': 'F#3', 'b': 'G3', 'h': 'G#3', 'n': 'A3', 'j': 'A#3', 'm': 'B3',
    'a': 'C4', 'w': 'C#4', 's': 'D4', 'e': 'D#4', 'd': 'E4', 'f': 'F4', 
    't': 'F#4', 'g': 'G4', 'y': 'G#4', 'h': 'A4', 'u': 'A#4', 'j': 'B4',
    'k': 'C5', 'o': 'C#5', 'l': 'D5', 'p': 'D#5', ';': 'E5', "'": 'F5'
};

const reverseKeyMap = Object.fromEntries(Object.entries(keyMap).map(([k, v]) => [v, k.toUpperCase()]));

// TRANSLATOR: Converts your HTML Sharps to GitHub Flats
function getSoundfontNoteName(noteName) {
    if (!noteName.includes('#')) return noteName;
    
    const note = noteName.substring(0, 2); 
    const octave = noteName.substring(2); 
    
    const sharpToFlat = { 'C#': 'Db', 'D#': 'Eb', 'F#': 'Gb', 'G#': 'Ab', 'A#': 'Bb' };
    return sharpToFlat[note] + octave;
}

function base64ToArrayBuffer(base64) {
    const binaryString = window.atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes.buffer;
}

async function loadInstrument(instrument) {
    if (!audioCtx) return;
    lcdValue.textContent = "LOADING...";
    
    try {
        const response = await fetch(instrument.url);
        const scriptContent = await response.text();
        
        eval(scriptContent); 
        const rawData = MIDI.Soundfont[instrument.id];
        
        const decodedBuffers = {};
        for (let note in rawData) {
            const base64Data = rawData[note].split(',')[1];
            const arrayBuffer = base64ToArrayBuffer(base64Data);
            decodedBuffers[note] = await audioCtx.decodeAudioData(arrayBuffer);
        }
        
        currentBuffers = decodedBuffers;
        currentInstrument = instrument;
        lcdValue.textContent = instrument.name.toUpperCase();
    } catch (e) {
        lcdValue.textContent = "LOAD ERROR";
        console.error("Failed to load instrument:", e);
    }
}

async function initAudio() {
    if (audioCtx) return;
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    masterGain = audioCtx.createGain();
    masterGain.gain.value = volume;
    masterGain.connect(audioCtx.destination);
    
    await loadInstrument(currentInstrument);
    startOverlay.style.display = 'none';
}

function createPiano() {
    octaves.forEach(octave => {
        notes.forEach(note => {
            const noteName = note + octave;
            const isBlack = note.includes('#');

            const key = document.createElement('div');
            key.className = `key ${isBlack ? 'black' : 'white'}`;
            key.dataset.note = noteName;

            const label = document.createElement('div');
            label.className = 'label';
            label.innerHTML = `<span class="note-name">${noteName}</span>`;
            
            if (reverseKeyMap[noteName]) {
                const bindSpan = document.createElement('span');
                bindSpan.className = 'key-bind';
                bindSpan.textContent = reverseKeyMap[noteName];
                label.appendChild(bindSpan);
            }

            key.appendChild(label);

            const startNote = (e) => { e.preventDefault(); playNote(noteName); };
            const stopNoteEvent = () => stopNote(noteName);

            key.addEventListener('mousedown', startNote);
            key.addEventListener('mouseup', stopNoteEvent);
            key.addEventListener('mouseleave', stopNoteEvent);
            key.addEventListener('touchstart', startNote);
            key.addEventListener('touchend', stopNoteEvent);

            piano.appendChild(key);
        });
    });
}

function playNote(noteName) {
    const sfNote = getSoundfontNoteName(noteName); // Translate C# to Db
    
    // --- LOGGING ---
    if (isRecording && !isPlayingSeq) {
        recordedSequence.push({ note: noteName, time: audioCtx.currentTime - recordingStartTime, type: 'play' });
    }
    
    if (!audioCtx || !currentBuffers[sfNote]) {
        console.warn("Sound not found for:", sfNote); // Debugging log
        return;
    }
    if (activeNotes.has(noteName)) return;

    const source = audioCtx.createBufferSource();
    source.buffer = currentBuffers[sfNote];

    const noteGain = audioCtx.createGain();
    const now = audioCtx.currentTime;

    noteGain.gain.setValueAtTime(0, now);
    noteGain.gain.linearRampToValueAtTime(1, now + 0.01);

    source.connect(noteGain);
    noteGain.connect(masterGain);
    source.start(0);

    activeNotes.set(noteName, { source, noteGain });
    document.querySelector(`[data-note="${noteName}"]`)?.classList.add('keydown-active');
}

function stopNote(noteName) {
    // --- LOGGING ---
    if (isRecording && !isPlayingSeq) {
        recordedSequence.push({ note: noteName, time: audioCtx.currentTime - recordingStartTime, type: 'stop' });
    }

    if (!activeNotes.has(noteName)) return;
    const { source, noteGain } = activeNotes.get(noteName);
    const now = audioCtx.currentTime;

    noteGain.gain.exponentialRampToValueAtTime(0.01, now + 0.1);
    source.stop(now + 0.1);

    activeNotes.delete(noteName);
    document.querySelector(`[data-note="${noteName}"]`)?.classList.remove('keydown-active');
}

// Volume Knob Logic
let isDragging = false;
let startY = 0;
volContainer.addEventListener('mousedown', (e) => { isDragging = true; startY = e.clientY; });
window.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    const delta = startY - e.clientY;
    startY = e.clientY;
    volume = Math.min(Math.max(volume + delta * 0.01, 0), 1);
    if (masterGain) masterGain.gain.value = volume;
    volKnob.style.transform = `rotate(${(volume * 270) - 135}deg)`;
});
window.addEventListener('mouseup', () => isDragging = false);

// UI Listeners
document.getElementById('instrumentToggle').onclick = () => modal.classList.add('show');
document.getElementById('closeModal').onclick = () => modal.classList.remove('show');

function createInstrumentList() {
    instrumentDatabase.forEach((inst) => {
        const btn = document.createElement('button');
        btn.className = `instrument-btn ${inst.id === currentInstrument.id ? 'active' : ''}`;
        btn.textContent = inst.name;

        btn.onclick = async () => {
            document.querySelectorAll('.instrument-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            modal.classList.remove('show');
            await loadInstrument(inst);
        };
        instrumentListEl.appendChild(btn);
    });
}

showLabelsCheck.onchange = (e) => {
    document.querySelectorAll('.label').forEach(l => l.style.opacity = e.target.checked ? '1' : '0');
};

window.addEventListener('keydown', (e) => {
    const note = keyMap[e.key.toLowerCase()];
    if (note && !e.repeat) playNote(note);
});

window.addEventListener('keyup', (e) => {
    const note = keyMap[e.key.toLowerCase()];
    if (note) stopNote(note);
});

startBtn.onclick = initAudio;
createInstrumentList();
createPiano();
volKnob.style.transform = `rotate(0deg)`;

recordBtn.onclick = () => {
    if (isPlayingSeq) return; 
    isRecording = !isRecording;
    
    if (isRecording) {
        recordedSequence = []; 
        recordingStartTime = audioCtx.currentTime;
        recordBtn.classList.add('recording-active');
        lcdValue.textContent = "REC  ●";
    } else {
        recordBtn.classList.remove('recording-active');
        lcdValue.textContent = currentInstrument.name.toUpperCase();
    }
};

playBtn.onclick = () => {
    if (isRecording || isPlayingSeq || recordedSequence.length === 0) return;
    
    isPlayingSeq = true;
    playBtn.classList.add('playing-active');
    lcdValue.textContent = "PLAYING ▶";

    recordedSequence.forEach(event => {
        const msTime = event.time * 1000;
        const timer = setTimeout(() => {
            if (event.type === 'play') playNote(event.note);
            if (event.type === 'stop') stopNote(event.note);
        }, msTime);
        playbackTimers.push(timer);
    });

    const totalDuration = recordedSequence[recordedSequence.length - 1].time * 1000;
    setTimeout(() => { if (isPlayingSeq) haltSequencer(); }, totalDuration + 500);
};

function haltSequencer() {
    isPlayingSeq = false;
    isRecording = false;
    playBtn.classList.remove('playing-active');
    recordBtn.classList.remove('recording-active');
    lcdValue.textContent = currentInstrument.name.toUpperCase();
    
    playbackTimers.forEach(clearTimeout);
    playbackTimers = [];
    activeNotes.forEach((value, key) => stopNote(key));
}

stopSeqBtn.onclick = haltSequencer;