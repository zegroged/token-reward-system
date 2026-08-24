-- ══════════════════════════════════════════════════════════
-- MIGRATION 001 — Kritik Para Akışı & Güvenlik Düzeltmeleri
-- ══════════════════════════════════════════════════════════
-- Kapsam:
--   1. withdrawals: tx_hash UNIQUE (partial) + idempotency_key
--   2. withdrawals: status geçişleri için CHECK
--   3. users: wallet_address UNIQUE (partial, case-insensitive)
--   4. transactions: type='earn' → formula_version NOT NULL (CHECK)
--   5. instagram_data: (user_id, platform, reel_id, snapshot_number) UNIQUE
--   6. pool: advisory lock destekli trigger (race-free)
--   7. encryption_keys: key versiyon yönetim tablosu (multi-version rotation)
--
-- İdempotent: IF NOT EXISTS / DO blokları ile tekrar çalıştırılabilir.
-- ══════════════════════════════════════════════════════════

BEGIN;

-- ─────────────────────────────────────────────────────────
-- 1) WITHDRAWALS — idempotency_key + tx_hash UNIQUE
-- ─────────────────────────────────────────────────────────
ALTER TABLE withdrawals
    ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(64);

ALTER TABLE withdrawals
    ADD COLUMN IF NOT EXISTS retry_count INTEGER DEFAULT 0;

ALTER TABLE withdrawals
    ADD COLUMN IF NOT EXISTS last_error TEXT;

-- Kısmi UNIQUE: NULL'a izin ver, dolu olanlar benzersiz
CREATE UNIQUE INDEX IF NOT EXISTS uq_withdrawals_idempotency_key
    ON withdrawals (idempotency_key)
    WHERE idempotency_key IS NOT NULL;

-- tx_hash dolduğunda benzersiz olmalı (çift ödeme koruması)
CREATE UNIQUE INDEX IF NOT EXISTS uq_withdrawals_tx_hash
    ON withdrawals (tx_hash)
    WHERE tx_hash IS NOT NULL;

-- Status geçiş koruması: processing ve completed olanlar artık rollback edilemez
-- Uygulama tarafı 'approved → processing → completed/failed' akışını korumalı.
-- failed yeni bir terminal state olarak ekleniyor.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.check_constraints
        WHERE constraint_name = 'withdrawals_status_check_v2'
    ) THEN
        ALTER TABLE withdrawals DROP CONSTRAINT IF EXISTS withdrawals_status_check;
        ALTER TABLE withdrawals
            ADD CONSTRAINT withdrawals_status_check_v2
            CHECK (status IN ('pending', 'approved', 'processing', 'completed', 'rejected', 'failed'));
    END IF;
END $$;

-- ─────────────────────────────────────────────────────────
-- 2) USERS — wallet_address UNIQUE (partial, case-insensitive)
-- ─────────────────────────────────────────────────────────
-- TRC20 adresleri case-sensitive olsa da kullanıcı karışıklığını ve çoğaltmayı
-- önlemek için ToLower normalize + partial unique.
CREATE UNIQUE INDEX IF NOT EXISTS uq_users_wallet_address
    ON users (LOWER(wallet_address))
    WHERE wallet_address IS NOT NULL AND is_active = true;

-- ─────────────────────────────────────────────────────────
-- 3) TRANSACTIONS — earn için formula_version NOT NULL
-- ─────────────────────────────────────────────────────────
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.check_constraints
        WHERE constraint_name = 'transactions_earn_requires_formula'
    ) THEN
        ALTER TABLE transactions
            ADD CONSTRAINT transactions_earn_requires_formula
            CHECK (
                type <> 'earn'
                OR (type = 'earn' AND formula_version IS NOT NULL)
            );
    END IF;
END $$;

-- formula_version FK (data integrity)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'fk_transactions_formula_version'
    ) THEN
        ALTER TABLE transactions
            ADD CONSTRAINT fk_transactions_formula_version
            FOREIGN KEY (formula_version) REFERENCES formula_versions(version)
            DEFERRABLE INITIALLY DEFERRED;
    END IF;
END $$;

