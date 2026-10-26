package ru.opodoydet.domain;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import ru.opodoydet.shared.Json;
import tools.jackson.databind.node.ObjectNode;

public final class Features {
  public record Definition(
      String label,
      String scope,
      String tool,
      String question,
      String positive,
      String negative,
      Integer threshold) {}

  private static final Map<String, Definition> ALL = new LinkedHashMap<>();

  static {
    ALL.put(
        "beach_walk",
        new Definition(
            "До пляжа пешком",
            "hotel",
            "route",
            "Как пройти от входа к общедоступному пляжу?",
            "Пляж в пределах 1 км",
            "До пляжа больше 1 км",
            1000));
    ALL.put(
        "step_free_route",
        new Definition(
            "Дорога без лестниц",
            "hotel",
            "route",
            "Есть ли лестницы на пути до пляжа и доступный обход?",
            "Путь без ступеней подтверждён",
            "На пути есть лестницы",
            null));
    ALL.put(
        "courtyard",
        new Definition(
            "Номер во двор",
            "room",
            "host",
            "Все окна этой категории номера выходят во двор или на улицу?",
            "Окна номера выходят во двор",
            "Номер выходит на улицу",
            null));
    ALL.put(
        "step_free_access",
        new Definition(
            "Удобно с коляской",
            "room",
            "host",
            "Можно ли пройти от улицы до этой категории номера без ступеней, включая вход и путь до"
                + " лифта? Если есть ступени, есть ли доступный обход?",
            "Путь до номера без ступеней подтверждён",
            "На пути до номера есть препятствия",
            null));
    ALL.put(
        "family",
        new Definition(
            "Семейное размещение",
            "room",
            "host",
            "Подходит ли эта категория для размещения с детьми?",
            "Предусмотрено семейное размещение",
            "Семейное размещение не подтверждено отельером",
            null));
    ALL.put(
        "area_safety",
        new Definition(
            "Безопасность района",
            "hotel",
            "area",
            "Нужны сопоставимые официальные показатели зарегистрированных происшествий за один"
                + " период.",
            "Показатель не выше сопоставимого регионального",
            "Показатель выше сопоставимого регионального",
            null));
    ALL.put(
        "clean_air",
        new Definition(
            "Чистый воздух",
            "hotel",
            "area",
            "Нужен почасовой прогноз US AQI на всё пребывание.",
            "US AQI не выше 50 на всё пребывание по доступному прогнозу",
            "В прогнозе есть часы с US AQI выше 50",
            50));
    ALL.put(
        "low_noise",
        new Definition(
            "Меньше внешнего шума",
            "hotel",
            "area",
            "Нужны датированные данные о транспортной нагрузке и мероприятиях на время поездки.",
            "Низкий расчётный риск внешнего шума",
            "Есть факторы повышенного риска внешнего шума",
            null));
  }

  public static List<String> ids() {
    return List.copyOf(ALL.keySet());
  }

  public static Definition get(String id) {
    Definition value = ALL.get(id);
    if (value == null) throw new IllegalArgumentException("Неизвестное пожелание");
    return value;
  }

  public static ObjectNode catalog() {
    return Json.MAPPER.valueToTree(ALL);
  }
}
