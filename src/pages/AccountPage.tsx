import { Link, useLocation } from "react-router-dom";
import { Search } from "lucide-react";
import { AccountShell } from "../features/account/components/AccountShell";
import { BookingsPanel } from "../features/account/components/BookingsPanel";
import { ProfileForm } from "../features/account/components/ProfileForm";
import { QuestionsPanel } from "../features/account/components/QuestionsPanel";

export function AccountPage() {
  const { pathname } = useLocation();
  const section = pathname.split("/")[2];
  if (section === "profile")
    return (
      <AccountShell
        title="Мой профиль"
        description="Контакты для связи с отельером и информация о вас."
      >
        <ProfileForm />
      </AccountShell>
    );
  if (section === "questions")
    return (
      <AccountShell
        title="Мои вопросы"
        description="Условия проживания, которые вы уточняли у отельеров."
      >
        <QuestionsPanel />
      </AccountShell>
    );
  return (
    <AccountShell
      title="Мои поездки"
      description="Заявки, предстоящий отдых и история проживания."
      action={
        <Link className="button primary account-find-action" to="/">
          <Search size={21} aria-hidden="true" />
          Найти отель
        </Link>
      }
    >
      <BookingsPanel />
    </AccountShell>
  );
}
