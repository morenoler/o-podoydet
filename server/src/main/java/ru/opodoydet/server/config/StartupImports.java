package ru.opodoydet.server.config;

import org.springframework.context.SmartLifecycle;
import org.springframework.stereotype.Component;
import ru.opodoydet.server.catalog.SeedImporter;
import ru.opodoydet.server.migration.SqliteImporter;

/**
 * Загрузка каталога и перенос старой SQLite до того, как сервер начнёт принимать запросы.
 *
 * <p>ApplicationRunner запускается уже после открытия порта, и первые запросы успевали увидеть
 * пустой каталог («Набор данных не загружен»). Фаза этого компонента меньше фазы веб-сервера,
 * поэтому Tomcat стартует только после импорта — как и старый бэкенд.
 */
@Component
class StartupImports implements SmartLifecycle {

  private final SeedImporter seed;
  private final SqliteImporter sqlite;
  private volatile boolean running;

  StartupImports(SeedImporter seed, SqliteImporter sqlite) {
    this.seed = seed;
    this.sqlite = sqlite;
  }

  @Override
  public void start() {
    try {
      seed.run();
      sqlite.run();
    } catch (Exception failure) {
      throw new IllegalStateException("Не удалось загрузить данные при старте: " + failure.getMessage(), failure);
    }
    running = true;
  }

  @Override
  public void stop() {
    running = false;
  }

  @Override
  public boolean isRunning() {
    return running;
  }

  @Override
  public int getPhase() {
    return 0; // веб-сервер стартует в фазе около Integer.MAX_VALUE
  }
}
