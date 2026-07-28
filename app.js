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
    grad.setAttribute('x2', '100%'); grad.setAttribute('y2', '0%');
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

    // Update header emoji
    const emoji = $('header').querySelector('.header-emoji');
    if (pct === 100) emoji.textContent = '🎉';
    else if (pct > 0) emoji.textContent = '📖';
    else emoji.textContent = '📖';
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

    // Title & difficulty
    let html = `<div class="card"><div class="card-title">${r.title}</div>`;
    html += `<span class="difficulty-badge ${r.difficulty_level}">${r.difficulty_level}</span>`;
    if (r.source_url) html += ` <a href="${r.source_url}" target="_blank" style="color:#6366f1;font-size:12px;margin-left:8px;text-decoration:none;">来源 ↗</a>`;
    html += '</div>';

    // Content paragraphs
    html += `<div class="section-title">📄 正文</div>`;
    (r.content_paragraphs || []).forEach(p => {
      html += `<div class="card paragraph">${p}</div>`;
    });

    // Key vocabulary (inline)
    if (r.key_vocabulary && r.key_vocabulary.length) {
      html += `<div class="section-title">🔑 核心词汇</div><div class="card" style="display:flex;flex-wrap:wrap;gap:6px;">`;
      r.key_vocabulary.forEach((v, i) => {
        html += `<span class="vocab-chip" data-vocab-index="${i}">${v.word}</span>`;
      });
      html += '</div>';

      // Vocab popup overlay
      html += `<div class="vocab-popup-overlay" id="vocab-overlay"></div>`;
      html += `<div class="vocab-chip-popup" id="vocab-popup">
        <div class="vocab-popup-word" id="popup-word"></div>
        <div class="vocab-popup-meaning" id="popup-meaning"></div>
        <div class="vocab-popup-example" id="popup-example"></div>
      </div>`;
    }

    // Comprehension questions
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
    }

    section.innerHTML = html;
    content.appendChild(section);

    // Vocab chip click handlers
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

    // Audio player
    html += `<div class="section-title">🔊 音频播放</div>
    <div class="audio-player">
      <button class="audio-play-btn" id="play-btn">▶</button>
      <div class="audio-info">
        <div class="audio-label">今日听力素材</div>
        <div class="audio-status" id="audio-status">点击播放</div>
      </div>
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
      l.dictation_sentences.forEach((s, i) => {
        const id = `dict-${i}`;
        html += `<div class="card dictation-item">
          <div class="dictation-text">${i+1}. ${s}</div>
        </div>`;
      });
    }

    section.innerHTML = html;
    content.appendChild(section);

    // Audio player setup
    const playBtn = $('play-btn');
    const audioStatus = $('audio-status');
    if (playBtn) {
      // Try TTS as fallback
      let isPlaying = false;
      let utterance = null;

      playBtn.addEventListener('click', function() {
        if (isPlaying) {
          if (window.speechSynthesis) window.speechSynthesis.cancel();
          isPlaying = false;
          playBtn.textContent = '▶';
          audioStatus.textContent = '已暂停';
          return;
        }

        if (window.speechSynthesis && l.transcript) {
          // Use TTS as fallback playback
          const sentences = l.dictation_sentences && l.dictation_sentences.length ? l.dictation_sentences : [l.transcript];
          let idx = 0;
          isPlaying = true;
          playBtn.textContent = '⏸';

          function speakNext() {
            if (idx >= sentences.length || !isPlaying) {
              isPlaying = false;
              playBtn.textContent = '▶';
              audioStatus.textContent = '播放完成 ✓';
              return;
            }
            utterance = new SpeechSynthesisUtterance(sentences[idx]);
            utterance.lang = 'en-US';
            utterance.rate = 0.8;
            utterance.onend = () => { idx++; speakNext(); };
            utterance.onerror = () => { idx++; speakNext(); };
            audioStatus.textContent = `播放中 ${idx+1}/${sentences.length}`;
            window.speechSynthesis.speak(utterance);
          }
          speakNext();
        } else {
          audioStatus.textContent = '当前环境不支持语音合成';
        }
      });
    }
  }

  function renderSpeaking() {
    const s = data.speaking;
    if (!s) return;
    const section = document.createElement('div');
    section.id = 'tab-speaking';
    section.className = 'tab-section';

    let html = '';

    // Shadowing text
    if (s.passage_for_shadowing) {
      html += `<div class="section-title">🎯 跟读训练</div>
      <div class="card card-highlight">
        <div class="card-title">👄 注意连读和重音</div>
        <div class="shadowing-text">${s.passage_for_shadowing}</div>
      </div>`;
    }

    // Dialogue
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

    // Recording
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

    // Recording setup
    const recordBtn = $('record-btn');
    const recordStatus = $('record-status');
    const playback = $('record-playback');
    if (recordBtn) {
      recordBtn.addEventListener('click', async function() {
        if (isRecording) {
          // Stop recording
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

    // Showcase sentences
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

    // Translation
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

    // Free writing
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

  // ===== Toggle Answer (global for onclick) =====
  window.toggleAnswer = function(btn) {
    const targetId = btn.dataset.target;
    const target = document.getElementById(targetId);
    if (!target) return;
    target.classList.toggle('show');
    btn.textContent = target.classList.contains('show') ? '隐藏答案 ▾' : '显示答案 ▸';
    toggleItem(targetId);
    updateProgress();
  };

  // ===== Reveal Gap (global for onclick) =====
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
      const res = await fetch('data.json?_=' + Date.now());
      if (!res.ok) throw new Error('HTTP ' + res.status);
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

    // Meta
    if (data.meta) {
      dateDisplay.textContent = data.meta.date || '';
      topicDisplay.textContent = data.meta.topic_theme || '';
      if (data.meta.estimated_completion_minutes) {
        durationDisplay.textContent = '⏱ ' + data.meta.estimated_completion_minutes + '分钟';
      }
    }

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

    // Answer toggles (delegated for all tabs)
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

    // Progress
    updateProgress();

    // SW init
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
