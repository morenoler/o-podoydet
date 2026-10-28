package ru.opodoydet.server.web;

import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;
import ru.opodoydet.application.ProviderSelection;

@RestController
public final class ProviderController {
  private final ProviderSelection providers;
  public ProviderController(ProviderSelection providers) { this.providers = providers; }
  @GetMapping("/api/ai/config")
  public ResponseEntity<String> config() { return JsonResponses.send(200, providers.publicConfig()); }
}
