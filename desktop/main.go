// Vorbestellungen.exe: startet die App lokal auf diesem PC.
//
// Ablage (alles im selben Dropbox-Ordner, z. B. Dropbox\Apps\<Name>\):
//
//	Vorbestellungen.exe      dieses Programm
//	programm\                die App-Dateien (index.html, js, css …); Updates = diesen Ordner ersetzen
//	vorbestellungen.json     Daten (wie bisher, vom Dropbox-Client zwischen den PCs abgeglichen)
//	protokoll\JJJJ-MM.json   Änderungsprotokoll
//	etron-zugang.json        etron-Zugang (Adresse, Client Key, Client Secret)
//
// Der Server hört nur auf 127.0.0.1: Handys und andere PCs kommen nicht heran.
// Er beendet sich, wenn die App einige Minuten nicht mehr offen war.
package main

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"sync"
	"time"
)

const port = "47913"
const idleExit = 15 * time.Minute

var (
	baseDir  string // Ordner der EXE
	webDir   string // baseDir\programm
	lastSeen = time.Now()
	seenMu   sync.Mutex
	fileMu   sync.Mutex
)

func main() {
	exe, err := os.Executable()
	if err != nil {
		fatal(err)
	}
	baseDir = filepath.Dir(exe)
	if d := os.Getenv("VB_DIR"); d != "" { // nur für Tests
		baseDir = d
	}
	webDir = filepath.Join(baseDir, "programm")
	logf, _ := os.OpenFile(filepath.Join(os.TempDir(), "vorbestellungen.log"), os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o600)
	if logf != nil {
		log.SetOutput(logf)
	}
	url := "http://127.0.0.1:" + port + "/"

	ln, err := net.Listen("tcp", "127.0.0.1:"+port)
	if err != nil {
		// Läuft schon? Dann nur das Fenster öffnen.
		if alreadyRunning() {
			openWindow(url)
			return
		}
		fatal(fmt.Errorf("Port %s ist belegt: %v", port, err))
	}
	if _, err := os.Stat(filepath.Join(webDir, "index.html")); err != nil {
		fatal(fmt.Errorf("Ordner „programm“ fehlt neben der EXE (%s)", webDir))
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/api/info", guard(handleInfo))
	mux.HandleFunc("/api/fs/read", guard(handleRead))
	mux.HandleFunc("/api/fs/write", guard(handleWrite))
	mux.HandleFunc("/api/fs/list", guard(handleList))
	mux.HandleFunc("/api/fs/conflicts", guard(handleConflicts))
	mux.HandleFunc("/api/fs/remove", guard(handleRemove))
	mux.HandleFunc("/api/etron/config", guard(handleEtronConfig))
	mux.HandleFunc("/api/etron", guard(handleEtron))
	mux.HandleFunc("/api/migrate/candidates", guard(handleCandidates))
	mux.HandleFunc("/api/migrate/list", guard(handleSrcList))
	mux.HandleFunc("/api/migrate/read", guard(handleSrcRead))
	mux.HandleFunc("/api/backup", guard(handleBackup))
	mux.Handle("/", hostOnly(noCache(http.FileServer(http.Dir(webDir)))))

	go func() {
		for range time.Tick(time.Minute) {
			seenMu.Lock()
			idle := time.Since(lastSeen)
			seenMu.Unlock()
			if idle > idleExit {
				log.Println("keine Nutzung, beende")
				os.Exit(0)
			}
		}
	}()
	if os.Getenv("VB_NOWINDOW") == "" {
		go func() { time.Sleep(300 * time.Millisecond); openWindow(url) }()
	}
	log.Println("Start", baseDir)
	fatal(http.Serve(ln, mux))
}

func fatal(err error) {
	log.Println(err)
	msg := "Vorbestellungen konnte nicht starten:\n\n" + err.Error()
	if runtime.GOOS == "windows" {
		// Meldung anzeigen, auch ohne Konsole
		exec.Command("mshta", "javascript:alert("+jsString(msg)+");close()").Run()
	} else {
		fmt.Fprintln(os.Stderr, msg)
	}
	os.Exit(1)
}

func jsString(s string) string { b, _ := json.Marshal(s); return string(b) }

func alreadyRunning() bool {
	req, _ := http.NewRequest("GET", "http://127.0.0.1:"+port+"/api/info", nil)
	req.Header.Set("X-VB", "1")
	c := http.Client{Timeout: 2 * time.Second}
	r, err := c.Do(req)
	if err != nil {
		return false
	}
	defer r.Body.Close()
	var j map[string]any
	return json.NewDecoder(r.Body).Decode(&j) == nil && j["app"] == "vorbestellungen"
}

func openWindow(url string) {
	if runtime.GOOS != "windows" {
		log.Println("Fenster:", url)
		return
	}
	for _, p := range []string{
		os.Getenv("ProgramFiles(x86)") + `\Microsoft\Edge\Application\msedge.exe`,
		os.Getenv("ProgramFiles") + `\Microsoft\Edge\Application\msedge.exe`,
		os.Getenv("LOCALAPPDATA") + `\Microsoft\Edge\Application\msedge.exe`,
	} {
		if _, err := os.Stat(p); err == nil {
			if exec.Command(p, "--app="+url).Start() == nil {
				return
			}
		}
	}
	exec.Command("rundll32", "url.dll,FileProtocolHandler", url).Start()
}

// ---------- Schutz: nur vom eigenen PC, nur von der eigenen Seite ----------

func okHost(r *http.Request) bool {
	h := r.Host
	return h == "127.0.0.1:"+port || h == "localhost:"+port
}

func hostOnly(h http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !okHost(r) {
			http.Error(w, "nicht erlaubt", 403)
			return
		}
		touch()
		h.ServeHTTP(w, r)
	})
}

