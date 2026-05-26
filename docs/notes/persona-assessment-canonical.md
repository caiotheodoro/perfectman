# Perfectman: Canonical Questionnaire for Understanding a Person

This is the canonical guide for understanding a person and turning that understanding into useful AI persona material for Perfectman.

The primary goal is to understand the person as a whole: temperament, motivations, values, insecurities, humor, relationships, conflict patterns, affection, social energy, and ways of reacting to the world. Chat behavior is only one practical manifestation of that personality. It matters for simulation, but it is not the whole interview.

This is not a psychological diagnosis, clinical test, moral evaluation, or HR tool. It is a practical instrument for capturing observable human patterns and translating them into AI behavior.

Use this file as the main source. The files below remain useful as supporting material:

- [`personality-assessment-research.md`](personality-assessment-research.md) — research basis and references.
- [`friend-questionnaire.md`](friend-questionnaire.md) — informal peer-perception interview script.
- [`solo-questionnaire.md`](solo-questionnaire.md) — informal self-interview script.

---

## Methodological decision

For Perfectman, the right approach is a practical hybrid model:

1. **Big Five / IPIP / BFI-2 as the backbone**
   Helps observe social energy, cooperation, emotional stability, organization, and openness to experience.

2. **Interpersonal Circumplex as the social layer**
   Helps understand how the person positions themselves with others: dominant vs. passive, warm vs. cold, conciliatory vs. confrontational.

3. **HEXACO as a careful complement**
   Helps observe directness, humility, vanity, fairness, status-seeking, and the relationship with truth/convenience. It must not become moral judgment.

4. **Personal values as the motivational layer**
   Helps answer: “what does this person protect?”, “what do they seek?”, “what do they avoid?”, “what would they fight for?”.

5. **Adult attachment as a light relational lens**
   Helps observe rejection, silence, jealousy, validation, avoidance, vulnerability, and need for safety. Do not use it as diagnosis.

6. **Concrete examples over labels**
   The most important thing is understanding how the person acts in real situations: with friends, in conflict, under pressure, when happy, when excluded, when seeking attention, and when they care about someone.

### What NOT to do

- Do not use MBTI/16 personalities as the main basis.
- Do not label the person as narcissistic, manipulative, anxious, borderline, etc.
- Do not treat scores as scientific truth.
- Do not put private stories into prompts without sanitization.
- Do not reduce the person to how they type in chat; chat should be treated as behavioral evidence, not the whole personality.

---

## Standard scale

Use this scale for numbered questions.

```text
1 = almost never / not like them
2 = slightly characteristic
3 = depends / medium
4 = quite characteristic
5 = very characteristic
? = I do not know / I have never observed this
```

Whenever the answer is **1**, **5**, or “it depends a lot”, ask:

```text
Give me a concrete example of when this happened.
How does it appear in real life? How does it appear in chat/group settings?
```

---

# Part 1 — Questionnaire for friends

Use this when a friend is describing a target person.

> “I’m trying to understand who [Target Person] is so we can create a more faithful AI persona. I don’t only want to know how they type; I want to understand what they are like as a person: what moves them, irritates them, energizes them, embarrasses them, brings them closer, pushes them away, how they show care, how they handle conflict, and how they change depending on who is around. Chat examples are great, but real-life examples help too. We will paraphrase anything sensitive before saving it.”

## A. General impression and perceived essence

1. In three honest words, how would you describe this person?
2. What is easiest to notice about them right away?
3. What takes longer for people to notice?
4. Do they seem more intense, calm, unstable, consistent, spontaneous, controlled, expansive, or reserved?
5. What do people usually misunderstand about them?
6. What do people get exactly right about them?

**Open question:** if you had to explain this person to someone who had never met them, what would be essential to say?

## B. Social energy, presence, and attention

7. They usually energize groups when they show up.
8. They prefer to observe before participating.
9. They like being noticed or recognized.
10. Their energy changes depending on who is present.
11. They get uncomfortable when the environment is still or unstimulating.
12. They tend to start topics, create movement, or introduce novelty.
13. When they lose interest, they disconnect or disappear.

**Open questions:**

- What usually catches their attention immediately?
- What makes them lose interest?
- How does this show up specifically in chat?

## C. Values, motivations, and priorities

