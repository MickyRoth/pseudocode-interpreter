/*
 * Pseudocode Interpreter – Lexer, Parser und Interpreter
 *
 * Sprache: IHK-Pseudocode nach https://github.com/danycagiva/Pseudocode
 * Aufbau:  Quelltext → Lexer (Tokens) → Parser (AST) → Interpreter (Tree-Walking)
 *
 * Der Interpreter arbeitet asynchron, damit eingabe() auf die Webseite warten
 * und ein laufendes Programm jederzeit gestoppt werden kann.
 */
(function (global) {
  'use strict';

  // ------------------------------------------------------------------ //
  // Fehler und Signale                                                  //
  // ------------------------------------------------------------------ //

  class PseudoError extends Error {
    constructor(message, line, col, kind) {
      super(message);
      this.line = line;
      this.col = col;
      this.kind = kind || 'Fehler';
    }
  }

  class ReturnSignal {
    constructor(value) { this.value = value; }
  }

  class StopSignal {}

  // ------------------------------------------------------------------ //
  // Lexer                                                               //
  // ------------------------------------------------------------------ //

  // Ohne Prototyp, damit z. B. ein Name wie "constructor" nicht als Eintrag gilt.
  const KEYWORDS = Object.assign(Object.create(null), {
    sei: 'SEI',
    wenn: 'WENN', dann: 'DANN', sonstwenn: 'SONSTWENN', sonst: 'SONST',
    solange: 'SOLANGE', tue: 'TUE',
    fuer: 'FUER', 'für': 'FUER', von: 'VON', bis: 'BIS', schrittweite: 'SCHRITTWEITE',
    funktion: 'FUNKTION', rueckgabe: 'RUECKGABE', 'rückgabe': 'RUECKGABE',
    ausgabe: 'AUSGABE',
    und: 'UND', oder: 'ODER', nicht: 'NICHT',
    wahr: 'WAHR', falsch: 'FALSCH',
    liste: 'LISTE',
    // Alle Blockenden werden zu ENDE; der Parser prüft, ob die Variante passt.
    ende: 'ENDE', endewenn: 'ENDE', endesolange: 'ENDE',
    endefuer: 'ENDE', 'endefür': 'ENDE', endefunktion: 'ENDE',
  });

  const ID_START = /[\p{L}_]/u;
  const ID_PART = /[\p{L}\p{N}_]/u;
  const DIGIT = /[0-9]/;

  function tokenize(src) {
    const tokens = [];
    const chars = Array.from(src);
    const n = chars.length;
    let i = 0, line = 1, col = 1;

    const peek = (o = 0) => (i + o < n ? chars[i + o] : '');
    const advance = () => {
      const c = chars[i++];
      if (c === '\n') { line++; col = 1; } else { col++; }
      return c;
    };
    // value: Wert für den Parser (Namen und Schlüsselwörter in Kleinschreibung),
    // text:  Schreibweise im Quelltext (für Fehlermeldungen)
    const push = (type, value, l, c, text) =>
      tokens.push({ type, value, text: text === undefined ? value : text, line: l, col: c });
    const fail = (msg, l, c) => { throw new PseudoError(msg, l, c, 'Syntaxfehler'); };

    while (i < n) {
      const c = peek();
      if (c === ' ' || c === '\t' || c === '\r' || c === '\n' || c === ' ') { advance(); continue; }

      const tl = line, tc = col;

      // Kommentar
      if (c === '/' && peek(1) === '/') {
        while (i < n && peek() !== '\n') advance();
        continue;
      }

      // Zahl
      if (DIGIT.test(c)) {
        let s = '';
        while (i < n && DIGIT.test(peek())) s += advance();
        if (peek() === '.' && DIGIT.test(peek(1))) {
          s += advance();
          while (i < n && DIGIT.test(peek())) s += advance();
        }
        push('ZAHL', s, tl, tc);
        continue;
      }

      // Zeichenkette
      if (c === '"') {
        advance();
        let s = '';
        while (i < n && peek() !== '"') {
          if (peek() === '\n') fail('Zeichenkette wurde nicht mit " abgeschlossen', tl, tc);
          if (peek() === '\\') {
            advance();
            if (i >= n) break;
            const esc = advance();
            if (esc === 'n') s += '\n';
            else if (esc === 't') s += '\t';
            else if (esc === '"') s += '"';
            else if (esc === '\\') s += '\\';
            else s += '\\' + esc;
          } else {
            s += advance();
          }
        }
        if (i >= n) fail('Zeichenkette wurde nicht mit " abgeschlossen', tl, tc);
        advance();
        push('ZEICHENKETTE', s, tl, tc);
        continue;
      }

      // Bezeichner oder Schlüsselwort (inkl. Umlaute). Groß- und Kleinschreibung
      // spielt keine Rolle: WENN, Wenn und wenn sind gleich, ebenso Zaehler und zaehler.
      if (ID_START.test(c)) {
        let s = '';
        while (i < n && ID_PART.test(peek())) s += advance();
        const key = s.toLowerCase();
        push(Object.prototype.hasOwnProperty.call(KEYWORDS, key) ? KEYWORDS[key] : 'NAME', key, tl, tc, s);
        continue;
      }

      // Operatoren und Satzzeichen
      advance();
      switch (c) {
        case ':':
          if (peek() === '=') { advance(); push('ZUWEISUNG', ':=', tl, tc); }
          else fail("Unbekanntes Zeichen ':' – meintest du ':='?", tl, tc);
          break;
        case '←': push('ZUWEISUNG', ':=', tl, tc); break;
        case '=':
          // '==' ist als Schreibweise für den Vergleich '=' erlaubt
          if (peek() === '=') { advance(); push('OP', '==', tl, tc); }
          else push('OP', '=', tl, tc);
          break;
        case '≠': push('OP', '!=', tl, tc); break;
        case '≤': push('OP', '<=', tl, tc); break;
        case '≥': push('OP', '>=', tl, tc); break;
        case '!':
          if (peek() === '=') { advance(); push('OP', '!=', tl, tc); }
          else fail("Unbekanntes Zeichen '!' – meintest du '!=' oder 'nicht'?", tl, tc);
          break;
        case '<':
        case '>':
          if (peek() === '=') { advance(); push('OP', c + '=', tl, tc); }
          else push('OP', c, tl, tc);
          break;
        case '+':
          if (peek() === '+') { advance(); push('PLUSPLUS', '++', tl, tc); }
          else push('OP', '+', tl, tc);
          break;
        case '-':
          if (peek() === '-') { advance(); push('MINUSMINUS', '--', tl, tc); }
          else push('OP', '-', tl, tc);
          break;
        case '*':
          if (peek() === '*') { advance(); push('OP', '**', tl, tc); }
          else push('OP', '*', tl, tc);
          break;
        case '/': case '%':
          push('OP', c, tl, tc); break;
        case '(': push('LPAREN', c, tl, tc); break;
        case ')': push('RPAREN', c, tl, tc); break;
        case '[': push('LBRACKET', c, tl, tc); break;
        case ']': push('RBRACKET', c, tl, tc); break;
        case ',': push('KOMMA', c, tl, tc); break;
        case ';': push('STRICHPUNKT', c, tl, tc); break;
        case '.': push('PUNKT', c, tl, tc); break;
        default:
          fail("Unbekanntes Zeichen '" + c + "'", tl, tc);
      }
    }

    push('EOF', '', line, col);
    return tokens;
  }

  // ------------------------------------------------------------------ //
  // Parser (rekursiv absteigend)                                        //
  // ------------------------------------------------------------------ //

  // Erlaubte Blockenden je Blockart (neben dem universellen 'ende')
  const BLOCK_END = {
    wenn: ['endewenn'],
    solange: ['endesolange'],
    fuer: ['endefuer', 'endefür'],
    funktion: ['endefunktion'],
  };

  class Parser {
    constructor(tokens) {
      this.tokens = tokens;
      this.pos = 0;
    }

    get cur() { return this.tokens[this.pos]; }
    is(type, value) {
      const t = this.cur;
      return t.type === type && (value === undefined || t.value === value);
    }
    next() { return this.tokens[this.pos++]; }
    atEnd() { return this.cur.type === 'EOF'; }

    error(msg, tok) {
      tok = tok || this.cur;
      return new PseudoError(msg, tok.line, tok.col, 'Syntaxfehler');
    }

    describe(tok) {
      if (tok.type === 'EOF') return 'Dateiende';
      if (tok.type === 'ZEICHENKETTE') return 'Zeichenkette "' + tok.value + '"';
      return "'" + tok.text + "'";
    }

    expect(type, what) {
      if (!this.is(type)) throw this.error('Erwartet ' + what + ', gefunden ' + this.describe(this.cur));
      return this.next();
    }

    parseProgram() {
      const body = [];
      while (!this.atEnd()) body.push(this.parseStatement());
      return { type: 'Program', body };
    }

    parseBlock(stops) {
      const body = [];
      while (!this.atEnd() && !stops.includes(this.cur.type)) body.push(this.parseStatement());
      return body;
    }

    // Schließt einen Block ab und prüft, ob das passende Blockende verwendet wurde.
    closeBlock(kind, startTok) {
      const expected = BLOCK_END[kind][0];
      if (this.atEnd()) {
        throw this.error("'" + kind + "' aus Zeile " + startTok.line + " wird nicht mit '" + expected +
          "' abgeschlossen", startTok);
      }
      if (!this.is('ENDE')) {
        throw this.error("Erwartet '" + expected + "' zum Abschluss von '" + kind + "' (Zeile " +
          startTok.line + '), gefunden ' + this.describe(this.cur));
      }
      const end = this.cur;
      if (end.value !== 'ende' && !BLOCK_END[kind].includes(end.value)) {
        throw this.error("Falsches Blockende '" + end.text + "': der Block '" + kind + "' aus Zeile " +
          startTok.line + " muss mit '" + expected + "' (oder 'ende') abgeschlossen werden");
      }
      this.next();
    }

    parseStatement() {
      if (this.is('SEI')) this.next();

      let node;
      switch (this.cur.type) {
        case 'WENN': node = this.parseIf(); break;
        case 'SOLANGE': node = this.parseWhile(); break;
        case 'FUER': node = this.parseFor(); break;
        case 'FUNKTION': node = this.parseFunction(); break;
        case 'RUECKGABE': node = this.parseReturn(); break;
        case 'AUSGABE': node = this.parsePrint(); break;
        default: node = this.parseSimpleStatement();
      }
      this.endStatement();
      return node;
    }

    // Steht das aktuelle Token in einer neuen Zeile (oder am Dateiende)?
    atLineStart() {
      return this.atEnd() || this.pos === 0 || this.cur.line !== this.tokens[this.pos - 1].line;
    }

    // Nach einer Anweisung muss eine neue Zeile beginnen. Nur ein Blockende
    // (oder sonst/sonstwenn) darf noch in derselben Zeile folgen.
    endStatement() {
      if (this.atLineStart() || this.is('ENDE') || this.is('SONST') || this.is('SONSTWENN')) return;
      throw this.error('Nach einer Anweisung muss eine neue Zeile beginnen, gefunden ' + this.describe(this.cur));
    }

    parseSimpleStatement() {
      const start = this.cur;
      if (KEYWORDS[start.value] && this.tokens[this.pos + 1].type === 'ZUWEISUNG') {
        throw this.error("'" + start.text + "' ist ein Schlüsselwort und kann nicht als Variablenname verwendet werden");
      }
      const expr = this.parseExpr();

      if (this.is('ZUWEISUNG')) {
        this.next();
        const value = this.parseExpr();
        if (expr.type === 'Var') {
          return { type: 'Assign', name: expr.name, label: expr.label, value, line: start.line, col: start.col };
        }
        if (expr.type === 'Index') {
          return { type: 'IndexAssign', target: expr.object, index: expr.index, value, line: start.line, col: start.col };
        }
        throw this.error('Die linke Seite einer Zuweisung muss eine Variable oder ein Listenelement sein', start);
      }

      // i++ / i-- als eigene Anweisung
      if (this.is('PLUSPLUS') || this.is('MINUSMINUS')) {
        const opTok = this.next();
        if (expr.type !== 'Var') throw this.error("'" + opTok.value + "' ist nur bei Variablen erlaubt", opTok);
        return this.incrementOf(expr.name, expr.label, opTok.value === '++' ? '+' : '-', start);
      }

      if (expr.type === 'Call' || expr.type === 'Method') {
        return { type: 'ExprStmt', expr, line: start.line, col: start.col };
      }
      if (expr.type === 'Binary' && expr.op === '=') {
        throw this.error("'" + expr.symbol + "' ist ein Vergleich. Für eine Zuweisung bitte ':=' verwenden", expr);
      }
      throw this.error('Ausdruck ohne Wirkung – erwartet wird eine Anweisung (z. B. Zuweisung mit \':=\')', start);
    }

    incrementOf(name, label, op, tok) {
      return {
        type: 'Assign', name, label, line: tok.line, col: tok.col,
        value: {
          type: 'Binary', op, line: tok.line, col: tok.col,
          left: { type: 'Var', name, label, line: tok.line, col: tok.col },
          right: { type: 'Num', value: 1, line: tok.line, col: tok.col },
        },
      };
    }

    parseIf() {
      const start = this.next();
      const node = { type: 'If', branches: [], elseBody: null, line: start.line, col: start.col };
      const cond = this.parseExpr();
      this.expect('DANN', "'dann' nach der Bedingung");
      node.branches.push({ cond, body: this.parseBlock(['SONSTWENN', 'SONST', 'ENDE']) });

      while (this.is('SONSTWENN')) {
        this.next();
        const c = this.parseExpr();
        this.expect('DANN', "'dann' nach der 'sonstwenn'-Bedingung");
        node.branches.push({ cond: c, body: this.parseBlock(['SONSTWENN', 'SONST', 'ENDE']) });
      }
      if (this.is('SONST')) {
        this.next();
        node.elseBody = this.parseBlock(['ENDE']);
      }
      this.closeBlock('wenn', start);
      return node;
    }

    parseWhile() {
      const start = this.next();
      const cond = this.parseExpr();
      this.expect('TUE', "'tue' nach der Schleifenbedingung");
      const body = this.parseBlock(['ENDE']);
      this.closeBlock('solange', start);
      return { type: 'While', cond, body, line: start.line, col: start.col };
    }

    parseFor() {
      const start = this.next();
      const varTok = this.expect('NAME', 'eine Laufvariable nach \'fuer\'');

      // C-Stil: fuer i := 0; i < 5; i++ tue
      if (this.is('ZUWEISUNG')) {
        this.next();
        const init = { type: 'Assign', name: varTok.value, label: varTok.text, value: this.parseExpr(), line: varTok.line, col: varTok.col };
        this.expect('STRICHPUNKT', "';' nach dem Startwert");
        const cond = this.parseExpr();
        this.expect('STRICHPUNKT', "';' nach der Bedingung");

        const sTok = this.expect('NAME', 'eine Schrittanweisung (z. B. i++)');
        let step;
        if (this.is('PLUSPLUS') || this.is('MINUSMINUS')) {
          step = this.incrementOf(sTok.value, sTok.text, this.next().value === '++' ? '+' : '-', sTok);
        } else if (this.is('ZUWEISUNG')) {
          this.next();
          step = { type: 'Assign', name: sTok.value, label: sTok.text, value: this.parseExpr(), line: sTok.line, col: sTok.col };
        } else {
          throw this.error("Ungültige Schrittangabe – erlaubt sind i++, i-- oder i := …");
        }

        this.expect('TUE', "'tue' nach der Schrittangabe");
        const body = this.parseBlock(['ENDE']);
        this.closeBlock('fuer', start);
        return { type: 'For', init, cond, step, body, line: start.line, col: start.col };
      }

      // Bereich: fuer i von 1 bis 10 schrittweite 2 tue
      if (this.is('VON')) {
        this.next();
        const from = this.parseExpr();
        this.expect('BIS', "'bis' nach dem Startwert");
        const to = this.parseExpr();
        let by = null;
        if (this.is('SCHRITTWEITE')) {
          this.next();
          by = this.parseExpr();
        }
        this.expect('TUE', "'tue' nach der Bereichsangabe");
        const body = this.parseBlock(['ENDE']);
        this.closeBlock('fuer', start);
        return { type: 'Range', name: varTok.value, label: varTok.text, from, to, by, body, line: start.line, col: start.col };
      }

      throw this.error("Erwartet ':=' (C-Stil) oder 'von' (Bereich) nach der Laufvariable, gefunden " +
        this.describe(this.cur));
    }

    parseFunction() {
      const start = this.next();
      const nameTok = this.expect('NAME', 'einen Funktionsnamen');
      this.expect('LPAREN', "'(' nach dem Funktionsnamen");
      const params = [], paramLabels = [];
      while (!this.is('RPAREN')) {
        const p = this.expect('NAME', 'einen Parameternamen');
        if (params.includes(p.value)) throw this.error("Parameter '" + p.text + "' ist doppelt", p);
        params.push(p.value);
        paramLabels.push(p.text);
        if (this.is('KOMMA')) this.next();
        else if (!this.is('RPAREN')) throw this.error("Erwartet ',' oder ')' in der Parameterliste, gefunden " + this.describe(this.cur));
      }
      this.next();
      const body = this.parseBlock(['ENDE']);
      this.closeBlock('funktion', start);
      return { type: 'FuncDef', name: nameTok.value, label: nameTok.text, params, paramLabels, body, line: start.line, col: start.col };
    }

    parseReturn() {
      const start = this.next();
      // Ohne Wert in derselben Zeile ist es eine leere Rückgabe.
      const empty = this.atLineStart() || this.is('ENDE') || this.is('SONST') || this.is('SONSTWENN');
      return { type: 'Return', value: empty ? null : this.parseExpr(), line: start.line, col: start.col };
    }

    parsePrint() {
      const start = this.next();
      this.expect('LPAREN', "'(' nach 'ausgabe'");
      const args = this.parseArgs();
      if (args.length === 0) throw this.error("'ausgabe' braucht einen Wert", start);
      return { type: 'Print', args, line: start.line, col: start.col };
    }

    // Liest Argumente bis zur schließenden Klammer; '(' ist bereits gelesen.
    parseArgs() {
      const args = [];
      while (!this.is('RPAREN')) {
        if (this.atEnd()) throw this.error("Erwartet ')' – Klammer wurde nicht geschlossen");
        args.push(this.parseExpr());
        if (this.is('KOMMA')) this.next();
        else if (!this.is('RPAREN')) throw this.error("Erwartet ',' oder ')', gefunden " + this.describe(this.cur));
      }
      this.next();
      return args;
    }

    // --- Ausdrücke (Präzedenz von schwach nach stark) ---

    parseExpr() { return this.parseOr(); }

    parseOr() {
      let left = this.parseAnd();
      while (this.is('ODER')) {
        const t = this.next();
        left = { type: 'Logic', op: 'oder', left, right: this.parseAnd(), line: t.line, col: t.col };
      }
      return left;
    }

    parseAnd() {
      let left = this.parseNot();
      while (this.is('UND')) {
        const t = this.next();
        left = { type: 'Logic', op: 'und', left, right: this.parseNot(), line: t.line, col: t.col };
      }
      return left;
    }

    parseNot() {
      if (this.is('NICHT')) {
        const t = this.next();
        return { type: 'Unary', op: 'nicht', operand: this.parseNot(), line: t.line, col: t.col };
      }
      return this.parseComparison();
    }

    parseComparison() {
      let left = this.parseAdditive();
      while (this.is('OP') && ['=', '==', '!=', '<', '>', '<=', '>='].includes(this.cur.value)) {
        const t = this.next();
        const op = t.value === '==' ? '=' : t.value;
        left = { type: 'Binary', op, symbol: t.value, left, right: this.parseAdditive(), line: t.line, col: t.col };
      }
      return left;
    }

    parseAdditive() {
      let left = this.parseMultiplicative();
      while (this.is('OP', '+') || this.is('OP', '-')) {
        const t = this.next();
        left = { type: 'Binary', op: t.value, left, right: this.parseMultiplicative(), line: t.line, col: t.col };
      }
      return left;
    }

    parseMultiplicative() {
      let left = this.parseUnary();
      while (this.is('OP', '*') || this.is('OP', '/') || this.is('OP', '%')) {
        const t = this.next();
        left = { type: 'Binary', op: t.value, left, right: this.parseUnary(), line: t.line, col: t.col };
      }
      return left;
    }

    parseUnary() {
      if (this.is('OP', '-')) {
        const t = this.next();
        return { type: 'Unary', op: '-', operand: this.parseUnary(), line: t.line, col: t.col };
      }
      if (this.is('NICHT')) {
        const t = this.next();
        return { type: 'Unary', op: 'nicht', operand: this.parseUnary(), line: t.line, col: t.col };
      }
      return this.parsePower();
    }

    // Potenz bindet stärker als ein Vorzeichen links davon (-2 ** 2 = -4)
    // und ist rechtsassoziativ (2 ** 3 ** 2 = 2 ** 9).
    parsePower() {
      const base = this.parsePostfix(this.parsePrimary());
      if (!this.is('OP', '**')) return base;
      const t = this.next();
      return { type: 'Binary', op: '**', left: base, right: this.parseUnary(), line: t.line, col: t.col };
    }

    parsePrimary() {
      const t = this.cur;
      switch (t.type) {
        case 'ZAHL': this.next(); return { type: 'Num', value: parseFloat(t.value), line: t.line, col: t.col };
        case 'ZEICHENKETTE': this.next(); return { type: 'Str', value: t.value, line: t.line, col: t.col };
        case 'WAHR': this.next(); return { type: 'Bool', value: true, line: t.line, col: t.col };
        case 'FALSCH': this.next(); return { type: 'Bool', value: false, line: t.line, col: t.col };
        case 'LISTE':
          this.next();
          this.expect('LPAREN', "'(' nach 'liste'");
          return { type: 'List', items: this.parseArgs(), line: t.line, col: t.col };
        case 'NAME':
          this.next();
          if (this.is('LPAREN')) {
            this.next();
            return { type: 'Call', name: t.value, label: t.text, args: this.parseArgs(), line: t.line, col: t.col };
          }
          return { type: 'Var', name: t.value, label: t.text, line: t.line, col: t.col };
        case 'LPAREN': {
          this.next();
          const e = this.parseExpr();
          this.expect('RPAREN', "')' nach dem Ausdruck");
          return e;
        }
        case 'EOF':
          throw this.error('Unerwartetes Dateiende – hier fehlt noch ein Wert oder Ausdruck');
        case 'ENDE':
          throw this.error("'" + t.text + "' ohne passenden Blockanfang (wenn, solange, fuer, funktion)");
        case 'SONST':
        case 'SONSTWENN':
          throw this.error("'" + t.text + "' ohne passendes 'wenn'");
        case 'AUSGABE':
          throw this.error("'" + t.text + "' ist eine Anweisung und liefert keinen Wert");
        default:
          if (KEYWORDS[t.value]) throw this.error("Unerwartetes Schlüsselwort '" + t.text + "'");
          throw this.error('Unerwartetes Zeichen ' + this.describe(t));
      }
    }

    parsePostfix(expr) {
      for (;;) {
        if (this.is('LBRACKET')) {
          const t = this.next();
          const index = this.parseExpr();
          this.expect('RBRACKET', "']' nach dem Index");
          expr = { type: 'Index', object: expr, index, line: t.line, col: t.col };
        } else if (this.is('PUNKT')) {
          this.next();
          const m = this.expect('NAME', 'einen Methodennamen nach \'.\'');
          this.expect('LPAREN', "'(' nach dem Methodennamen");
          expr = { type: 'Method', object: expr, name: m.value, label: m.text, args: this.parseArgs(), line: m.line, col: m.col };
        } else {
          return expr;
        }
      }
    }
  }

  function parse(src) {
    return new Parser(tokenize(src)).parseProgram();
  }

  // ------------------------------------------------------------------ //
  // Werte                                                               //
  // ------------------------------------------------------------------ //

  function formatNumber(v) {
    if (Number.isNaN(v)) return 'keine Zahl';
    if (!Number.isFinite(v)) return v > 0 ? 'unendlich' : '-unendlich';
    if (Number.isInteger(v) && Math.abs(v) < 1e15) return String(v);
    return String(Number(v.toPrecision(12)));
  }

  function toText(v) {
    if (v === null || v === undefined) return 'nichts';
    if (typeof v === 'number') return formatNumber(v);
    if (typeof v === 'boolean') return v ? 'wahr' : 'falsch';
    if (typeof v === 'string') return v;
    if (Array.isArray(v)) {
      return '[' + v.map(x => (typeof x === 'string' ? '"' + x + '"' : toText(x))).join(', ') + ']';
    }
    return String(v);
  }

  function typeName(v) {
    if (v === null || v === undefined) return 'nichts';
    if (typeof v === 'number') return 'zahl';
    if (typeof v === 'string') return 'zeichenkette';
    if (typeof v === 'boolean') return 'wahrheitswert';
    if (Array.isArray(v)) return 'liste';
    return 'unbekannt';
  }

  function truthy(v) {
    if (typeof v === 'boolean') return v;
    if (typeof v === 'number') return v !== 0;
    if (typeof v === 'string') return v.length > 0;
    if (Array.isArray(v)) return v.length > 0;
    return false;
  }

  function equals(a, b) {
    if (Array.isArray(a) && Array.isArray(b)) {
      return a.length === b.length && a.every((x, i) => equals(x, b[i]));
    }
    return a === b;
  }

  // ------------------------------------------------------------------ //
  // Eingebaute Funktionen und Listenmethoden                            //
  // ------------------------------------------------------------------ //

  // Anzahl erlaubter Argumente: [min, max]
  const BUILTINS = Object.assign(Object.create(null), {
    eingabe: [0, 1], text: [1, 1], zahl: [1, 1], datentyp: [1, 1],
    laenge: [1, 1], 'länge': [1, 1],
    abs: [1, 1], runden: [1, 1], boden: [1, 1], decke: [1, 1], wurzel: [1, 1],
  });

  const METHODS = Object.assign(Object.create(null), {
    hinzufuegen: [1, 1], 'hinzufügen': [1, 1],
    entfernen: [1, 1],
    einfuegen: [2, 2], 'einfügen': [2, 2],
    pop: [0, 0], sortieren: [0, 0], umkehren: [0, 0],
  });

  function arityText(name, range) {
    const [min, max] = range;
    if (min === max) return "'" + name + "' erwartet " + min + (min === 1 ? ' Argument' : ' Argumente');
    return "'" + name + "' erwartet " + min + ' bis ' + max + ' Argumente';
  }

  const NUMBER_RE = /^[+-]?(\d+([.,]\d*)?|[.,]\d+)([eE][+-]?\d+)?$/;

  // ------------------------------------------------------------------ //
  // Statische Prüfung (Syntaxcheck über den Parser hinaus)              //
  // ------------------------------------------------------------------ //

  function check(program) {
    const funcs = new Map();
    const collect = nodes => {
      for (const s of nodes) {
        if (s.type === 'FuncDef') {
          if (funcs.has(s.name)) {
            throw new PseudoError("Funktion '" + s.label + "' ist mehrfach definiert", s.line, s.col, 'Syntaxfehler');
          }
          funcs.set(s.name, s);
        }
        for (const b of childBlocks(s)) collect(b);
      }
    };
    collect(program.body);

    // Variablen, denen im Hauptprogramm irgendwo ein Wert zugewiesen wird (Name → Schreibweise).
    // Funktionen sehen diese globalen Variablen zusätzlich zu ihren eigenen.
    const globalVars = assignedNames(program.body);
    const funcNames = () => [...funcs.values()].map(f => [f.name, f.label]);
    const builtinNames = table => Object.keys(table).map(k => [k, k]);
    const fail = (msg, node) => { throw new PseudoError(msg, node.line, node.col, 'Syntaxfehler'); };
    const hint = guess => (guess ? " – meintest du '" + guess + "'?" : '');

    const visit = (node, vars, inFunc) => {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node)) { node.forEach(n => visit(n, vars, inFunc)); return; }

      if (node.type === 'FuncDef') {
        const local = new Map(globalVars);
        node.params.forEach((p, i) => local.set(p, node.paramLabels[i]));
        visit(node.body, assignedNames(node.body, local), true);
        return;
      }
      if (node.type === 'Var' && !vars.has(node.name)) {
        const guess = suggest(node.name, vars);
        fail("Unbekannte Variable '" + node.label + "'" +
          (guess ? hint(guess) : ' – ihr wird nirgends ein Wert zugewiesen'), node);
      }
      if (node.type === 'Return' && !inFunc) {
        fail("'rueckgabe' ist nur innerhalb einer Funktion erlaubt", node);
      }
      if (node.type === 'Call') {
        const def = funcs.get(node.name);
        if (def) {
          if (def.params.length !== node.args.length) {
            fail("Funktion '" + node.label + "' erwartet " + def.params.length +
              ' Argument(e), aber ' + node.args.length + ' wurden übergeben', node);
          }
        } else if (BUILTINS[node.name]) {
          const [min, max] = BUILTINS[node.name];
          if (node.args.length < min || node.args.length > max) fail(arityText(node.label, BUILTINS[node.name]), node);
        } else {
          const guess = suggest(node.name, funcNames().concat(builtinNames(BUILTINS)));
          fail("Unbekannte Funktion '" + node.label + "'" + hint(guess), node);
        }
      }
      if (node.type === 'Method') {
        const range = METHODS[node.name];
        if (!range) fail("Unbekannte Listenmethode '" + node.label + "'" + hint(suggest(node.name, builtinNames(METHODS))), node);
        if (node.args.length < range[0] || node.args.length > range[1]) fail(arityText(node.label, range), node);
      }
      for (const key of Object.keys(node)) {
        if (key === 'line' || key === 'col' || key === 'type') continue;
        visit(node[key], vars, inFunc);
      }
    };
    visit(program.body, globalVars, false);
    return true;
  }

  // Sammelt alle Namen, denen in den Anweisungen (ohne verschachtelte Funktionen)
  // ein Wert zugewiesen wird, mit ihrer ersten Schreibweise. Die Reihenfolge spielt bewusst
  // keine Rolle, weil eine Zuweisung in einer Schleife erst in einem späteren Durchlauf greifen kann.
  function assignedNames(stmts, names) {
    names = names || new Map();
    const add = (name, label) => { if (!names.has(name)) names.set(name, label); };
    for (const s of stmts) {
      if (s.type === 'Assign' || s.type === 'Range') add(s.name, s.label);
      else if (s.type === 'For') { add(s.init.name, s.init.label); add(s.step.name, s.step.label); }
      if (s.type !== 'FuncDef') for (const b of childBlocks(s)) assignedNames(b, names);
    }
    return names;
  }

  // Ähnlichster bekannter Name für einen Tippfehler (candidates: [Name, Schreibweise]), sonst null.
  function suggest(name, candidates) {
    const len = Array.from(name).length;
    if (len <= 2) return null; // bei so kurzen Namen wäre fast alles „ähnlich“ (aus y würde x)
    const limit = len <= 4 ? 1 : 2;
    let best = null, bestDist = Infinity;
    for (const [key, label] of candidates) {
      const d = editDistance(name, key);
      if (d < bestDist) { best = label; bestDist = d; }
    }
    return bestDist <= limit ? best : null;
  }

  function editDistance(a, b) {
    a = Array.from(a); b = Array.from(b);
    let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
    for (let i = 1; i <= a.length; i++) {
      const cur = [i];
      for (let j = 1; j <= b.length; j++) {
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      }
      prev = cur;
    }
    return prev[b.length];
  }

  function childBlocks(s) {
    switch (s.type) {
      case 'If': return s.branches.map(b => b.body).concat(s.elseBody ? [s.elseBody] : []);
      case 'While': case 'For': case 'Range': case 'FuncDef': return [s.body];
      default: return [];
    }
  }

  // ------------------------------------------------------------------ //
  // Interpreter                                                         //
  // ------------------------------------------------------------------ //

  class Env {
    constructor(parent) {
      this.vars = new Map();
      this.parent = parent;
    }
    get(name, node) {
      for (let e = this; e; e = e.parent) {
        if (e.vars.has(name)) return e.vars.get(name);
      }
      throw new PseudoError("Unbekannte Variable '" + (node.label || name) + "'", node.line, node.col, 'Laufzeitfehler');
    }
    // Zuweisungen landen immer im aktuellen Gültigkeitsbereich.
    set(name, value) { this.vars.set(name, value); }
  }

  const MAX_DEPTH = 1000;
  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

  class Interpreter {
    /**
     * host.output(text)        – Text ausgeben
     * host.input(prompt)       – Promise<string> mit der Benutzereingabe
     * host.pause()             – Promise, das der Oberfläche kurz Zeit gibt
     */
    constructor(host) {
      this.host = host;
      this.globals = new Env(null);
      this.funcs = new Map();
      this.stopped = false;
      this.depth = 0;
      this.ops = 0;
      this.lastPause = now();
    }

    stop() { this.stopped = true; }

    async run(program) {
      for (const s of program.body) {
        if (s.type === 'FuncDef') this.funcs.set(s.name, s);
      }
      this.lastPause = now();
      try {
        await this.execBlock(program.body, this.globals);
      } catch (e) {
        if (e instanceof RangeError) {
          throw new PseudoError('Zu tiefe Rekursion – das Programm ruft sich zu oft selbst auf', 0, 0, 'Laufzeitfehler');
        }
        throw e;
      }
    }

    error(msg, node) {
      return new PseudoError(msg, node.line, node.col, 'Laufzeitfehler');
    }

    async tick() {
      if (this.stopped) throw new StopSignal();
      if ((++this.ops & 1023) === 0 && now() - this.lastPause > 40) {
        await this.host.pause();
        this.lastPause = now();
        if (this.stopped) throw new StopSignal();
      }
    }

    async execBlock(stmts, env) {
      for (const s of stmts) await this.exec(s, env);
    }

    async exec(s, env) {
      await this.tick();
      switch (s.type) {
        case 'Assign':
          env.set(s.name, await this.eval(s.value, env));
          return;

        case 'IndexAssign': {
          const list = await this.eval(s.target, env);
          const index = await this.eval(s.index, env);
          const value = await this.eval(s.value, env);
          if (!Array.isArray(list)) throw this.error('Nur Listenelemente können per [ ] verändert werden', s);
          list[this.toIndex(index, list.length, s.index)] = value;
          return;
        }

        case 'Print': {
          const parts = [];
          for (const a of s.args) parts.push(toText(await this.eval(a, env)));
          this.host.output(parts.join(' ') + '\n');
          return;
        }

        case 'If':
          for (const b of s.branches) {
            if (truthy(await this.eval(b.cond, env))) {
              await this.execBlock(b.body, env);
              return;
            }
          }
          if (s.elseBody) await this.execBlock(s.elseBody, env);
          return;

        case 'While':
          while (truthy(await this.eval(s.cond, env))) {
            await this.execBlock(s.body, env);
            await this.tick();
          }
          return;

        case 'For':
          await this.exec(s.init, env);
          while (truthy(await this.eval(s.cond, env))) {
            await this.execBlock(s.body, env);
            await this.exec(s.step, env);
          }
          return;

        case 'Range': {
          const from = this.toNumber(await this.eval(s.from, env), s.from, "Startwert von 'fuer'");
          const to = this.toNumber(await this.eval(s.to, env), s.to, "Endwert von 'fuer'");
          const by = s.by ? this.toNumber(await this.eval(s.by, env), s.by, 'Schrittweite') : 1;
          if (by === 0) throw this.error('Die Schrittweite darf nicht 0 sein', s.by || s);
          const eps = Math.abs(by) * 1e-9;
          for (let k = 0; ; k++) {
            const i = from + k * by;
            if (by > 0 ? i > to + eps : i < to - eps) break;
            env.set(s.name, Number(i.toPrecision(15)));
            await this.execBlock(s.body, env);
            await this.tick();
          }
          return;
        }

        case 'FuncDef':
          this.funcs.set(s.name, s);
          return;

        case 'Return':
          if (this.depth === 0) throw this.error("'rueckgabe' ist nur innerhalb einer Funktion erlaubt", s);
          throw new ReturnSignal(s.value ? await this.eval(s.value, env) : null);

        case 'ExprStmt':
          await this.eval(s.expr, env);
          return;

        default:
          throw this.error('Unbekannte Anweisung', s);
      }
    }

    async eval(e, env) {
      switch (e.type) {
        case 'Num':
        case 'Str':
        case 'Bool':
          return e.value;

        case 'List': {
          const items = [];
          for (const x of e.items) items.push(await this.eval(x, env));
          return items;
        }

        case 'Var':
          return env.get(e.name, e);

        case 'Index': {
          const obj = await this.eval(e.object, env);
          const index = await this.eval(e.index, env);
          if (Array.isArray(obj)) return obj[this.toIndex(index, obj.length, e.index)];
          if (typeof obj === 'string') {
            const chars = Array.from(obj);
            return chars[this.toIndex(index, chars.length, e.index)];
          }
          throw this.error('Zugriff mit [ ] ist nur bei Listen und Zeichenketten möglich (Wert ist ' +
            typeName(obj) + ')', e);
        }

        case 'Unary': {
          const v = await this.eval(e.operand, env);
          if (e.op === 'nicht') return !truthy(v);
          if (typeof v !== 'number') throw this.error("'-' erwartet eine Zahl, nicht " + typeName(v), e);
          return -v;
        }

        case 'Logic': {
          const left = truthy(await this.eval(e.left, env));
          if (e.op === 'und') return left ? truthy(await this.eval(e.right, env)) : false;
          return left ? true : truthy(await this.eval(e.right, env));
        }

        case 'Binary':
          return this.binary(e, await this.eval(e.left, env), await this.eval(e.right, env));

        case 'Call': {
          const args = [];
          for (const a of e.args) args.push(await this.eval(a, env));
          return this.call(e, args);
        }

        case 'Method': {
          const obj = await this.eval(e.object, env);
          const args = [];
          for (const a of e.args) args.push(await this.eval(a, env));
          return this.method(e, obj, args);
        }

        default:
          throw this.error('Unbekannter Ausdruck', e);
      }
    }

    binary(e, l, r) {
      switch (e.op) {
        case '=': return equals(l, r);
        case '!=': return !equals(l, r);
      }
      if (e.op === '+' && (typeof l === 'string' || typeof r === 'string')) return toText(l) + toText(r);

      if (['<', '>', '<=', '>='].includes(e.op) && typeof l === 'string' && typeof r === 'string') {
        const c = l.localeCompare(r, 'de');
        return e.op === '<' ? c < 0 : e.op === '>' ? c > 0 : e.op === '<=' ? c <= 0 : c >= 0;
      }

      if (typeof l !== 'number' || typeof r !== 'number') {
        throw this.error("Operator '" + e.op + "' erwartet Zahlen, erhalten: " + typeName(l) + ' und ' + typeName(r) +
          (e.op === '+' ? " (Tipp: text(…) wandelt Werte in Text um)" : ''), e);
      }
      switch (e.op) {
        case '+': return l + r;
        case '-': return l - r;
        case '*': return l * r;
        case '**': {
          const p = Math.pow(l, r);
          if (Number.isNaN(p)) throw this.error('Potenz ist nicht definiert (negative Basis mit gebrochenem Exponenten)', e);
          return p;
        }
        case '/':
          if (r === 0) throw this.error('Division durch Null', e);
          return l / r;
        case '%':
          if (r === 0) throw this.error('Modulo durch Null', e);
          return l % r;
        case '<': return l < r;
        case '>': return l > r;
        case '<=': return l <= r;
        case '>=': return l >= r;
      }
      throw this.error("Unbekannter Operator '" + e.op + "'", e);
    }

    toNumber(v, node, what) {
      if (typeof v === 'number') return v;
      if (typeof v === 'boolean') return v ? 1 : 0;
      throw this.error((what || 'Wert') + ' muss eine Zahl sein, ist aber ' + typeName(v), node);
    }

    toIndex(v, length, node) {
      if (typeof v !== 'number' || !Number.isInteger(v)) {
        throw this.error('Index muss eine ganze Zahl sein, ist aber ' + toText(v), node);
      }
      if (v < 0 || v >= length) {
        throw this.error('Index ' + v + ' liegt außerhalb des Bereichs (gültig: 0 bis ' + (length - 1) + ')', node);
      }
      return v;
    }

    async call(e, args) {
      const def = this.funcs.get(e.name);
      if (def) {
        if (args.length !== def.params.length) {
          throw this.error("Funktion '" + e.label + "' erwartet " + def.params.length + ' Argument(e), aber ' +
            args.length + ' wurden übergeben', e);
        }
        if (this.depth >= MAX_DEPTH) throw this.error('Maximale Rekursionstiefe (' + MAX_DEPTH + ') überschritten', e);
        const scope = new Env(this.globals);
        def.params.forEach((p, i) => scope.set(p, args[i]));
        this.depth++;
        try {
          await this.execBlock(def.body, scope);
        } catch (x) {
          if (x instanceof ReturnSignal) return x.value;
          throw x;
        } finally {
          this.depth--;
        }
        return null;
      }

      const range = BUILTINS[e.name];
      if (!range) throw this.error("Unbekannte Funktion '" + e.label + "'", e);
      if (args.length < range[0] || args.length > range[1]) throw this.error(arityText(e.label, range), e);
      const a = args[0];

      switch (e.name) {
        case 'eingabe': {
          const value = await this.host.input(args.length ? toText(a) : '');
          if (this.stopped) throw new StopSignal();
          return value;
        }
        case 'text': return toText(a);
        case 'zahl': {
          if (typeof a === 'number') return a;
          if (typeof a === 'boolean') return a ? 1 : 0;
          const s = typeof a === 'string' ? a.trim() : '';
          if (!NUMBER_RE.test(s)) throw this.error("'" + toText(a) + "' ist keine gültige Zahl", e);
          return parseFloat(s.replace(',', '.'));
        }
        case 'datentyp': return typeName(a);
        case 'laenge':
        case 'länge':
          if (typeof a === 'string') return Array.from(a).length;
          if (Array.isArray(a)) return a.length;
          throw this.error("'laenge' erwartet eine Zeichenkette oder Liste", e);
        case 'abs': return Math.abs(this.toNumber(a, e));
        case 'runden': {
          const n = this.toNumber(a, e);
          return Math.sign(n) * Math.round(Math.abs(n));
        }
        case 'boden': return Math.floor(this.toNumber(a, e));
        case 'decke': return Math.ceil(this.toNumber(a, e));
        case 'wurzel': {
          const n = this.toNumber(a, e);
          if (n < 0) throw this.error("'wurzel' erwartet eine nicht-negative Zahl", e);
          return Math.sqrt(n);
        }
      }
      throw this.error("Unbekannte Funktion '" + e.label + "'", e);
    }

    method(e, list, args) {
      const range = METHODS[e.name];
      if (!range) throw this.error("Unbekannte Listenmethode '" + e.label + "'", e);
      if (!Array.isArray(list)) throw this.error("Methode '" + e.label + "' gibt es nur für Listen (Wert ist " + typeName(list) + ')', e);
      if (args.length < range[0] || args.length > range[1]) throw this.error(arityText(e.label, range), e);

      switch (e.name) {
        case 'hinzufuegen':
        case 'hinzufügen':
          list.push(args[0]);
          return null;
        case 'entfernen': {
          const i = this.toIndex(args[0], list.length, e);
          return list.splice(i, 1)[0];
        }
        case 'einfuegen':
        case 'einfügen': {
          const i = this.toIndex(args[0], list.length + 1, e);
          list.splice(i, 0, args[1]);
          return null;
        }
        case 'pop':
          if (list.length === 0) throw this.error("'pop' auf einer leeren Liste", e);
          return list.pop();
        case 'umkehren':
          list.reverse();
          return null;
        case 'sortieren':
          if (list.every(x => typeof x === 'number')) list.sort((x, y) => x - y);
          else if (list.every(x => typeof x === 'string')) list.sort((x, y) => x.localeCompare(y, 'de'));
          else throw this.error("'sortieren': Die Liste muss nur Zahlen oder nur Zeichenketten enthalten", e);
          return null;
      }
      return null;
    }
  }

  const api = {
    tokenize, parse, check, Interpreter, PseudoError, StopSignal, toText,
    KEYWORDS, BUILTINS, METHODS,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.Pseudocode = api;
})(typeof window !== 'undefined' ? window : globalThis);
