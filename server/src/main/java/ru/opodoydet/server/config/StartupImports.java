package ru.opodoydet.server.config;

import org.springframework.context.SmartLifecycle;
import org.springframework.stereotype.Component;
import ru.opodoydet.persistence.Store;
import ru.opodoydet.server.catalog.SeedImporter;
import ru.opodoydet.server.migration.SqliteImporter;
import ru.opodoydet.server.migration.DemoSeedImporter;

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
  private final DemoSeedImporter demo;
  private final Store store;
  private volatile boolean running;

  StartupImports(SeedImporter seed, SqliteImporter sqlite, DemoSeedImporter demo, Store store) {
    this.seed = seed;
    this.sqlite = sqlite;
    this.demo = demo;
    this.store = store;
  }

  @Override
  public void start() {
    try {
      seed.run();
      demo.run();
      sqlite.run();
      // Imported runs arrive after AdvisorService's constructor recovery. They have no worker
      // in this process and must be terminal before HTTP history can expose them as running.
      store.recoverAdvisorRuns();
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