func noCache(h http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-cache")
		h.ServeHTTP(w, r)
	})
}

// API: Host muss stimmen (gegen DNS-Rebinding) und der Kopf X-VB muss gesetzt sein
// (fremde Webseiten können ihn ohne CORS-Freigabe nicht mitschicken).
func guard(f http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !okHost(r) || r.Header.Get("X-VB") != "1" {
			http.Error(w, "nicht erlaubt", 403)
			return
		}
		if o := r.Header.Get("Origin"); o != "" && o != "http://127.0.0.1:"+port && o != "http://localhost:"+port {
			http.Error(w, "nicht erlaubt", 403)
			return
		}
		touch()
		f(w, r)
	}
}

func touch() { seenMu.Lock(); lastSeen = time.Now(); seenMu.Unlock() }

func jsonOut(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

func handleInfo(w http.ResponseWriter, r *http.Request) {
	jsonOut(w, 200, map[string]any{"app": "vorbestellungen", "folder": baseDir, "build": build})
}

var build = "dev"

// ---------- Dateien ----------

// Nur .json-Dateien im Datenordner (nicht im Programmordner, nicht darüber hinaus)
func dataPath(rel string) (string, error) {
	rel = filepath.FromSlash(strings.TrimPrefix(rel, "/"))
	if rel == "" || strings.Contains(rel, "..") || filepath.IsAbs(rel) || strings.ContainsAny(rel, ":*?\"<>|") {
		return "", errors.New("ungültiger Pfad")
	}
	p := filepath.Join(baseDir, rel)
	if !strings.HasPrefix(p, baseDir+string(filepath.Separator)) {
		return "", errors.New("ungültiger Pfad")
	}
	if strings.HasPrefix(strings.ToLower(p), strings.ToLower(webDir+string(filepath.Separator))) {
		return "", errors.New("ungültiger Pfad")
	}
	if strings.ToLower(filepath.Ext(p)) != ".json" || strings.EqualFold(filepath.Base(p), "etron-zugang.json") {
		return "", errors.New("ungültiger Pfad")
	}
	return p, nil
}

func revOf(b []byte) string { s := sha256.Sum256(b); return hex.EncodeToString(s[:8]) }

func readRetry(p string) ([]byte, error) {
	var err error
	for i := 0; i < 6; i++ {
		var b []byte
		b, err = os.ReadFile(p)
		if err == nil || errors.Is(err, os.ErrNotExist) {
			return b, err
		}
		time.Sleep(150 * time.Millisecond) // Dropbox hält die Datei gerade
	}
	return nil, err
}

func handleRead(w http.ResponseWriter, r *http.Request) {
	p, err := dataPath(r.URL.Query().Get("path"))
	if err != nil {
		jsonOut(w, 400, map[string]string{"error": err.Error()})
		return
	}
	fileMu.Lock()
	b, err := readRetry(p)
	fileMu.Unlock()
	if errors.Is(err, os.ErrNotExist) {
		jsonOut(w, 404, map[string]string{"error": "not_found"})
		return
	}
	if err != nil {
		jsonOut(w, 500, map[string]string{"error": err.Error()})
		return
	}
	w.Header().Set("X-Rev", revOf(b))
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.Write(b)
}

func writeAtomic(p string, b []byte) error {
	if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
		return err
	}
	tmp := filepath.Join(filepath.Dir(p), "."+filepath.Base(p)+".tmp")
	if err := os.WriteFile(tmp, b, 0o644); err != nil {
		return err
	}
	var err error
	for i := 0; i < 8; i++ {
		if err = os.Rename(tmp, p); err == nil {
			return nil
		}
		time.Sleep(200 * time.Millisecond)
	}
	os.Remove(tmp)
	return err
}

