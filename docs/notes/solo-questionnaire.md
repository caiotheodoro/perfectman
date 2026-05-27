# Perfectman: Solo Self-Interview Guide

Use this guide for a sincere conversation with the target person about themselves in chat and in real life. It is based on a practical hybrid model of personality: Big Five, HEXACO, Interpersonal Circumplex, affective style, values, and light attachment patterns.

The goal is not to treat self-description as absolute truth. The goal is to capture self-perception: how the person thinks they act, how they believe others see them, what they try to hide, and what they want the AI simulation to preserve or avoid.

Use this together with [`friend-questionnaire.md`](friend-questionnaire.md), which captures how peers see the same person.

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

Keep the tone casual and concrete. The best answers are short examples: actual situations, message styles, reactions, and relationship differences.

Suggested time: 30–40 minutes.

---

# Part 1 — Full self-image script

Use a 1–7 scale for the numbered questions:

```text
1 = very low / almost never
4 = medium / depends
7 = very high / very characteristic
? = I do not know
```

## A. Agency and dominance

1. **Public activity:** from quiet lurker (1) to dominates the chat all day (7), how active do you think you are in the main group?
2. **Taking space:** from waits politely (1) to interrupts or redirects the conversation toward yourself (7), how competitive are you for attention?
3. **Typing layout:** from one long careful block (1) to many rapid one-line messages (7), what is your normal typing layout?
4. **Attention-seeking:** from stays in the background (1) to sends spicy takes, memes, or drama to make the chat revolve around you (7), how much do you seek the spotlight?
5. **Open question:** what parts of your real personality become exaggerated, more intense, or more caricatured when you type in the group chat?

## B. Warmth and support

6. **Emotional warmth:** from dry/cold/highly ironic (1) to very warm/expressive/supportive (7), how warm do you try to be in chat?
7. **Reaction to venting:** from practical/cold advice (1) to deep emotional validation (7), how do you behave when someone vents to you?
8. **Handling teasing:** from gets defensive quickly (1) to fully joins the joke and laughs at yourself (7), how do you handle jokes at your expense?
9. **Including quiet people:** from only talks to favorites (1) to quickly pulls quiet people back into the conversation (7), how much do you try to include others?
10. **Open question:** give 3 practical examples of messages you would send to support a close friend without sounding too sentimental or exposed.

## C. Alliances and private DMs

11. **Interest in secrets:** from avoids gossip (1) to wants to know everything and share it privately (7), how interested are you in private information?
12. **Social mask:** from fully transparent (1) to hides hurt behind jokes or a calm public mask (7), how much do you hide your real feelings?
13. **Private coordination:** from never opens DMs during group chat (1) to runs several parallel private conversations (7), how active are you privately?
14. **Vanity/status:** from avoids bragging (1) to likes showing achievements or fishing for praise (7), how much do you like inflating your ego?
15. **Open question:** what do you say in private DMs that you would never type publicly in the group? What is the biggest difference?

## D. Emotional reactivity and attachment

16. **Mood volatility:** from unshakeable (1) to mood changes from one reaction or silence (7), how volatile are you?
17. **Sensitivity to silence:** from does not care if ignored (1) to shuts down after being ignored (7), how much does silence affect you?
18. **Anger expression:** from explodes publicly (1) to becomes completely silent/cold (7), how do you show real anger?
19. **Recovery time:** from repairs and forgets quickly (1) to holds tension for days (7), how long do you take to return to normal?
20. **Open question:** what are your biggest chat triggers: contradiction, status loss, personal jokes, exclusion, uneven attention, criticism, or something else?

## E. Boredom and stimulation

21. **Need for activity:** from fine with a silent group for days (1) to cannot tolerate a dead chat (7), how impatient are you with silence?
22. **Boredom behavior:** from disappears silently (1) to sends absurd questions, provocations, or old gossip to restart the chat (7), what do you do when bored?
23. **Lurking:** from only opens chat to send messages (1) to reads everything silently (7), how much do you lurk?
24. **Open question:** what do you often want to send publicly but delete before sending? What stops you?

---

# Part 2 — Short high-signal version

Use this if you only have 10 minutes.

## 6 ratings

1. **Activity level:** quiet lurker (1) → chat-dominating sender (7).
2. **Default mood:** dry/ironic/cynical (1) → warm/expressive/supportive (7).
3. **Short fuse:** calm and unshakeable (1) → highly volatile (7).
4. **Silence sensitivity:** laughs it off (1) → gets hurt, closes off, or disappears (7).
5. **Private DM coordination:** never (1) → frequent parallel DMs/gossip/alliances (7).
6. **Boredom reaction:** disappears (1) → sends jokes or provocations to move the chat (7).

## 6 spoken questions

7. **My writing habits:** what are my 2–3 most obvious typing habits?
8. **My classic line:** give me a short message that sounds exactly like something I would send.
9. **When I am upset:** how can a friend tell when I moved from playful joking to real hurt or anger?
10. **Repair:** when I make the mood tense or hurt someone, what do I usually do to fix it?
11. **Fake AI:** what should my AI persona never say because it would sound artificial, too correct, or completely unlike me?
12. **DM trigger:** what makes me want to DM someone immediately instead of replying publicly in the group?

---

# Part 3 — Translating answers for development

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

Do not put raw self-interview material, private DMs, screenshots, or sensitive secrets into runtime prompts. Compile only safe behavioral summaries.
