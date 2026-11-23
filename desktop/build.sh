#!/bin/sh
# Baut das Windows-Paket: dist/TCG-Vorbestellungen.zip
#   Vorbestellungen.exe + programm\ (App-Dateien) + LIESMICH.txt
set -e
cd "$(dirname "$0")/.."
VER=$(sed -n "s/.*APP_VERSION = '\(.*\)'.*/\1/p" js/version.js)
OUT=dist/pkg
rm -rf dist && mkdir -p "$OUT/programm"
cp -r index.html manifest.webmanifest css js icons vendor "$OUT/programm/"
(cd desktop && GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go build -trimpath -ldflags "-H windowsgui -s -w -X main.build=$VER" -o "../$OUT/Vorbestellungen.exe" .)
cp desktop/LIESMICH.txt "$OUT/LIESMICH.txt"
(cd "$OUT" && zip -qr ../TCG-Vorbestellungen-$VER.zip .)
echo "dist/TCG-Vorbestellungen-$VER.zip"
