// Tests für den Sprachkern. Ausführen mit:  node --test
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const P = require('../js/interpreter.js');

/** Prüft und führt ein Programm aus; liefert die Ausgabe als Text. */
async function run(src, inputs = []) {
  const ast = P.parse(src);
  P.check(ast);
  let out = '';
  const queue = [...inputs];
  const interpreter = new P.Interpreter({
    output: t => { out += t; },
    input: async prompt => { out += prompt; return queue.shift() ?? ''; },
    pause: async () => {},
  });
  await interpreter.run(ast);
  return out;
}

/** Erwartet einen Fehler beim Prüfen bzw. Ausführen. */
async function fails(src, kind, pattern, line) {
  await assert.rejects(run(src), err => {
    assert.ok(err instanceof P.PseudoError, 'PseudoError erwartet, erhalten: ' + err);
    assert.equal(err.kind, kind);
    assert.match(err.message, pattern);
    if (line !== undefined) assert.equal(err.line, line);
    return true;
  });
}

const lines = (...l) => l.join('\n') + '\n';

describe('Ausdrücke', () => {
  test('Rechnen und Rangfolge', async () => {
    assert.equal(await run('ausgabe(1 + 2 * 3, (1 + 2) * 3, 7 % 3, 7 / 2)'), '7 9 1 3.5\n');
  });

  test('Potenz ist rechtsassoziativ und bindet stärker als das Vorzeichen', async () => {
    assert.equal(await run('ausgabe(2 ** 3 ** 2, -2 ** 2, 2 ** -1)'), '512 -4 0.5\n');
  });

  test('Vergleiche mit = und ==', async () => {
    assert.equal(await run('ausgabe(1 = 1, 1 == 2, 1 != 2, 2 <= 2, "a" < "b")'), 'wahr falsch wahr wahr wahr\n');
  });

  test('Logik mit Kurzschluss', async () => {
    // Die rechte Seite würde durch Null teilen, wird aber nicht ausgewertet.
    assert.equal(await run('ausgabe(falsch und 1 / 0 = 1, wahr oder 1 / 0 = 1, nicht wahr)'), 'falsch wahr falsch\n');
  });

  test('Zeichenketten verbinden und indizieren', async () => {
    assert.equal(await run('s := "Hallo"\nausgabe(s + " " + text(3), s[1], laenge(s))'), 'Hallo 3 a 5\n');
  });

  test('Kommazahlen werden lesbar ausgegeben', async () => {
    assert.equal(await run('ausgabe(0.1 + 0.2)'), '0.3\n');
  });
});

describe('Anweisungen', () => {
  test('wenn / sonstwenn / sonst', async () => {
    const src = lines(
      'fuer x von 9 bis 11 tue',
      '    wenn x > 10 dann',
      '        ausgabe("groß")',
      '    sonstwenn x = 10 dann',
      '        ausgabe("zehn")',
      '    sonst',
      '        ausgabe("klein")',
      '    endewenn',
      'endefuer');
    assert.equal(await run(src), 'klein\nzehn\ngroß\n');
  });

  test('solange und i++ als Anweisung', async () => {
    assert.equal(await run(lines('i := 0', 'solange i < 3 tue', '    ausgabe(i)', '    i++', 'endesolange')), '0\n1\n2\n');
  });

  test('fuer im C-Stil', async () => {
    assert.equal(await run(lines('fuer i := 3; i > 0; i-- tue', '    ausgabe(i)', 'endefuer')), '3\n2\n1\n');
  });

  test('fuer mit Bereich, negativer und gebrochener Schrittweite', async () => {
    assert.equal(await run(lines('fuer i von 5 bis 1 schrittweite -2 tue', '    ausgabe(i)', 'endefuer')), '5\n3\n1\n');
    assert.equal(await run(lines('fuer i von 0 bis 0.3 schrittweite 0.1 tue', '    ausgabe(i)', 'endefuer')), '0\n0.1\n0.2\n0.3\n');
  });

  test('eingabe und zahl (auch mit Komma)', async () => {
    const src = lines('n := zahl(eingabe("Zahl? "))', 'ausgabe(n * 2)');
    assert.equal(await run(src, ['3,5']), 'Zahl? 7\n');
  });

  test('sei vor einer Zuweisung und Umlaut-Schreibweisen', async () => {
    assert.equal(await run(lines('sei l := liste()', 'l.hinzufügen(1)', 'für i von 1 bis 1 tue', '    ausgabe(länge(l))', 'endefür')), '1\n');
  });
});

