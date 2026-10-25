import type { FeatureId } from "./types";

// Adding a characteristic reuses the existing evaluators and collection tools.
export const features: Record<
  FeatureId,
  {
    label: string;
    detail: string;
    scope: "hotel" | "room";
    evaluator: "max" | "true";
    threshold?: number;
    tool: "route" | "host" | "area";
    question: string;
    positive: string;
    negative: string;
  }
> = {
  beach_walk: {
    label: "До пляжа пешком",
    detail: "Не больше 1 км по рассчитанному пути",
    scope: "hotel",
    evaluator: "max",
    threshold: 1000,
    tool: "route",
    question: "Как пройти от входа к общедоступному пляжу?",
    positive: "Пляж в пределах 1 км",
    negative: "До пляжа больше 1 км",
  },
  step_free_route: {
    label: "Дорога без лестниц",
    detail: "Проверим известные препятствия по пути",
    scope: "hotel",
    evaluator: "true",
    tool: "route",
    question: "Есть ли лестницы на пути до пляжа и доступный обход?",
    positive: "Путь без ступеней подтверждён",
    negative: "На пути есть лестницы",
  },
  courtyard: {
    label: "Номер во двор",
    detail: "Проверим сторону окон; тишина не гарантируется",
    scope: "room",
    evaluator: "true",
    tool: "host",
    question: "Все окна этой категории номера выходят во двор или на улицу?",
    positive: "Окна номера выходят во двор",
    negative: "Номер выходит на улицу",
  },
  step_free_access: {
    label: "Удобно с коляской",
    detail: "Без ступеней от входа до номера",
    scope: "room",
    evaluator: "true",
    tool: "host",
    question:
      "Можно ли пройти от улицы до этой категории номера без ступеней, включая вход и путь до лифта? Если есть ступени, есть ли доступный обход?",
    positive: "Путь до номера без ступеней подтверждён",
    negative: "На пути до номера есть препятствия",
  },
  family: {
    label: "Семейное размещение",
    detail: "Есть условия для размещения с детьми",
    scope: "room",
    evaluator: "true",
    tool: "host",
    question: "Подходит ли эта категория для размещения с детьми?",
    positive: "Предусмотрено семейное размещение",
    negative: "Семейное размещение не подтверждено отельером",
  },
  area_safety: {
    label: "Безопасность района",
    detail: "Проверим сопоставимую статистику происшествий",
    scope: "hotel",
    evaluator: "true",
    tool: "area",
    question:
      "Есть ли сопоставимая официальная статистика безопасности района?",
    positive: "Показатель происшествий не выше регионального",
    negative: "Показатель происшествий выше регионального",
  },
  clean_air: {
    label: "Чистый воздух",
    detail: "US AQI до 50 по прогнозу на все даты поездки",
    scope: "hotel",
    evaluator: "max",
    threshold: 50,
    tool: "area",
    question: "Есть ли прогноз качества воздуха на даты поездки?",
    positive: "Прогноз качества воздуха соответствует пожеланию",
    negative: "В прогнозе есть часы с US AQI выше 50",
  },
  low_noise: {
    label: "Меньше внешнего шума",
    detail: "Оценка по дорогам, трафику и событиям",
    scope: "hotel",
    evaluator: "true",
    tool: "area",
    question: "Какой риск внешнего шума на даты поездки?",
    positive: "Низкий риск по доступным данным",
    negative: "Повышенный риск внешнего шума",
  },
};
export const featureIds = Object.keys(features) as FeatureId[];
export const scenarios = [
  {
    id: "sea",
    title: "Отдых у моря",
    description: "Пляж ближе, прогулки проще",
    features: ["beach_walk", "step_free_route"] as FeatureId[],
    icon: "waves",
  },
  {
    id: "family",
    title: "Поездка с детьми",
    description: "Продумать маленькие детали",
    features: [
      "family",
      "step_free_access",
      "clean_air",
      "area_safety",
    ] as FeatureId[],
    icon: "family",
  },
  {
    id: "quiet",
    title: "Спокойный отдых",
    description: "Найти свой тихий уголок",
    features: ["low_noise", "courtyard", "clean_air"] as FeatureId[],
    icon: "moon",
  },
];