func handleWrite(w http.ResponseWriter, r *http.Request) {
	if r.Method != "PUT" && r.Method != "POST" {
		jsonOut(w, 405, map[string]string{"error": "method"})
		return
	}
	p, err := dataPath(r.URL.Query().Get("path"))
	if err != nil {
		jsonOut(w, 400, map[string]string{"error": err.Error()})
		return
	}
	body, err := io.ReadAll(io.LimitReader(r.Body, 64<<20))
	if err != nil || !json.Valid(body) {
		jsonOut(w, 400, map[string]string{"error": "kein gültiges JSON"})
		return
	}
	want := r.URL.Query().Get("rev")
	fileMu.Lock()
	defer fileMu.Unlock()
	cur, err := readRetry(p)
	exists := err == nil
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		jsonOut(w, 500, map[string]string{"error": err.Error()})
		return
	}
	if (exists && revOf(cur) != want) || (!exists && want != "") {
		jsonOut(w, 409, map[string]string{"error": "conflict"})
		return
	}
	if err := writeAtomic(p, body); err != nil {
		jsonOut(w, 500, map[string]string{"error": err.Error()})
		return
	}
	jsonOut(w, 200, map[string]string{"rev": revOf(body)})
}

func handleList(w http.ResponseWriter, r *http.Request) {
	folder := strings.Trim(filepath.FromSlash(r.URL.Query().Get("folder")), `\/`)
	if strings.Contains(folder, "..") || strings.EqualFold(folder, "programm") {
		jsonOut(w, 400, map[string]string{"error": "ungültiger Pfad"})
		return
	}
	ents, _ := os.ReadDir(filepath.Join(baseDir, folder))
	names := []string{}
	for _, e := range ents {
		if !e.IsDir() && strings.HasSuffix(strings.ToLower(e.Name()), ".json") && !strings.HasPrefix(e.Name(), ".") && e.Name() != "etron-zugang.json" {
			names = append(names, e.Name())
		}
	}
	sort.Strings(names)
	jsonOut(w, 200, names)
}

// Konfliktkopien, die der Dropbox-Client anlegt, wenn zwei PCs gleichzeitig speichern:
// „vorbestellungen (… conflicted copy …).json“ bzw. „vorbestellungen (… Konflikt …).json“
func handleConflicts(w http.ResponseWriter, r *http.Request) {
	rel := r.URL.Query().Get("path")
	p, err := dataPath(rel)
	if err != nil {
		jsonOut(w, 400, map[string]string{"error": err.Error()})
		return
	}
	stem := strings.TrimSuffix(filepath.Base(p), filepath.Ext(p))
	ents, _ := os.ReadDir(filepath.Dir(p))
	relDir := filepath.ToSlash(filepath.Dir(filepath.FromSlash(strings.TrimPrefix(rel, "/"))))
	out := []string{}
	for _, e := range ents {
		n := e.Name()
		ln := strings.ToLower(n)
		if e.IsDir() || !strings.HasPrefix(n, stem+" (") || !strings.HasSuffix(ln, ".json") {
			continue
		}
		if strings.Contains(ln, "conflict") || strings.Contains(ln, "konflikt") {
			if relDir == "." {
				out = append(out, n)
			} else {
				out = append(out, relDir+"/"+n)
			}
		}
	}
	jsonOut(w, 200, out)
}