describe('Groß- und Kleinschreibung', () => {
  test('Schlüsselwörter in beliebiger Schreibweise', async () => {
    const src = lines(
      'FUNKTION Verdopple(N)',
      '    RÜCKGABE n * 2',
      'EndeFunktion',
      'FÜR i VON 1 BIS 2 TUE',
      '    WENN i = 1 DANN',
      '        AUSGABE(verdopple(I))',
      '    SONST',
      '        Ausgabe(VERDOPPLE(i), WAHR, Nicht Falsch)',
      '    ENDEWENN',
      'ENDEFÜR',
      'SEI z := 0',
      'SOLANGE z < 1 TUE',
      '    z++',
      'ENDESOLANGE',
      'ausgabe(z)');
    assert.equal(await run(src), '2\n4 wahr wahr\n1\n');
  });

  test('Bezeichner: Zaehler, zaehler und ZAEHLER sind dieselbe Variable', async () => {
    assert.equal(await run(lines('Zaehler := 1', 'ZAEHLER := zaehler + 1', 'ausgabe(ZaEhLeR)')), '2\n');
  });

  test('eingebaute Funktionen und Listenmethoden', async () => {
    const src = lines('L := LISTE(3, 1, 2)', 'l.SORTIEREN()', 'L.Hinzufügen(9)', 'AUSGABE(LÄNGE(l), TEXT(L), WURZEL(16))');
    assert.equal(await run(src), '4 [1, 2, 3, 9] 4\n');
  });

  test('Parameter dürfen sich nicht nur in der Schreibweise unterscheiden', async () => {
    await fails(lines('funktion f(a, A)', 'endefunktion'), 'Syntaxfehler', /Parameter 'A' ist doppelt/);
  });

  test('Funktion darf nicht in anderer Schreibweise erneut definiert werden', async () => {
    await fails(lines('funktion f()', 'endefunktion', 'funktion F()', 'endefunktion'), 'Syntaxfehler', /'F' ist mehrfach definiert/);
  });

  test('Namen wie constructor sind normale Bezeichner', async () => {
    assert.equal(await run(lines('constructor := 1', 'toString := 2', 'ausgabe(constructor + tostring)')), '3\n');
  });
});

describe('Funktionen', () => {
  test('Rekursion und Aufruf vor der Definition', async () => {
    const src = lines(
      'ausgabe(fak(10))',
      'funktion fak(n)',
      '    wenn n <= 1 dann',
      '        rueckgabe 1',
      '    endewenn',
      '    rueckgabe n * fak(n - 1)',
      'endefunktion');
    assert.equal(await run(src), '3628800\n');
  });

  test('Zuweisungen in Funktionen sind lokal, globale Variablen sind lesbar', async () => {
    const src = lines(
      'x := 1',
      'funktion f()',
      '    y := x + 1',
      '    x := 100',
      '    rueckgabe y',
      'endefunktion',
      'ausgabe(f(), x)');
    assert.equal(await run(src), '2 1\n');
  });

  test('rueckgabe ohne Wert, danach weitere Zeilen', async () => {
    const src = lines(
      'funktion f(n)',
      '    wenn n < 0 dann',
      '        rueckgabe',
      '    endewenn',
      '    ausgabe(n)',
      'endefunktion',
      'f(-1)',
      'f(5)',
      'ausgabe(datentyp(f(-1)))');
    assert.equal(await run(src), '5\nnichts\n');
  });

  test('rueckgabe ohne Wert direkt vor einer Zuweisung', async () => {
    const src = lines(
      'funktion f()',
      '    rueckgabe',
      '    x := 1',
      'endefunktion',
      'ausgabe(datentyp(f()))');
    assert.equal(await run(src), 'nichts\n');
  });
});

