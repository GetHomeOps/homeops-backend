-- Create ENUM types
CREATE TYPE role AS ENUM ('super_admin', 'admin','agent','homeowner');
CREATE TYPE db_role AS ENUM ('admin','agent','homeowner');
CREATE TYPE contact_type AS ENUM ('individual', 'company');

-- Users table
CREATE TABLE users(
    id SERIAL PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    name VARCHAR(100) NOT NULL,
    phone VARCHAR(50),
    role role DEFAULT 'admin',
    contact_id INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Databases table
CREATE TABLE databases(
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    url VARCHAR(255) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Databases Users table
CREATE TABLE user_databases(
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    database_id INTEGER REFERENCES databases(id) ON DELETE RESTRICT,
    role db_role DEFAULT 'admin',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, database_id)
);


-- Contacts Table
CREATE TABLE contacts (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    image VARCHAR(500),
    type INTEGER,
    phone VARCHAR(50),
    email VARCHAR(255),
    website VARCHAR(255),
    street1 VARCHAR(255),
    street2 VARCHAR(255),
    city VARCHAR(100),
    state VARCHAR(100),
    zip_code VARCHAR(20),
    country VARCHAR(100),
    country_code VARCHAR(10),
    notes TEXT,
    role VARCHAR(50),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Contacts Databases Junction Table
CREATE TABLE contacts_databases (
    contact_id INTEGER REFERENCES contacts(id) ON DELETE CASCADE,
    database_id INTEGER REFERENCES databases(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (contact_id, database_id)
);

-- User Invitations Table
CREATE TABLE user_invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMP NOT NULL,
  used_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT now()
);
