CREATE SEQUENCE IF NOT EXISTS lsa_association_id_seq START 101;


CREATE TABLE IF NOT EXISTS audit_logs (
    log_id SERIAL PRIMARY KEY,
    action VARCHAR(50) NOT NULL,
    table_name VARCHAR(100) NOT NULL,
    record_id INT NOT NULL,
    admin_id VARCHAR(100),
    old_data JSONB,
    new_data JSONB,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);


CREATE TABLE IF NOT EXISTS students (
    id SERIAL PRIMARY KEY,
    lsa_association_id VARCHAR(50) UNIQUE,

    full_name VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,
    dob DATE NOT NULL,
    passport_number VARCHAR(100),
    college_id VARCHAR(100),

    course VARCHAR(255),
    duration_of_study VARCHAR(100),
    year_of_admission INT,
    year_of_graduation INT,
    position VARCHAR(100),

    is_verified BOOLEAN DEFAULT FALSE,
    is_admin BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);


CREATE TABLE IF NOT EXISTS alumni (
    id SERIAL PRIMARY KEY,
    lsa_association_id VARCHAR(50) UNIQUE,

    full_name VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,
    dob DATE NOT NULL,
    passport_number VARCHAR(100),
    college_id VARCHAR(100),

    position_served VARCHAR(100),
    graduation_date DATE,

    is_verified BOOLEAN DEFAULT FALSE,
    is_admin BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);


CREATE OR REPLACE FUNCTION assign_lsa_id_on_verification()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.is_verified = TRUE AND OLD.is_verified = FALSE AND NEW.lsa_association_id IS NULL THEN
        NEW.lsa_association_id := 'LSA-' || nextval('lsa_association_id_seq');

        INSERT INTO audit_logs (action, table_name, record_id, admin_id, new_data)
        VALUES ('VERIFY', TG_TABLE_NAME, NEW.id, 'System/Admin', jsonb_build_object('lsa_association_id', NEW.lsa_association_id));
    END IF;

    NEW.updated_at = CURRENT_TIMESTAMP;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_student_verification ON students;
CREATE TRIGGER trigger_student_verification
    BEFORE UPDATE ON students
    FOR EACH ROW
    EXECUTE FUNCTION assign_lsa_id_on_verification();

DROP TRIGGER IF EXISTS trigger_alumni_verification ON alumni;
CREATE TRIGGER trigger_alumni_verification
    BEFORE UPDATE ON alumni
    FOR EACH ROW
    EXECUTE FUNCTION assign_lsa_id_on_verification();
CREATE OR REPLACE FUNCTION log_admin_updates()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO audit_logs (action, table_name, record_id, old_data, new_data)
    VALUES ('UPDATE', TG_TABLE_NAME, OLD.id, row_to_json(OLD)::jsonb, row_to_json(NEW)::jsonb);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_student_audit ON students;
CREATE TRIGGER trigger_student_audit AFTER UPDATE ON students FOR EACH ROW EXECUTE FUNCTION log_admin_updates();

DROP TRIGGER IF EXISTS trigger_alumni_audit ON alumni;
CREATE TRIGGER trigger_alumni_audit AFTER UPDATE ON alumni FOR EACH ROW EXECUTE FUNCTION log_admin_updates();

CREATE OR REPLACE VIEW admin_students_view AS
SELECT 
    *,
    EXTRACT(YEAR FROM AGE(CURRENT_DATE, dob)) AS current_age
FROM students;

CREATE OR REPLACE VIEW admin_alumni_view AS
SELECT 
    *,
    EXTRACT(YEAR FROM AGE(CURRENT_DATE, dob)) AS current_age
FROM alumni;

CREATE TABLE IF NOT EXISTS otp_logs (
    id SERIAL PRIMARY KEY,
    email_address VARCHAR(255) NOT NULL,
    ip_address VARCHAR(100),
    status VARCHAR(50) NOT NULL,
    attempt_count INT DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

