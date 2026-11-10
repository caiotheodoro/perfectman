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
    // An act the ladder refused for want of a motive or a grievance is not yet earned (errata P7): told so, with what would earn it. A skipped rung, a cast that already
    // has too many at each other's throats and a blow nobody would see (errata P8) are told too. The ceiling (`max_rung`) stays unshown: the director decides it.
    case "ladder":
      if (reason.detail === "motive") {
        return pt
          ? `Ainda não dá pra partir pra cima de ${ref ?? "essa pessoa"}: falta provocação. Uma ofensa direta com o nome da pessoa esquenta. Um passo de cada vez.`
          : `It is not earned yet to go for ${ref ?? "that person"}: nothing has pushed you that far. A direct insult that names them heats it up. One step at a time.`;
      }
      if (reason.detail === "grievance") {
        return pt
          ? `Você ainda não tem motivo claro contra ${ref ?? "essa pessoa"}. Uma ameaça ou acusação na cara, com o nome da pessoa, cria o motivo.`
          : `You have no clear grievance against ${ref ?? "that person"} yet. A threat or an accusation to their face, using their name, builds one.`;
      }
      if (reason.detail === "rung") {
        return pt
          ? `Um passo de cada vez com ${ref ?? "essa pessoa"}: antes um olhar ou uma ofensa.`
          : `One step at a time with ${ref ?? "that person"}: a look or a sharp word first.`;
      }
      if (reason.detail === "zero_witness") {
        return pt
          ? `Não com ninguém olhando: sem plateia por perto, você não parte pra cima de ${ref ?? "essa pessoa"}.`
          : `Not with nobody watching: without someone close enough to see it, you do not go for ${ref ?? "that person"}.`;
      }
      if (reason.detail === "contagion") {
        return pt
          ? `A sala já está pegando fogo: espere o clima baixar antes de partir pra cima de ${ref ?? "essa pessoa"}.`
          : `The room is already on fire: wait for it to cool before going for ${ref ?? "that person"}.`;
      }
      return undefined;
    case "slow_down":
    case "too_far":
    case "cooldown":
    // The act contract's reasons come from the hotel or the director's veto; the model is never told them as text.
    case "kill_switch":
    case "calm_room":
    case "consent_off":
    case "budget":
    case "dead_target":
    case "no_scenario_gate":
    case "rate_limit":
      return undefined;
  }
}