func handleRemove(w http.ResponseWriter, r *http.Request) {
	p, err := dataPath(r.URL.Query().Get("path"))
	if err != nil || r.Method != "POST" {
		jsonOut(w, 400, map[string]string{"error": "ungültig"})
		return
	}
	// Nur Konfliktkopien dürfen gelöscht werden
	ln := strings.ToLower(filepath.Base(p))
	if !strings.Contains(ln, " (") || !(strings.Contains(ln, "conflict") || strings.Contains(ln, "konflikt")) {
		jsonOut(w, 403, map[string]string{"error": "nur Konfliktkopien"})
		return
	}
	fileMu.Lock()
	err = os.Remove(p)
	fileMu.Unlock()
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		jsonOut(w, 500, map[string]string{"error": err.Error()})
		return
	}
	jsonOut(w, 200, map[string]bool{"ok": true})
}

// ---------- etron ----------

type etronCfg struct {
	URL     string `json:"url"`
	Key     string `json:"key"`
	Secret  string `json:"secret"`
	SavedAt string `json:"savedAt,omitempty"`
	SavedBy string `json:"savedBy,omitempty"`
}

func cfgPath() string { return filepath.Join(baseDir, "etron-zugang.json") }

func loadCfg() (etronCfg, error) {
	var c etronCfg
	b, err := readRetry(cfgPath())
	if err != nil {
		return c, err
	}
	err = json.Unmarshal(b, &c)
	return c, err
}

func handleEtronConfig(w http.ResponseWriter, r *http.Request) {
	if r.Method == "GET" {
		c, err := loadCfg()
		if err != nil {
			jsonOut(w, 200, map[string]any{"set": false})
			return
		}
		tail := ""
		if len(c.Key) >= 4 {
			tail = c.Key[len(c.Key)-4:]
		}
		jsonOut(w, 200, map[string]any{"set": c.Key != "" && c.Secret != "", "url": c.URL, "keyTail": tail, "savedAt": c.SavedAt, "savedBy": c.SavedBy})
		return
	}
	if r.Method != "POST" {
		jsonOut(w, 405, map[string]string{"error": "method"})
		return
	}
	var in etronCfg
	var del struct {
		Delete bool `json:"delete"`
	}
	body, _ := io.ReadAll(io.LimitReader(r.Body, 1<<16))
	json.Unmarshal(body, &del)
	if del.Delete {
		os.Remove(cfgPath())
		tok.reset()
		jsonOut(w, 200, map[string]bool{"ok": true})
		return
	}
	if err := json.Unmarshal(body, &in); err != nil {
		jsonOut(w, 400, map[string]string{"error": "ungültig"})
		return
	}
	old, _ := loadCfg()
	if in.Key == "" {
		in.Key = old.Key
	}
	if in.Secret == "" {
		in.Secret = old.Secret
	}
	if in.URL == "" {
		in.URL = old.URL
	}
	if !(strings.HasPrefix(in.URL, "https://") || strings.HasPrefix(in.URL, "http://127.0.0.1:")) || in.Key == "" || in.Secret == "" {
		jsonOut(w, 400, map[string]string{"error": "Adresse (https://…), Client Key und Client Secret werden gebraucht"})
		return
	}
	b, _ := json.MarshalIndent(in, "", "  ")
	if err := writeAtomic(cfgPath(), b); err != nil {
		jsonOut(w, 500, map[string]string{"error": err.Error()})
		return
	}
	tok.reset()
	jsonOut(w, 200, map[string]bool{"ok": true})
}

type tokenCache struct {
	mu    sync.Mutex
	token string
	until time.Time
}

func (t *tokenCache) reset() { t.mu.Lock(); t.token = ""; t.mu.Unlock() }

var tok tokenCache
var httpc = &http.Client{Timeout: 30 * time.Second}

type etronErr struct {
	msg    string
	status int
}

func (e *etronErr) Error() string { return e.msg }

