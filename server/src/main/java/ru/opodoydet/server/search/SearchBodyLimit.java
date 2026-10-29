package ru.opodoydet.server.search;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.lang.reflect.Type;
import org.springframework.core.MethodParameter;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpInputMessage;
import org.springframework.http.converter.HttpMessageConverter;
import org.springframework.web.bind.annotation.ControllerAdvice;
import org.springframework.web.servlet.mvc.method.annotation.RequestBodyAdviceAdapter;

/** Retains the existing 24 KiB limit, including requests with chunked transfer encoding. */
@ControllerAdvice(assignableTypes = SearchController.class)
class SearchBodyLimit extends RequestBodyAdviceAdapter {
  @Override
  public boolean supports(MethodParameter parameter, Type type,
      Class<? extends HttpMessageConverter<?>> converter) {
    return type == SearchRequest.class;
  }

  @Override
  public HttpInputMessage beforeBodyRead(HttpInputMessage input, MethodParameter parameter,
      Type type, Class<? extends HttpMessageConverter<?>> converter) throws IOException {
    byte[] bytes = input.getBody().readNBytes(24 * 1024 + 1);
    if (bytes.length > 24 * 1024) throw new IllegalArgumentException("Запрос слишком большой");
    return new HttpInputMessage() {
      public InputStream getBody() { return new ByteArrayInputStream(bytes); }
      public HttpHeaders getHeaders() { return input.getHeaders(); }
    };
  }
}
