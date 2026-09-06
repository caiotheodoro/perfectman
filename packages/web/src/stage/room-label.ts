/**
 * What to call a room.
 *
 * A channel an agent opens mid-run is named by the engine, and that name is an
 * id — `Bk1u4NORDRAIyZFCMFJRF` is not something to put on screen. A private
 * room is best identified by who is in it anyway: "Iris and Marcela" says
 * everything the name was for, and keeps working when the id is meaningless.
 *
 * Public channels keep their authored name, because someone chose it.
 */
import type { LiveChannel } from "@perfectman/shared";

export type NamedAgent = { id: string; displayName: string };

export function roomLabel(channel: LiveChannel | undefined, agents: readonly NamedAgent[]): string {
  if (!channel) return "somewhere";
  if (channel.type !== "private_channel") return channel.name || channel.id;

  const names = channel.memberAgentIds
    .map((id) => agents.find((a) => a.id === id)?.displayName)
    .filter((name): name is string => Boolean(name));

  if (names.length === 0) return looksLikeId(channel.name) ? "a private channel" : channel.name;
  if (names.length === 1) return `${names[0]} alone`;
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** Engine-minted ids are long, unbroken and mixed-case. Authored names are not. */
function looksLikeId(name: string): boolean {
  return /^[A-Za-z0-9_-]{16,}$/.test(name) && /[a-z]/.test(name) && /[A-Z]/.test(name);
}