-- ─────────────────────────────────────────────────────────
-- 4) INSTAGRAM_DATA — çift sayım koruması
-- ─────────────────────────────────────────────────────────
-- Aynı kullanıcının aynı reel'inin aynı snapshot turunda iki kez girilmesini engelle
CREATE UNIQUE INDEX IF NOT EXISTS uq_instagram_data_user_reel_snapshot
    ON instagram_data (user_id, platform, reel_id, snapshot_number)
    WHERE reel_id IS NOT NULL AND user_id IS NOT NULL;

-- Sık sorgu için
CREATE INDEX IF NOT EXISTS idx_instagram_data_snapshot_at
    ON instagram_data(snapshot_at);

-- ─────────────────────────────────────────────────────────
-- 5) POOL — advisory lock ile race-free running_balance
-- ─────────────────────────────────────────────────────────
-- Sabit bir lock key (1 = "pool" namespace). Aynı transaction içinde yazan
-- herkes sıraya girer; running_balance TOCTOU yarışı elimine edilir.
CREATE OR REPLACE FUNCTION calculate_pool_running_balance()
RETURNS TRIGGER AS $$
DECLARE
    last_balance DECIMAL(15,2);
BEGIN
    -- Pool üzerindeki tüm yazıcılar bu lock için sıraya girer.
    -- XACT scope: commit/rollback ile otomatik bırakılır.
    PERFORM pg_advisory_xact_lock(hashtext('pool_running_balance'));

    SELECT COALESCE(
        (SELECT running_balance FROM pool ORDER BY created_at DESC, id DESC LIMIT 1),
        0
    ) INTO last_balance;

    IF NEW.action = 'deposit' THEN
        NEW.running_balance := last_balance + NEW.amount;
    ELSIF NEW.action IN ('distribution', 'withdrawal_out') THEN
        NEW.running_balance := last_balance - NEW.amount;
        IF NEW.running_balance < 0 THEN
            RAISE EXCEPTION 'Havuz bakiyesi yetersiz! Mevcut: %, İstenen: %',
                last_balance, NEW.amount
                USING ERRCODE = 'check_violation';
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Balance'ta negatif değere düşmesini hiçbir koşulda kabul etme
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.check_constraints
        WHERE constraint_name = 'pool_running_balance_nonneg'
    ) THEN
        ALTER TABLE pool
            ADD CONSTRAINT pool_running_balance_nonneg
            CHECK (running_balance >= 0);
    END IF;
END $$;

-- ─────────────────────────────────────────────────────────
-- 6) BALANCES — koruyucu CHECK (zaten var ama emin olalım)
-- ─────────────────────────────────────────────────────────
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.check_constraints
        WHERE constraint_name = 'chk_total_earned_nonneg'
    ) THEN
        ALTER TABLE balances
            ADD CONSTRAINT chk_total_earned_nonneg CHECK (total_earned >= 0);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.check_constraints
        WHERE constraint_name = 'chk_total_withdrawn_nonneg'
    ) THEN
        ALTER TABLE balances
            ADD CONSTRAINT chk_total_withdrawn_nonneg CHECK (total_withdrawn >= 0);
    END IF;
END $$;

-- ─────────────────────────────────────────────────────────
-- 7) ENCRYPTION KEYS — multi-version rotation desteği
-- ─────────────────────────────────────────────────────────
-- Token encryption key'i versiyonlu tutuluyor; rotation sırasında her
-- kullanıcı kendi versiyon numarasıyla okunup yeni versiyona yazılır.
-- Aktif (is_current = true) sadece bir key olabilir.
CREATE TABLE IF NOT EXISTS encryption_keys (
    version         INTEGER PRIMARY KEY,
    key_hash        VARCHAR(64) NOT NULL,              -- SHA256 of raw key (verification)
    is_current      BOOLEAN NOT NULL DEFAULT false,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    retired_at      TIMESTAMPTZ,
    rotated_by      UUID REFERENCES users(id),
    notes           TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_encryption_keys_one_current
    ON encryption_keys (is_current)
    WHERE is_current = true;

-- ─────────────────────────────────────────────────────────
-- 8) İNDEKS EKLEMELERİ — performans
-- ─────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_withdrawals_approved_at
    ON withdrawals(approved_at)
    WHERE status = 'approved';

CREATE INDEX IF NOT EXISTS idx_withdrawals_processing
    ON withdrawals(status, processed_at)
    WHERE status IN ('processing', 'approved');

COMMIT;
