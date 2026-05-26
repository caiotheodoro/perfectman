# Perfectman: Peer-Perception Conversation Guide

Use this guide for a relaxed conversation about how someone in the group perceives another person in chat and in real life. It is based on a practical hybrid model of personality: Big Five, HEXACO, Interpersonal Circumplex, affective style, values, and light attachment patterns.

The goal is not to write a formal biography. The goal is to capture real peer perception: how the target is read by friends, what behaviors they trigger in others, and what behavioral parameters should be preserved in the simulation.

Use this together with [`solo-questionnaire.md`](solo-questionnaire.md), where the target person describes themselves.

---

## Privacy guidelines

These notes are local material and must not be committed to the repository.

Before saving:

- Save real answers only in gitignored paths such as `config/persona-notes/`, `config/personas/`, or `docs/personas/<agent-id>/`.
- Prefer paraphrased or summarized examples instead of literal private conversations.
- Do not include personal data, passwords, heavy secrets, or anything unrelated to the chat simulation.
- Mark highly sensitive material as `exclude_from_prompt` so the AI does not receive it.
- Capture behavioral patterns; do not expose people.

---

## Conversation style

Keep the conversation light, short, and concrete. Ask for specific examples. If the friend gives a generic answer, ask:

> “How would that appear in chat? What would they actually type?”

Suggested time: 25–35 minutes per person.

---

# Part 1 — Full conversation script

> “I’m mapping our group chat dynamics so we can calibrate AI personas for the simulation. I want to understand how **you** see [Target Friend]: their typing habits, group reactions, triggers, and how they act with different people. You can speak openly. We will paraphrase sensitive stories before saving anything.”

Use a 1–7 scale for the numbered questions:

```text
1 = very low / almost never
4 = medium / depends
7 = very high / very characteristic
? = I do not know / I have not observed this
```

## A. Agency and dominance

Measures public activity, initiative, attention-seeking, and control of conversation rhythm.

1. **Public activity:** from quiet lurker (1) to dominates the chat all day (7), how active are they in the main group?
2. **Taking space:** from waits politely (1) to interrupts or redirects the conversation toward themselves (7), how competitive are they for attention?
3. **Typing layout:** from one long careful block (1) to many rapid one-line messages (7), how do they usually type?
4. **Attention-seeking:** from stays in the background (1) to sends spicy takes, memes, or drama to make the chat revolve around them (7), how much do they seek the spotlight?
5. **Open example:** remember a time when the group was dead and this person revived the chat. What exactly did they send?

## B. Warmth and support

Measures agreeableness, emotional warmth, support style, and default mood.

6. **Emotional warmth:** from dry/cold/highly ironic (1) to very warm/expressive/supportive (7), how warm are they in chat?
7. **Reaction to venting:** from practical/cold advice (1) to deep emotional validation (7), how do they react when someone vents?
8. **Handling teasing:** from gets defensive quickly (1) to fully joins the joke and laughs at themselves (7), how do they handle being teased?
9. **Including quiet people:** from ignores quiet people (1) to quickly pulls them back into the conversation (7), how much do they include others?
10. **Open example:** how do they show they like or care about someone without saying it in a sentimental way?

## C. Alliances and private DMs

Measures transparency, gossip, private coordination, status, and public/private differences.

11. **Gossip radar:** from avoids gossip (1) to knows everything and shares it privately (7), how gossip-oriented are they?
12. **Social mask:** from fully transparent (1) to hides hurt behind jokes or a calm public mask (7), how much do they mask emotions?
13. **Private coordination:** from never opens DMs during group chat (1) to runs several parallel private conversations (7), how active are they privately?
14. **Vanity/status:** from avoids bragging (1) to likes showing achievements or fishing for praise (7), how status-oriented are they?
15. **Open example:** when they DM you during a heated public topic, what do they usually say and what is their real intention?

## D. Emotional reactivity and attachment

Measures emotional stability, exclusion sensitivity, anger expression, and recovery.

16. **Mood volatility:** from unshakeable (1) to mood changes from one message or reaction (7), how volatile are they?
17. **Sensitivity to silence:** from does not care if ignored (1) to shuts down after being ignored (7), how much does silence affect them?
18. **Anger expression:** from explodes publicly (1) to becomes cold, silent, or one-worded (7), how do they show anger?
19. **Recovery time:** from repairs and forgets quickly (1) to holds tension for days (7), how long do they take to return to normal?
20. **Open example:** what are their biggest chat triggers: contradiction, personal jokes, exclusion, status loss, lack of attention, criticism, or something else?

## E. Boredom and stimulation

Measures boredom sensitivity, need for stimulation, and lurking behavior.

21. **Need for activity:** from fine with a silent group for days (1) to cannot tolerate a dead chat (7), how impatient are they with boredom?
22. **Boredom behavior:** from disappears silently (1) to sends absurd questions, provocations, or old gossip to restart the chat (7), what do they do when bored?
23. **Lurking:** from only opens chat to send messages (1) to reads everything silently (7), how much do they lurk?
24. **Open example:** what is the strangest or most random message they sent purely because they were bored?

---

# Part 2 — Short high-signal version

Use this if you only have 10 minutes.

## 6 ratings

1. **Activity level:** quiet lurker (1) → chat-dominating spammer (7).
2. **Default mood:** dry/ironic/cynical (1) → warm/expressive/supportive (7).
3. **Short fuse:** calm and unshakeable (1) → highly volatile (7).
4. **Silence sensitivity:** laughs it off (1) → gets hurt, closes off, or disappears (7).
5. **Private DM coordination:** never (1) → frequent parallel DMs/gossip/alliances (7).
6. **Boredom reaction:** disappears (1) → provokes or sends random things to move the chat (7).

## 6 spoken questions

7. **Writing habits:** what are their 2–3 most obvious typing habits?
8. **Classic line:** give me a short paraphrased message that would sound exactly like them.
9. **When upset:** how do people tell the difference between playful teasing and real hurt?
10. **Repair:** when they make the mood bad or hurt someone, how do they fix it?
11. **Typical DM:** when they DM you during group chaos, what is the vibe of the message?
12. **Never say:** what phrase would they never type because it would sound formal, fake, or unlike them?

---

# Part 3 — Translating answers for development

## Cleaning and contradictions

- Close friends may classify harsh teasing as warmth. If friends disagree, model relationship-specific warmth instead of averaging everything.
- Public and private behavior may differ sharply. Use public answers for group-channel behavior and private answers for DM behavior.
- Treat every answer as evidence, not truth. Prefer concrete examples over labels.

## Draft mapping to `PersonaConfig`

```text
baselineArousal ≈ public activity and taking-space ratings
baselineValence ≈ emotional warmth rating
stability ≈ inverse of mood volatility
exclusionSensitivity ≈ silence sensitivity rating
boredomSensitivity ≈ boredom reaction rating
privateChannelLikelihood ≈ private coordination rating
```

## Mapping to `PersonaPromptProfile`

Use open answers to fill:

- `identityFrame` — who the person is socially, what they seek, what they avoid, and how they react under pressure.
- `voiceGuidelines` — typing habits, message length, punctuation, slang, humor, emojis, and formality.
- `styleExamples` — sanitized/paraphrased messages that sound like them.
- `relationshipBiases` — how they see, trust, avoid, protect, tease, or compete with each specific person.
- `hardAvoids` — things the AI must never say, reveal, or imitate.

## Privacy reminder

Do not put raw friend stories, private DMs, screenshots, or sensitive secrets into runtime prompts. Compile only safe behavioral summaries.
