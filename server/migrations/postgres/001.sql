-- Schema equivalent to SQLite v4; new PostgreSQL installations only.
CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
      password_hash TEXT NOT NULL, terms_version TEXT NOT NULL,
      accepted_at BIGINT NOT NULL, created_at BIGINT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS profiles (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      payload TEXT NOT NULL, updated_at BIGINT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at BIGINT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS resets (
      token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at BIGINT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS rate_limits (key TEXT PRIMARY KEY, count BIGINT NOT NULL, until BIGINT NOT NULL);
    CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS resets_user ON resets(user_id);
  

    CREATE TABLE IF NOT EXISTS training_plans (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      status TEXT NOT NULL CHECK(status IN ('saved','active','archived')), payload TEXT NOT NULL,
      version BIGINT NOT NULL DEFAULT 1, created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS one_active_plan ON training_plans(user_id) WHERE status='active';
    CREATE INDEX IF NOT EXISTS plans_owner ON training_plans(user_id,updated_at);
    CREATE TABLE IF NOT EXISTS workout_logs (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      plan_id TEXT REFERENCES training_plans(id) ON DELETE SET NULL, plan_ref TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('in_progress','completed','partial')), payload TEXT NOT NULL,
      version BIGINT NOT NULL DEFAULT 1, started_at BIGINT NOT NULL, finished_at BIGINT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS one_running_workout ON workout_logs(user_id) WHERE status='in_progress';
    CREATE INDEX IF NOT EXISTS workouts_owner_date ON workout_logs(user_id,started_at);
  

    CREATE TABLE user_preferences (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      payload TEXT NOT NULL, version BIGINT NOT NULL DEFAULT 1, updated_at BIGINT NOT NULL
    );
    CREATE TABLE calendar_events (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      date TEXT NOT NULL, payload TEXT NOT NULL, version BIGINT NOT NULL DEFAULT 1,
      created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL
    );
    CREATE INDEX calendar_owner_date ON calendar_events(user_id,date);
    CREATE TABLE ai_drafts (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      payload TEXT NOT NULL, created_at BIGINT NOT NULL, expires_at BIGINT NOT NULL
    );
    CREATE INDEX drafts_owner ON ai_drafts(user_id,expires_at);
  

      CREATE TABLE calendar_series (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        payload TEXT NOT NULL, version BIGINT NOT NULL DEFAULT 1,
        cancelled BIGINT NOT NULL DEFAULT 0, created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL
      );
      CREATE INDEX series_owner ON calendar_series(user_id);
      CREATE TABLE calendar_occurrences (
        series_id TEXT NOT NULL REFERENCES calendar_series(id) ON DELETE CASCADE,
        date TEXT NOT NULL, event_id TEXT UNIQUE REFERENCES calendar_events(id) ON DELETE SET NULL,
        exception BIGINT NOT NULL DEFAULT 0, PRIMARY KEY(series_id,date)
      );
      CREATE TABLE calendar_links (
        event_id TEXT PRIMARY KEY REFERENCES calendar_events(id) ON DELETE CASCADE,
        workout_id TEXT NOT NULL UNIQUE REFERENCES workout_logs(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE
      );
      CREATE INDEX links_owner ON calendar_links(user_id);
      CREATE TABLE plan_versions (
        plan_id TEXT NOT NULL REFERENCES training_plans(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        version BIGINT NOT NULL, status TEXT NOT NULL, payload TEXT NOT NULL,
        created_at BIGINT NOT NULL, PRIMARY KEY(plan_id,version)
      );
      CREATE INDEX versions_owner ON plan_versions(user_id,plan_id);
      
      CREATE FUNCTION gymia_record_plan_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.version <> OLD.version THEN
    INSERT INTO plan_versions VALUES(NEW.id,NEW.user_id,NEW.version,NEW.status,NEW.payload,NEW.updated_at);
    DELETE FROM plan_versions WHERE plan_id=NEW.id AND version NOT IN
      (SELECT version FROM plan_versions WHERE plan_id=NEW.id ORDER BY version DESC LIMIT 30);
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER plan_version AFTER INSERT OR UPDATE ON training_plans
  FOR EACH ROW EXECUTE FUNCTION gymia_record_plan_version();
CREATE INDEX workouts_owner_plan_date ON workout_logs(user_id,plan_ref,started_at DESC,id);
