-- Create ENUM types
CREATE TYPE user_role AS ENUM ('super_admin','user','agent','homeowner');
CREATE TYPE db_role AS ENUM ('admin','agent','homeowner');
CREATE TYPE contact_type AS ENUM ('individual', 'company');
CREATE TYPE weight_unit AS ENUM ('kg', 'g', 'lb', 'oz');
CREATE TYPE volume_unit AS ENUM ('l', 'ml', 'gal', 'qt', 'pt', 'fl_oz');
CREATE TYPE time_unit AS ENUM ('days', 'weeks', 'months');

-- Users table
CREATE TABLE users(
    id SERIAL PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    full_name VARCHAR(100) NOT NULL,
    role user_role DEFAULT 'user',
    is_active BOOLEAN DEFAULT true,
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

-- Product Categories Table
CREATE TABLE prod_categories (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Taxes Table
CREATE TABLE taxes (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    rate DECIMAL(5,2) NOT NULL,
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Product Types Table
CREATE TABLE product_types (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    description TEXT
);

-- Products Table
CREATE TABLE products (
    id SERIAL PRIMARY KEY,
    database_id INTEGER REFERENCES databases(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    for_sale BOOLEAN DEFAULT false,
    for_purchase BOOLEAN DEFAULT false,
    type_id INTEGER REFERENCES product_types(id) ON DELETE SET NULL,
    track_inventory BOOLEAN DEFAULT false,
    quantity_on_hand DECIMAL(15,2) DEFAULT 0,
    sales_price DECIMAL(15,2),
    cost DECIMAL(15,2),
    reference VARCHAR(255),
    barcode VARCHAR(255),
    responsible_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    weight DECIMAL(15,2),
    weight_unit weight_unit,
    volume DECIMAL(15,2),
    volume_unit volume_unit,
    lead_time INTEGER,
    lead_time_unit time_unit,
    delivery_note TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Product Categories Junction Table
CREATE TABLE products_categories (
    product_id INTEGER REFERENCES products(id) ON DELETE CASCADE,
    category_id INTEGER REFERENCES prod_categories(id) ON DELETE CASCADE,
    PRIMARY KEY (product_id, category_id)
);

-- Product Sales Taxes Junction Table
CREATE TABLE products_sales_taxes (
    product_id INTEGER REFERENCES products(id) ON DELETE CASCADE,
    tax_id INTEGER REFERENCES taxes(id) ON DELETE CASCADE,
    PRIMARY KEY (product_id, tax_id)
);

-- Product Purchase Taxes Junction Table
CREATE TABLE products_purchase_taxes (
    product_id INTEGER REFERENCES products(id) ON DELETE CASCADE,
    tax_id INTEGER REFERENCES taxes(id) ON DELETE CASCADE,
    PRIMARY KEY (product_id, tax_id)
);

-- Contacts Table
CREATE TABLE contacts (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255),
    phone VARCHAR(50),
    website VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Product Vendors Junction Table
CREATE TABLE products_vendors (
    product_id INTEGER REFERENCES products(id) ON DELETE CASCADE,
    vendor_id INTEGER REFERENCES contacts(id) ON DELETE CASCADE,
    PRIMARY KEY (product_id, vendor_id)
);
