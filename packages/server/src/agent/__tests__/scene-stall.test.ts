import { describe, expect, it, vi } from "vitest";
import type { AgentRuntimeInput, CommittedEvent } from "@perfectman/shared";
import { PromptBuilder } from "../prompt-builder.js";
import { EXAMPLE_PROMPT_PROFILE } from "../persona-prompt-profile.js";
import { MAX_NEW_ANCHORS, sceneStalled, stallNote, stallNoteFor } from "../scene-stall.js";
import { ActionIntentStep } from "../surface/action-intent-step.js";
import type { StepRunContext } from "../surface/llm-step.js";
import type { GuardKind } from "../repetition-guard.js";
import { hotelInput, humanLine } from "./hotel-test-helpers.js";
import { NORMAL } from "./fixtures/ptbr-lines.js";

const profile = { ...EXAMPLE_PROMPT_PROFILE, language: "pt-BR" as const, hotelMode: true, relationshipBiases: {}, messageLength: "short" as const };

const cast = (n: number, actorId: string, content: string, extra: Record<string, unknown> = {}): CommittedEvent => ({
  ...humanLine(content, "Duda"),
  id: `evt-${n}`,
  actorId,
  payload: { content, senderName: actorId, ...extra },
  pulseIndex: n,
});

/** Run 55's shape: the scene is set up in four lines, then three actors say them again for 90 seconds. */
const SETUP = [
  "Senta os dois aqui, vamos resolver isso agora.",
  "Dois minutos, só dois minutos, eu juro.",
  "O próximo passo é você abrir o envelope.",
  "Aposto que você não aguenta abrir.",
];
const LOOP = [
  "Senta os dois, vamos resolver isso agora.",
  "Dois minutos, eu juro, só dois minutos.",
  "O próximo passo é abrir o envelope.",
  "Aposto que você não aguenta.",
];
const MOVING = [
  "Achei o recibo de 4.500 reais na gaveta do Otávio.",
  "A Heloísa assinou como testemunha e depois sumiu para Curitiba.",
  "Esse cofre azul não abre com a chave que o Cooper me deu.",
  "Quem trocou a fechadura foi o seu primo Rogério, não eu.",
];

function room(lines: readonly string[], extraOf: (i: number) => Record<string, unknown> = () => ({})): CommittedEvent[] {
  return lines.map((text, i) => cast(i + 1, `actor-${i % 3}`, text, extraOf(i)));
}

function dramaInput(events: CommittedEvent[], mutate?: (i: AgentRuntimeInput) => void): AgentRuntimeInput {
  const input = hotelInput(events);
  input.perceptionPacket.triggeringEvent = events.at(-1) ?? null;
  input.perceptionPacket.body = { ...input.perceptionPacket.body!, drama: true };
  mutate?.(input);
  return input;
}

