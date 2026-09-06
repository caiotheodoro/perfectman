/**
 * What the mock says.
 *
 * The mock used to have three lines total — `"oi tudo bem"`, `"olá"`, `"pois é"`
 * — shared by every agent. That is fine for asserting that a pulse commits an
 * event, and useless for anything you look at: from the second turn onward the
 * repetition guard blocked every intent, so a sixteen-turn run produced three
 * lines and then a room full of people saying nothing. It also answered in
 * Portuguese regardless of the scene.
 *
 * These pools exist so the zero-setup path produces a conversation with a shape.
 * They are still canned text and make no claim to be a model: nothing here reads
 * the room, and the *decisions* — who speaks, who stays quiet, who opens a
 * private channel — are still the engine's, unchanged. Only the words vary.
 *
 * Rotation is keyed on the pulse index and the agent id, not on a counter. The
 * factory builds a fresh provider for every intent, so instance state would
 * reset on each call — which is exactly the bug this replaces. Deriving the
 * line from the pulse also keeps a seeded run reproducible across processes.
 */

type Voice = { openers: string[]; replies: string[]; motives: string[] };

const VOICES: Record<string, Voice> = {
  provocateur: {
    openers: [
      "someone's going to have to say it",
      "we're all just going to sit here then",
      "fine, I'll be the bad guy",
      "this is the part where everyone goes quiet",
      "I've got a version of this nobody's going to like",
      "let's stop pretending we agree",
      "nobody wants to go first, fine",
      "I'll ask the question then",
      "we can keep circling this all night",
      "someone here knows more than they are saying",
    ],
    replies: [
      "that's not an answer",
      "sure. and the rest of it?",
      "you don't believe that either",
      "say the actual thing",
      "convenient",
      "ok, but who decided that",
      "you are managing me right now",
      "that is a no dressed up",
      "try again",
      "you skipped the middle bit",
    ],
    motives: [
      "If nobody reacts to me I might as well not be here.",
      "Pushing until somebody drops the polite voice.",
      "I would rather be the problem than be ignored.",
      "Testing how much of this is real.",
    ],
  },
  performer: {
    openers: [
      "ok so let me lay this out properly",
      "I've actually been thinking about this all week",
      "here's what I'd do, and hear me out",
      "quick context before anyone panics",
      "I flagged this ages ago for what it's worth",
      "there's a version of this that works for everyone",
      "look, the numbers are actually fine",
      "I did the maths on this",
      "nobody is being cut out here",
      "can I finish the thought",
    ],
    replies: [
      "right, that's basically what I was getting at",
      "yes — with one important difference",
      "I'd frame it slightly differently",
      "that's fair, and it's also what I said",
      "sure, but look at the timing",
      "I'm not disagreeing, I'm adding to it",
      "that is a detail, not a problem",
      "we are saying the same thing differently",
      "hold on, hold on",
      "I want that on the record",
    ],
    motives: [
      "If I explain it well enough nobody asks where I was.",
      "Filling the gap before somebody else defines it.",
      "This has to sound like it was my idea.",
      "The silence is starting to feel like a verdict.",
    ],
  },
  skeptic: {
    openers: [
      "why is nobody saying the number",
      "what are we actually deciding",
      "I want to hear it from him",
      "that doesn't add up",
      "who else knew",
      "I'd rather have the argument now",
      "say the number",
      "who talked to them first",
      "that is the second time you have moved past it",
      "I am not asking to be difficult",
    ],
    replies: [
      "that doesn't answer what I asked",
      "ok.",
      "so that's a no",
      "you're doing it again",
      "say it plainly",
      "and if it isn't?",
      "no.",
      "that is not what you said before",
      "I will wait",
      "then say so",
    ],
    motives: [
      "Everyone is being careful and I want to know why.",
      "Asking once more without softening it.",
      "The politeness is doing a lot of work here.",
      "I already know. I want them to say it.",
    ],
  },
  connector: {
    openers: [
      "ok everyone breathe",
      "can we do this properly, not in a group chat",
      "I think we're closer than it sounds",
      "genuinely asking — is everyone alright",
      "let's not do this over text",
      "I'll say the nice version first",
      "we are all tired, that is all this is",
      "nobody here is the villain",
      "I hate that this is happening over text",
      "can I say something",
    ],
    replies: [
      "that's fair, both things can be true",
      "I hear you, honestly",
      "ok but let's not make it a thing",
      "haha stop, come on",
      "I don't want anyone leaving upset",
      "can we park that for one minute",
      "you are both right, annoyingly",
      "that came out sharper than you meant",
      "I do not think that is what he meant",
      "let us all be normal for a second",
    ],
    motives: [
      "Getting between them before this becomes permanent.",
      "If I change the subject fast enough it never happened.",
      "I care more than I want to admit right now.",
      "Somebody is going to get hurt and it will be my fault.",
    ],
  },
  strategist: {
    openers: [
      "before we decide, one thing",
      "what's the deadline actually",
      "there are two versions of this and only one is reversible",
      "I'd want that in writing",
      "let's separate the money from the feelings",
      "who benefits if we wait",
      "what happens on Friday if we do nothing",
      "I want the version with numbers",
      "we should decide the order first",
      "that assumes a lot",
    ],
    replies: [
      "noted. and the downside?",
      "that changes the order of things",
      "I'd want to see it first",
      "that works if the timing holds",
      "not yet",
      "let's come back to that",
      "possibly",
      "I would structure it the other way",
      "that is the expensive option",
      "depends who signs",
    ],
    motives: [
      "Letting them talk while I count the moves.",
      "Not saying the part that would cost me leverage.",
      "This is going where I need it to go.",
      "Three steps out this looks very different.",
    ],
  },
  enthusiast: {
    openers: [
      "wait I actually love this",
      "ok ok what if",
      "no because think about it",
      "genuinely this could be great",
      "I've got twelve ideas and one of them is good",
      "why does everyone sound so grim",
      "ok but genuinely though",
      "can we do the fun version",
      "I have been quiet for ages, look at me",
      "is anyone else starving",
    ],
    replies: [
      "yes exactly!!",
      "oh that's a good point actually",
      "wait say more",
      "ok I'm in",
      "no no I get it",
      "hmm. ok. hmm.",
      "oh!",
      "wait wait wait",
      "that is actually clever",
      "I had not thought of it like that",
    ],
    motives: [
      "Talking fast because the quiet is unbearable.",
      "Checking whether anyone is still with me.",
      "If I'm excited enough maybe they will be too.",
      "Something is off and nobody is saying it.",
    ],
  },
};

