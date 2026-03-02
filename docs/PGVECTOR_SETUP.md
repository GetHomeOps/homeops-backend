# pgvector Setup

The `document_chunks` table and Document RAG (AI over property documents) require the [pgvector](https://github.com/pgvector/pgvector) extension. Install it before running `posDB.sql` or `pos-schema.sql`.

## macOS (Homebrew)

```bash
brew install pgvector
```

Then restart PostgreSQL if it's running as a service:

```bash
brew services restart postgresql@16   # or your version, e.g. postgresql@15
```

## Ubuntu / Debian

```bash
sudo apt install postgresql-16-pgvector   # or postgresql-15-pgvector for PG 15
```

If the package isn't available for your PostgreSQL version, build from source:

```bash
cd /tmp
git clone --branch v0.7.4 https://github.com/pgvector/pgvector.git
cd pgvector
make
sudo make install
```

## Docker

Use an image that includes pgvector:

```bash
docker run -d \
  --name postgres \
  -e POSTGRES_USER=youruser \
  -e POSTGRES_PASSWORD=yourpassword \
  -e POSTGRES_DB=posdb \
  -p 5432:5432 \
  ankane/pgvector
```

Or add pgvector to your existing PostgreSQL Dockerfile:

```dockerfile
FROM postgres:16
RUN apt-get update && apt-get install -y postgresql-16-pgvector
```

## Verify

After installation, connect to your database and run:

```sql
CREATE EXTENSION IF NOT EXISTS vector;
\dx
```

You should see `vector` in the list of extensions. Then run `posDB.sql` or `pos-schema.sql` as usual.