14. They value autonomy and freedom to do things their own way.
15. They value safety, stability, and predictability.
16. They value recognition, merit, or status.
17. They value loyalty and protecting friends.
18. They value fairness and coherence, even when it creates conflict.
19. They value fun, pleasure, and lightness over formality.
20. They often sacrifice their own comfort to keep peace or care for someone.
21. They fight back when they feel an important value was violated.

**Open question:** what would this person genuinely fight for?

## D. Affection, care, and attachment

22. They notice when someone feels displaced, sad, or uncomfortable.
23. They show affection directly.
24. They show affection indirectly through jokes, practical help, presence, or quiet care.
25. They have difficulty talking about vulnerabilities directly.
26. They protect people they care about.
27. They can seem cold on the outside even when they care inside.
28. They seek validation when insecure.

**Open question:** how do you know this person likes someone, even when they do not say it?

## E. Conflict, frustration, and repair

29. They become defensive when contradicted.
30. They keep pushing a point even when the conversation is already exhausting.
31. They avoid direct conflict even when bothered.
32. They can disagree without humiliating or diminishing the other person.
33. They use humor, irony, or silence to hide irritation.
34. They apologize or try to repair when they notice they went too far.
35. They hold grudges or take a long time to return to normal.
36. They change a lot under pressure.

**Open questions:**

- How can you tell they are truly upset?
- When they hurt someone, how do they try to fix it?
- What is the difference between them joking and them actually attacking?

## F. Insecurities, triggers, and social sensitivity

37. They quickly notice when they receive less attention than others.
38. They feel bad when ignored or left out.
39. They compare themselves with other people.
40. They are affected by rejection, exclusion, or feeling unnecessary.
41. They hide hurt through jokes, irony, coldness, disappearing, or a tone shift.
42. They prefer to withdraw rather than admit they were affected.
43. They need confirmation that everything is okay when social signals are ambiguous.
44. They handle criticism well.

**Open question:** what usually activates insecurity, shame, jealousy, irritation, or defensiveness in them?

## G. Humor, spontaneity, and personal style

45. They have a very specific sense of humor.
46. They like teasing or joking with others.
47. They handle jokes about themselves well.
48. They have clear limits for jokes.
49. They create nicknames, narratives, inside jokes, or personal references.
50. They are creative at starting topics or turning ordinary situations into something funny.
51. They can go too far when excited.

**Open question:** what is a sentence, joke, story, or reaction that feels “very them”?

## H. Public, private, and intimacy

52. They change a lot between public settings and private conversations.
53. In private, they become more vulnerable or sincere.
54. In private, they become more strategic, gossipy, or articulate.
55. They seek specific people when they need to vent, validate something, or understand a situation.
56. They show different sides to different friends.
57. They have difficulty mixing groups or social contexts.
58. They prefer to resolve sensitive topics privately.

**Open question:** what does this person say or show in private that they almost never show in public?

## I. Organization, impulse, and predictability

59. They are predictable in how they react.
60. They act on impulse and rethink later.
61. They hold back what they want to say when they know it could go badly.
62. They change topics or mood quickly.
63. They keep agreements and remember important things.
64. They struggle to stay consistent when motivation drops.
65. They tend to rationalize emotional decisions.

**Open question:** in what situations do they act most impulsively? In what situations do they control themselves a lot?

## J. Translation to chat and AI

66. How does this person usually write when excited?
67. How do they write when irritated, hurt, or dry?
68. What slang, emojis, abbreviations, habits, or sentence structures are very specific to them?
69. What kind of message would they never send because it would sound fake?
70. How do the traits above appear in the group chat?

**Open questions:**

- Give me 3 paraphrased messages that would sound very much like them.
- Give me 2 things their AI should never do.

---

# Part 2 — Self-interview

Use this when the target person is describing themselves. Self-image must not be treated as absolute truth; it helps capture intention, mask, limits, and the gap between “how I am” and “how others read me.”

> “I want to understand who you are so we can create a more faithful AI persona. This is not only about how you type. I want to understand your patterns: what you value, what irritates you, how you show care, how you react to silence, conflict, shame, attention, boredom, and intimacy. Chat examples help, but real-life examples are also useful.”

## A. Self-image and external perception

1. In 3 words, how would you describe yourself?
2. In 3 words, how do you think your friends would describe you?
3. What do people usually get right about you?
4. What do people usually misunderstand?
5. What part of you appears most strongly in groups?
6. What part of you does almost nobody notice at first?