describe('Listen', () => {
  test('Methoden', async () => {
    const src = lines(
      'l := liste(5, 3, 8)',
      'l.hinzufuegen(1)',
      'l.sortieren()',
      'l.einfuegen(0, 0)',
      'ausgabe(l)',
      'ausgabe(l.pop(), l.entfernen(0), l)',
      'l.umkehren()',
      'ausgabe(l)');
    assert.equal(await run(src), '[0, 1, 3, 5, 8]\n8 0 [1, 3, 5]\n[5, 3, 1]\n');
  });

  test('2D-Listen', async () => {
    const src = lines('m := liste(', '    liste(1, 2),', '    liste(3, 4)', ')', 'm[1][0] := 99', 'ausgabe(m)');
    assert.equal(await run(src), '[[1, 2], [99, 4]]\n');
  });

  test('Ausdrücke dürfen über mehrere Zeilen gehen', async () => {
    assert.equal(await run(lines('summe := 1 +', '    2', 'ausgabe(summe)')), '3\n');
  });
});

describe('Syntaxfehler', () => {
  test('falsches Blockende', async () => {
    await fails(lines('wenn wahr dann', '    ausgabe(1)', 'endesolange'), 'Syntaxfehler', /Falsches Blockende/, 3);
  });

  test('fehlendes Blockende', async () => {
    await fails(lines('solange wahr tue', '    ausgabe(1)'), 'Syntaxfehler', /nicht mit 'endesolange' abgeschlossen/, 1);
  });

  test('= statt :=', async () => {
    await fails('x = 5', 'Syntaxfehler', /Für eine Zuweisung bitte ':='/);
  });

  test('zwei Anweisungen in einer Zeile', async () => {
    await fails('a := 1 b := 2', 'Syntaxfehler', /neue Zeile beginnen, gefunden 'b'/, 1);
    await fails('ausgabe(1) ausgabe(2)', 'Syntaxfehler', /neue Zeile beginnen/, 1);
  });

  test('Blockende in derselben Zeile ist erlaubt', async () => {
    assert.equal(await run('wenn wahr dann ausgabe(1) endewenn'), '1\n');
  });

  test('unbekannte Variable', async () => {
    await fails(lines('x := 1', 'ausgabe(y)'), 'Syntaxfehler', /Unbekannte Variable 'y' – ihr wird nirgends/, 2);
  });

  test('Tippfehler bei Variablen, Funktionen und Methoden', async () => {
    await fails(lines('zaehler := 1', 'ausgabe(zaeler)'), 'Syntaxfehler', /meintest du 'zaehler'\?/, 2);
    await fails('ausgabe(laenhe("a"))', 'Syntaxfehler', /Unbekannte Funktion 'laenhe' – meintest du 'laenge'\?/);
    await fails(lines('l := liste()', 'l.sortiren()'), 'Syntaxfehler', /meintest du 'sortieren'\?/);
  });

  test('Vorschlag und Meldung in der Schreibweise des Programms', async () => {
    await fails(lines('MeinZaehler := 1', 'ausgabe(meinzaeler)'), 'Syntaxfehler',
      /Unbekannte Variable 'meinzaeler' – meintest du 'MeinZaehler'\?/);
    await fails(lines('FUNKTION Quadrat(x)', '    RUECKGABE x * x', 'ENDEFUNKTION', 'AUSGABE(QUADRAT(1, 2))'), 'Syntaxfehler',
      /Funktion 'QUADRAT' erwartet 1 Argument/);
  });

  test('kein Vorschlag bei sehr kurzen Namen', async () => {
    await fails(lines('x := 1', 'ausgabe(y)'), 'Syntaxfehler', /Unbekannte Variable 'y' – ihr wird nirgends/);
  });

  test('Schlüsselwort als Variablenname', async () => {
    await fails('Liste := 1', 'Syntaxfehler', /'Liste' ist ein Schlüsselwort/);
    await fails('VON := 1', 'Syntaxfehler', /'VON' ist ein Schlüsselwort/);
  });

  test('falsches Blockende in Großschreibung', async () => {
    await fails(lines('WENN wahr DANN', '    ausgabe(1)', 'ENDESOLANGE'), 'Syntaxfehler', /Falsches Blockende 'ENDESOLANGE'/, 3);
  });

  test('globale Variable einer anderen Funktion ist nicht sichtbar', async () => {
    const src = lines(
      'funktion a()',
      '    geheim := 1',
      'endefunktion',
      'funktion b()',
      '    rueckgabe geheim',
      'endefunktion');
    await fails(src, 'Syntaxfehler', /Unbekannte Variable 'geheim'/, 5);
  });

  test('Variable aus einer Schleife darf vorher im Schleifenrumpf gelesen werden', async () => {
    const src = lines(
      'fuer i von 1 bis 2 tue',
      '    wenn i = 2 dann',
      '        ausgabe(letzter)',
      '    endewenn',
      '    letzter := i',
      'endefuer');
    assert.equal(await run(src), '1\n');
  });

  test('falsche Argumentanzahl', async () => {
    await fails(lines('funktion f(a)', 'endefunktion', 'f(1, 2)'), 'Syntaxfehler', /erwartet 1 Argument/);
    await fails('ausgabe(wurzel())', 'Syntaxfehler', /'wurzel' erwartet 1 Argument/);
  });

  test('rueckgabe außerhalb einer Funktion', async () => {
    await fails('rueckgabe 1', 'Syntaxfehler', /nur innerhalb einer Funktion/);
  });
});

