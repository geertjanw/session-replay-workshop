package main

// Browser side of the workshop: the registration page and its script live in
// the shared repo-root web/ folder (WEB_DIR, set by run.sh). Both are re-read
// on every request, so edits to web/index.html or web/registration.js show up
// on the next page reload, without restarting this service.

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

func webDir() string {
	if v := os.Getenv("WEB_DIR"); v != "" {
		return v
	}
	return filepath.Join("..", "..", "..", "web")
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

// browserConfig returns the Dash0 Web SDK settings as a JSON literal.
// encoding/json escapes "<" as <, so it is safe inside a <script> block.
func browserConfig() string {
	b, _ := json.Marshal(map[string]string{
		"serviceName": envOr("DASH0_WEB_SERVICE_NAME", "registration-website-go"),
		"endpointUrl": os.Getenv("OTEL_EXPORTER_OTLP_ENDPOINT"),
		"authToken":   os.Getenv("DASH0_WEB_AUTH_TOKEN"),
		"dataset":     envOr("DASH0_DATASET", "default"),
	})
	return string(b)
}

func handleIndex(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/" {
		http.NotFound(w, r)
		return
	}
	page, err := os.ReadFile(filepath.Join(webDir(), "index.html"))
	if err != nil {
		http.Error(w, "cannot read web/index.html: "+err.Error(), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	_, _ = io.WriteString(w, strings.Replace(string(page), "__DASH0_BROWSER_CONFIG__", browserConfig(), 1))
}

func handleRegistrationJS(w http.ResponseWriter, r *http.Request) {
	js, err := os.ReadFile(filepath.Join(webDir(), "registration.js"))
	if err != nil {
		http.Error(w, "cannot read web/registration.js: "+err.Error(), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/javascript; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	_, _ = w.Write(js)
}

// handleAPIRegistrations is the JSON endpoint the page's fetch() calls. The
// browser sends a traceparent header (same-origin, added by the Dash0 Web SDK);
// otelhttp.NewHandler continues that trace, and the otelhttp transport passes
// it on to the backend, so browser -> web -> api is one trace.
func handleAPIRegistrations(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Name       string `json:"name"`
		Email      string `json:"email"`
		Company    string `json:"company"`
		TicketType string `json:"ticketType"`
	}
	_ = json.NewDecoder(r.Body).Decode(&in)
	payload, _ := json.Marshal(map[string]string{
		"name": in.Name, "email": in.Email, "company": in.Company, "ticketType": in.TicketType,
	})

	req, err := http.NewRequestWithContext(r.Context(), http.MethodPost, backendURL()+"/api/register", bytes.NewReader(payload))
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{
			"status": "error", "errorType": "backend_unreachable", "message": "could not build backend request",
		})
		return
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := httpClient.Do(req)
	if err != nil {
		// 502 only when the backend is actually unreachable.
		writeJSON(w, http.StatusBadGateway, map[string]string{
			"status": "error", "errorType": "backend_unreachable", "message": "backend unreachable: " + err.Error(),
		})
		return
	}
	defer resp.Body.Close()

	// Mirror the backend's status (200/400/422/503) and body.
	body, _ := io.ReadAll(resp.Body)
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(resp.StatusCode)
	_, _ = w.Write(body)
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