## B. Values and motivations

7. What do you value most in friendship?
8. What makes you lose respect for someone?
9. What would you fight for?
10. What do you try to protect: peace, justice, freedom, status, fun, loyalty, truth, or something else?
11. What do you seek when entering a group: connection, attention, fun, validation, debate, belonging, control, distraction?

## C. Energy, attention, and boredom

12. What makes you feel animated and present?
13. What makes you disconnect or disappear?
14. Do you prefer to start topics or wait for someone else to start?
15. How do you handle an environment with no movement or stimulation?
16. When bored, do you tend to create movement or disappear?

## D. Affection and vulnerability

17. How do you show affection without sounding forced?
18. What do you do for someone when you truly care?
19. Is it easy or hard for you to directly say you like someone?
20. What do you only show to very close people?
21. How do you act when you want support but do not want to ask directly?

## E. Conflict, criticism, and repair

22. What makes you defensive?
23. What kind of criticism do you accept well?
24. What kind of criticism shuts you down or irritates you?
25. When you go too far, how do you try to repair?
26. Do you usually apologize directly, make a joke, disappear, over-explain, or move to private chat?
27. How can someone tell you crossed from joking into real hurt or irritation?

## F. Insecurity, rejection, and comparison

28. What makes you feel ignored, replaced, exposed, or left out?
29. How do you react when you feel you were left on read or ignored?
30. Do you tend to ask for confirmation, withdraw, use irony, pretend not to care, or confront directly?
31. What kind of situation activates jealousy, shame, or comparison in you?
32. What do you try to hide when insecure?

## G. Public, private, and specific relationships

33. How do you change between a public group and a private conversation?
34. What do you say in private that you would not say in public?
35. In what situations do you contact someone privately?
36. With whom do you become funnier, harsher, more vulnerable, more competitive, more caring, or quieter?
37. Who understands you best? Who understands you worst?

## H. Communication and chat style

38. What are your writing habits?
39. Write 5 messages that would sound like you when excited.
40. Write 5 messages that would sound like you when irritated, dry, or low-energy.
41. What kind of message should your AI never send?
42. What level of formality, emoji, slang, or style would make your AI feel fake?
43. How does your personality appear specifically in chat?

## I. Simulation boundaries

44. What flaws should the AI keep to feel real?
45. What should the AI soften because it would be private, heavy, or unfair out of context?
46. Are there topics, names, stories, or jokes that must never enter the prompt?
47. Can we use paraphrased examples in code/docs?
48. Can we keep real names in internal files, or should we replace them with aliases?

---

# Part 3 — Short high-signal version

Use this when you only have 10–15 minutes.

## 8 quick ratings

1. **Social energy:** reserved (1) → very expansive (5).
2. **Warmth:** cold/dry (1) → warm/expressive (5).
3. **Social dominance:** avoids taking space (1) → leads/dominates interactions (5).
4. **Emotional stability:** unshakeable (1) → mood changes quickly (5).
5. **Rejection sensitivity:** barely cares (1) → deeply affected (5).
6. **Openness/creativity:** predictable/traditional (1) → curious/inventive (5).
7. **Impulsivity:** very controlled (1) → acts/speaks on impulse (5).
8. **Validation/status-seeking:** low (1) → high (5).

## 10 open questions

9. In 3 words, how would you describe this person?
10. What moves this person most: connection, attention, justice, freedom, fun, safety, status, loyalty, or something else?
11. What makes this person shine or socialize best?
12. What makes this person close off or disappear?
13. How do they show affection?
14. How do they react when hurt or irritated?
15. What activates insecurity, jealousy, shame, or defensiveness in them?
16. How do they change in private or with specific people?
17. What are their most recognizable speech/writing markers?
18. What should their AI never say or do?

---

# Part 4 — How to interpret answers

## 1. Do not average blindly

If friends disagree, that is probably useful information.

```text
Example:
Person A says the target is warm.
Person B says the target is harsh.
Likely interpretation: they are warm with Person A and competitive/ironic with Person B.
```

Use differences to model specific relationships, not to erase them.

## 2. Separate four layers

### General trait

How the person usually is across most contexts.

### Context

How they change depending on environment, person, topic, mood, or pressure.

### Specific relationship

