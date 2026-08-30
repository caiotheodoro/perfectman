/**
 * SQLite schema — CREATE TABLE statements for all tables.
 * Populated by database.ts on first connection.
 */

export const CREATE_TABLES_SQL = `

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS simulations (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'initializing',
  agent_ids   TEXT NOT NULL DEFAULT '[]',    -- JSON array
  channel_ids TEXT NOT NULL DEFAULT '[]',    -- JSON array
  settings    TEXT NOT NULL DEFAULT '{}',    -- JSON object
  seed        INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS channels (
  id                    TEXT PRIMARY KEY,
  simulation_id         TEXT NOT NULL REFERENCES simulations(id) ON DELETE CASCADE,
  type                  TEXT NOT NULL,
  name                  TEXT NOT NULL,
  created_by            TEXT NOT NULL,
  member_agent_ids      TEXT NOT NULL DEFAULT '[]',   -- JSON array
  spectator_visible     INTEGER NOT NULL DEFAULT 1,   -- boolean
  operator_visible      INTEGER NOT NULL DEFAULT 1,   -- boolean
  created_for_motives   TEXT NOT NULL DEFAULT '[]',   -- JSON array
  status                TEXT NOT NULL DEFAULT 'active',
  created_at            INTEGER NOT NULL,
  updated_at            INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS channel_memberships (
  channel_id  TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  agent_id    TEXT NOT NULL,
  joined_at   INTEGER NOT NULL,
  left_at     INTEGER,
  PRIMARY KEY (channel_id, agent_id)
);

CREATE TABLE IF NOT EXISTS events (
  id                TEXT PRIMARY KEY,
  simulation_id     TEXT NOT NULL REFERENCES simulations(id) ON DELETE CASCADE,
  channel_id        TEXT NOT NULL,
  actor_id          TEXT NOT NULL,
  type              TEXT NOT NULL,
  payload           TEXT NOT NULL DEFAULT '{}',       -- JSON
  created_at        INTEGER NOT NULL,
  pulse_index       INTEGER NOT NULL DEFAULT 0,
  source_intent_id  TEXT,
  source_event_ids  TEXT NOT NULL DEFAULT '[]',       -- JSON array
  emotional_salience TEXT NOT NULL DEFAULT 'low',
  visibility        TEXT NOT NULL DEFAULT '{}'        -- JSON
);

CREATE INDEX IF NOT EXISTS idx_events_simulation_id ON events(simulation_id);
CREATE INDEX IF NOT EXISTS idx_events_created_at ON events(created_at);
CREATE INDEX IF NOT EXISTS idx_events_pulse_index ON events(pulse_index);

CREATE TABLE IF NOT EXISTS agent_states (
  agent_id                TEXT NOT NULL,
  simulation_id           TEXT NOT NULL REFERENCES simulations(id) ON DELETE CASCADE,
  persona_id              TEXT NOT NULL,
  presence                TEXT NOT NULL DEFAULT 'active',
  core_mood               TEXT NOT NULL DEFAULT '{}',          -- JSON
  social_emotions         TEXT NOT NULL DEFAULT '{}',          -- JSON
  relational_states       TEXT NOT NULL DEFAULT '[]',          -- JSON array of {targetAgentId, ...}
  memories                TEXT NOT NULL DEFAULT '[]',          -- JSON array
  initiative_accumulators TEXT NOT NULL DEFAULT '[]',          -- JSON array
  last_processed_event_id TEXT,
  last_action_at          INTEGER,
  last_rumination_pulse   INTEGER,
  arrival_pulse           INTEGER,
  created_at              INTEGER NOT NULL,
  updated_at              INTEGER NOT NULL,
  PRIMARY KEY (agent_id, simulation_id)
);

CREATE TABLE IF NOT EXISTS memories (
  id                  TEXT PRIMARY KEY,
  agent_id            TEXT NOT NULL,
  simulation_id       TEXT NOT NULL REFERENCES simulations(id) ON DELETE CASCADE,
  type                TEXT NOT NULL,
  subject_agent_ids   TEXT NOT NULL DEFAULT '[]',   -- JSON array
  source_event_ids    TEXT NOT NULL DEFAULT '[]',   -- JSON array
  summary             TEXT NOT NULL,
  emotional_tone      TEXT NOT NULL DEFAULT 'neutral',
  confidence          REAL NOT NULL DEFAULT 0.8,
  intensity           REAL NOT NULL DEFAULT 0,
  unresolved          INTEGER NOT NULL DEFAULT 0,   -- boolean
  created_at          INTEGER NOT NULL,
  last_reinforced_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_memories_agent_id ON memories(agent_id, simulation_id);

CREATE TABLE IF NOT EXISTS goal_self_verdicts (
  simulation_id TEXT NOT NULL REFERENCES simulations(id) ON DELETE CASCADE,
  goal_id       TEXT NOT NULL,
  verdict       TEXT NOT NULL,    -- JSON
  source        TEXT NOT NULL,
  updated_at    INTEGER NOT NULL,
  PRIMARY KEY (simulation_id, goal_id)
);
`;
