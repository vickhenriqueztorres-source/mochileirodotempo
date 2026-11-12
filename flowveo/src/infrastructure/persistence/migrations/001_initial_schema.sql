-- Migração 001: Schema Inicial Completo (Arquitetura §15)

CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS policy_versions (
  policy_version TEXT PRIMARY KEY,
  release_phase TEXT NOT NULL CHECK (release_phase IN ('A', 'B', 'C')),
  config_json TEXT NOT NULL,
  digest_sha256 TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS operator_approvals (
  approval_id TEXT PRIMARY KEY,
  scope_id TEXT NOT NULL,
  transition_id TEXT NOT NULL,
  operator_id TEXT NOT NULL,
  declared_purpose TEXT NOT NULL,
  before_state_digest TEXT NOT NULL,
  after_state_digest TEXT NOT NULL,
  approved_at TEXT NOT NULL,
  revoked_at TEXT
);

CREATE TABLE IF NOT EXISTS controller_leases (
  lease_id TEXT PRIMARY KEY,
  controller_epoch INTEGER NOT NULL UNIQUE,
  owner_pid INTEGER NOT NULL,
  owner_host TEXT NOT NULL,
  session_epoch INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('ACTIVE', 'RELEASED', 'REVOKED')),
  acquired_at TEXT NOT NULL,
  heartbeat_at TEXT NOT NULL,
  released_at TEXT
);

CREATE TABLE IF NOT EXISTS mapping_scopes (
  scope_id TEXT PRIMARY KEY,
  locale TEXT NOT NULL,
  viewport_width INTEGER NOT NULL,
  viewport_height INTEGER NOT NULL,
  account_context_id TEXT NOT NULL,
  project_context_id TEXT NOT NULL,
  creation_mode TEXT NOT NULL,
  observed_variant TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS registry_versions (
  registry_version TEXT PRIMARY KEY,
  scope_id TEXT NOT NULL REFERENCES mapping_scopes(scope_id),
  status TEXT NOT NULL CHECK (status IN ('DRAFT', 'VALIDATED', 'INVALIDATED')),
  states_not_observed_json TEXT NOT NULL,
  coverage_summary_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  invalidated_at TEXT,
  invalidation_reason TEXT
);

CREATE TABLE IF NOT EXISTS controls (
  control_id TEXT NOT NULL,
  registry_version TEXT NOT NULL REFERENCES registry_versions(registry_version),
  scope_id TEXT NOT NULL REFERENCES mapping_scopes(scope_id),
  page_state TEXT NOT NULL,
  container_id TEXT NOT NULL,
  candidates_json TEXT NOT NULL,
  expected_matches INTEGER NOT NULL CHECK (expected_matches = 1),
  observed_matches INTEGER NOT NULL,
  capabilities_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('candidate', 'validated', 'invalidated')),
  evidence_ids_json TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (control_id, registry_version)
);

CREATE TABLE IF NOT EXISTS transitions (
  transition_id TEXT NOT NULL,
  registry_version TEXT NOT NULL REFERENCES registry_versions(registry_version),
  scope_id TEXT NOT NULL REFERENCES mapping_scopes(scope_id),
  source_state TEXT NOT NULL,
  action_kind TEXT NOT NULL CHECK (action_kind IN ('READ', 'OPEN_UI', 'CONFIGURE', 'FILL', 'UPLOAD', 'SUBMIT', 'DOWNLOAD', 'LIFECYCLE')),
  control_id TEXT NOT NULL,
  preconditions_json TEXT NOT NULL,
  expected_postconditions_json TEXT NOT NULL,
  timeout_ms INTEGER NOT NULL,
  approved_for_modes_json TEXT NOT NULL,
  risk TEXT NOT NULL CHECK (risk IN ('low', 'medium', 'cost-bearing')),
  evidence_ids_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('candidate', 'validated', 'invalidated')),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (transition_id, registry_version)
);