func apiBase(c etronCfg) string {
	u := strings.TrimRight(c.URL, "/")
	if i := strings.Index(u, "/api/"); i > 0 {
		u = u[:i]
	}
	return u + "/api/v2"
}

func (t *tokenCache) get(c etronCfg, force bool) (string, error) {
	t.mu.Lock()
	defer t.mu.Unlock()
	if !force && t.token != "" && time.Now().Before(t.until) {
		return t.token, nil
	}
	req, _ := http.NewRequest("POST", apiBase(c)+"/authentication/oauth2/token", strings.NewReader("grant_type=client_credentials"))
	req.SetBasicAuth(c.Key, c.Secret)
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	r, err := httpc.Do(req)
	if err != nil {
		return "", &etronErr{"etron nicht erreichbar: " + err.Error(), 0}
	}
	defer r.Body.Close()
	b, _ := io.ReadAll(io.LimitReader(r.Body, 1<<20))
	if r.StatusCode != 200 {
		return "", &etronErr{fmt.Sprintf("etron-Anmeldung abgelehnt (HTTP %d): %s", r.StatusCode, short(b, 200)), r.StatusCode}
	}
	var j struct {
		AccessToken string `json:"access_token"`
		ExpiresIn   int    `json:"expires_in"`
	}
	if json.Unmarshal(b, &j) != nil || j.AccessToken == "" {
		return "", &etronErr{"etron-Anmeldung: unerwartete Antwort: " + short(b, 200), r.StatusCode}
	}
	if j.ExpiresIn < 120 {
		j.ExpiresIn = 3600
	}
	t.token = j.AccessToken
	t.until = time.Now().Add(time.Duration(j.ExpiresIn-60) * time.Second)
	return t.token, nil
}

func short(b []byte, n int) string {
	s := string(b)
	if len(s) > n {
		s = s[:n]
	}
	return s
}