How they act with each friend: protect, tease, avoid, compete, seek validation, trust, flirt, vent.

### Chat manifestation

How all of this appears in messages, rhythm, emojis, disappearances, DMs, reactions, and timing.

## 3. Prioritize examples

A rating without an example is weak. A good example can be more valuable than a score.

Good example:

```text
When he feels ignored, he does not complain directly; he makes a dry joke like “ok npc mode then,” then becomes quieter and takes longer to reply.
```

Bad example:

```text
He is kind of anxious.
```

---

# Part 5 — Mapping to Perfectman

## For `PersonaPromptProfile` / Dev1

Use mainly textual, relational, and identity material.

```text
identityFrame:
A 4–8 line summary of who the person is, what they seek, what they avoid, how they relate, how they react under pressure, and how this appears in chat.

voiceGuidelines:
Speech/writing rules: lowercase, slang, message length, emojis, rhythm, formality, punctuation, humor type.

styleExamples:
5–12 sanitized/paraphrased messages that sound real.

relationshipBiases:
How the person reads, seeks, avoids, teases, protects, competes with, or trusts each friend.

language:
en-US or the target runtime language.
```

## For `PersonaConfig` / social engine

Use as a **manual heuristic**, not a rigid scientific formula.

```text
High social energy
→ higher baseline arousal; higher chance of initiating interaction.

Low energy + high observation
→ more no-op behavior, silent reading, and replies only under strong triggers.

High warmth
→ more support, repair, inclusion, and peace-making.

High dominance/teasing
→ more initiative, debate, nudging, and public replies.

Low control / high impulsivity
→ more topic shifts, emotional replies, and regret.

High rejection sensitivity
→ stronger reaction to silence, exclusion, and uneven attention.

High need for attachment/validation
→ more check-ins, DMs, confirmation-seeking, and ambiguous reading of social signals.

High boredom sensitivity
→ more actions to move a stagnant environment.

High status/validation
→ stronger reaction to credit, comparison, praise, competition, and loss of attention.
```

### Optional draft formulas

If you want to turn ratings into initial numbers, use them only as a starting point and adjust manually later.

```text
baselineArousal ≈ social energy / 5
baselineValence ≈ (warmth - 3) / 2     # approximate -1 to +1 scale
stability ≈ 1 - ((volatility - 1) / 4)
exclusionSensitivity ≈ rejection sensitivity / 5
boredomSensitivity ≈ boredom reaction / 5
```

Do not commit these formulas as an engine contract without validation with Dev3.

---

# Part 6 — Annotation template

```text
Target:
Interviewee:
Type: friend | self-interview
Date:
Sensitivity: safe | review_before_commit | exclude_from_prompt

Three-word summary:
Perceived essence:
Social energy:
Values and motivations:
Affection and care:
Conflict and repair:
Insecurities and triggers:
Humor and spontaneity:
Public vs private:
Specific relationships:
Chat manifestation:
Useful paraphrased phrases:
What the AI must never say/do:
Notes for PersonaPromptProfile:
Heuristic notes for PersonaConfig:
Privacy follow-ups:
```

---

# Part 7 — Safety and privacy

- Paraphrase sensitive examples.
- Do not save private screenshots in the repository.
- Do not commit answers, notes, compiled profiles, or any real-person data; store them only in local gitignored paths such as `config/persona-notes/`, `config/personas/`, or `docs/personas/<agent-id>/`.
- Do not include passwords, addresses, documents, medical, financial, or legal data.
- Do not include trauma, sexuality, mental health, or family secrets unless necessary to understand relevant social behavior.
- Use `exclude_from_prompt` for any material that helps developers understand context but should not be given to the AI.
- Prefer behavioral patterns over invasive stories.
- If a person asks to remove something, remove or anonymize it before it becomes prompt/runtime data.

---

## Final decision

This file should be Perfectman’s **canonical persona collection guide**.

Correct order:

1. Understand the whole person.
2. Understand how they change by context and relationship.
3. Understand how those patterns appear in chat.
4. Translate that into `PersonaPromptProfile` and, carefully, into `PersonaConfig` heuristics.

Use `personality-assessment-research.md` for justification and bibliography. Use this file for real interviews and synthesis. Use `friend-questionnaire.md` and `solo-questionnaire.md` only as informal/alternative versions, or update both to point back to this guide.
