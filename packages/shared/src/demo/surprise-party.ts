/**
 * The film on the landing page: a surprise party that nobody admits to.
 *
 * Out loud, four people are having a very ordinary Saturday. In their heads,
 * the cake is in the bathtub. That gap is the whole product, so the film is
 * built from it: every line has a thing that was said and a thing that was not.
 */
import { scriptToReplay, type Script } from "./script-to-replay.js";

export const SURPRISE_PARTY_SCRIPT: Script = {
  title: "The party nobody mentioned",
  start: "19:51",
  step: 1,
  look: { setting: "living" },
  cast: [
    { id: "mo", name: "Mo", archetype: "organizer", writingStyle: "bright, over-explains, lists everything" },
    { id: "dex", name: "Dex", archetype: "trickster", writingStyle: "lowercase, deadpan, cannot keep a secret" },
    { id: "ines", name: "Gran Ines", archetype: "elder", writingStyle: "formal, dry, enjoys every second of this" },
    { id: "juno", name: "Juno", archetype: "gatekeeper", writingStyle: "precise, suspicious, keeps notes" },
  ],
  channels: [
    { id: "flat", name: "flat 4B", type: "public_channel", memberAgentIds: ["mo", "dex", "ines", "juno"] },
    { id: "committee", name: "the committee", type: "private_channel", memberAgentIds: ["mo", "dex", "ines"] },
  ],
  beats: [
    { who: "juno", say: "Why is everyone wearing shoes indoors?",
      think: "Four people. One couch. Zero explanations. I am writing this down.",
      feel: { juno: "suspicious" } },
    { who: "mo", say: "No reason! Totally normal Saturday. Nothing is happening at eight.",
      think: "The cake is in the bathtub. The BATHTUB. Why did I put the cake in the bathtub.",
      feel: { mo: "panic" } },
    { who: "dex", say: "yep. super boring. no surprise of any kind.",
      think: "I said \"surprise.\" I said the word. Out loud. With my mouth.",
      feel: { dex: "mortified" } },
    { who: "juno", say: "Mo, your clipboard says PARTY.",
      think: "It says PARTY. In capitals. I am not the one who is losing it here." },
    { who: "mo", say: "It says PARTLY. As in partly cloudy.",
      think: "I plan weddings for a living. Why can I not lie to one woman about the weather." },
    { who: "mo", in: "committee", say: "Dex. One more \"surprise\" and you are on balloon duty. In the bathtub.",
      think: "He has the discretion of a golden retriever with a megaphone.",
      feel: { juno: "suspicious", dex: "panic" } },
    { who: "ines", in: "committee", say: "Children. She is looking. Smile as if you have nothing to hide.",
      think: "Forty guests in nine minutes. The confetti cannon is in my handbag. I have never been happier.",
      feel: { ines: "smug" } },
    { who: "juno", say: "Why are you all smiling like that?",
      think: "That is the smile of people hiding a cake. I know it. I have seen it. In a bathtub.",
      feel: { mo: "panic", dex: "panic", ines: "smug" } },
    { who: "dex", say: "cake! i mean no cake. cake is a myth.",
      think: "Somebody please confiscate my mouth.",
      feel: { dex: "mortified" } },
    { who: "juno", say: "Fine. I'll just use the bathroom, then.",
      think: "They stopped breathing. All of them. Even Ines.",
      feel: { juno: "smug" } },
    { who: "mo", say: "NO!! The light is broken! Very dark in there!",
      think: "SHE IS TOUCHING THE DOORKNOB.",
      feel: { mo: "panic" } },
    { who: "ines", say: "Oh. The doorbell. How unexpected.",
      think: "Nine minutes early. I could kiss every one of them.",
      feel: { ines: "warm" } },
    { who: "mo", say: "SURPRISE!! Happy birthday!!",
      think: "Nobody. Look. In. The. Bathtub.",
      feel: { mo: "warm", dex: "warm", juno: "calm" } },
    { who: "juno", say: "Obviously I knew.",
      think: "I did not know. This is the best night of my life. Nobody say anything. Nobody say anything.",
      feel: { juno: "warm", mo: "warm", ines: "warm" } },
  ],
};

export const surpriseParty = () => scriptToReplay(SURPRISE_PARTY_SCRIPT);
