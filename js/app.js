/* Pseudocode Interpreter – Oberfläche: Editor, Dateien, Ein-/Ausgabe */
(function () {
  'use strict';

  const P = window.Pseudocode;
  const $ = id => document.getElementById(id);

  const code = $('code');
  const highlight = $('highlight');
  const gutter = $('gutter');
  const marker = $('line-marker');
  const consoleEl = $('console');
  const inputForm = $('input-form');
  const inputEl = $('input');
  const sendBtn = $('btn-send');
  const runBtn = $('btn-run');
  const runLabel = runBtn.querySelector('.label');
  const runState = $('run-state');
  const statusEl = $('status');
  const cursorEl = $('cursor');
  const filenameEl = $('filename');
  const fileInput = $('file-input');
  const dialog = $('syntax-dialog');

  const INDENT = '    ';
  const STORAGE_KEY = 'pseudocode-interpreter.v1';

  const EXAMPLE = `// Willkommen im Pseudocode Interpreter!
// Links schreibst du dein Programm, rechts siehst du Ein- und Ausgabe.
// Mit "Run" (F5) startest du es, mit "Syntax" öffnest du die Übersicht.

funktion fakultaet(n)
    wenn n <= 1 dann
        rueckgabe 1
    endewenn
    rueckgabe n * fakultaet(n - 1)
endefunktion

name := eingabe("Wie heißt du? ")
ausgabe("Hallo, " + name + "!")

n := zahl(eingabe("Gib eine Zahl zwischen 1 und 20 ein: "))
ausgabe(text(n) + "! = " + text(fakultaet(n)))

zahlen := liste(5, 3, 8, 1, 9)
zahlen.sortieren()
ausgabe("Sortiert: " + text(zahlen))

fuer i von 1 bis 5 tue
    ausgabe(text(i) + " zum Quadrat ist " + text(i * i))
endefuer
`;

  const state = {
    filename: 'unbenannt.pseudo',
    fileHandle: null,
    dirty: false,
    interpreter: null,
    pendingInput: null,
    errorLine: 0,
  };

  // ------------------------------------------------------------------ //
  // Syntax-Hervorhebung                                                 //
  // ------------------------------------------------------------------ //

  const VALUE_WORDS = new Set(['wahr', 'falsch', 'und', 'oder', 'nicht']);
  const TOKEN_RE = /(\/\/[^\n]*)|("(?:[^"\\\n]|\\.)*"?)|(\d+(?:\.\d+)?)|([\p{L}_][\p{L}\p{N}_]*)|(:=|==|!=|<=|>=|\*\*|\+\+|--|[+\-*/%=<>←≠≤≥])/gu;

  function escapeHtml(s) {
    return s.replace(/[&<>]/g, c => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;'));
  }

  function highlightCode(src) {
    let html = '';
    let last = 0;
    TOKEN_RE.lastIndex = 0;
    let m;
    while ((m = TOKEN_RE.exec(src))) {
      html += escapeHtml(src.slice(last, m.index));
      last = TOKEN_RE.lastIndex;
      const text = escapeHtml(m[0]);
      let cls;
      if (m[1]) cls = 'com';
      else if (m[2]) cls = 'str';
      else if (m[3]) cls = 'num';
      else if (m[5]) cls = 'op';
      else {
        const w = m[4].toLowerCase(); // Groß-/Kleinschreibung spielt keine Rolle
        if (VALUE_WORDS.has(w)) cls = 'val';
        else if (P.KEYWORDS[w]) cls = 'kw';
        else if (P.BUILTINS[w] || P.METHODS[w]) cls = 'fn';
        else if (src[last] === '(') cls = 'call';
      }
      html += cls ? `<span class="tok-${cls}">${text}</span>` : text;
    }
    return html + escapeHtml(src.slice(last));
  }

  // ------------------------------------------------------------------ //
  // Editor                                                              //
  // ------------------------------------------------------------------ //

  let lineCount = 0;

  function render() {
    const src = code.value;
    highlight.innerHTML = highlightCode(src) + '\n';
    const lines = src.split('\n').length;
    if (lines !== lineCount || state.errorLine) {
      lineCount = lines;
      let html = '';
      for (let i = 1; i <= lines; i++) {
        html += i === state.errorLine ? `<div class="error">${i}</div>` : `<div>${i}</div>`;
      }
      gutter.innerHTML = html;
    }
    syncScroll();
  }

  function syncScroll() {
    const x = code.scrollLeft, y = code.scrollTop;
    highlight.style.transform = `translate(${-x}px, ${-y}px)`;
    gutter.style.transform = `translateY(${-y}px)`;
    if (state.errorLine) positionMarker();
  }

  function lineHeight() {
    return parseFloat(getComputedStyle(code).lineHeight) || 21;
  }

  function positionMarker() {
    const padTop = parseFloat(getComputedStyle(code).paddingTop) || 0;
    marker.style.top = (padTop + (state.errorLine - 1) * lineHeight() - code.scrollTop) + 'px';
  }

  function markErrorLine(line) {
    state.errorLine = line || 0;
    marker.hidden = !state.errorLine;
    lineCount = -1;
    render();
  }

  function clearErrorLine() {
    if (statusEl.className === 'error') setStatus('Bereit');
    if (!state.errorLine) return;
    state.errorLine = 0;
    marker.hidden = true;
    lineCount = -1;
    render();
  }

  function goToLine(line, col) {
    const lines = code.value.split('\n');
    if (line < 1 || line > lines.length) return;
    let pos = 0;
    for (let i = 0; i < line - 1; i++) pos += lines[i].length + 1;
    const start = pos + Math.max(0, Math.min((col || 1) - 1, lines[line - 1].length));
    code.focus();
    code.setSelectionRange(start, start);
    const target = (line - 1) * lineHeight();
    if (target < code.scrollTop || target > code.scrollTop + code.clientHeight - 3 * lineHeight()) {
      code.scrollTop = Math.max(0, target - code.clientHeight / 3);
    }
    updateCursor();
  }

  function updateCursor() {
    const before = code.value.slice(0, code.selectionStart);
    const line = before.split('\n').length;
    const col = before.length - before.lastIndexOf('\n');
    cursorEl.textContent = `Zeile ${line}, Spalte ${col}`;
  }

  // Text einfügen und dabei die Rückgängig-Funktion des Browsers erhalten.
  function insertText(text) {
    code.focus();
    if (!document.execCommand || !document.execCommand('insertText', false, text)) {
      code.setRangeText(text, code.selectionStart, code.selectionEnd, 'end');
      onCodeChanged();
    }
  }

  function selectedLineRange() {
    const v = code.value;
    const start = v.lastIndexOf('\n', code.selectionStart - 1) + 1;
    let end = v.indexOf('\n', code.selectionEnd - (code.selectionEnd > code.selectionStart && v[code.selectionEnd - 1] === '\n' ? 1 : 0));
    if (end === -1) end = v.length;
    return [start, end];
  }

  function indentSelection(outdent) {
    const [start, end] = selectedLineRange();
    const block = code.value.slice(start, end);
    const lines = block.split('\n');
    const changed = lines.map(l => {
      if (!outdent) return INDENT + l;
      const m = l.match(/^( {1,4}|\t)/);
      return m ? l.slice(m[0].length) : l;
    }).join('\n');
    if (changed === block) return;
    code.setSelectionRange(start, end);
    insertText(changed);
    code.setSelectionRange(start, start + changed.length);
  }

  const OPENS_BLOCK = /^\s*(funktion\b.*|.*\b(dann|tue)\s*|sonst\s*)(\/\/.*)?$/i;

  function handleEnter() {
    autoOutdent();
    const v = code.value;
    const lineStart = v.lastIndexOf('\n', code.selectionStart - 1) + 1;
    const line = v.slice(lineStart, code.selectionStart);
    let indent = line.match(/^[ \t]*/)[0];
    if (OPENS_BLOCK.test(line)) indent += INDENT;
    insertText('\n' + indent);
  }

  // Zeilen mit "ende…", "sonst" oder "sonstwenn" beim Enter automatisch ausrücken.
  const CLOSES_BLOCK = /^[ \t]+((ende|endewenn|endesolange|endefuer|endefür|endefunktion|sonst)\s*(\/\/.*)?|sonstwenn\b.*)$/i;

  function autoOutdent() {
    const v = code.value;
    const pos = code.selectionStart;
    if (pos !== code.selectionEnd) return;
    const lineStart = v.lastIndexOf('\n', pos - 1) + 1;
    let lineEnd = v.indexOf('\n', pos);
    if (lineEnd === -1) lineEnd = v.length;
    if (lineEnd !== pos) return;
    const line = v.slice(lineStart, pos);
    if (!CLOSES_BLOCK.test(line)) return;
    const prevStart = v.lastIndexOf('\n', lineStart - 2) + 1;
    const prevLine = lineStart > 0 ? v.slice(prevStart, lineStart - 1) : '';
    const prevIndent = prevLine.match(/^[ \t]*/)[0];
    const curIndent = line.match(/^[ \t]*/)[0];
    // Nur ausrücken, wenn die Zeile noch auf Höhe des Blockinhalts steht
    if (curIndent.length >= INDENT.length && curIndent.length >= prevIndent.length) {
      const word = line.trim();
      code.setSelectionRange(lineStart, pos);
      insertText(curIndent.slice(INDENT.length) + word);
    }
  }

  function onCodeChanged() {
    clearErrorLine();
    render();
    updateCursor();
    setDirty(true);
    saveDraft();
  }

  code.addEventListener('input', onCodeChanged);
  code.addEventListener('scroll', syncScroll);
  code.addEventListener('keyup', updateCursor);
  code.addEventListener('click', updateCursor);
  code.addEventListener('select', updateCursor);

  code.addEventListener('keydown', e => {
    if (e.key === 'Tab' && !e.ctrlKey && !e.altKey && !e.metaKey) {
      e.preventDefault();
      if (e.shiftKey || code.value.slice(code.selectionStart, code.selectionEnd).includes('\n')) {
        indentSelection(e.shiftKey);
      } else {
        insertText(INDENT);
      }
    } else if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey && !e.isComposing) {
      e.preventDefault();
      handleEnter();
    }
  });

  // ------------------------------------------------------------------ //
  // Ausgabe-Konsole                                                     //
  // ------------------------------------------------------------------ //

  const MAX_CONSOLE_NODES = 4000;
  let outBuffer = [];
  let flushScheduled = false;

  function write(text, cls) {
    const lastEntry = outBuffer[outBuffer.length - 1];
    if (lastEntry && lastEntry.cls === cls) lastEntry.text += text;
    else outBuffer.push({ text, cls });
    if (!flushScheduled) {
      flushScheduled = true;
      requestAnimationFrame(flush);
    }
  }

  function flush() {
    flushScheduled = false;
    if (!outBuffer.length) return;
    const stick = consoleEl.scrollHeight - consoleEl.scrollTop - consoleEl.clientHeight < 40;
    const frag = document.createDocumentFragment();
    for (const { text, cls } of outBuffer) {
      const last = frag.lastChild || consoleEl.lastChild;
      if (!cls && last && last.nodeType === Node.TEXT_NODE) {
        last.appendData(text);
      } else if (cls) {
        const span = document.createElement('span');
        span.className = 'out-' + cls;
        span.textContent = text;
        frag.appendChild(span);
      } else {
        frag.appendChild(document.createTextNode(text));
      }
    }
    outBuffer = [];
    consoleEl.appendChild(frag);
    while (consoleEl.childNodes.length > MAX_CONSOLE_NODES) consoleEl.removeChild(consoleEl.firstChild);
    if (stick) consoleEl.scrollTop = consoleEl.scrollHeight;
  }

  // Beginnt die nächste Ausgabe auf einer neuen Zeile?
  function ensureNewline() {
    flush();
    const text = consoleEl.textContent;
    if (text && !text.endsWith('\n')) write('\n');
  }

  function clearConsole() {
    outBuffer = [];
    consoleEl.textContent = '';
  }

  function showError(err) {
    ensureNewline();
    const where = err.line ? `Zeile ${err.line}, Spalte ${err.col}: ` : '';
    const kind = err.kind || 'Fehler';
    write(`${kind} in ${where}${err.message}`, 'error');
    flush();
    const box = consoleEl.lastChild;
    if (err.line) {
      box.title = 'Klicken, um zur Fehlerstelle zu springen';
      box.addEventListener('click', () => goToLine(err.line, err.col));
      markErrorLine(err.line);
    }
    setStatus(`${kind}${err.line ? ' in Zeile ' + err.line : ''}: ${err.message}`, 'error');
  }

  function setStatus(text, kind) {
    statusEl.textContent = text;
    statusEl.className = kind || '';
  }

  $('btn-clear').addEventListener('click', clearConsole);

  // ------------------------------------------------------------------ //
  // Eingabe                                                             //
  // ------------------------------------------------------------------ //

  function requestInput(prompt) {
    if (prompt) write(prompt, 'prompt');
    flush();
    return new Promise(resolve => {
      state.pendingInput = resolve;
      inputEl.disabled = false;
      sendBtn.disabled = false;
      inputForm.classList.add('waiting');
      inputEl.placeholder = 'Eingabe eintippen und mit Enter bestätigen';
      setRunState('Wartet auf Eingabe …', 'waiting');
      inputEl.focus();
    });
  }

  function finishInput(value) {
    const resolve = state.pendingInput;
    state.pendingInput = null;
    inputEl.value = '';
    inputEl.disabled = true;
    sendBtn.disabled = true;
    inputForm.classList.remove('waiting');
    inputEl.placeholder = 'Eingabe ist aktiv, sobald das Programm eingabe(…) aufruft';
    if (resolve) resolve(value);
  }

  inputForm.addEventListener('submit', e => {
    e.preventDefault();
    if (!state.pendingInput) return;
    const value = inputEl.value;
    write(value, 'echo');
    write('\n');
    setRunState('Läuft …', 'active');
    finishInput(value);
  });

  // ------------------------------------------------------------------ //
  // Syntaxcheck und Ausführung                                          //
  // ------------------------------------------------------------------ //

  function analyse() {
    const ast = P.parse(code.value);
    P.check(ast);
    return ast;
  }

  function syntaxCheck() {
    if (state.interpreter) return;
    clearErrorLine();
    ensureNewline();
    try {
      analyse();
      write('✓ Syntaxcheck erfolgreich – keine Fehler gefunden.', 'success');
      flush();
      setStatus('Syntaxcheck erfolgreich', 'success');
    } catch (err) {
      if (!(err instanceof P.PseudoError)) throw err;
      showError(err);
    }
  }

  function setRunState(text, cls) {
    runState.textContent = text;
    runState.className = 'run-state' + (cls ? ' ' + cls : '');
  }

  function setRunning(running) {
    runBtn.classList.toggle('running', running);
    runLabel.textContent = running ? 'Stop' : 'Run';
    runBtn.title = running ? 'Programm abbrechen (F5)' : 'Programm ausführen (F5 oder Strg+Enter)';
    $('btn-check').disabled = running;
    $('btn-new').disabled = running;
    $('btn-open').disabled = running;
    setRunState(running ? 'Läuft …' : '', running ? 'active' : '');
  }

  async function run() {
    if (state.interpreter) { stop(); return; }
    clearErrorLine();
    clearConsole();

    let ast;
    try {
      ast = analyse();
    } catch (err) {
      if (!(err instanceof P.PseudoError)) throw err;
      showError(err);
      return;
    }

    const interpreter = new P.Interpreter({
      output: text => write(text),
      input: prompt => requestInput(prompt),
      pause: () => {
        flush();
        return new Promise(r => setTimeout(r, 0));
      },
    });
    state.interpreter = interpreter;
    setRunning(true);
    setStatus('Programm läuft …');
    const started = performance.now();

    try {
      await interpreter.run(ast);
      const secs = ((performance.now() - started) / 1000).toFixed(2).replace('.', ',');
      ensureNewline();
      write(`— Programm beendet (${secs} s) —\n`, 'system');
      setStatus('Programm beendet', 'success');
    } catch (err) {
      if (err instanceof P.StopSignal) {
        ensureNewline();
        write('— Programm abgebrochen —\n', 'system');
        setStatus('Programm abgebrochen');
      } else if (err instanceof P.PseudoError) {
        showError(err);
      } else {
        showError({ kind: 'Interner Fehler', message: String(err && err.message || err) });
        console.error(err);
      }
    } finally {
      state.interpreter = null;
      finishInput(null);
      setRunning(false);
      flush();
    }
  }

  function stop() {
    if (!state.interpreter) return;
    state.interpreter.stop();
    if (state.pendingInput) finishInput(null);
  }

  runBtn.addEventListener('click', run);
  $('btn-check').addEventListener('click', syntaxCheck);

  // ------------------------------------------------------------------ //
  // Dateien: Neu, Öffnen, Speichern                                     //
  // ------------------------------------------------------------------ //

  const FILE_TYPES = [{ description: 'Pseudocode', accept: { 'text/plain': ['.pseudo', '.pc', '.txt'] } }];

  function setDirty(dirty) {
    state.dirty = dirty;
    filenameEl.classList.toggle('dirty', dirty);
    filenameEl.title = dirty ? 'Ungespeicherte Änderungen' : '';
  }

  function setFilename(name) {
    state.filename = name;
    filenameEl.textContent = name;
    document.title = (name === 'unbenannt.pseudo' ? '' : name + ' – ') + 'Pseudocode Interpreter';
  }

  function loadCode(text, name, handle) {
    code.value = text.replace(/\r\n?/g, '\n');
    code.scrollTop = 0;
    code.scrollLeft = 0;
    code.setSelectionRange(0, 0);
    state.fileHandle = handle || null;
    setFilename(name);
    clearErrorLine();
    lineCount = -1;
    render();
    updateCursor();
    setDirty(false);
    saveDraft();
  }

  function confirmDiscard() {
    return !state.dirty || window.confirm('Es gibt ungespeicherte Änderungen. Trotzdem fortfahren?');
  }

  function newFile() {
    if (state.interpreter || !confirmDiscard()) return;
    loadCode('', 'unbenannt.pseudo');
    clearConsole();
    setStatus('Neues Programm');
    code.focus();
  }

  async function openFile() {
    if (state.interpreter || !confirmDiscard()) return;
    if (window.showOpenFilePicker) {
      try {
        const [handle] = await window.showOpenFilePicker({ types: FILE_TYPES, multiple: false });
        const file = await handle.getFile();
        loadCode(await file.text(), file.name, handle);
        setStatus(`„${file.name}“ geöffnet`);
        return;
      } catch (err) {
        if (err.name === 'AbortError') return;
        // Sonst auf das klassische Dateifeld ausweichen
      }
    }
    fileInput.value = '';
    fileInput.click();
  }

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    if (!file) return;
    loadCode(await file.text(), file.name);
    setStatus(`„${file.name}“ geöffnet`);
  });

  async function saveFile() {
    const text = code.value;
    try {
      if (!state.fileHandle && window.showSaveFilePicker) {
        state.fileHandle = await window.showSaveFilePicker({ suggestedName: state.filename, types: FILE_TYPES });
      }
      if (state.fileHandle) {
        const writable = await state.fileHandle.createWritable();
        await writable.write(text);
        await writable.close();
        setFilename(state.fileHandle.name);
        setDirty(false);
        setStatus(`„${state.fileHandle.name}“ gespeichert`, 'success');
        return;
      }
    } catch (err) {
      if (err.name === 'AbortError') return;
      state.fileHandle = null;
    }
    downloadFile(text);
  }

  function downloadFile(text) {
    let name = state.filename;
    if (name === 'unbenannt.pseudo') {
      const answer = window.prompt('Dateiname:', name);
      if (answer === null) return;
      name = answer.trim() || name;
      if (!/\.[a-z0-9]+$/i.test(name)) name += '.pseudo';
    }
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setFilename(name);
    setDirty(false);
    setStatus(`„${name}“ heruntergeladen`, 'success');
  }

  $('btn-new').addEventListener('click', newFile);
  $('btn-open').addEventListener('click', openFile);
  $('btn-save').addEventListener('click', saveFile);

  // Entwurf im Browser merken, damit nach einem Neuladen nichts verloren geht.
  let draftTimer = 0;
  function saveDraft() {
    clearTimeout(draftTimer);
    draftTimer = setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ code: code.value, filename: state.filename, dirty: state.dirty }));
      } catch (_) { /* Speicher nicht verfügbar */ }
    }, 300);
  }

  function restoreDraft() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      if (saved && typeof saved.code === 'string') {
        loadCode(saved.code, saved.filename || 'unbenannt.pseudo');
        setDirty(!!saved.dirty);
        return;
      }
    } catch (_) { /* ignorieren */ }
    loadCode(EXAMPLE, 'unbenannt.pseudo');
  }

  // ------------------------------------------------------------------ //
  // Syntax-Dialog                                                       //
  // ------------------------------------------------------------------ //

  function setupSyntaxDialog() {
    for (const pre of dialog.querySelectorAll('pre.example')) {
      const source = pre.textContent;
      pre.innerHTML = highlightCode(source);
      const wrap = document.createElement('div');
      wrap.className = 'example-wrap';
      pre.replaceWith(wrap);
      wrap.appendChild(pre);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'insert-btn';
      btn.textContent = 'Übernehmen';
      btn.title = 'Beispiel an der Cursorposition einfügen';
      btn.addEventListener('click', () => {
        dialog.close();
        const v = code.value;
        const atLineStart = code.selectionStart === 0 || v[code.selectionStart - 1] === '\n';
        insertText((atLineStart ? '' : '\n') + source + '\n');
      });
      wrap.appendChild(btn);
    }
  }

  function openSyntax() {
    if (!dialog.open) dialog.showModal();
  }

  $('btn-syntax').addEventListener('click', openSyntax);
  $('btn-syntax-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', e => {
    if (e.target === dialog) dialog.close();
  });

  // ------------------------------------------------------------------ //
  // Teiler zwischen den Bereichen                                       //
  // ------------------------------------------------------------------ //

  const split = $('split');
  const divider = $('divider');

  function setLeft(percent) {
    const p = Math.min(80, Math.max(20, percent));
    split.style.setProperty('--left', p + '%');
    try { localStorage.setItem(STORAGE_KEY + '.split', String(p)); } catch (_) { /* ignorieren */ }
    syncScroll();
  }

  divider.addEventListener('pointerdown', e => {
    divider.setPointerCapture(e.pointerId);
    divider.classList.add('dragging');
    const rect = split.getBoundingClientRect();
    const move = ev => setLeft(((ev.clientX - rect.left) / rect.width) * 100);
    const up = () => {
      divider.classList.remove('dragging');
      divider.removeEventListener('pointermove', move);
      divider.removeEventListener('pointerup', up);
    };
    divider.addEventListener('pointermove', move);
    divider.addEventListener('pointerup', up);
  });

  divider.addEventListener('keydown', e => {
    const current = parseFloat(getComputedStyle(split).getPropertyValue('--left')) || 55;
    if (e.key === 'ArrowLeft') setLeft(current - 2);
    else if (e.key === 'ArrowRight') setLeft(current + 2);
  });

  try {
    const savedSplit = parseFloat(localStorage.getItem(STORAGE_KEY + '.split'));
    if (savedSplit) split.style.setProperty('--left', savedSplit + '%');
  } catch (_) { /* ignorieren */ }

  // ------------------------------------------------------------------ //
  // Tastenkürzel                                                        //
  // ------------------------------------------------------------------ //

  document.addEventListener('keydown', e => {
    const mod = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();
    if (e.key === 'F5' || (mod && e.key === 'Enter')) {
      e.preventDefault();
      run();
    } else if (e.key === 'F7') {
      e.preventDefault();
      syntaxCheck();
    } else if (e.key === 'F1') {
      e.preventDefault();
      openSyntax();
    } else if (mod && !e.shiftKey && key === 's') {
      e.preventDefault();
      saveFile();
    } else if (mod && !e.shiftKey && key === 'o') {
      e.preventDefault();
      openFile();
    } else if (mod && e.altKey && key === 'n') {
      e.preventDefault();
      newFile();
    }
  });

  // ------------------------------------------------------------------ //
  // Start                                                               //
  // ------------------------------------------------------------------ //

  setupSyntaxDialog();
  restoreDraft();
  new ResizeObserver(syncScroll).observe(code);
})();
