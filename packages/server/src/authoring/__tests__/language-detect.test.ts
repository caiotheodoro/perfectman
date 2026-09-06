import { describe, expect, it } from "vitest";
import { detectLanguage, resolveLanguage } from "../language-detect.js";
import { fold, nearestHeading } from "../diagnostics.js";

const PT_SAMPLE =
  "Você é a pessoa que segura o clima da sala. Quando alguém levanta a voz, você muda de assunto com uma piada, porque não suporta ver o grupo brigando.";
const EN_SAMPLE =
  "You are the one who holds the room together. When someone raises their voice you change the subject with a joke, because you cannot stand watching the group fight.";

describe("detectLanguage", () => {
  it("detects Portuguese prose", () => {
    const result = detectLanguage(PT_SAMPLE);
    expect(result.language).toBe("pt-BR");
    expect(result.confidence).toBeGreaterThan(0.5);
  });

  it("detects English prose", () => {
    const result = detectLanguage(EN_SAMPLE);
    expect(result.language).toBe("en");
    expect(result.confidence).toBeGreaterThan(0.5);
  });

  it("is deterministic", () => {
    expect(detectLanguage(PT_SAMPLE)).toEqual(detectLanguage(PT_SAMPLE));
  });

  it("falls back to en on empty input rather than failing", () => {
    expect(detectLanguage("")).toMatchObject({ language: "en", confidence: 0, markers: [] });
  });

  it("does not flip an English file because it quotes one accented word", () => {
    const mostlyEnglish = `${EN_SAMPLE} ${EN_SAMPLE} She once said "não" and left.`;
    expect(detectLanguage(mostlyEnglish).language).toBe("en");
  });

  it("reports the markers it matched, so the UI can show its work", () => {
    expect(detectLanguage(PT_SAMPLE).markers.length).toBeGreaterThan(0);
  });

  it("is not fooled by topic words — Portuguese nouns in English prose", () => {
    expect(detectLanguage("They danced samba and ate feijoada at the party with their friends.").language).toBe(
      "en",
    );
  });
});

describe("resolveLanguage", () => {
  it("prefers an explicit frontmatter value over detection", () => {
    const result = resolveLanguage({ explicit: "en", proseForDetection: PT_SAMPLE });
    expect(result).toMatchObject({ language: "en", source: "frontmatter", confidence: 1 });
  });

  it("prefers a UI override over frontmatter", () => {
    const result = resolveLanguage({ explicit: "pt-BR", override: "en", proseForDetection: PT_SAMPLE });
    expect(result).toMatchObject({ language: "en", source: "override" });
  });

  it("detects when nothing is declared", () => {
    expect(resolveLanguage({ proseForDetection: PT_SAMPLE })).toMatchObject({
      language: "pt-BR",
      source: "heuristic",
    });
  });

  it("flags an unsupported explicit value instead of silently ignoring it", () => {
    const result = resolveLanguage({ explicit: "portuguese", proseForDetection: PT_SAMPLE });
    expect(result.invalidExplicit).toBe("portuguese");
    expect(result.source).toBe("heuristic");
    expect(result.language).toBe("pt-BR");
  });
});

describe("heading helpers", () => {
  it("folds accents and case so Memórias matches memorias", () => {
    expect(fold("Memórias")).toBe("memorias");
  });

  it("suggests the nearest known heading for a typo", () => {
    expect(nearestHeading("Style Exmples", ["style examples", "voice", "identity"])).toBe("style examples");
  });

  it("suggests nothing when the heading is not close to anything known", () => {
    expect(nearestHeading("Soundtrack", ["style examples", "voice", "identity"])).toBeUndefined();
  });
});
