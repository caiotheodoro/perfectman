import type {
  CoreMood,
  SocialEmotions,
  RelationalState,
  Pressure,
  Inhibition,
  TranslatedEmotionalState,
  RelationalFlavor,
} from "@perfectman/shared";

/**
 * Translate the emotional state into natural language strings for the LLM prompt.
 *
 * HARD RULES:
 *   - No raw numeric values in output
 *   - No spectator-narration style ("The agent feels...")
 *   - Subjective first-person or internal perspective
 *   - Ambiguity preserved — no forced certainty
 *   - Pressures/inhibitions described as felt urges and blocks, not formulas
 *
 * Dev1 imports this for prompt builder sections 4 and 5.
 */

export function translateEmotionalState(
  mood: CoreMood,
  social: SocialEmotions,
  relationalStates: Map<string, RelationalState>,
  pressures: Pressure[],
  inhibitions: Inhibition[],
): TranslatedEmotionalState {
  return {
    moodDescription:      describeMood(mood),
    socialContext:        describeSocialContext(social),
    relationalFlavors:    describeRelationalFlavors(relationalStates),
    pressureDescriptions: pressures.map(describePressure),
    inhibitionDescriptions: inhibitions.map(describeInhibition),
  };
}

// ── Mood ─────────────────────────────────────────────────────────────────────

function describeMood(mood: CoreMood): string {
  const valenceWord = valenceToWord(mood.valence);
  const arousalWord = arousalToWord(mood.arousal);
  const stabilityClause = mood.stability < 0.35
    ? " Things feel a bit unsettled internally — it's hard to predict how this will land."
    : mood.stability > 0.75
    ? " There's a steadiness to things right now."
    : "";

  const energyClause = mood.energy < 0.25
    ? " Running a bit low — not sure how much to give right now."
    : mood.energy > 0.80
    ? " Feeling energized, ready to engage."
    : "";

  const momentumClause =
    mood.momentumValence > 0.15 ? " Something good happened recently and it's still there a little." :
    mood.momentumValence < -0.15 ? " There's still a slight residue from something earlier." :
    "";

  return `Feeling ${valenceWord} — ${arousalWord}.${stabilityClause}${energyClause}${momentumClause}`.trim();
}

function valenceToWord(v: number): string {
  if (v >= 0.6)  return "genuinely good, in a warm kind of way";
  if (v >= 0.3)  return "okay, maybe even a bit positive";
  if (v >= 0.1)  return "pretty neutral, not bad";
  if (v >= -0.1) return "somewhere between neutral and slightly off";
  if (v >= -0.3) return "a little down or flat";
  if (v >= -0.5) return "not great, honestly";
  if (v >= -0.7) return "pretty low";
  return "really not okay right now";
}

function arousalToWord(a: number): string {
  if (a >= 0.80) return "there's a lot going on mentally, hard to settle";
  if (a >= 0.60) return "kind of activated, a bit restless";
  if (a >= 0.40) return "moderate — present but not wound up";
  if (a >= 0.20) return "fairly calm, maybe a little detached";
  return "really low energy, almost withdrawn";
}

// ── Social Emotions ───────────────────────────────────────────────────────────

function describeSocialContext(social: SocialEmotions): string {
  const sentences: string[] = [];

  if (social.fearOfExclusion > 0.5) {
    sentences.push("There's a background worry about being left out or overlooked.");
  }
  if (social.jealousy > 0.5 || social.envy > 0.5) {
    sentences.push("Seeing others connect is producing something that isn't quite comfortable.");
  }
  if (social.pride > 0.6) {
    sentences.push("Something was done well — there's a small satisfaction in that.");
  }
  if (social.shame > 0.5) {
    sentences.push("There's a lingering sense that something went wrong, or was exposed.");
  }
  if (social.humiliation > 0.5) {
    sentences.push("Something recently landed in a way that felt deeply wrong — like being seen badly.");
  }
  if (social.resentment > 0.5) {
    sentences.push("There's something building quietly — a feeling that hasn't been addressed.");
  }
  if (social.affection > 0.6) {
    sentences.push("There's a genuine warmth toward at least one person in this space.");
  }
  if (social.suspicion > 0.5) {
    sentences.push("Something feels slightly off about how others are behaving — hard to name.");
  }
  if (social.socialAnxiety > 0.5) {
    sentences.push("Just a low-level dread about how interactions might go.");
  }
  if (social.neediness > 0.5) {
    sentences.push("Would appreciate some acknowledgment or contact right now.");
  }
  if (social.desireForIntimacy > 0.6) {
    sentences.push("There's a pull toward something more real or closer with someone.");
  }
  if (social.desireForStatus > 0.6) {
    sentences.push("Aware of how one comes across — wants to be seen as credible or in-the-know.");
  }
  if (social.contempt > 0.5) {
    sentences.push("Something about the dynamic here is creating a kind of low-grade disdain.");
  }
  if (social.admiration > 0.5) {
    sentences.push("Someone said or did something genuinely impressive.");
  }

  if (sentences.length === 0) return "";
  return sentences.slice(0, 3).join(" ");
}

