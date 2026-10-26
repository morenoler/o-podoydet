import type {
  AnswerClarification,
  AskClarification,
  ListingClarification,
} from "../../../shared/clarifications";
import { api } from "../../shared/api/client";

export const clarificationApi = {
  ask: (listingId: string, input: AskClarification) =>
    api<ListingClarification>(
      `/listings/${encodeURIComponent(listingId)}/clarifications`,
      input,
    ),
  answer: (id: string, input: AnswerClarification) =>
    api<ListingClarification>(
      `/host/clarifications/${encodeURIComponent(id)}/answers`,
      input,
    ),
};
