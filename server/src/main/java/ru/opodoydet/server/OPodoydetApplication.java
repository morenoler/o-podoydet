package ru.opodoydet.server;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.context.properties.ConfigurationPropertiesScan;

@SpringBootApplication
@ConfigurationPropertiesScan
public class OPodoydetApplication {

  public static void main(String[] args) {
    SpringApplication.run(OPodoydetApplication.class, args);
  }
}
