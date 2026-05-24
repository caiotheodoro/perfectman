# Perfectman: Peer-Description Voice Interview Guide

This guide is for **peer-description voice interviews**: asking each group member how they perceive another person in the chat.

Example: ask Bruno what he thinks of Goulart, Caio what he thinks of Goulart, and so on. The goal is not an objective biography. The goal is to collect **peer perception**: how the target is read by specific friends, what behavior they trigger, and what social biases should inform the simulation.

Use this alongside [`solo-questionnaire.md`](solo-questionnaire.md), which captures the target person's self-perception.

## Privacy and repo guidance

These notes may eventually be committed to the repo and may preserve real names. Before committing:

- Prefer sanitized/paraphrased examples over raw private quotes.
- Do not include addresses, phone numbers, passwords, private secrets, medical/legal/financial details, or anything that should not affect simulation behavior.
- Mark sensitive stories as `exclude_from_prompt` instead of putting them into runtime prompt material.
- Preserve the behavioral pattern, not the most invasive detail.

## Interview style

Keep the interview casual and short. Ask for concrete examples, not abstract labels. If the speaker gives a generic answer, follow with: "What would that look like in chat?"

Target length: 20-30 minutes per target person.

## Part 1: Peer interview script

> ### Calibrating [Target Friend's Name]
>
> "I'm mapping our group's chat dynamics into AI personas for a socket-chat simulation. I want how *you* perceive [Target Friend] — their quirks, patterns, and how they behave with different people. You can use real names, but we'll sanitize or paraphrase sensitive examples before committing anything."

### 1. Default vibe and presence

- If you had to describe [Target Friend]'s default group-chat vibe in three words, what would they be?
- When they enter the chat, does the room feel louder, warmer, tenser, funnier, more chaotic, or basically unchanged?
- Are they usually high-energy and reactive, or quieter and selective?
- Is their tone usually warm/supportive, dry/sarcastic, serious, indifferent, provocative, or something else?
- Does their mood swing depending on who is online, or are they stable regardless of the room?

### 2. Chat cadence, attention, and silence

- How do they type: many short messages, one careful paragraph, audio-like rambling, memes, reactions, or mostly lurking?
- What makes them pay attention and reply immediately?
- What makes them get bored or disappear?
- When they go silent, what does it usually mean: busy, bored, annoyed, hurt, judging, avoiding conflict, or something else?
- If they are ignored, do they chase attention, joke it off, withdraw, get passive-aggressive, DM someone, or not care?

### 3. Voice, tells, and examples

- What are their signature texting tells: lowercase, punctuation, emojis, ALL-CAPS, typos, abbreviations, repeated phrases, rhythm?
- Give 3-5 short paraphrased messages they might send when excited.
- Give 3-5 short paraphrased messages they might send when annoyed or bored.
- Give 1 example of a message that instantly sounds like them.
- What should their AI persona avoid saying because it would sound unlike them?

### 4. Conflict, shame, jealousy, and repair

- What happens if someone makes a slightly mean public joke at their expense?
- What makes them feel embarrassed, exposed, replaced, or second-choice?
- Do they mask hurt in public? If yes, how can you tell?
- When they hurt someone or create tension, how do they repair it: apologize, joke, DM privately, pretend nothing happened, disappear, or double down?
- What is the difference between them being playfully mean and actually upset?

### 5. Affection, loyalty, and care

- How do they show they care without saying it directly?
- Who brings out their softer, funnier, meaner, quieter, or most chaotic side?
- What kind of attention from others makes them feel included?
- What kind of joke or teasing do they usually accept well?
- What kind of joke crosses a line for them?

### 6. Peer-specific relationship dynamics

Ask these about the speaker's relationship with the target, then repeat for other important friends if useful:

- How does [Target Friend] behave differently with you compared to the rest of the group?
- What do they usually come to you for: gossip, comfort, alliance, logistics, jokes, validation, debate, help?
- What do you think they privately think about you?
- What do you think they misunderstand about you?
- Which friend do they most often seek, avoid, provoke, protect, envy, or compete with?

### 7. Public channel vs private DM

- Are they different in private DMs than in public channels?
- In DMs, are they warmer, more vulnerable, meaner, more strategic, more anxious, or basically the same?
- During public drama, do they open side DMs? With whom, and why?
- What is their usual side-DM motive: gossip, checking if someone agrees, venting, comfort, alliance-building, flirting, repair, or logistics?

### 8. Useful final examples

Ask for quick scenario responses. Paraphrases are enough.

- Someone ignores their message in a fast-moving chat. What do they do?
- Someone they like replies warmly to someone else but not to them. What do they do?
- A friend posts a bad take. What do they do?
- A conflict gets too tense. What do they do?
- The room is dead and boring. What do they do?

## Part 2: Aggregating peer reviews

Aggregate peer reviews into two separate outputs:

1. **Dev3 engine calibration hints** — energy, valence, stability, sensitivity, conflict tolerance. These may inform `PersonaConfig`, but should not be copied directly without review.
2. **Dev1 prompt profile material** — voice, style examples, relationship biases, self/peer perception summaries. These may inform `PersonaPromptProfile`, but should stay compact.

### Engine calibration hints

Use peer consensus as weak evidence, not automatic scoring.

- High energy / fast spam / reactive → higher arousal baseline.
- Slow / quiet / careful / lurking → lower arousal baseline.
- Warm / inclusive / optimistic → higher valence baseline.
- Dry / cynical / passive-aggressive → lower valence baseline.
- Easily triggered / mood swings → lower stability.
- Calm / unshakable / rarely reacts → higher stability.
- Hates embarrassment → higher humiliation sensitivity.
- Hates being ignored or excluded → higher exclusion sensitivity.
- Loves debate or stirs conflict → higher conflict drive.
- Avoids tension or logs off → stronger conflict inhibition.

### Prompt profile material

Do not paste the entire interview into `persona-prompt-profile.ts`. Summarize only what the LLM needs at runtime:

```typescript
export const GOULART_PROMPT_PROFILE: PersonaPromptProfile = {
  personaId: "goulart",
  displayName: "Goulart",
  identityFrame: "Compact summary of how Goulart tends to show up in chat.",
  voiceGuidelines: [
    "Specific texting quirks and rhythm.",
    "Specific public/private behavior constraints."
  ],
  styleExamples: [
    "Short sanitized/paraphrased examples only."
  ],
  relationshipBiases: {
    bruno: "How Goulart tends to read and respond to Bruno, informed by self + peer perception."
  },
  language: "pt-BR"
};
```

## Minimal recorder notes template

```text
Target:
Speaker:
Date:
Sensitivity: safe | review_before_commit | exclude_from_prompt

Default vibe:
Chat cadence and silence:
Voice/tells/examples:
Conflict/shame/repair:
Affection/care:
Peer-specific dynamics:
Public vs private:
Useful paraphrased examples:
Do-not-use sensitive material:
```
