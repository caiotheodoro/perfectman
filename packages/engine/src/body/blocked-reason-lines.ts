import type { BlockedReason } from "@perfectman/shared";
import { quoteText, type BodyLanguage } from "../space/text.js";

/**
 * One natural-language "blocked" line per reason for the next pulse
 * (embodiment.md 6.2). Reasons the table marks "not shown" return undefined.
 * Names and labels in `ref` / `detail` are quoted (ADR-0023).
 */
export function blockedReasonLine(reason: BlockedReason, language: BodyLanguage): string | undefined {
  const pt = language === "pt-BR";
  const ref = reason.ref !== undefined ? quoteText(reason.ref) : undefined;
  const detail = reason.detail !== undefined ? quoteText(reason.detail) : undefined;
  switch (reason.code) {
    case "unknown_ref":
      return pt ? "Não achei quem/o que você quis dizer." : "You could not find who or what you meant.";
    case "target_elsewhere":
      return pt ? `${ref ?? "Essa pessoa"} não está mais aqui.` : `${ref ?? "That person"} is not here anymore.`;
    case "seat_taken":
      return pt
        ? `O lugar${ref ? ` (${ref})` : ""} estava ocupado${detail ? ` (${detail})` : ""}.`
        : `The seat${ref ? ` (${ref})` : ""} was taken${detail ? ` (${detail})` : ""}.`;
    case "no_route":
      return pt ? "Não dá pra chegar lá." : "There is no way to get there.";
    case "busy_moving":
      return pt ? "Você ainda está a caminho." : "You are still on your way.";
    case "not_a_seat":
      return pt ? "Isso não é um lugar pra sentar." : "That is not somewhere to sit.";
    case "room_unreachable":
      return pt ? "Não dá pra ir pra lá agora." : "You cannot go there right now.";
    case "stale_space":
      return pt ? "Você não está enxergando direito agora." : "You cannot see clearly right now.";
    case "not_in_earshot":
      return pt
        ? `Você chegou, mas ${ref ?? "a pessoa"} já tinha saído.`
        : `You got there, but ${ref ?? "they"} had already left.`;
    case "slow_down":
    case "too_far":
    case "cooldown":
      return undefined;
  }
}