describe("scene stall", () => {
  it("run 55: three actors going over the same four lines is a stall", () => {
    const input = dramaInput(room([...SETUP, ...LOOP]));
    expect(sceneStalled(input.perceptionPacket)).toBe(true);
    expect(stallNoteFor(input, "pt-BR")).toBe(stallNote("pt-BR"));
  });

  it("no window of ordinary conversation is a stall (121 windows of 12 lines)", () => {
    const stalled: number[] = [];
    for (let end = 8; end <= NORMAL.length; end++) {
      const events = room(NORMAL.slice(Math.max(0, end - 12), end));
      if (sceneStalled({ triggeringEvent: events.at(-1) ?? null, visibleContextEvents: events })) stalled.push(end);
    }
    expect(stalled).toEqual([]);
  });

  it("a scene that keeps bringing a name, a number or an object is not stalled", () => {
    expect(sceneStalled(dramaInput(room([...SETUP, ...MOVING])).perceptionPacket)).toBe(false);
  });

  it("the threshold is at most two new anchors in the newest four lines", () => {
    expect(MAX_NEW_ANCHORS).toBe(2);
    const oneNew = [...LOOP.slice(0, 3), "Aposto que você não aguenta, Heloísa."];
    expect(sceneStalled(dramaInput(room([...SETUP, ...oneNew])).perceptionPacket)).toBe(true);
  });

  it("is not called on a young scene: fewer than seven lines in view (4 judged, 3 of history)", () => {
    expect(sceneStalled(dramaInput(room([...SETUP.slice(0, 2), ...LOOP])).perceptionPacket)).toBe(false);
  });

  it("a person's line in the newest four lines, or something that moved, ends it", () => {
    const withGuest = room([...SETUP, ...LOOP], (i) => (i === 6 ? { untrusted: true, senderName: "Visitante" } : {}));
    expect(sceneStalled(dramaInput(withGuest).perceptionPacket)).toBe(false);
    const moved = dramaInput(room([...SETUP, ...LOOP]), (i) => {
      i.perceptionPacket.body = { ...i.perceptionPacket.body!, changes: [{ kind: "gesture", name: "Duda", a: "wave" }] };
    });
    expect(sceneStalled(moved.perceptionPacket)).toBe(false);
  });

  it("whispers and private lines are not part of what the room said", () => {
    const events = room([...SETUP, ...LOOP], (i) => (i >= 4 ? { mode: "whisper" } : {}));
    expect(sceneStalled(dramaInput(events).perceptionPacket)).toBe(false);
  });

  it("adds no line outside drama hotel runs, on a whisper to the actor, or on a line a person aimed at it", () => {
    const events = room([...SETUP, ...LOOP]);
    const input = dramaInput(events);
    expect(stallNoteFor(input, "pt-BR")).toBe(stallNote("pt-BR"));
    const plain = dramaInput(events, (i) => {
      i.perceptionPacket.body = { ...i.perceptionPacket.body!, drama: undefined as never };
    });
    expect(stallNoteFor(plain, "pt-BR")).toBeUndefined();
    const aimed = dramaInput([...events.slice(0, -1), cast(8, "h:42", "Agent, o que você acha?", { untrusted: true, addresseeIds: ["example-friend"] })]);
    expect(stallNoteFor(aimed, "pt-BR")).toBeUndefined();
  });

  it("is one short line in the profile's language that names the moves", () => {
    expect(stallNote("pt-BR")).toMatch(/revele algo, acuse alguém, recuse dando um motivo, vá embora ou toque/);
    expect(stallNote("en")).toMatch(/reveal something, accuse someone, refuse and say why, leave, or touch/);
    expect(stallNote("pt-BR").length).toBeLessThan(300);
  });
});

describe("the nudge in the prompts", () => {
  const stalled = (): AgentRuntimeInput => dramaInput(room([...SETUP, ...LOOP]));
  const moving = (): AgentRuntimeInput => dramaInput(room([...SETUP, ...MOVING]));

  it("reaches the compact and the full decision when the scene is stalled, and neither when it moves", () => {
    for (const style of ["compact", "full"] as const) {
      const on = PromptBuilder.build(stalled(), profile, "action_intent", undefined, style);
      const off = PromptBuilder.build(moving(), profile, "action_intent", undefined, style);
      expect(on.user, style).toContain(stallNote("pt-BR"));
      expect(on.stallNudged, style).toBe(true);
      expect(off.user, style).not.toContain(stallNote("pt-BR"));
      expect(off.stallNudged, style).toBeUndefined();
    }
  });

  it("sits once inside the decision, and the template version does not move", () => {
    for (const style of ["compact", "full"] as const) {
      const on = PromptBuilder.build(stalled(), profile, "action_intent", undefined, style);
      const at = on.user.indexOf(stallNote("pt-BR"));
      expect(at, style).toBeGreaterThan(on.user.indexOf("Decide now"));
      expect(on.user.indexOf(stallNote("pt-BR"), at + 1), style).toBe(-1);
      expect(on.templateVersion, style).toBe(PromptBuilder.build(moving(), profile, "action_intent", undefined, style).templateVersion);
    }
  });

  it("is counted once per prompt through the policy's hook, and only when stalled", () => {
    const seen: GuardKind[] = [];
    const ctx = (): StepRunContext => ({
      now: 1,
      pulseIndex: 1,
      provider: { generateIntent: vi.fn() } as StepRunContext["provider"],
      llmConfig: { modelName: "m", temperature: 1, promptStyle: "compact" } as StepRunContext["llmConfig"],
      profile,
      repetitionPolicy: { onGuard: (k) => seen.push(k) },
    });
    new ActionIntentStep().render(moving(), ctx());
    expect(seen).toEqual([]);
    new ActionIntentStep().render(stalled(), ctx());
    expect(seen).toEqual(["stall_nudge"]);
  });
});