// ── Relational ───────────────────────────────────────────────────────────────

function describeRelationalFlavors(
  relationalStates: Map<string, RelationalState>,
): RelationalFlavor[] {
  const flavors: RelationalFlavor[] = [];

  for (const [targetId, rel] of relationalStates.entries()) {
    const desc = describeRelation(rel);
    if (desc) {
      flavors.push({ targetAgentId: targetId, description: desc });
    }
  }

  return flavors.slice(0, 5); // cap at 5 to avoid prompt bloat
}

function describeRelation(rel: RelationalState): string | null {
  const lines: string[] = [];

  // Dominant positive
  if (rel.trust > 0.4 && rel.affection > 0.4) {
    lines.push("Someone who feels genuinely safe to be around.");
  } else if (rel.affection > 0.5) {
    lines.push("A warmth there that's hard to explain.");
  } else if (rel.admiration > 0.4) {
    lines.push("Something about them commands attention.");
  } else if (rel.curiosity > 0.5) {
    lines.push("Genuinely interested in what they're thinking.");
  }

  // Dominant negative
  if (rel.resentment > 0.4 && rel.suspicion > 0.3) {
    lines.push("Something feels unresolved — hard to trust.");
  } else if (rel.resentment > 0.5) {
    lines.push("There's something that hasn't been said.");
  } else if (rel.suspicion > 0.5) {
    lines.push("Not quite sure what they're after.");
  } else if (rel.threat > 0.4) {
    lines.push("This person puts something on edge.");
  }

  // Closeness vs distance
  if (rel.desireForCloseness > 0.5 && rel.desireForDistance < 0.2) {
    lines.push("Would like more of this connection.");
  } else if (rel.desireForDistance > 0.5) {
    lines.push("Would rather keep some distance right now.");
  }

  if (lines.length === 0) return null;
  return lines.slice(0, 2).join(" ");
}

// ── Pressures ────────────────────────────────────────────────────────────────

const PRESSURE_TEMPLATES: Partial<Record<string, string>> = {
  urge_to_reply:                  "There's a pull to respond — something about the last message needs answering.",
  urge_to_message:                "There's an itch to say something, open something up.",
  urge_to_defend_self:            "Part of this wants to push back, set the record straight.",
  urge_to_mock:                   "There's a sharp edge that keeps surfacing — a want to say something cutting.",
  urge_to_create_private_channel: "This conversation might work better somewhere else, more private.",
  urge_to_invite:                 "Want to pull someone in here.",
  urge_to_leave:                  "The pull to just step back from this, at least for now.",
  urge_to_react:                  "Want to acknowledge something without making it a big thing.",
  urge_to_type:                   "Starting to write something, even if it doesn't get sent.",
  urge_to_show_off:               "Want people to notice what was done or said.",
  urge_to_seek_comfort:           "Would be nice if someone just... acknowledged this.",
  urge_to_repair:                 "Something wants to smooth things over, fix whatever's been off.",
  urge_to_dominate:               "Want to steer this — be the one who shapes the direction.",
  urge_to_provoke:                "There's a reckless edge here, wanting to poke at something.",
  urge_to_withdraw:               "The easiest thing would be to just go quiet.",
};

function describePressure(pressure: Pressure): string {
  const template = PRESSURE_TEMPLATES[pressure.type] ?? `A pull toward ${pressure.type.replace(/_/g, " ")}.`;
  const intensitySuffix =
    pressure.intensity === "overwhelming" ? " It's hard to ignore." :
    pressure.intensity === "high"         ? " It's fairly strong." :
    "";
  return template + intensitySuffix;
}

// ── Inhibitions ───────────────────────────────────────────────────────────────

const INHIBITION_TEMPLATES: Partial<Record<string, string>> = {
  fear_of_looking_needy:          "But coming across as too eager or needy would be worse.",
  fear_of_escalating:             "Worried about making things worse — the situation feels fragile.",
  fear_of_rejection:              "There's a real chance this doesn't land, and that would sting.",
  fear_of_exclusion_worsening:    "Acting might draw even more attention to being on the outside.",
  shame_about_desire:             "Something about wanting this feels embarrassing.",
  social_anxiety_block:           "There's a kind of low-level dread about how this will go over.",
  status_protection:              "Can't afford to look foolish or out of place right now.",
  conflict_avoidance:             "A fight right now isn't worth it.",
  vulnerability_guard:            "Opening up here doesn't feel safe.",
  contempt_concealment:           "Showing how you actually feel would be a bad move.",
  strategic_patience_hold:        "Better to hold back and see how this develops.",
  intimacy_fear:                  "Getting closer sounds good but something resists it.",
  performance_anxiety:            "What if this doesn't land the way it's supposed to?",
  repair_doubt:                   "Not sure an attempt to fix this would even work.",
};

function describeInhibition(inhibition: Inhibition): string {
  return INHIBITION_TEMPLATES[inhibition.type] ?? inhibition.reason;
}
