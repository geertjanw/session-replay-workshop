package com.example.registration.frontend;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.http.CacheControl;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.client.RestClient;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Browser side of the workshop. The registration page and its script live in
 * the shared repo-root web/ folder (WEB_DIR, set by run.sh). Both are re-read on
 * every request, so edits to web/index.html or web/registration.js show up on
 * the next page reload, without rebuilding or restarting this service.
 */
@RestController
public class WebController {

    private static final MediaType JAVASCRIPT = MediaType.parseMediaType("application/javascript;charset=UTF-8");

    private final RestClient backend;
    private final ObjectMapper json;
    private final Path webDir;

    public WebController(RestClient backendRestClient, ObjectMapper json) {
        this.backend = backendRestClient;
        this.json = json;
        this.webDir = Path.of(System.getenv().getOrDefault("WEB_DIR", "../../../web"));
    }

    @GetMapping(value = "/", produces = MediaType.TEXT_HTML_VALUE)
    public ResponseEntity<String> index() throws IOException {
        String page = Files.readString(webDir.resolve("index.html"), StandardCharsets.UTF_8)
                .replace("__DASH0_BROWSER_CONFIG__", browserConfig());
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).contentType(MediaType.TEXT_HTML).body(page);
    }

    @GetMapping("/static/registration.js")
    public ResponseEntity<String> registrationJs() throws IOException {
        String js = Files.readString(webDir.resolve("registration.js"), StandardCharsets.UTF_8);
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).contentType(JAVASCRIPT).body(js);
    }

    /**
     * JSON endpoint the page's fetch() calls. The browser sends a traceparent
     * header (same-origin, added by the Dash0 Web SDK); the javaagent continues
     * that trace in Spring MVC and passes it on through the RestClient, so
     * browser -> web -> api is one trace.
     */
    @PostMapping(value = "/api/registrations", consumes = MediaType.APPLICATION_JSON_VALUE,
            produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<String> apiRegistrations(@RequestBody Map<String, Object> in) throws JsonProcessingException {
        Map<String, Object> body = new LinkedHashMap<>();
        for (String key : new String[] {"name", "email", "company", "ticketType"}) {
            body.put(key, in.get(key));
        }
        try {
            // exchange() hands back every status as-is, so we mirror the
            // backend's status (200/400/422/503) and body.
            return backend.post()
                    .uri("/api/register")
                    .contentType(MediaType.APPLICATION_JSON)
                    .body(body)
                    .exchange((request, response) -> ResponseEntity.status(response.getStatusCode())
                            .contentType(MediaType.APPLICATION_JSON)
                            .body(new String(response.getBody().readAllBytes(), StandardCharsets.UTF_8)));
        } catch (Exception e) {
            // 502 only when the backend is actually unreachable.
            Map<String, String> error = new LinkedHashMap<>();
            error.put("status", "error");
            error.put("errorType", "backend_unreachable");
            error.put("message", "backend unreachable: " + e.getMessage());
            return ResponseEntity.status(502).contentType(MediaType.APPLICATION_JSON).body(json.writeValueAsString(error));
        }
    }

    /** Dash0 Web SDK settings as a JSON literal that is safe inside a script block. */
    private String browserConfig() throws JsonProcessingException {
        Map<String, String> config = new LinkedHashMap<>();
        config.put("serviceName", System.getenv().getOrDefault("DASH0_WEB_SERVICE_NAME", "registration-website-java"));
        config.put("endpointUrl", System.getenv().getOrDefault("OTEL_EXPORTER_OTLP_ENDPOINT", ""));
        config.put("authToken", System.getenv().getOrDefault("DASH0_WEB_AUTH_TOKEN", ""));
        config.put("dataset", System.getenv().getOrDefault("DASH0_DATASET", "default"));
        return json.writeValueAsString(config).replace("<", "\\u003c");
    }
}
