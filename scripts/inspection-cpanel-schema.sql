-- RG Cars: inspection-only storage on cPanel MySQL/MariaDB (InnoDB).
-- Select the dedicated database in phpMyAdmin before importing this file.
-- The existing Supabase inventory/Auth are external references, never copied here.
-- Idempotent initial schema. Does not create database users or contain secrets.
SET NAMES utf8mb4;
SET time_zone = '+00:00';

CREATE TABLE IF NOT EXISTS rg_inspection_permissions (
  email VARCHAR(254) NOT NULL PRIMARY KEY,
  user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL UNIQUE,
  role ENUM('inspector','admin') NOT NULL,
  can_na TINYINT(1) NOT NULL DEFAULT 0,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- No permission is granted by importing the schema. Grant users separately
-- after reviewing scripts/inspection-cpanel-permissions.sql.

CREATE TABLE IF NOT EXISTS rg_inspection_vehicle_locks (
  vehicle_id VARCHAR(150) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL PRIMARY KEY
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS rg_inspection_scoring_configs (
  version VARCHAR(100) NOT NULL PRIMARY KEY,
  config LONGTEXT NOT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT rg_inspection_config_json CHECK (JSON_VALID(config))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS rg_inspections (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  vehicle_id VARCHAR(150) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  revision INT NOT NULL DEFAULT 1,
  status ENUM('draft','in_review','approved','published','archived') NOT NULL DEFAULT 'draft',
  document LONGTEXT NOT NULL,
  scoring_snapshot LONGTEXT NULL,
  created_by CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  approved_by CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  approved_at DATETIME(6) NULL,
  published_at DATETIME(6) NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  KEY rg_inspections_vehicle_history (vehicle_id,created_at),
  CONSTRAINT rg_inspections_vehicle_lock FOREIGN KEY (vehicle_id) REFERENCES rg_inspection_vehicle_locks(vehicle_id),
  CONSTRAINT rg_inspections_document_json CHECK (JSON_VALID(document)),
  CONSTRAINT rg_inspections_snapshot_json CHECK (scoring_snapshot IS NULL OR JSON_VALID(scoring_snapshot)),
  CONSTRAINT rg_inspections_positive_revision CHECK (revision > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- A single current pointer per vehicle is portable across MySQL and MariaDB.
CREATE TABLE IF NOT EXISTS rg_inspection_current (
  vehicle_id VARCHAR(150) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL PRIMARY KEY,
  inspection_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL UNIQUE,
  CONSTRAINT rg_inspection_current_vehicle FOREIGN KEY (vehicle_id) REFERENCES rg_inspection_vehicle_locks(vehicle_id),
  CONSTRAINT rg_inspection_current_report FOREIGN KEY (inspection_id) REFERENCES rg_inspections(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS rg_inspection_evidence (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  inspection_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  item_id VARCHAR(100) NOT NULL,
  storage_path VARCHAR(100) CHARACTER SET ascii COLLATE ascii_bin NOT NULL UNIQUE,
  mime_type ENUM('image/jpeg','image/png','image/webp') NOT NULL,
  size_bytes INT NOT NULL,
  caption VARCHAR(1000) NOT NULL DEFAULT '',
  approved_public TINYINT(1) NOT NULL DEFAULT 0,
  created_by CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  KEY rg_inspection_evidence_report (inspection_id,created_at),
  CONSTRAINT rg_inspection_evidence_parent FOREIGN KEY (inspection_id) REFERENCES rg_inspections(id),
  CONSTRAINT rg_inspection_evidence_size CHECK (size_bytes BETWEEN 1 AND 8388608)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS rg_inspection_audit (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  inspection_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  actor_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  action VARCHAR(40) NOT NULL,
  from_status VARCHAR(20) NULL,
  to_status VARCHAR(20) NOT NULL,
  revision INT NOT NULL,
  metadata LONGTEXT NOT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  KEY rg_inspection_audit_report (inspection_id,created_at),
  CONSTRAINT rg_inspection_audit_parent FOREIGN KEY (inspection_id) REFERENCES rg_inspections(id),
  CONSTRAINT rg_inspection_audit_json CHECK (JSON_VALID(metadata))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

DELIMITER $$
DROP TRIGGER IF EXISTS rg_inspections_freeze_update$$
CREATE TRIGGER rg_inspections_freeze_update BEFORE UPDATE ON rg_inspections FOR EACH ROW
BEGIN
  IF OLD.id <> NEW.id OR OLD.vehicle_id <> NEW.vehicle_id OR OLD.created_by <> NEW.created_by OR OLD.created_at <> NEW.created_at THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Inspection identity is immutable';
  END IF;
  IF OLD.approved_at IS NOT NULL AND (
    BINARY OLD.document <> BINARY NEW.document OR NOT (BINARY OLD.scoring_snapshot <=> BINARY NEW.scoring_snapshot)
    OR NOT (OLD.approved_by <=> NEW.approved_by) OR NOT (OLD.approved_at <=> NEW.approved_at)
    OR NEW.status NOT IN ('approved','published','archived')
  ) THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Approved inspection history is immutable'; END IF;
  IF NEW.status IN ('approved','published') AND (NEW.approved_at IS NULL OR NEW.approved_by IS NULL OR NEW.scoring_snapshot IS NULL) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Approval snapshot is required';
  END IF;
END$$
DROP TRIGGER IF EXISTS rg_inspections_no_delete$$
CREATE TRIGGER rg_inspections_no_delete BEFORE DELETE ON rg_inspections FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Inspection history cannot be deleted';
END$$
DROP TRIGGER IF EXISTS rg_inspection_evidence_insert$$
CREATE TRIGGER rg_inspection_evidence_insert BEFORE INSERT ON rg_inspection_evidence FOR EACH ROW
BEGIN
  DECLARE parent_status VARCHAR(20);
  SELECT status INTO parent_status FROM rg_inspections WHERE id=NEW.inspection_id FOR UPDATE;
  IF parent_status <> 'draft' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Evidence may change only in draft'; END IF;
END$$
DROP TRIGGER IF EXISTS rg_inspection_evidence_update$$
CREATE TRIGGER rg_inspection_evidence_update BEFORE UPDATE ON rg_inspection_evidence FOR EACH ROW
BEGIN
  DECLARE parent_status VARCHAR(20);
  SELECT status INTO parent_status FROM rg_inspections WHERE id=OLD.inspection_id FOR UPDATE;
  IF parent_status <> 'draft' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Evidence may change only in draft'; END IF;
  IF OLD.id <> NEW.id OR OLD.inspection_id <> NEW.inspection_id OR OLD.item_id <> NEW.item_id OR OLD.storage_path <> NEW.storage_path OR OLD.mime_type <> NEW.mime_type OR OLD.size_bytes <> NEW.size_bytes THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Evidence identity is immutable';
  END IF;
END$$
DROP TRIGGER IF EXISTS rg_inspection_evidence_delete$$
CREATE TRIGGER rg_inspection_evidence_delete BEFORE DELETE ON rg_inspection_evidence FOR EACH ROW
BEGIN
  DECLARE parent_status VARCHAR(20);
  SELECT status INTO parent_status FROM rg_inspections WHERE id=OLD.inspection_id FOR UPDATE;
  IF parent_status <> 'draft' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Evidence may change only in draft'; END IF;
END$$
DROP TRIGGER IF EXISTS rg_inspection_config_freeze$$
CREATE TRIGGER rg_inspection_config_freeze BEFORE UPDATE ON rg_inspection_scoring_configs FOR EACH ROW
BEGIN
  IF OLD.version <> NEW.version OR BINARY OLD.config <> BINARY NEW.config THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Configuration versions are immutable';
  END IF;
END$$
DROP TRIGGER IF EXISTS rg_inspection_audit_no_update$$
CREATE TRIGGER rg_inspection_audit_no_update BEFORE UPDATE ON rg_inspection_audit FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Audit history is immutable';
END$$
DROP TRIGGER IF EXISTS rg_inspection_audit_no_delete$$
CREATE TRIGGER rg_inspection_audit_no_delete BEFORE DELETE ON rg_inspection_audit FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Audit history is immutable';
END$$
DELIMITER ;
