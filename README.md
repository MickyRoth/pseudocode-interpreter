# Pseudocode Interpreter – V2

Ein Interpreter für **IHK-Pseudocode**, der komplett im Browser läuft. Gedacht zum Üben für die
Abschlussprüfung zum Fachinformatiker: Programm links schreiben, rechts Ein- und Ausgabe sehen.

## Funktionen

- **Zweigeteilte Oberfläche:** links der Quellcode-Editor (Zeilennummern, Syntax-Hervorhebung,
  automatisches Einrücken), rechts die Ein- und Ausgabe. Die Breite lässt sich mit dem Teiler verändern.
- **Neu, Öffnen, Speichern:** Programme als `.pseudo`-Datei laden und speichern. Der aktuelle Entwurf
  wird zusätzlich im Browser gemerkt.
- **Syntaxcheck:** prüft das Programm, ohne es auszuführen, und markiert die Fehlerzeile.
- **Run:** führt das Programm aus. `eingabe(…)` wartet auf eine Eingabe im Feld rechts unten.
  Während das Programm läuft, wird aus „Run“ ein „Stop“-Knopf, z. B. für Endlosschleifen.
- **Syntax-Popup:** Übersicht über die komplette Sprache mit Beispielen, die per Klick in den
  Editor übernommen werden können.

### Tastenkürzel

| Kürzel | Aktion |
|---|---|
| `F5` oder `Strg+Enter` | Run / Stop |
| `F7` | Syntaxcheck |
| `F1` | Syntax-Übersicht |
| `Strg+S` | Speichern |
| `Strg+O` | Öffnen |
| `Strg+Alt+N` | Neu |
| `Tab` / `Umschalt+Tab` | Ein- / Ausrücken |

## Starten

Keine Installation und kein Build nötig: `index.html` im Browser öffnen.

Mit einem lokalen Webserver funktioniert zusätzlich das Speichern direkt in die geöffnete Datei
(in Chrome und Edge):

```bash
python -m http.server 8765
```

Danach <http://localhost:8765> öffnen.

## Sprache

Die Syntax folgt [danycagiva/Pseudocode](https://github.com/danycagiva/Pseudocode#syntax).

```pseudocode
funktion addiere(a, b)
    rueckgabe a + b
endefunktion

name := eingabe("Wie heißt du? ")
ausgabe("Hallo, " + name + "!")

wenn addiere(3, 4) = 7 dann
    ausgabe("stimmt")
endewenn

fuer i von 1 bis 10 schrittweite 2 tue
    ausgabe(i)
endefuer
```

Unterstützt werden Variablen (`:=`), `wenn/sonstwenn/sonst`, `solange`, `fuer` (C-Stil und
`von … bis … schrittweite`), Funktionen mit `rueckgabe` und Rekursion, Listen und 2D-Listen mit
Methoden sowie die eingebauten Funktionen `ausgabe`, `eingabe`, `text`, `zahl`, `datentyp`,
`laenge`, `abs`, `runden`, `boden`, `decke` und `wurzel`.

Kleine Ergänzungen gegenüber dem Original:

- `**` berechnet Potenzen, z. B. `2 ** n` (rechtsassoziativ, `-2 ** 2` ergibt `-4`).
- Für den Vergleich ist neben `=` auch `==` erlaubt.
- `i++` und `i--` sind auch als eigene Anweisung erlaubt, nicht nur im Kopf einer `fuer`-Schleife.
- Der Syntaxcheck meldet falsche Blockenden (z. B. `endesolange` für einen `wenn`-Block),
  unbekannte Funktionen und Variablen (mit Vorschlag bei Tippfehlern, z. B. „meintest du
  'zaehler'?“), falsche Argumentanzahl und `=` statt `:=`.
- Jede Anweisung steht in einer eigenen Zeile; nur ein Blockende darf noch in derselben Zeile
  folgen. Ausdrücke dürfen über mehrere Zeilen gehen. Ein `rueckgabe` ohne Wert in derselben
  Zeile ist eine leere Rückgabe.
- Zeichenketten lassen sich mit `<`, `>` vergleichen und mit `[i]` einzelne Zeichen lesen.
- `zahl("3,5")` akzeptiert auch ein Komma als Dezimaltrennzeichen.
- Schreibweisen mit Umlaut (`für`, `rückgabe`, `länge`, `hinzufügen`, `einfügen`) sind erlaubt.
- Groß- und Kleinschreibung spielt keine Rolle, weder bei Schlüsselwörtern (`WENN`, `Wenn`, `wenn`)
  noch bei Namen von Variablen und Funktionen (`Zaehler` und `zaehler` sind dieselbe Variable).
  Schlüsselwörter können daher in keiner Schreibweise als Name verwendet werden (z. B. `Liste`).

## Aufbau

```
index.html          Seite mit Editor, Ein-/Ausgabe und Syntax-Popup
css/style.css       Layout, Farben (hell/dunkel)
js/interpreter.js   Lexer → Parser (AST) → Tree-Walking-Interpreter
js/app.js           Editor, Dateien, Konsole, Ausführung
test/               Tests für den Sprachkern (Node.js)
```

## Tests

Für die Tests wird nur [Node.js](https://nodejs.org) (ab Version 18) gebraucht:

```bash
node --test
```

Geprüft werden Sprache, Fehlermeldungen, das Startbeispiel und alle Beispiele der Syntax-Übersicht.

## Neue Version

Nach Änderungen an CSS oder JavaScript die Cache-Version `ASSET_VERSION` oben in `index.html`
erhöhen. Sie wird an alle eingebundenen Dateien angehängt, damit Browser keine alten Dateien aus
dem Cache verwenden.