CREATE TABLE IF NOT EXISTS jobs (
  job_id TEXT PRIMARY KEY,
  payload_version INTEGER NOT NULL,
  prompt_digest_sha256 TEXT NOT NULL,
  prompt_encrypted_or_ref TEXT NOT NULL,
  model TEXT NOT NULL,
  aspect_ratio TEXT NOT NULL,
  requested_outputs INTEGER NOT NULL CHECK (requested_outputs >= 1),
  start_frame_path TEXT,
  project_context_id TEXT NOT NULL,
  account_context_id TEXT NOT NULL,
  completion_policy_json TEXT NOT NULL,
  phase TEXT NOT NULL CHECK (phase IN ('PREFLIGHT', 'PREPARING', 'SUBMITTING', 'AWAITING_RESULTS', 'COLLECTING', 'VERIFYING', 'DONE')),
  status TEXT NOT NULL CHECK (status IN ('QUEUED', 'ACTIVE', 'PAUSED', 'NEEDS_REVIEW', 'COMPLETED', 'PARTIAL', 'FAILED', 'CANCELLED_LOCAL')),
  pause_reason TEXT CHECK (pause_reason IN ('AUTH', 'POLICY', 'UI_DRIFT', 'UNKNOWN_STATE', 'CONTROLLER_LOST', 'USER')),
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS job_attempts (
  attempt_id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES jobs(job_id),
  attempt_number INTEGER NOT NULL,
  controller_epoch INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('STARTED', 'FINISHED', 'INTERRUPTED', 'FAILED')),
  started_at TEXT NOT NULL,
  ended_at TEXT,
  UNIQUE (job_id, attempt_number)
);

CREATE TABLE IF NOT EXISTS submission_intents (
  submission_intent_id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL UNIQUE REFERENCES jobs(job_id),
  attempt_id TEXT NOT NULL REFERENCES job_attempts(attempt_id),
  status TEXT NOT NULL CHECK (status IN ('PLANNED', 'RESERVED', 'DISPATCHING', 'CONFIRMED', 'UNKNOWN', 'RECONCILING', 'NEEDS_REVIEW', 'ABORTED')),
  observed_config_digest TEXT NOT NULL,
  baseline_snapshot_json TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS remote_submissions (
  remote_submission_id TEXT PRIMARY KEY,
  submission_intent_id TEXT NOT NULL UNIQUE REFERENCES submission_intents(submission_intent_id),
  scope_id TEXT NOT NULL,
  remote_external_id TEXT,
  correlation_status TEXT NOT NULL CHECK (correlation_status IN ('CONFIRMED', 'AMBIGUOUS', 'NOT_OBSERVED')),
  observed_at TEXT NOT NULL,
  UNIQUE (scope_id, remote_external_id)
);

CREATE TABLE IF NOT EXISTS remote_results (
  remote_result_id TEXT PRIMARY KEY,
  remote_submission_id TEXT NOT NULL REFERENCES remote_submissions(remote_submission_id),
  result_index INTEGER NOT NULL,
  remote_asset_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('OBSERVED', 'PROCESSING', 'READY', 'FAILED_REMOTE', 'UNKNOWN')),
  version INTEGER NOT NULL DEFAULT 1,
  observed_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (remote_submission_id, result_index)
);

