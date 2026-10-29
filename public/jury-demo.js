const find = (id) => document.getElementById(id);
const log = {};
const day = new Date();
day.setUTCDate(day.getUTCDate() + 7);
const checkIn = day.toISOString().slice(0, 10);
day.setUTCDate(day.getUTCDate() + 3);
const trip = {
  region: "Пусан", checkIn, checkOut: day.toISOString().slice(0, 10),
  adults: 2, children: 0, scenarios: [], text: "", admissionMode: "verified",
  preferences: [{ feature: "courtyard", required: true }],
};

async function request(path, payload) {
  const response = await fetch(path, {
    method: payload === undefined ? "GET" : "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: payload === undefined ? undefined : JSON.stringify(payload),
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) {
    if (response.status === 403) throw new Error("Откройте эту страницу в лаборатории на порту 8081. Диалог недоступен для реального каталога.");
    throw new Error(`Сервер вернул ошибку ${response.status}. Проверьте готовность контейнеров и повторите шаг.`);
  }
  return response.json();
}

function save(key, data) {
  log[key] = data;
  find("details").textContent = JSON.stringify(log, null, 2);
}

function button(id, operation) {
  find(id).addEventListener("click", async () => {
    find(id).disabled = true;
    find("status").textContent = "Выполняем запрос…";
    try {
      await operation();
      find("status").textContent = "";
    } catch (error) {
      find("status").textContent = error.name === "TimeoutError"
        ? "Сервер не ответил за 30 секунд. Проверьте его готовность и повторите шаг."
        : error.message;
      find(id).disabled = false;
    }
  });
}

button("search-before", async () => {
  // The guard is read before searching, so the production page cannot start a fake demo.
  await request("/api/v2/questions?hotelId=demo-harbor");
  const result = await request("/api/search", trip);
  save("Поиск до ответа", result);
  find("before-result").textContent = result.results.length === 0
    ? "Совпадений: 0.\nОкна во двор пока не подтверждены даже в учебном наборе."
    : `Совпадений: ${result.results.length}.\nУчебный ответ уже сохранён с прошлого запуска. История остаётся в базе.`;
  find("answer-result").textContent = "Можно получить ответ вымышленного отельера.";
  find("answer").disabled = false;
});

button("answer", async () => {
  const result = await request("/api/v2/host/demo-harbor/simulate", {});
  save("Ответ учебного отельера", result);
  const changes = (result.answers || []).flatMap((answer) => answer.changes || []);
  const courtyard = changes.find((change) => change.characteristic === "courtyard");
  find("answer-result").textContent = courtyard
    ? `«${courtyard.quote}»\nИсточник: вымышленный отельер. Ответ сохранён как simulated.`
    : "Сценарий выполнен. Ранее полученные ответы сохранены в истории.";
  find("after-result").textContent = "Повторите поиск с теми же условиями.";
  find("search-after").disabled = false;
});

button("search-after", async () => {
  const result = await request("/api/search", trip);
  const knowledge = await request("/api/v2/hotels/demo-harbor/knowledge");
  save("Поиск после ответа", result);
  save("Происхождение сведений", knowledge);
  const harbor = result.results.find((item) => item.hotel?.id === "demo-harbor");
  if (!harbor) throw new Error("Учебная категория не прошла поиск. В ответах API ниже можно проверить причину; результат не был подменён.");
  find("after-result").textContent = `Совпадений: ${result.results.length}.\n«${harbor.hotel.name}» подходит по учебным сведениям об окнах во двор.`;
  find("search-after").disabled = false;
});
