import { Link, useLocation, useSearchParams } from "react-router-dom";
import { Plus } from "lucide-react";
import { useState } from "react";
import { AccountShell } from "../features/account/components/AccountShell";
import { BookingsPanel } from "../features/account/components/BookingsPanel";
import { HostListingsPanel } from "../features/account/components/HostListingsPanel";
import { ProfileForm } from "../features/account/components/ProfileForm";
import { QuestionsPanel } from "../features/account/components/QuestionsPanel";

export function HostAccountPage() {
  const { pathname } = useLocation();
  const [params] = useSearchParams();
  const [editorDescription, setEditorDescription] = useState(
    "Заполните информацию о жилье и параметры номера.",
  );
  const section = pathname.split("/")[2];
  const editing = params.has("edit") || params.get("new") === "1";
  if (section === "profile")
    return (
      <AccountShell
        title="Мой профиль"
        description="Контактные данные и информация о вас."
      >
        <ProfileForm />
      </AccountShell>
    );
  if (section === "questions")
    return (
      <AccountShell
        title="Вопросы гостей"
        description="Помогите гостям узнать детали и выбрать ваше жильё."
      >
        <QuestionsPanel host />
      </AccountShell>
    );
  if (section === "bookings")
    return (
      <AccountShell
        title="Бронирования"
        description="Заявки гостей, подтверждённые брони и история проживания."
      >
        <BookingsPanel host />
      </AccountShell>
    );
  return (
    <AccountShell
      title={
        editing
          ? params.has("edit")
            ? "Редактировать объявление"
            : "Новое объявление"
          : "Мои объявления"
      }
      description={
        editing
          ? editorDescription
          : "Управляйте жильём и отвечайте на запросы гостей."
      }
      action={
        editing ? (
          <a
            className="button secondary editor-preview-action"
            href="#listing-preview"
          >
            Предпросмотр
          </a>
        ) : (
          <Link className="button primary account-add-action" to="/host?new=1">
            <Plus size={23} aria-hidden="true" />
            Добавить объявление
          </Link>
        )
      }
    >
      <HostListingsPanel onEditorDescription={setEditorDescription} />
    </AccountShell>
  );
}
