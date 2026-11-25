# TCG Vorbestellungen

**App öffnen:** https://electronicfallout.github.io/TCG-Preorder/

Vorbestellungen, Wartelisten und Zuteilungen für One Piece, Pokémon und Riftbound. Läuft im Browser am PC und am Handy und lässt sich wie eine App auf den Startbildschirm legen.

## Was die App kann

- **Produkte** pro Spiel (One Piece, Pokémon, Riftbound), sortiert nach Release, mit Vorbestellt, Wareneingang, Zugeteilt, Frei und Fehlmenge.
- **Serien** (z. B. zwei Pokémon-Produkte einer Serie): Kunden bestellen „nur A“, „nur B“, „egal welches“ oder „beide“. „Egal welches“-Bestellungen bekommen bei der Zuteilung das Produkt, von dem nach den festen Wünschen noch etwas übrig ist.
- **Serien-Liste**: alle Produkte einer Serie (z. B. Doppel-Release) in einer Tabelle mit gemeinsamer Zuteilung.
- **Excel-Import** (Einstellungen): Spalten wie Name, Telefon, E-Mail, Produkt A, Produkt B werden direkt im Browser eingelesen. Die Datei wird nirgends hochgeladen.
- **Bestellungen** mit Status: Offen, Zugeteilt, Auftrag angelegt, Abgeholt, Warteliste, Storniert. Stornierte und Wartelisten-Einträge zählen nicht zur Vorbestellsumme.
- **Zuteilung** per Vorschlag: proportional (Reststücke nach größtem Rest, bei Gleichstand die frühere Bestellung) oder nach Bestelldatum.
- **Kunden** mit etron-Kundennummer und Kontakt. Die App warnt bei ähnlichen Namen und zeigt mögliche **Dubletten** zum Zusammenführen.
- **Nachrichten** an Kunden aus Vorlagen mit Platzhaltern ({Vorname}, {Produkt}, {Stück}, {Mitarbeiter} …): kopieren, WhatsApp oder E-Mail öffnen, als gesendet markieren. Vorlagen unter Einstellungen.
- **etron-Export**: alle zugeteilten Bestellungen als CSV (mit etron-Kundennummer), danach als „Auftrag angelegt“ markieren.
- Funktioniert **offline** und gleicht später ab. Ändern zwei Geräte gleichzeitig, werden die Änderungen pro Eintrag zusammengeführt statt überschrieben.

## In der Firma: Chrome-App + Erweiterung

Die App läuft in **Chrome** (als App installiert). Die etron-Schnittstelle (Kunden suchen/abgleichen, Artikel verknüpfen, Aufträge als Entwurf anlegen) läuft über die kleine Chrome-Erweiterung im Ordner `erweiterung/`. Sie leitet nur Anfragen der App an `https://*.wawi.onretail.eu/api/` weiter, nichts läuft über fremde Server. Der etron-Zugang liegt in `etron-zugang.json` in der Dropbox, nie im Repository.

Das frühere Windows-Programm (`desktop/`, `Vorbestellungen.exe`) wird nicht mehr verwendet (Smart App Control blockiert unsignierte Programme).

## Wo liegen die Daten?

Ausschließlich in der Dropbox, im Ordner `Apps/<Name der Dropbox-App>/vorbestellungen.json`.

**In diesem Repository liegt nur der Programmcode, keine Kundendaten.** `.gitignore` schließt JSON-, Excel- und CSV-Dateien aus. Zum Testen gibt es nur erfundene Beispieldaten („Nur ausprobieren“).

## Einrichtung (einmalig)

### 1. Dropbox-App anlegen

1. https://www.dropbox.com/developers/apps öffnen und mit der Dropbox anmelden, in der die Daten liegen sollen.
2. **Create app** → *Scoped access* → *App folder* → Namen vergeben, z. B. `Vorbestellungen-MeinShop`.
3. Reiter **Permissions**: `files.metadata.read`, `files.content.read`, `files.content.write` anhaken → **Submit**.
4. Reiter **Settings**:
   - **OAuth 2 → Redirect URIs**: die Adresse der App eintragen (wird auf der Startseite der App angezeigt, `https://electronicfallout.github.io/TCG-Preorder/`) → **Add**
   - **Allow public clients (Implicit Grant & PKCE)** auf *Allow*.
   - Den **App key** kopieren (den App secret braucht man nicht).

### 2. Erstes Gerät verbinden

App öffnen → App key einfügen → **Mit Dropbox verbinden** → bei Dropbox erlauben. Danach unter **Einstellungen → Sicherung** die bisherigen Daten (JSON-Export der alten App) importieren.

### 3. Weitere Geräte

Unter **Einstellungen → Kollegen einladen** den Einladungscode anzeigen und am anderen Gerät bei „Weiteres Gerät“ einfügen.

## Sicherheit

- Der Einladungscode erlaubt Zugriff auf den Dropbox-App-Ordner (nicht auf den Rest der Dropbox). Nur an Mitarbeiter weitergeben.
- Dropbox hebt frühere Dateiversionen 30 Tage auf; zusätzlich gibt es unter *Einstellungen → Sicherung* einen Download.
- Zugang für alle widerrufen: in der Dropbox unter *Einstellungen → Verbundene Apps* die App trennen, danach neu verbinden.

## Technik

Statische Web-App ohne Server (HTML, CSS, JavaScript-Module), gehostet über GitHub Pages. Daten über die Dropbox-API (OAuth mit PKCE), gleicher Aufbau wie beim Dienstplaner. Mitgeliefert: [SheetJS](https://sheetjs.com) (Apache-2.0) für den Excel-Import.

Lokal starten: `python3 -m http.server` im Projektordner, dann http://localhost:8000 öffnen und „Ausprobieren“ wählen (speichert nur im Browser, mit Beispieldaten).