describe('Laufzeitfehler', () => {
  test('Division durch Null', async () => {
    await fails('ausgabe(1 / 0)', 'Laufzeitfehler', /Division durch Null/);
  });

  test('Index außerhalb des Bereichs', async () => {
    await fails(lines('l := liste(1)', 'ausgabe(l[1])'), 'Laufzeitfehler', /außerhalb des Bereichs/, 2);
  });

  test('Text plus Zahl im Vergleich', async () => {
    await fails('ausgabe("a" * 2)', 'Laufzeitfehler', /erwartet Zahlen/);
  });

  test('zu tiefe Rekursion', async () => {
    await fails(lines('funktion f(n)', '    rueckgabe f(n + 1)', 'endefunktion', 'f(0)'), 'Laufzeitfehler', /Rekursionstiefe/);
  });

  test('Stop bricht eine Endlosschleife ab', async () => {
    const ast = P.parse(lines('solange wahr tue', '    x := 1', 'endesolange'));
    // pause() muss wie im Browser echte Zeit abgeben, sonst kommt der Timer nie dran.
    const interpreter = new P.Interpreter({ output() {}, input: async () => '', pause: () => new Promise(r => setTimeout(r, 0)) });
    setTimeout(() => interpreter.stop(), 20);
    await assert.rejects(interpreter.run(ast), err => err instanceof P.StopSignal);
  });
});

describe('Beispiele aus der Oberfläche', () => {
  const root = path.join(__dirname, '..');

  test('Startbeispiel in app.js läuft fehlerfrei', async () => {
    const app = fs.readFileSync(path.join(root, 'js/app.js'), 'utf8');
    const example = app.match(/const EXAMPLE = `([\s\S]*?)`;/)[1];
    const out = await run(example, ['Ada', '5']);
    assert.match(out, /Hallo, Ada!/);
    assert.match(out, /5! = 120/);
  });

  test('alle Beispiele der Syntax-Übersicht sind syntaktisch korrekt', () => {
    const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
    const examples = [...html.matchAll(/<pre class="example">([\s\S]*?)<\/pre>/g)]
      .map(m => m[1].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'));
    assert.ok(examples.length >= 5);
    for (const src of examples) {
      try {
        P.check(P.parse(src));
      } catch (err) {
        // Die Schnipsel verwenden teils Variablen, die erst im eigenen Programm entstehen.
        if (!/Unbekannte Variable/.test(err.message)) throw new Error(err.message + '\n' + src);
      }
    }
  });
});
