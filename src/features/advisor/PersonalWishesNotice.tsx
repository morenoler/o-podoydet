import { MessageCircleQuestion } from "lucide-react";
import { Link } from "react-router-dom";
import type { PersonalWishes } from "../../../shared/types";
import { personalWishNotice } from "../../shared/lib/personalWishes";

export function PersonalWishesNotice({ wishes, hasText }: { wishes?: PersonalWishes; hasText: boolean }) {
  const notice = personalWishNotice(wishes, hasText);
  if (!notice) return null;
  return (
    <div className="advisor-personal-wishes" role="status">
      <MessageCircleQuestion size={22} aria-hidden="true" />
      <div>
        <h3>{notice.title}</h3>
        <p>{notice.message}</p>
        {wishes?.status === "unrecognized" && <Link to="/wishes">Уточнить пожелание</Link>}
      </div>
    </div>
  );
}
