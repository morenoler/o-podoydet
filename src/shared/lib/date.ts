export const dateLabel = (d: string) =>
  d
    ? new Date(d + "T12:00:00").toLocaleDateString("ru-RU", {
        day: "numeric",
        month: "short",
      })
    : "Даты не выбраны";

export const dateFull = (d: string) =>
  new Date(/^\d{4}-\d{2}-\d{2}$/.test(d) ? d + "T12:00:00" : d).toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

export const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
