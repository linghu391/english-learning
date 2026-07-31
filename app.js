(function() {
  'use strict';

  // ===== State =====
  let data = null;
  let currentTab = 'reading';
  const progressKey = 'ed_progress_' + new Date().toISOString().slice(0,10);
  let mediaRecorder = null;
  let audioChunks = [];
  let isRecording = false;
  let audioContext = null;

  // Difficulty state
  const difficultyKey = 'ed_difficulty_pref';
  const feedbackKey = 'ed_difficulty_feedback';

  // Audio state
  let availableVoices = [];
  let selectedVoiceURI = null;
  let playbackSpeed = parseFloat(localStorage.getItem('ed_playback_speed')) || 0.85;
  let useOnlineTTS = localStorage.getItem('ed_use_online_tts') !== 'false'; // default true
  let mainAudioEl = null; // HTMLAudioElement for online TTS playback
  let isMainAudioPlaying = false;

  // ===== DOM Elements =====
  const $ = id => document.getElementById(id);
  const loading = $('loading-screen');
  const errorScreen = $('error-screen');
  const mainApp = $('main-app');
  const content = $('content');
  const dateDisplay = $('date-display');
  const topicDisplay = $('topic-display');
  const durationDisplay = $('duration-display');
  const progressBar = $('progress-bar');
  const progressRing = $('progress-ring');
  const progressText = $('progress-text');
  const retryBtn = $('retry-btn');

  // ===== SVG Gradient =====
  function injectProgressGradient() {
    if (document.querySelector('#progressGrad')) return;
    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg');
    svg.style.position = 'absolute'; svg.style.width = '0'; svg.style.height = '0';
    const defs = document.createElementNS(svgNS, 'defs');
    const grad = document.createElementNS(svgNS, 'linearGradient');
    grad.id = 'progressGrad';
    grad.setAttribute('x1', '0%'); grad.setAttribute('y1', '0%');
    grad.setAttribute('x2', '100%'); grad.setAttribute('y2', '100%');
    const stop1 = document.createElementNS(svgNS, 'stop');
    stop1.setAttribute('offset', '0%'); stop1.setAttribute('stop-color', '#6366f1');
    const stop2 = document.createElementNS(svgNS, 'stop');
    stop2.setAttribute('offset', '100%'); stop2.setAttribute('stop-color', '#8b5cf6');
    grad.appendChild(stop1); grad.appendChild(stop2);
    defs.appendChild(grad); svg.appendChild(defs);
    document.body.appendChild(svg);
  }

  // ===== Progress =====
  function loadProgress() {
    try { return JSON.parse(localStorage.getItem(progressKey) || '{}'); } catch { return {}; }
  }
  function saveProgress(p) { localStorage.setItem(progressKey, JSON.stringify(p)); }
  function toggleItem(id) {
    const p = loadProgress();
    p[id] = !p[id];
    saveProgress(p);
    updateProgress();
    return p[id];
  }
  function isDone(id) {
    const p = loadProgress();
    return !!p[id];
  }
  function updateProgress() {
    const p = loadProgress();
    const items = document.querySelectorAll('[data-progress-id]');
    let done = 0;
    items.forEach(el => { if (p[el.dataset.progressId]) done++; });
    const total = items.length || 1;
    const pct = Math.round((done / total) * 100);
    progressBar.style.width = pct + '%';
    progressText.textContent = pct + '%';
    const circumference = 87.96;
    progressRing.style.strokeDashoffset = circumference - (pct / 100) * circumference;
    const emoji = $('header').querySelector('.header-emoji');
    if (pct === 100) emoji.textContent = '🎉';
    else emoji.textContent = '📖';
  }

  // ===== Difficulty Management =====
  function loadDifficulty() {
    return localStorage.getItem(difficultyKey) || 'B2';
  }
  function saveDifficulty(level) {
    localStorage.setItem(difficultyKey, level);
  }
  function loadFeedback() {
    try { return JSON.parse(localStorage.getItem(feedbackKey) || '{}'); } catch { return {}; }
  }
  function saveFeedback(fb) {
    localStorage.setItem(feedbackKey, JSON.stringify(fb));
  }
  function recordFeedback(rating) {
    const fb = loadFeedback();
    const today = new Date().toISOString().slice(0, 10);
    if (!fb[today]) fb[today] = [];
    fb[today].push(rating);
    saveFeedback(fb);
  }
  function getRecommendedDifficulty() {
    const fb = loadFeedback();
    let easy = 0, ok = 0, hard = 0;
    Object.values(fb).forEach(dayRatings => {
      dayRatings.forEach(r => {
        if (r === 'easy') easy++;
        else if (r === 'ok') ok++;
        else if (r === 'hard') hard++;
      });
    });
    const total = easy + ok + hard;
    if (total < 3) return null;
    const current = loadDifficulty();
    if (easy > hard * 2 && easy > total * 0.4) {
      return current === 'B1' ? 'B2' : 'C1';
    }
    if (hard > easy * 2 && hard > total * 0.4) {
      return current === 'C1' ? 'B2' : 'B1';
    }
    return null;
  }
  function renderDifficultySelector() {
    const current = loadDifficulty();
    const recommendation = getRecommendedDifficulty();
    const container = $('difficulty-selector');
    if (!container) return;
    let html = '';
    ['B1', 'B2', 'C1'].forEach(level => {
      const active = level === current ? 'active' : '';
      const recommended = recommendation === level ? 'recommended' : '';
      html += `<button class="diff-pill ${active} ${recommended}" data-level="${level}" onclick="setDifficulty('${level}')">${level}</button>`;
    });
    if (recommendation && recommendation !== current) {
      html += `<span class="diff-rec-hint">建议调整至 ${recommendation}</span>`;
    }
    container.innerHTML = html;
  }
  window.setDifficulty = function(level) {
    saveDifficulty(level);
    renderDifficultySelector();
  };

  // ===== Audio / TTS Management =====
  function initVoices() {
    if (!window.speechSynthesis) return;
    availableVoices = speechSynthesis.getVoices().filter(v => v.lang.startsWith('en'));
    availableVoices.sort((a, b) => {
      const score = v => {
        let s = 0;
        if (v.name.includes('Google')) s += 3;
        if (v.name.includes('Enhanced')) s += 2;
        if (v.name.includes('Neural')) s += 2;
        if (v.name.includes('Natural')) s += 2;
        if (v.name.includes('Premium')) s += 1;
        if (v.lang === 'en-US') s += 1;
        return -s;
      };
      return score(a) - score(b);
    });
    const saved = localStorage.getItem('ed_voice_uri');
    if (saved && availableVoices.find(v => v.voiceURI === saved)) {
      selectedVoiceURI = saved;
    } else if (availableVoices.length > 0) {
      selectedVoiceURI = availableVoices[0].voiceURI;
    }
    // Update voice dropdown if it exists
    const select = $('voice-select');
    if (select && availableVoices.length > 0) {
      const prev = select.value;
      select.innerHTML = availableVoices.map(v =>
        `<option value="${v.voiceURI}" ${v.voiceURI === selectedVoiceURI ? 'selected' : ''}>${v.name} (${v.lang})</option>`
      ).join('');
      if (prev) select.value = prev;
    }
  }
  if (window.speechSynthesis) {
    speechSynthesis.onvoiceschanged = initVoices;
    setTimeout(initVoices, 100);
  }

  function getSelectedVoice() {
    return availableVoices.find(v => v.voiceURI === selectedVoiceURI) || null;
  }

  // IndexedDB for audio caching
  function openAudioDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open('ed_audio_cache', 1);
      req.onupgradeneeded = e => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('audio')) {
          db.createObjectStore('audio');
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  async function getCachedAudio(key) {
    try {
      const db = await openAudioDB();
      return new Promise((resolve) => {
        const tx = db.transaction('audio', 'readonly');
        const req = tx.objectStore('audio').get(key);
        req.onsuccess = () => resolve(req.result ? req.result.blob : null);
        req.onerror = () => resolve(null);
      });
    } catch { return null; }
  }
  async function setCachedAudio(key, blob) {
    try {
      const db = await openAudioDB();
      const tx = db.transaction('audio', 'readwrite');
      tx.objectStore('audio').put({ blob }, key);
    } catch { /* ignore */ }
  }

  // Split text for TTS API (max ~450 chars per request)
  function splitTextForTTS(text, maxLen) {
    const sentences = text.match(/[^.!?]+[.!?]*/g) || [text];
    const chunks = [];
    let current = '';
    for (const s of sentences) {
      if ((current + s).length > maxLen) {
        if (current.trim()) chunks.push(current.trim());
        if (s.length > maxLen) {
          const parts = s.split(/, */);
          let part = '';
          for (const p of parts) {
            if ((part + p).length > maxLen) {
              if (part) chunks.push(part.trim());
              part = p;
            } else {
              part += (part ? ', ' : '') + p;
            }
          }
          current = part;
        } else {
          current = s;
        }
      } else {
        current += s;
      }
    }
    if (current.trim()) chunks.push(current.trim());
    return chunks;
  }

  // Fetch online TTS (StreamElements - free, high quality "Brian" voice)
  async function fetchOnlineTTS(text) {
    const cacheKey = 'tts_' + text.length + '_' + text.substring(0, 50).replace(/\s/g, '_');

    // Check cache first
    const cached = await getCachedAudio(cacheKey);
    if (cached) return URL.createObjectURL(cached);

    // Split and fetch
    const chunks = splitTextForTTS(text, 450);
    if (chunks.length === 0) return null;

    try {
      const blobs = [];
      for (const chunk of chunks) {
        const url = 'https://api.streamelements.com/kappa/v2/speech?voice=Brian&text=' + encodeURIComponent(chunk);
        const resp = await fetch(url);
        if (!resp.ok) throw new Error('TTS API: ' + resp.status);
        blobs.push(await resp.blob());
      }
      const merged = blobs.length === 1 ? blobs[0] : new Blob(blobs, { type: 'audio/mpeg' });
      await setCachedAudio(cacheKey, merged);
      return URL.createObjectURL(merged);
    } catch (e) {
      return null; // Caller falls back to system TTS
    }
  }

  // Play via system TTS
  function playSystemTTS(text, opts) {
    if (!window.speechSynthesis) return false;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'en-US';
    u.rate = opts.rate || playbackSpeed;
    const voice = getSelectedVoice();
    if (voice) u.voice = voice;
    if (opts.onend) u.onend = opts.onend;
    if (opts.onerror) u.onerror = opts.onerror;
    window.speechSynthesis.speak(u);
    return true;
  }

  // ===== Tab Rendering =====
  function switchTab(tab) {
    currentTab = tab;
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tab === tab);
    });
    document.querySelectorAll('.tab-section').forEach(s => s.classList.remove('active'));
    const section = document.getElementById('tab-' + tab);
    if (section) section.classList.add('active');
    content.scrollTop = 0;
    updateProgress();
  }

  // ===== Render Functions =====

  function renderReading() {
    const r = data.reading;
    if (!r) return;
    const section = document.createElement('div');
    section.id = 'tab-reading';
    section.className = 'tab-section active';

    let html = `<div class="card"><div class="card-title">${r.title}</div>`;
    html += `<span class="difficulty-badge ${r.difficulty_level}">${r.difficulty_level}</span>`;
    if (r.source_url) html += ` <a href="${r.source_url}" target="_blank" style="color:#6366f1;font-size:12px;margin-left:8px;text-decoration:none;">来源 ↗</a>`;
    html += '</div>';

    html += `<div class="section-title">📄 正文</div>`;
    (r.content_paragraphs || []).forEach(p => {
      html += `<div class="card paragraph">${p}</div>`;
    });

    if (r.key_vocabulary && r.key_vocabulary.length) {
      html += `<div class="section-title">🔑 核心词汇</div><div class="card" style="display:flex;flex-wrap:wrap;gap:6px;">`;
      r.key_vocabulary.forEach((v, i) => {
        html += `<span class="vocab-chip" data-vocab-index="${i}">${v.word}</span>`;
      });
      html += '</div>';
      html += `<div class="vocab-popup-overlay" id="vocab-overlay"></div>`;
      html += `<div class="vocab-chip-popup" id="vocab-popup">
        <div class="vocab-popup-word" id="popup-word"></div>
        <div class="vocab-popup-meaning" id="popup-meaning"></div>
        <div class="vocab-popup-example" id="popup-example"></div>
      </div>`;
    }

    if (r.comprehension_questions && r.comprehension_questions.length) {
      html += `<div class="section-title">❓ 阅读理解</div>`;
      r.comprehension_questions.forEach((q, i) => {
        const id = `reading-q-${i}`;
        html += `<div class="card comprehension-item">
          <div class="comprehension-q">${i+1}. ${q.question}</div>
          <button class="answer-toggle" data-target="${id}" data-progress-id="${id}" onclick="toggleAnswer(this)">显示答案 ▸</button>
          <div class="answer-content" id="${id}">${q.answer}</div>
        </div>`;
      });
      // Difficulty feedback
      html += `<div class="feedback-bar">
        <span class="feedback-label">今日难度感受：</span>
        <button class="feedback-btn" data-rating="hard" onclick="handleDifficultyFeedback('hard')">👎 太难</button>
        <button class="feedback-btn" data-rating="ok" onclick="handleDifficultyFeedback('ok')">👌 正好</button>
        <button class="feedback-btn" data-rating="easy" onclick="handleDifficultyFeedback('easy')">👍 太简单</button>
      </div>`;
    }

    section.innerHTML = html;
    content.appendChild(section);

    section.querySelectorAll('.vocab-chip').forEach(chip => {
      chip.addEventListener('click', function() {
        const idx = parseInt(this.dataset.vocabIndex);
        const v = r.key_vocabulary[idx];
        if (!v) return;
        $('popup-word').textContent = v.word;
        $('popup-meaning').textContent = v.meaning;
        $('popup-example').textContent = '例: ' + v.example_sentence;
        $('vocab-popup').classList.add('show');
        $('vocab-overlay').classList.add('show');
      });
    });
    const overlay = $('vocab-overlay');
    if (overlay) {
      overlay.addEventListener('click', () => {
        $('vocab-popup').classList.remove('show');
        overlay.classList.remove('show');
      });
    }
  }

  function renderListening() {
    const l = data.listening;
    if (!l) return;
    const section = document.createElement('div');
    section.id = 'tab-listening';
    section.className = 'tab-section';

    let html = '';

    // Voice settings panel
    html += `<div class="section-title">⚙️ 语音设置</div>
    <div class="card voice-settings">
      <div class="voice-setting-row">
        <label class="voice-label">语音引擎</label>
        <select id="tts-engine-select" class="voice-select" onchange="onTTSEngineChange(this.value)">
          <option value="online" ${useOnlineTTS ? 'selected' : ''}>在线语音 (高质量)</option>
          <option value="system" ${!useOnlineTTS ? 'selected' : ''}>系统语音</option>
        </select>
      </div>
      <div class="voice-setting-row" id="system-voice-row" style="display:${useOnlineTTS ? 'none' : 'flex'};">
        <label class="voice-label">系统语音</label>
        <select id="voice-select" class="voice-select" onchange="onVoiceChange(this.value)">
          <option value="">加载中...</option>
        </select>
      </div>
      <div class="voice-setting-row">
        <label class="voice-label">语速 <span id="speed-display">${playbackSpeed.toFixed(2)}x</span></label>
        <input type="range" id="speed-slider" class="speed-slider" min="0.5" max="1.5" step="0.05" value="${playbackSpeed}" oninput="onSpeedChange(this.value)">
      </div>
    </div>`;

    // Audio player
    html += `<div class="section-title">🔊 音频播放</div>
    <div class="audio-player">
      <button class="audio-play-btn" id="play-btn">▶</button>
      <div class="audio-info">
        <div class="audio-label">今日听力素材</div>
        <div class="audio-status" id="audio-status">点击播放</div>
      </div>
      <div class="audio-engine-badge" id="audio-engine-badge">${useOnlineTTS ? '🌐' : '💻'}</div>
    </div>`;

    // Gap fill
    if (l.gap_fill_exercise && l.gap_fill_exercise.length) {
      html += `<div class="section-title">✏️ 填词练习</div>`;
      l.gap_fill_exercise.forEach((g, i) => {
        const id = `gap-${i}`;
        const text = g.sentence_with_blanks;
        const displayText = text.replace(/_{2,}/g, match => {
          return `<span class="gap-blank" id="${id}" data-answers='${JSON.stringify(g.answers_array)}' data-revealed="false" onclick="revealGap(this)">______</span>`;
        });
        html += `<div class="card gap-fill-item">
          <div class="gap-fill-text">${displayText}</div>
        </div>`;
      });
    }

    // Transcript
    if (l.transcript) {
      html += `<div class="section-title">📝 听力原文</div>
      <div class="card"><div class="card-sub">${l.transcript}</div></div>`;
    }

    // Dictation
    if (l.dictation_sentences && l.dictation_sentences.length) {
      html += `<div class="section-title">✍️ 逐句听写</div>`;
      html += `<div class="card" style="font-size:11px;color:#71717a;padding:8px 14px;">点击 ▶ 逐句播放，尝试写下你听到的内容</div>`;
      l.dictation_sentences.forEach((s, i) => {
        const id = `dict-${i}`;
        html += `<div class="card dictation-item" style="display:flex;align-items:center;gap:10px;">
          <button class="dict-play-btn" data-sentence="${s.replace(/"/g, '&quot;')}" data-index="${i}" style="flex-shrink:0;width:32px;height:32px;background:#1e1b4b;border:1px solid #312e81;border-radius:50%;color:#a5b4fc;font-size:12px;cursor:pointer;display:flex;align-items:center;justify-content:center;">▶</button>
          <div class="dictation-text" style="flex:1;">${i+1}. ${s}</div>
        </div>`;
      });
    }

    section.innerHTML = html;
    content.appendChild(section);

    // Populate voice dropdown if in system mode
    if (!useOnlineTTS && availableVoices.length > 0) {
      const sel = $('voice-select');
      if (sel) {
        sel.innerHTML = availableVoices.map(v =>
          `<option value="${v.voiceURI}" ${v.voiceURI === selectedVoiceURI ? 'selected' : ''}>${v.name} (${v.lang})</option>`
        ).join('');
      }
    }

    // Main audio player
    setupMainAudioPlayer(l.transcript);

    // Dictation buttons
    section.querySelectorAll('.dict-play-btn').forEach(btn => {
      btn.addEventListener('click', async function() {
        const text = this.dataset.sentence;
        this.textContent = '⏳';

        if (useOnlineTTS) {
          const url = await fetchOnlineTTS(text);
          if (url) {
            if (window.speechSynthesis) window.speechSynthesis.cancel();
            const audio = new Audio(url);
            audio.playbackRate = playbackSpeed;
            audio.onended = () => { this.textContent = '▶'; };
            audio.onerror = () => {
              playSystemTTS(text, { onend: () => { this.textContent = '▶'; } });
            };
            audio.play();
            return;
          }
        }
        // Fallback to system TTS
        this.textContent = '🔊';
        playSystemTTS(text, { onend: () => { this.textContent = '▶'; } });
      });
    });
  }

  function setupMainAudioPlayer(transcript) {
    const playBtn = $('play-btn');
    const audioStatus = $('audio-status');
    const engineBadge = $('audio-engine-badge');
    if (!playBtn || !transcript) return;

    let onlineAudioUrl = null;
    let isPreparingOnline = false;

    playBtn.addEventListener('click', async function() {
      if (isMainAudioPlaying) {
        // Stop everything
        if (mainAudioEl) { mainAudioEl.pause(); mainAudioEl = null; }
        if (window.speechSynthesis) window.speechSynthesis.cancel();
        isMainAudioPlaying = false;
        playBtn.textContent = '▶';
        audioStatus.textContent = '已暂停';
        return;
      }

      // Try online TTS first
      if (useOnlineTTS) {
        if (!onlineAudioUrl && !isPreparingOnline) {
          isPreparingOnline = true;
          playBtn.textContent = '⏳';
          audioStatus.textContent = '正在获取高质量音频...';
          onlineAudioUrl = await fetchOnlineTTS(transcript);
          isPreparingOnline = false;
        }

        if (onlineAudioUrl) {
          if (window.speechSynthesis) window.speechSynthesis.cancel();
          mainAudioEl = new Audio(onlineAudioUrl);
          mainAudioEl.playbackRate = playbackSpeed;
          isMainAudioPlaying = true;
          playBtn.textContent = '⏸';
          audioStatus.textContent = '播放中 (在线语音)';
          engineBadge.textContent = '🌐';

          mainAudioEl.onended = () => {
            isMainAudioPlaying = false;
            playBtn.textContent = '▶';
            audioStatus.textContent = '播放完成 ✓';
          };
          mainAudioEl.onerror = () => {
            // Fallback to system TTS
            audioStatus.textContent = '在线音频失败，使用系统语音';
            playSystemTTS(transcript, {
              onend: () => {
                isMainAudioPlaying = false;
                playBtn.textContent = '▶';
                audioStatus.textContent = '播放完成 ✓';
              }
            });
          };
          mainAudioEl.play();
          return;
        }
      }

      // System TTS fallback
      if (window.speechSynthesis) {
        isMainAudioPlaying = true;
        playBtn.textContent = '⏸';
        audioStatus.textContent = '播放中 (系统语音)';
        engineBadge.textContent = '💻';
        playSystemTTS(transcript, {
          onend: () => {
            isMainAudioPlaying = false;
            playBtn.textContent = '▶';
            audioStatus.textContent = '播放完成 ✓';
          },
          onerror: () => {
            isMainAudioPlaying = false;
            playBtn.textContent = '▶';
            audioStatus.textContent = '播放出错';
          }
        });
      } else {
        audioStatus.textContent = '当前环境不支持语音合成';
      }
    });
  }

  // Voice settings handlers
  window.onTTSEngineChange = function(val) {
    useOnlineTTS = val === 'online';
    localStorage.setItem('ed_use_online_tts', useOnlineTTS);
    const sysRow = $('system-voice-row');
    if (sysRow) sysRow.style.display = useOnlineTTS ? 'none' : 'flex';
    const badge = $('audio-engine-badge');
    if (badge) badge.textContent = useOnlineTTS ? '🌐' : '💻';
  };
  window.onVoiceChange = function(uri) {
    selectedVoiceURI = uri;
    localStorage.setItem('ed_voice_uri', uri);
  };
  window.onSpeedChange = function(val) {
    playbackSpeed = parseFloat(val);
    localStorage.setItem('ed_playback_speed', playbackSpeed);
    const display = $('speed-display');
    if (display) display.textContent = playbackSpeed.toFixed(2) + 'x';
  };
  window.handleDifficultyFeedback = function(rating) {
    recordFeedback(rating);
    // Visual feedback
    document.querySelectorAll('.feedback-btn').forEach(btn => {
      btn.classList.remove('selected');
      if (btn.dataset.rating === rating) btn.classList.add('selected');
    });
    // Show recommendation after feedback
    const rec = getRecommendedDifficulty();
    if (rec) {
      const hint = document.querySelector('.diff-rec-hint');
      if (hint) {
        hint.textContent = `建议调整至 ${rec}`;
        hint.style.display = 'inline';
      }
    }
    renderDifficultySelector();
  };

  function renderSpeaking() {
    const s = data.speaking;
    if (!s) return;
    const section = document.createElement('div');
    section.id = 'tab-speaking';
    section.className = 'tab-section';

    let html = '';

    if (s.passage_for_shadowing) {
      html += `<div class="section-title">🎯 跟读训练</div>
      <div class="card card-highlight">
        <div class="card-title">👄 注意连读和重音</div>
        <div class="shadowing-text">${s.passage_for_shadowing}</div>
      </div>
      <button class="shadowing-play-btn" id="shadowing-play" onclick="playShadowing()">▶ 播放跟读</button>`;
    }

    if (s.dialogue_template && s.dialogue_template.length) {
      html += `<div class="section-title">💬 情景对话</div>`;
      s.dialogue_template.forEach((d, i) => {
        const speakerClass = d.speaker.toLowerCase();
        html += `<div class="dialogue-item ${speakerClass}">
          <div class="dialogue-speaker ${speakerClass}">${d.speaker}</div>
          <div class="dialogue-line">${d.line}</div>
        </div>`;
      });
    }

    if (s.speaking_challenge) {
      html += `<div class="section-title">🎤 口语挑战</div>
      <div class="card card-highlight">
        <div class="card-sub">${s.speaking_challenge}</div>
      </div>
      <div class="section-title">📻 录音</div>
      <div class="recorder-area">
        <button class="record-btn" id="record-btn">🎙</button>
        <div class="record-status" id="record-status">点击开始录音</div>
        <audio id="record-playback" controls style="display:none;height:32px;flex:1;max-width:160px;"></audio>
      </div>`;
    }

    section.innerHTML = html;
    content.appendChild(section);

    // Shadowing play
    const shadowBtn = $('shadowing-play');
    if (shadowBtn && s.passage_for_shadowing) {
      const cleanText = s.passage_for_shadowing.replace(/\//g, '. ');
      shadowBtn.addEventListener('click', async function() {
        if (this.textContent.includes('⏸')) {
          if (mainAudioEl) { mainAudioEl.pause(); mainAudioEl = null; }
          if (window.speechSynthesis) window.speechSynthesis.cancel();
          this.textContent = '▶ 播放跟读';
          return;
        }
        this.textContent = '⏳ 加载中...';
        if (useOnlineTTS) {
          const url = await fetchOnlineTTS(cleanText);
          if (url) {
            if (window.speechSynthesis) window.speechSynthesis.cancel();
            const audio = new Audio(url);
            audio.playbackRate = playbackSpeed;
            this.textContent = '⏸ 播放中';
            audio.onended = () => { this.textContent = '▶ 播放跟读'; };
            audio.play();
            return;
          }
        }
        this.textContent = '⏸ 播放中';
        playSystemTTS(cleanText, { onend: () => { this.textContent = '▶ 播放跟读'; } });
      });
    }

    // Recording
    const recordBtn = $('record-btn');
    const recordStatus = $('record-status');
    const playback = $('record-playback');
    if (recordBtn) {
      recordBtn.addEventListener('click', async function() {
        if (isRecording) {
          if (mediaRecorder && mediaRecorder.state !== 'inactive') {
            mediaRecorder.stop();
          }
          isRecording = false;
          recordBtn.classList.remove('recording');
          recordBtn.textContent = '🎙';
          recordStatus.textContent = '录音已停止';
          return;
        }
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          audioChunks = [];
          mediaRecorder = new MediaRecorder(stream);
          mediaRecorder.ondataavailable = e => { if (e.data.size > 0) audioChunks.push(e.data); };
          mediaRecorder.onstop = () => {
            const blob = new Blob(audioChunks, { type: 'audio/webm' });
            const url = URL.createObjectURL(blob);
            playback.src = url;
            playback.style.display = 'block';
            recordStatus.textContent = '录音完成 ✓ 点击播放回放';
            stream.getTracks().forEach(t => t.stop());
          };
          mediaRecorder.start();
          isRecording = true;
          recordBtn.classList.add('recording');
          recordBtn.textContent = '⏹';
          recordStatus.textContent = '录音中... 点击停止';
        } catch (err) {
          recordStatus.textContent = '无法录音: 请允许麦克风权限';
        }
      });
    }
  }

  function renderWriting() {
    const w = data.writing;
    if (!w) return;
    const section = document.createElement('div');
    section.id = 'tab-writing';
    section.className = 'tab-section';

    let html = '';

    if (w.showcase_sentences && w.showcase_sentences.length) {
      html += `<div class="section-title">✨ 地道句式</div>`;
      w.showcase_sentences.forEach((sw, i) => {
        html += `<div class="card showcase-item">
          <div class="showcase-sentence">${sw.sentence}</div>
          <div class="showcase-structure"><strong>结构：</strong>${sw.structure_explanation}</div>
          <div class="showcase-usage"><strong>用法：</strong>${sw.usage_notes}</div>
        </div>`;
      });
    }

    if (w.translation_exercise && w.translation_exercise.length) {
      html += `<div class="section-title">🔄 中译英</div>`;
      w.translation_exercise.forEach((t, i) => {
        const id = `trans-ref-${i}`;
        html += `<div class="card translation-item">
          <div class="translation-cn">${t.chinese_sentence}</div>
          <textarea class="translation-input" placeholder="在此输入你的翻译..." rows="2"></textarea>
          <button class="answer-toggle" data-target="${id}">显示参考译文 ▸</button>
          <div class="translation-ref" id="${id}">${t.reference_english}</div>
        </div>`;
      });
    }

    if (w.free_writing_prompt) {
      html += `<div class="section-title">✍️ 自由写作</div>
      <div class="card card-highlight">
        <div class="card-sub">${w.free_writing_prompt}</div>
      </div>
      <div class="card">
        <textarea class="translation-input" placeholder="开始写作..." rows="6" style="min-height:120px;"></textarea>
      </div>`;
    }

    section.innerHTML = html;
    content.appendChild(section);
  }

  function renderVocabulary() {
    const v = data.vocabulary;
    if (!v) return;
    const section = document.createElement('div');
    section.id = 'tab-vocabulary';
    section.className = 'tab-section';

    let html = '';

    if (v.root_affix_notes) {
      html += `<div class="section-title">🌱 词根词缀</div>
      <div class="root-note">${v.root_affix_notes}</div>`;
    }

    html += `<div class="section-title">📚 今日词汇</div>`;
    if (v.word_list && v.word_list.length) {
      v.word_list.forEach((w, i) => {
        html += `<div class="card vocab-card">
          <div class="vocab-word">${w.word}<span class="vocab-pos">${w.part_of_speech}</span></div>
          <div class="vocab-def">${w.definition}</div>
          <div class="vocab-example">${w.example}</div>`;
        if (w.collocations && w.collocations.length) {
          html += `<div class="vocab-colloc">`;
          w.collocations.forEach(c => { html += `<span class="vocab-colloc-item">${c}</span>`; });
          html += `</div>`;
        }
        // Add pronunciation button for each word
        html += `<button class="vocab-pronounce-btn" data-word="${w.word}" onclick="pronounceWord(this)">🔊 发音</button>`;
        html += `</div>`;
      });
    }

    if (v.anki_csv_filename) {
      html += `<div class="card" style="text-align:center;background:#1e1b4b;border-color:#312e81;">
        <div style="font-size:12px;color:#a5b4fc;">💡 这些词汇来自今日阅读/听力材料</div>
        <div style="font-size:11px;color:#71717a;margin-top:4px;">作为你 Anki 绿宝书的语境补充</div>
      </div>`;
    }

    section.innerHTML = html;
    content.appendChild(section);
  }

  // Pronounce word
  window.pronounceWord = async function(btn) {
    const word = btn.dataset.word;
    btn.textContent = '⏳';
    if (useOnlineTTS) {
      const url = await fetchOnlineTTS(word);
      if (url) {
        const audio = new Audio(url);
        audio.playbackRate = playbackSpeed;
        audio.onended = () => { btn.textContent = '🔊 发音'; };
        audio.play();
        return;
      }
    }
    playSystemTTS(word, { onend: () => { btn.textContent = '🔊 发音'; } });
  };

  // ===== Toggle Answer =====
  window.toggleAnswer = function(btn) {
    const targetId = btn.dataset.target;
    const target = document.getElementById(targetId);
    if (!target) return;
    target.classList.toggle('show');
    btn.textContent = target.classList.contains('show') ? '隐藏答案 ▾' : '显示答案 ▸';
    toggleItem(targetId);
    updateProgress();
  };

  // ===== Reveal Gap =====
  window.revealGap = function(el) {
    if (el.dataset.revealed === 'true') return;
    const answers = JSON.parse(el.dataset.answers || '[]');
    el.textContent = answers.join(' / ');
    el.classList.add('revealed');
    el.dataset.revealed = 'true';
    toggleItem(el.id);
    updateProgress();
  };

  // ===== Load Data =====
  async function loadData() {
    try {
      const dayNames = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
      const today = new Date();
      const daySuffix = dayNames[today.getDay()];
      const fileName = 'data-' + daySuffix + '.json';

      let res;
      try {
        res = await fetch(fileName + '?_=' + Date.now());
        if (!res.ok) throw new Error('HTTP ' + res.status);
      } catch (e) {
        res = await fetch('data.json?_=' + Date.now());
        if (!res.ok) throw new Error('HTTP ' + res.status);
      }
      data = await res.json();
      initApp();
    } catch (err) {
      loading.style.display = 'none';
      errorScreen.style.display = 'flex';
    }
  }

  // ===== Init App =====
  function initApp() {
    loading.style.display = 'none';
    mainApp.style.display = 'flex';
    mainApp.style.flexDirection = 'column';

    if (data.meta) {
      dateDisplay.textContent = data.meta.date || '';
      topicDisplay.textContent = data.meta.topic_theme || '';
      if (data.meta.estimated_completion_minutes) {
        durationDisplay.textContent = '⏱ ' + data.meta.estimated_completion_minutes + '分钟';
      }
    }

    // Render difficulty selector
    renderDifficultySelector();

    // Render all tabs
    renderReading();
    renderListening();
    renderSpeaking();
    renderWriting();
    renderVocabulary();

    // Tab switching
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', function() {
        switchTab(this.dataset.tab);
      });
    });

    // Answer toggles (delegated)
    content.addEventListener('click', function(e) {
      const toggle = e.target.closest('.answer-toggle');
      if (toggle) {
        const targetId = toggle.dataset.target;
        const target = document.getElementById(targetId);
        if (!target) return;
        target.classList.toggle('show');
        toggle.textContent = target.classList.contains('show') ? '隐藏答案 ▾' : '显示答案 ▸';
        toggleItem(targetId);
        updateProgress();
      }
    });

    updateProgress();
    injectProgressGradient();
  }

  // ===== Offline detection =====
  function checkOnline() {
    if (!navigator.onLine) {
      const banner = document.createElement('div');
      banner.className = 'offline-banner';
      banner.textContent = '📡 当前离线 — 显示缓存内容';
      banner.id = 'offline-banner';
      if (!document.getElementById('offline-banner')) {
        document.body.prepend(banner);
      }
    } else {
      const banner = document.getElementById('offline-banner');
      if (banner) banner.remove();
    }
  }

  // ===== Service Worker =====
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }

  // ===== Bootstrap =====
  document.body.classList.add('loaded');
  window.addEventListener('online', checkOnline);
  window.addEventListener('offline', checkOnline);
  checkOnline();

  retryBtn.addEventListener('click', () => {
    errorScreen.style.display = 'none';
    loading.style.display = 'flex';
    loadData();
  });

  loadData();

})();