// Werte als JSON in die Adresse (wie in der etron-Dokumentation: domain=[…]&fields=[…])
func query(params map[string]any) string {
	if len(params) == 0 {
		return ""
	}
	keys := make([]string, 0, len(params))
	for k := range params {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	var sb strings.Builder
	for i, k := range keys {
		if i > 0 {
			sb.WriteByte('&')
		}
		v := params[k]
		var s string
		if str, ok := v.(string); ok {
			s = str
		} else {
			b, _ := json.Marshal(v)
			s = string(b)
		}
		sb.WriteString(k + "=" + urlEscape(s))
	}
	return "?" + sb.String()
}

func urlEscape(s string) string {
	var sb strings.Builder
	for _, c := range []byte(s) {
		if (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || strings.IndexByte("-_.~", c) >= 0 {
			sb.WriteByte(c)
		} else {
			sb.WriteString(fmt.Sprintf("%%%02X", c))
		}
	}
	return sb.String()
}

func call(c etronCfg, method, path string, params map[string]any, body any) (any, error) {
	for attempt := 0; attempt < 2; attempt++ {
		t, err := tok.get(c, attempt > 0)
		if err != nil {
			return nil, err
		}
		var rd io.Reader
		if body != nil {
			b, _ := json.Marshal(body)
			rd = bytes.NewReader(b)
		}
		req, _ := http.NewRequest(method, apiBase(c)+path+query(params), rd)
		req.Header.Set("Authorization", "Bearer "+t)
		if body != nil {
			req.Header.Set("Content-Type", "application/json")
		}
		r, err := httpc.Do(req)
		if err != nil {
			return nil, &etronErr{"etron nicht erreichbar: " + err.Error(), 0}
		}
		b, _ := io.ReadAll(io.LimitReader(r.Body, 8<<20))
		r.Body.Close()
		if r.StatusCode == 401 && attempt == 0 {
			continue
		}
		if r.StatusCode >= 300 {
			return nil, &etronErr{fmt.Sprintf("etron HTTP %d: %s", r.StatusCode, short(b, 300)), r.StatusCode}
		}
		var out any
		if json.Unmarshal(b, &out) != nil {
			return string(b), nil
		}
		return out, nil
	}
	return nil, &etronErr{"etron: Anmeldung abgelaufen", 401}
}

func listOf(v any) []any {
	if a, ok := v.([]any); ok {
		return a
	}
	if m, ok := v.(map[string]any); ok {
		for _, k := range []string{"data", "result", "records"} {
			if a, ok := m[k].([]any); ok {
				return a
			}
		}
	}
	return nil
}

func str(v any, n int) string {
	s, _ := v.(string)
	s = strings.TrimSpace(s)
	if len([]rune(s)) > n {
		s = string([]rune(s)[:n])
	}
	return s
}

func intOf(v any) int {
	switch x := v.(type) {
	case float64:
		return int(x)
	case string:
		var i int
		fmt.Sscanf(x, "%d", &i)
		return i
	}
	return 0
}

var partnerFields = []string{"id", "name", "firstname", "lastname", "ref", "phone", "mobile", "email"}

func handleEtron(w http.ResponseWriter, r *http.Request) {
	if r.Method != "POST" {
		jsonOut(w, 405, map[string]string{"error": "method"})
		return
	}
	c, err := loadCfg()
	if err != nil || c.Key == "" || c.Secret == "" || c.URL == "" {
		jsonOut(w, 412, map[string]string{"error": "etron-Zugang ist nicht eingerichtet (Einstellungen)."})
		return
	}
	var b map[string]any
	if json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(&b) != nil {
		jsonOut(w, 400, map[string]string{"error": "ungültige Anfrage"})
		return
	}
	res, err := etronAction(c, str(b["action"], 40), b)
	if err != nil {
		st := 0
		var ee *etronErr
		if errors.As(err, &ee) {
			st = ee.status
		}
		jsonOut(w, 502, map[string]any{"error": err.Error(), "status": st})
		return
	}
	jsonOut(w, 200, res)
}

func etronAction(c etronCfg, action string, b map[string]any) (any, error) {
	switch action {
	case "ping":
		if _, err := tok.get(c, true); err != nil {
			return nil, err
		}
		r, err := call(c, "GET", "/search_extract/res.partner", map[string]any{"fields": []string{"id"}, "limit": 1}, nil)
		if err != nil {
			return nil, err
		}
		return map[string]any{"ok": true, "read": len(listOf(r))}, nil

	case "partner_search":
		q := str(b["q"], 60)
		if len(q) < 2 {
			return map[string]any{"items": []any{}}, nil
		}
		var domain []any
		if isDigits(q) {
			domain = []any{"|", "|", "|", []any{"id", "=", intOf(q)}, []any{"ref", "=", q}, []any{"phone", "ilike", q}, []any{"mobile", "ilike", q}}
		} else {
			domain = []any{"|", "|", "|", []any{"name", "ilike", q}, []any{"email", "ilike", q}, []any{"phone", "ilike", q}, []any{"mobile", "ilike", q}}
		}
		r, err := call(c, "GET", "/search_extract/res.partner", map[string]any{"domain": domain, "fields": partnerFields, "limit": 15, "order": "name"}, nil)
		if err != nil {
			return nil, err
		}
		return map[string]any{"items": listOf(r)}, nil

	case "partner_get":
		id := intOf(b["id"])
		if id <= 0 {
			return nil, errors.New("Kundennummer fehlt")
		}
		r, err := call(c, "GET", "/search_extract/res.partner", map[string]any{"domain": []any{[]any{"id", "=", id}}, "fields": partnerFields, "limit": 1}, nil)
		if err != nil {
			return nil, err
		}
		return map[string]any{"items": listOf(r)}, nil

	case "partner_create":
		fn, ln := str(b["firstname"], 120), str(b["lastname"], 120)
		if fn == "" || ln == "" {
			return nil, errors.New("Vor- und Nachname fehlen")
		}
		values := map[string]any{"firstname": fn, "lastname": ln, "type": "contact", "customer_rank": 1}
		if p := str(b["phone"], 40); p != "" {
			values["mobile"] = p
		}
		if e := str(b["email"], 120); e != "" {
			values["email"] = e
		}
		r, err := call(c, "POST", "/create/res.partner", nil, map[string]any{"values": values})
		if err != nil {
			return nil, err
		}
		return map[string]any{"result": r}, nil

	case "product_find":
		raw, _ := b["codes"].([]any)
		codes := []string{}
		for _, x := range raw {
			if s := str(x, 60); s != "" && len(codes) < 50 {
				codes = append(codes, s)
			}
		}
		if len(codes) == 0 {
			return map[string]any{"items": []any{}}, nil
		}
		r, err := call(c, "GET", "/search_read/product.product", map[string]any{"domain": []any{[]any{"default_code", "in", codes}}, "fields": []string{"id", "default_code", "name"}}, nil)
		if err != nil {
			return nil, err
		}
		return map[string]any{"items": listOf(r)}, nil

	case "order_create":
		partner := intOf(b["partner_id"])
		if partner <= 0 {
			return nil, errors.New("etron-Kundennummer fehlt")
		}
		raw, _ := b["lines"].([]any)
		lines := []any{}
		for _, x := range raw {
			m, _ := x.(map[string]any)
			pid, qty := intOf(m["product_id"]), intOf(m["qty"])
			if pid > 0 && qty > 0 && qty < 10000 && len(lines) < 50 {
				lines = append(lines, []any{0, 0, map[string]any{"product_id": pid, "product_uom_qty": qty}})
			}
		}
		if len(lines) == 0 {
			return nil, errors.New("keine Auftragszeilen")
		}
		origin := str(b["origin"], 60)
		if origin == "" {
			origin = "Vorbestellung"
		}
		values := map[string]any{"partner_id": partner, "origin": origin, "order_line": lines}
		if n := str(b["note"], 500); n != "" {
			values["note"] = n
		}
		names := []any{}
		for _, t := range strings.Split(str(b["tag"], 200), ",") {
			if t = strings.TrimSpace(t); t != "" {
				names = append(names, t)
			}
		}
		if len(names) > 0 {
			tr, err := call(c, "GET", "/search_read/crm.tag", map[string]any{"domain": []any{[]any{"name", "in", names}}, "fields": []string{"id", "name"}}, nil)
			if err != nil {
				return nil, fmt.Errorf("Stichwort nicht lesbar: %v", err)
			}
			ids := []any{}
			for _, x := range listOf(tr) {
				if m, ok := x.(map[string]any); ok && intOf(m["id"]) > 0 {
					ids = append(ids, intOf(m["id"]))
				}
			}
			if len(ids) < len(names) {
				return nil, fmt.Errorf("Stichwort „%s“ gibt es in etron nicht (genaue Schreibweise prüfen)", str(b["tag"], 200))
			}
			values["tag_ids"] = []any{[]any{6, 0, ids}}
		}
		r, err := call(c, "POST", "/create/sale.order", nil, map[string]any{"values": values})
		if err != nil {
			return nil, err
		}
		return map[string]any{"result": r}, nil
	}
	return nil, errors.New("unbekannte Aktion")
}

func isDigits(s string) bool {
	for _, c := range s {
		if c < '0' || c > '9' {
			return false
		}
	}
	return s != ""
}

// ---------- Übernahme aus dem alten System (Web-App mit Dropbox-App-Ordner) ----------

func dropboxRoots() []string {
	roots := []string{}
	add := func(p string) {
		if p == "" {
			return
		}
		for _, r := range roots {
			if strings.EqualFold(r, p) {
				return
			}
		}
		if st, err := os.Stat(p); err == nil && st.IsDir() {
			roots = append(roots, p)
		}
	}
	for _, f := range []string{filepath.Join(os.Getenv("LOCALAPPDATA"), "Dropbox", "info.json"), filepath.Join(os.Getenv("APPDATA"), "Dropbox", "info.json")} {
		b, err := os.ReadFile(f)
		if err != nil {
			continue
		}
		var info map[string]struct {
			Path string `json:"path"`
		}
		if json.Unmarshal(b, &info) == nil {
			for _, v := range info {
				add(v.Path)
			}
		}
	}
	if h, _ := os.UserHomeDir(); h != "" {
		add(filepath.Join(h, "Dropbox"))
	}
	if d := os.Getenv("VB_DROPBOX"); d != "" { // nur für Tests
		add(d)
	}
	return roots
}

func sameDir(a, b string) bool {
	a, _ = filepath.Abs(a)
	b, _ = filepath.Abs(b)
	return strings.EqualFold(filepath.Clean(a), filepath.Clean(b))
}

func handleCandidates(w http.ResponseWriter, r *http.Request) {
	type cand struct {
		Folder   string `json:"folder"`
		Modified string `json:"modified"`
		Logs     int    `json:"logs"`
	}
	out := []cand{}
	for _, root := range dropboxRoots() {
		for _, apps := range []string{"Apps", "Anwendungen"} {
			ents, _ := os.ReadDir(filepath.Join(root, apps))
			for _, e := range ents {
				if !e.IsDir() {
					continue
				}
				dir := filepath.Join(root, apps, e.Name())
				st, err := os.Stat(filepath.Join(dir, "vorbestellungen.json"))
				if err != nil || sameDir(dir, baseDir) {
					continue
				}
				logs, _ := filepath.Glob(filepath.Join(dir, "protokoll", "*.json"))
				out = append(out, cand{dir, st.ModTime().Format("02.01.2006 15:04"), len(logs)})
			}
		}
	}
	jsonOut(w, 200, out)
}

// Quellordner: absolut, enthält vorbestellungen.json, ist nicht der eigene Ordner
func srcDir(r *http.Request) (string, error) {
	src := filepath.Clean(r.URL.Query().Get("src"))
	if !filepath.IsAbs(src) {
		return "", errors.New("Bitte den vollständigen Ordnerpfad angeben")
	}
	if sameDir(src, baseDir) {
		return "", errors.New("Das ist schon der Ordner dieses Programms")
	}
	if _, err := os.Stat(filepath.Join(src, "vorbestellungen.json")); err != nil {
		return "", errors.New("In diesem Ordner liegt keine vorbestellungen.json")
	}
	return src, nil
}

func handleSrcList(w http.ResponseWriter, r *http.Request) {
	src, err := srcDir(r)
	if err != nil {
		jsonOut(w, 400, map[string]string{"error": err.Error()})
		return
	}
	out := []string{"vorbestellungen.json"}
	logs, _ := filepath.Glob(filepath.Join(src, "protokoll", "*.json"))
	sort.Strings(logs)
	for _, l := range logs {
		n := filepath.Base(l)
		if !strings.Contains(n, " (") {
			out = append(out, "protokoll/"+n)
		}
	}
	jsonOut(w, 200, out)
}

func handleSrcRead(w http.ResponseWriter, r *http.Request) {
	src, err := srcDir(r)
	if err != nil {
		jsonOut(w, 400, map[string]string{"error": err.Error()})
		return
	}
	rel := filepath.FromSlash(r.URL.Query().Get("path"))
	if strings.Contains(rel, "..") || filepath.IsAbs(rel) || strings.ToLower(filepath.Ext(rel)) != ".json" {
		jsonOut(w, 400, map[string]string{"error": "ungültiger Pfad"})
		return
	}
	b, err := readRetry(filepath.Join(src, rel))
	if err != nil {
		jsonOut(w, 404, map[string]string{"error": "not_found"})
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.Write(b)
}

// Sicherung der eigenen Daten nach sicherung\JJJJ-MM-TT_HHMMSS\ (vor der Übernahme)
func handleBackup(w http.ResponseWriter, r *http.Request) {
	if r.Method != "POST" {
		jsonOut(w, 405, map[string]string{"error": "method"})
		return
	}
	name := time.Now().Format("2006-01-02_150405")
	dst := filepath.Join(baseDir, "sicherung", name)
	n := 0
	fileMu.Lock()
	defer fileMu.Unlock()
	files := []string{filepath.Join(baseDir, "vorbestellungen.json")}
	logs, _ := filepath.Glob(filepath.Join(baseDir, "protokoll", "*.json"))
	files = append(files, logs...)
	for _, f := range files {
		b, err := readRetry(f)
		if err != nil {
			continue
		}
		rel, _ := filepath.Rel(baseDir, f)
		if err := writeAtomic(filepath.Join(dst, rel), b); err != nil {
			jsonOut(w, 500, map[string]string{"error": err.Error()})
			return
		}
		n++
	}
	jsonOut(w, 200, map[string]any{"folder": "sicherung/" + name, "files": n})
}
