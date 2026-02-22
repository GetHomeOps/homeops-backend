-- API Usage Tracking (per-user OpenAI cost tracking with monthly cap)
CREATE TABLE IF NOT EXISTS user_api_usage (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint VARCHAR(255) NOT NULL,
  model VARCHAR(100) NOT NULL,
  prompt_tokens INTEGER NOT NULL DEFAULT 0,
  completion_tokens INTEGER NOT NULL DEFAULT 0,
  total_cost NUMERIC(10, 6) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_api_usage_user_id ON user_api_usage(user_id);
CREATE INDEX IF NOT EXISTS idx_api_usage_created_at ON user_api_usage(created_at);
CREATE INDEX IF NOT EXISTS idx_api_usage_user_month ON user_api_usage(user_id, created_at);
