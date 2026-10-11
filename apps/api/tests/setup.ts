process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'postgresql://medassist:medassist_dev_only@localhost:5432/medassist_test';
process.env.JWT_SECRET = 'test-secret-min-32-chars-long-xxxxxxxxxxxx';
process.env.JWT_EXPIRES_IN = '7d';
process.env.PORT = '3101';
process.env.LLM_PROVIDER = 'mock';
// Scrub real LLM keys so provider-config tests stay hermetic even when .env
// holds developer keys (dotenv never overrides existing vars, so empty wins).
process.env.GEMINI_API_KEY = '';
process.env.CEREBRAS_API_KEY = '';
process.env.HF_TOKEN = '';