const DEFAULT_VOICE: Voice = {
  openers: [
    "so where are we with this",
    "anyone else thinking about it",
    "right",
    "I've been putting off saying this",
    "quick one",
    "ok",
    "worth saying out loud, probably",
    "one thing before we move on",
    "I keep coming back to this",
    "not to drag it out, but",
  ],
  replies: [
    "makes sense",
    "I suppose so",
    "hm",
    "if you say so",
    "yeah",
    "not sure about that",
    "fair enough",
    "I'd want to check",
    "possibly",
    "let's see",
  ],
  motives: [
    "Saying something because the silence got long.",
    "Not sure this is worth the trouble.",
    "Waiting to see who moves first.",
    "There is more to this than I want to get into.",
  ],
};

function voiceFor(archetype: string | undefined): Voice {
  return (archetype ? VOICES[archetype] : undefined) ?? DEFAULT_VOICE;
}

/** Small stable offset so two agents sharing an archetype do not speak in unison. */
function offsetFor(agentId: string): number {
  let hash = 0;
  for (const char of agentId) hash = (hash * 31 + char.charCodeAt(0)) % 997;
  return hash;
}

function pick(pool: readonly string[], agentId: string, pulseIndex: number): string {
  return pool[(offsetFor(agentId) + pulseIndex) % pool.length]!;
}

export function mockOpener(agentId: string, pulseIndex: number, archetype?: string): string {
  return pick(voiceFor(archetype).openers, agentId, pulseIndex);
}

export function mockReply(agentId: string, pulseIndex: number, archetype?: string): string {
  return pick(voiceFor(archetype).replies, agentId, pulseIndex);
}

export function mockMotive(agentId: string, pulseIndex: number, archetype?: string): string {
  return pick(voiceFor(archetype).motives, agentId, pulseIndex);
}
