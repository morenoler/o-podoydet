package ru.opodoydet;

import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

final class Features {
  record Definition(
      String label,
      String scope,
      String tool,
      String question,
      String positive,
      String negative,
      Integer threshold) {}

  static final Map<String, Definition> ALL = new LinkedHashMap<>();

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
  }

  static List<String> ids() {
    return List.copyOf(ALL.keySet());
  }

  static Definition get(String id) {
    Definition value = ALL.get(id);
    if (value == null) throw new IllegalArgumentException("Неизвестное пожелание");
    return value;
  }

  static ObjectNode catalog() {
    return Json.MAPPER.valueToTree(ALL);
  }
}