CREATE TABLE IF NOT EXISTS remote_observations (
  observation_id TEXT PRIMARY KEY,
  job_id TEXT,
  submission_intent_id TEXT,
  scope_id TEXT NOT NULL,
  is_virtualized_or_partial INTEGER NOT NULL CHECK (is_virtualized_or_partial IN (0, 1)),
  snapshot_sanitized_json TEXT NOT NULL,
  observed_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS correlation_decisions (
  decision_id TEXT PRIMARY KEY,
  submission_intent_id TEXT NOT NULL REFERENCES submission_intents(submission_intent_id),
  outcome TEXT NOT NULL CHECK (outcome IN ('CONFIRMED', 'AMBIGUOUS', 'NOT_OBSERVED')),
  matched_remote_id TEXT,
  rule_applied TEXT NOT NULL,
  evidence_json TEXT NOT NULL,
  operator_approved_by TEXT,
  decided_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS action_plans (
  plan_id TEXT PRIMARY KEY,
  job_id TEXT,
  attempt_id TEXT,
  submission_intent_id TEXT,
  mode TEXT NOT NULL,
  action_kind TEXT NOT NULL CHECK (action_kind IN ('READ', 'OPEN_UI', 'CONFIGURE', 'FILL', 'UPLOAD', 'SUBMIT', 'DOWNLOAD', 'LIFECYCLE')),
  target_control_id TEXT NOT NULL,
  transition_id TEXT NOT NULL,
  params_canonical_json TEXT NOT NULL,
  params_digest_sha256 TEXT NOT NULL,
  project_context_id TEXT NOT NULL,
  account_context_id TEXT NOT NULL,
  registry_version TEXT NOT NULL,
  policy_version TEXT NOT NULL,
  observed_config_digest TEXT NOT NULL,
  observed_revision INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS execution_permits (
  permit_id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL UNIQUE REFERENCES action_plans(plan_id),
  nonce TEXT NOT NULL UNIQUE,
  controller_epoch INTEGER NOT NULL,
  session_epoch INTEGER NOT NULL,
  page_id TEXT NOT NULL,
  job_id TEXT,
  attempt_id TEXT,
  submission_intent_id TEXT,
  action_kind TEXT NOT NULL,
  target_control_id TEXT NOT NULL,
  transition_id TEXT NOT NULL,
  params_digest_sha256 TEXT NOT NULL,
  project_context_id TEXT NOT NULL,
  account_context_id TEXT NOT NULL,
  registry_version TEXT NOT NULL,
  policy_version TEXT NOT NULL,
  observed_config_digest TEXT NOT NULL,
  observed_revision INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('ISSUED', 'CLAIMED', 'FINISHED', 'REVOKED', 'EXPIRED')),
  issued_at_ms INTEGER NOT NULL,
  expires_at_ms INTEGER NOT NULL,
  monotonic_issued_ns TEXT NOT NULL,
  monotonic_expires_ns TEXT NOT NULL,
  claimed_at_ms INTEGER,
  finished_at_ms INTEGER,
  revocation_reason TEXT,
  outcome_json TEXT
);

CREATE TABLE IF NOT EXISTS events (
  event_id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  correlation_id TEXT NOT NULL,
  job_id TEXT,
  controller_epoch INTEGER NOT NULL,
  policy_version TEXT NOT NULL,
  registry_version TEXT NOT NULL,
  reason TEXT NOT NULL,
  payload_sanitized_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS checkpoints (
  checkpoint_id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES jobs(job_id),
  phase TEXT NOT NULL,
  status TEXT NOT NULL,
  controller_epoch INTEGER NOT NULL,
  state_snapshot_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS artifacts (
  artifact_id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES jobs(job_id),
  submission_intent_id TEXT NOT NULL REFERENCES submission_intents(submission_intent_id),
  remote_submission_id TEXT NOT NULL REFERENCES remote_submissions(remote_submission_id),
  remote_result_id TEXT NOT NULL REFERENCES remote_results(remote_result_id),
  download_permit_id TEXT NOT NULL REFERENCES execution_permits(permit_id),
  internal_filename TEXT NOT NULL UNIQUE,
  remote_filename_sanitized TEXT NOT NULL,
  staging_path TEXT NOT NULL,
  final_path TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('PLANNED', 'DOWNLOADING', 'DOWNLOADED', 'VERIFYING', 'VERIFIED', 'REJECTED', 'MISSING')),
  size_bytes INTEGER,
  sha256 TEXT,
  container_format TEXT,
  duration_sec REAL,
  width INTEGER,
  height INTEGER,
  rejection_reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS artifact_links (
  link_id TEXT PRIMARY KEY,
  artifact_id TEXT NOT NULL UNIQUE REFERENCES artifacts(artifact_id),
  job_id TEXT NOT NULL REFERENCES jobs(job_id),
  submission_intent_id TEXT NOT NULL REFERENCES submission_intents(submission_intent_id),
  remote_submission_id TEXT NOT NULL REFERENCES remote_submissions(remote_submission_id),
  remote_result_id TEXT NOT NULL REFERENCES remote_results(remote_result_id),
  verified_chain_digest TEXT NOT NULL,
  linked_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS budget_reservations (
  reservation_id TEXT PRIMARY KEY,
  submission_intent_id TEXT NOT NULL UNIQUE REFERENCES submission_intents(submission_intent_id),
  job_id TEXT NOT NULL REFERENCES jobs(job_id),
  account_context_id TEXT NOT NULL,
  project_context_id TEXT NOT NULL,
  requested_outputs INTEGER NOT NULL CHECK (requested_outputs >= 1),
  status TEXT NOT NULL CHECK (status IN ('RESERVED', 'CONSUMED', 'HELD_UNKNOWN', 'RELEASED_ABORTED')),
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS usage_counters (
  counter_key TEXT PRIMARY KEY,
  submissions_count INTEGER NOT NULL DEFAULT 0,
  requested_outputs_count INTEGER NOT NULL DEFAULT 0,
  downloaded_bytes INTEGER NOT NULL DEFAULT 0,
  window_started_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS circuit_breaker_state (
  breaker_id TEXT PRIMARY KEY CHECK (breaker_id = 'GLOBAL'),
  status TEXT NOT NULL CHECK (status IN ('CLOSED', 'OPEN', 'HALF_OPEN')),
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  last_failure_reason TEXT,
  opened_at TEXT,
  updated_at TEXT NOT NULL
);
