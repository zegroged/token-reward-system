-- ══════════════════════════════════════════════════════════
-- TOKEN ÖDÜL SİSTEMİ — VERİTABANI ŞEMASI
-- v5.0 — TikTok desteği, bildirim sistemi, platform alanı
-- ══════════════════════════════════════════════════════════

-- UUID extension
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ══════════════════════════════════════════
-- KULLANICILAR
-- ══════════════════════════════════════════
CREATE TABLE users (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email                   VARCHAR(255) UNIQUE NOT NULL,
    phone                   VARCHAR(20) UNIQUE,
    password_hash           VARCHAR(255) NOT NULL,
    full_name               VARCHAR(255) NOT NULL,
    role                    VARCHAR(20) DEFAULT 'employee'
                            CHECK (role IN ('employee', 'registrar', 'admin', 'super_admin')),
    -- Doğrulama
    email_verified          BOOLEAN DEFAULT false,
    phone_verified          BOOLEAN DEFAULT false,
    -- Instagram bağlantısı
    instagram_handle        VARCHAR(100),
    instagram_user_id       VARCHAR(50),
    instagram_token_enc     TEXT,
    instagram_token_iv      VARCHAR(32),
    instagram_token_expires TIMESTAMPTZ,
    instagram_connected_at  TIMESTAMPTZ,
    encryption_key_version  INTEGER DEFAULT 1,
    -- TikTok bağlantısı
    tiktok_handle           VARCHAR(100),
    tiktok_user_id          VARCHAR(50),
    tiktok_token_enc        TEXT,
    tiktok_token_iv         VARCHAR(32),
    tiktok_token_expires    TIMESTAMPTZ,
    tiktok_refresh_token_enc TEXT,
    tiktok_refresh_iv       VARCHAR(32),
    tiktok_connected_at     TIMESTAMPTZ,
    -- Cüzdan
    wallet_address          VARCHAR(255),
    wallet_network          VARCHAR(20) DEFAULT 'TRC20',
    -- Hesap durumu
    is_active               BOOLEAN DEFAULT true,
    deactivated_at          TIMESTAMPTZ,
    withdrawal_deadline     TIMESTAMPTZ,
    -- KVKK
    kvkk_consent            BOOLEAN DEFAULT false,
    kvkk_consent_at         TIMESTAMPTZ,
    kvkk_data_processing    BOOLEAN DEFAULT false,
    kvkk_retention_accepted BOOLEAN DEFAULT false,
    -- 2FA (sadece admin)
    totp_secret_enc         TEXT,
    totp_enabled            BOOLEAN DEFAULT false,
    -- Güvenlik
    failed_login_attempts   INTEGER DEFAULT 0,
    locked_until            TIMESTAMPTZ,
    last_login_ip           VARCHAR(45),
    last_login_city         VARCHAR(100),
    force_password_change   BOOLEAN DEFAULT false,
    -- Kimin kaydettiği
    registered_by_id        UUID REFERENCES users(id),
    -- Zaman damgaları
    created_at              TIMESTAMPTZ DEFAULT NOW(),
    updated_at              TIMESTAMPTZ DEFAULT NOW()
);

-- ══════════════════════════════════════════
-- TOKEN BAKİYELERİ
-- ══════════════════════════════════════════
CREATE TABLE balances (
    user_id                 UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    available               DECIMAL(15,2) DEFAULT 0,
    pending                 DECIMAL(15,2) DEFAULT 0,
    total_earned            DECIMAL(15,2) DEFAULT 0,
    total_withdrawn         DECIMAL(15,2) DEFAULT 0,
    updated_at              TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT chk_available CHECK (available >= 0),
    CONSTRAINT chk_pending CHECK (pending >= 0)
);

-- ══════════════════════════════════════════
-- TOKEN HAVUZU
-- ══════════════════════════════════════════
CREATE TABLE pool (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    action                  VARCHAR(20) NOT NULL
                            CHECK (action IN ('deposit', 'distribution', 'withdrawal_out')),
    amount                  DECIMAL(15,2) NOT NULL,
    running_balance         DECIMAL(15,2) NOT NULL,
    description             TEXT,
    admin_id                UUID REFERENCES users(id),
    created_at              TIMESTAMPTZ DEFAULT NOW()
);

-- Pool balance trigger: running_balance otomatik hesaplama
-- ★ RACE-FREE: Eşzamanlı INSERT'ler pg_advisory_xact_lock ile serileştirilir.
CREATE OR REPLACE FUNCTION calculate_pool_running_balance()
RETURNS TRIGGER AS $$
DECLARE
    last_balance DECIMAL(15,2);
BEGIN
    -- Pool yazıcıları tek kuyruğa girer; transaction sonunda otomatik serbest kalır.
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

CREATE TRIGGER trg_pool_running_balance
    BEFORE INSERT ON pool
    FOR EACH ROW EXECUTE FUNCTION calculate_pool_running_balance();

-- Negatif running_balance güvencesi
ALTER TABLE pool ADD CONSTRAINT pool_running_balance_nonneg CHECK (running_balance >= 0);

-- ══════════════════════════════════════════
-- İŞLEM GEÇMİŞİ (IMMUTABLE)
-- ══════════════════════════════════════════
CREATE TABLE transactions (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id                 UUID REFERENCES users(id),
    type                    VARCHAR(20) NOT NULL
                            CHECK (type IN ('earn', 'withdraw', 'penalty', 'bonus', 'adjustment')),
    amount                  DECIMAL(15,2) NOT NULL,
    description             TEXT,
    formula_version         VARCHAR(10),
    raw_input               JSONB,
    calculated_check        DECIMAL(15,2),
    reference_type          VARCHAR(30),
    reference_id            UUID,
    created_at              TIMESTAMPTZ DEFAULT NOW(),
    -- ★ earn türündeki her işlem hangi formülle ödendiğini kayıt altına almalı
    CONSTRAINT transactions_earn_requires_formula CHECK (
        type <> 'earn' OR (type = 'earn' AND formula_version IS NOT NULL)
    )
);

-- Immutable trigger
CREATE OR REPLACE FUNCTION prevent_transaction_mutation()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'transactions tablosu immutable — UPDATE/DELETE yasak';
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_no_update_transactions
    BEFORE UPDATE OR DELETE ON transactions
    FOR EACH ROW EXECUTE FUNCTION prevent_transaction_mutation();

-- ══════════════════════════════════════════
-- INSTAGRAM + TIKTOK VERİ KAYITLARI
-- ══════════════════════════════════════════
CREATE TABLE instagram_data (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id                 UUID REFERENCES users(id),
    platform                VARCHAR(20) DEFAULT 'instagram'
                            CHECK (platform IN ('instagram', 'tiktok')),
    reel_id                 VARCHAR(255),
    reel_url                TEXT,
    collected_at            TIMESTAMPTZ DEFAULT NOW(),
    source                  VARCHAR(20) DEFAULT 'api'
                            CHECK (source IN ('api', 'manual_form', 'manual')),
    -- Multi-Snapshot
    snapshot_number         INTEGER DEFAULT 1,   -- 1=T+2h, 2=T+8h, 3=T+24h(final)
    snapshot_at             TIMESTAMPTZ DEFAULT NOW(),
    -- Ham metrikler
    view_count              INTEGER DEFAULT 0,
    like_count              INTEGER DEFAULT 0,
    comment_count           INTEGER DEFAULT 0,
    save_count              INTEGER DEFAULT 0,
    share_count             INTEGER DEFAULT 0,
    reach                   INTEGER DEFAULT 0,
    impressions             INTEGER DEFAULT 0,
    follower_count          INTEGER DEFAULT 0,
    -- Hesaplanan metrikler
    engagement_rate         DECIMAL(8,6),
    view_velocity_1h        DECIMAL(10,2),
    view_velocity_6h        DECIMAL(10,2),
    view_velocity_24h       DECIMAL(10,2),
    historical_zscore       DECIMAL(8,4),
    -- Analiz sonuçları
    analysis_level          VARCHAR(20)
                            CHECK (analysis_level IN ('rule', 'statistical', 'ml', 'ai', 'full', 'pending')),
    authenticity_score      DECIMAL(5,2),
    is_authentic            BOOLEAN,
    flagged                 BOOLEAN DEFAULT false,
    flag_reasons            JSONB,
    -- AI analiz
    ai_score                DECIMAL(5,2),
    ai_risk                 VARCHAR(20),
    ai_reason               TEXT,
    ai_source               VARCHAR(20),
    -- Büyüme eğrisi
    growth_curve_score      DECIMAL(5,2),
    growth_pattern          VARCHAR(30),
    -- Admin review
    admin_reviewed          BOOLEAN DEFAULT false,
    admin_override          BOOLEAN,
    admin_id                UUID REFERENCES users(id),
    admin_notes             TEXT,
    reviewed_at             TIMESTAMPTZ,
    -- Kampanya doğrulama
    campaign_id             UUID,              -- campaigns tablosu henüz oluşmamış olabilir
    campaign_verified       BOOLEAN DEFAULT false,
    tag_found               BOOLEAN DEFAULT false,
    content_match_score     DECIMAL(5,2),
    duration_match          BOOLEAN,
    -- Raw API response
    raw_api_response        JSONB
);

-- ══════════════════════════════════════════
-- ÇEKİM TALEPLERİ
-- ══════════════════════════════════════════
CREATE TABLE withdrawals (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id                 UUID REFERENCES users(id),
    amount_token            DECIMAL(15,2) NOT NULL,
    amount_usdt             DECIMAL(15,4),
    exchange_rate           DECIMAL(15,6),
    wallet_address          VARCHAR(255) NOT NULL,
    wallet_network          VARCHAR(20) DEFAULT 'TRC20',
    status                  VARCHAR(20) DEFAULT 'pending'
                            CHECK (status IN ('pending', 'approved', 'processing', 'completed', 'rejected', 'failed', 'unconfirmed')),
    admin_id                UUID REFERENCES users(id),
    admin_notes             TEXT,
    tx_hash                 VARCHAR(255),
    tx_confirmed            BOOLEAN DEFAULT false,
    -- ★ Idempotency: retry güvenliği + çift ödeme önleme
    idempotency_key         VARCHAR(64),
    retry_count             INTEGER DEFAULT 0,
    last_error              TEXT,
    requested_at            TIMESTAMPTZ DEFAULT NOW(),
    approved_at             TIMESTAMPTZ,
    processed_at            TIMESTAMPTZ,
    completed_at            TIMESTAMPTZ
);

-- tx_hash dolduğunda benzersiz (aynı TX iki withdrawal'a yazılamaz)
CREATE UNIQUE INDEX uq_withdrawals_tx_hash
    ON withdrawals (tx_hash) WHERE tx_hash IS NOT NULL;

-- Idempotency key benzersizliği
CREATE UNIQUE INDEX uq_withdrawals_idempotency_key
    ON withdrawals (idempotency_key) WHERE idempotency_key IS NOT NULL;

-- ══════════════════════════════════════════
-- KAMPANYALAR (Reklam Görevleri)
-- ══════════════════════════════════════════
CREATE TABLE campaigns (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title                   VARCHAR(255) NOT NULL,           -- "Pepsi Yaz 2026"
    brand_name              VARCHAR(255),                    -- "Pepsi"
    brand_account           VARCHAR(100) NOT NULL,           -- "@pepsi_tr" (etiketlenecek)
    platform                VARCHAR(20) DEFAULT 'both'
                            CHECK (platform IN ('instagram', 'tiktok', 'both')),
    description             TEXT,                            -- Kampanya talimatları
    keywords                TEXT[],                          -- AI eşleşme kelimeleri
    reference_url           TEXT,                            -- Orijinal video URL
    reference_thumbnail     TEXT,                            -- Thumbnail URL (pixel karşılaştırma)
    reference_duration_sec  INTEGER,                         -- Video süresi (saniye)
    reference_phash         VARCHAR(64),                     -- Perceptual hash (görsel parmak izi)
    status                  VARCHAR(20) DEFAULT 'active'
                            CHECK (status IN ('draft', 'active', 'paused', 'completed')),
    start_date              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    end_date                TIMESTAMPTZ,
    created_by              UUID REFERENCES users(id),
    created_at              TIMESTAMPTZ DEFAULT NOW()
);

-- ══════════════════════════════════════════
-- KAMPANYA ÖDEMELERİ (tek seferlik garanti)
-- ══════════════════════════════════════════
CREATE TABLE campaign_payments (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id             UUID REFERENCES campaigns(id) NOT NULL,
    user_id                 UUID REFERENCES users(id) NOT NULL,
    reel_id                 VARCHAR(255) NOT NULL,
    platform                VARCHAR(20),
    tokens_paid             DECIMAL(15,2) NOT NULL,
    verification_result     JSONB,           -- AI doğrulama detayları
    paid_at                 TIMESTAMPTZ DEFAULT NOW(),
    -- ★ FIX L9: BİR KAMPANYADA BİR REEL BİR KEZ ÖDENİR
    -- Farklı reeller aynı kampanyadan ödenebilir (çoklu video desteği)
    UNIQUE(campaign_id, user_id, reel_id)
);

-- ══════════════════════════════════════════
-- ML EĞİTİM VERİSİ
-- ══════════════════════════════════════════
CREATE TABLE ml_training_data (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    instagram_data_id       UUID REFERENCES instagram_data(id),
    labeled_by              UUID REFERENCES users(id),
    is_authentic            BOOLEAN NOT NULL,
    confidence              DECIMAL(5,2),
    notes                   TEXT,
    labeled_at              TIMESTAMPTZ DEFAULT NOW()
);

-- ══════════════════════════════════════════
-- FORMÜL VERSİYONLARI (IMMUTABLE)
-- ══════════════════════════════════════════
CREATE TABLE formula_versions (
    version                 VARCHAR(10) PRIMARY KEY,
    base_rate               DECIMAL(10,4) NOT NULL,
    engagement_multiplier   DECIMAL(5,2) DEFAULT 1.0,
    daily_cap               DECIMAL(15,2),
    min_authenticity_score  DECIMAL(5,2) DEFAULT 70,
    effective_from          TIMESTAMPTZ NOT NULL,
    effective_until         TIMESTAMPTZ,
    created_by              UUID REFERENCES users(id),
    created_at              TIMESTAMPTZ DEFAULT NOW()
);

-- İlk formül (v1 — baseline)
-- base_rate: 1000 view = 10 TOKEN, engagement_multiplier devre dışı (kampanya modu)
INSERT INTO formula_versions (version, base_rate, engagement_multiplier, daily_cap, min_authenticity_score, effective_from)
VALUES ('v1', 0.01, 1.0, 500, 70, NOW());

-- Production formülü (v2 — kampanya odaklı)
-- ★ base_rate 0.03 (system_settings.token_per_view ile uyumlu)
-- ★ engagement_multiplier 1.0 (reklam içeriklerinde düşük etkileşim normal)
-- ★ daily_cap 1000 (yüksek performanslı çalışanlar için artırıldı)
-- ★ min_authenticity_score 70 (5-katman analiz sonrası yeterli)
INSERT INTO formula_versions (version, base_rate, engagement_multiplier, daily_cap, min_authenticity_score, effective_from)
VALUES ('v2', 0.03, 1.0, 1000, 70, NOW());

-- Formül immutable trigger
CREATE OR REPLACE FUNCTION prevent_formula_mutation()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'formula_versions tablosu immutable — UPDATE/DELETE yasak. Yeni versiyon ekleyin.';
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_no_update_formulas
    BEFORE UPDATE OR DELETE ON formula_versions
    FOR EACH ROW EXECUTE FUNCTION prevent_formula_mutation();

-- ══════════════════════════════════════════
-- AUDIT LOG
-- ══════════════════════════════════════════
CREATE TABLE audit_log (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id                 UUID REFERENCES users(id),
    action                  VARCHAR(100) NOT NULL,
    details                 JSONB,
    ip_address              VARCHAR(45),
    user_agent              TEXT,
    created_at              TIMESTAMPTZ DEFAULT NOW()
);

-- ══════════════════════════════════════════
-- BOT ÇALIŞMA KAYITLARI
-- ══════════════════════════════════════════
CREATE TABLE bot_runs (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    started_at              TIMESTAMPTZ NOT NULL,
    completed_at            TIMESTAMPTZ,
    status                  VARCHAR(20) DEFAULT 'running'
                            CHECK (status IN ('running', 'completed', 'failed', 'partial')),
    total_users             INTEGER,
    successful_users        INTEGER,
    failed_users            INTEGER,
    total_reels_analyzed    INTEGER,
    total_tokens_distributed DECIMAL(15,2),
    flagged_count           INTEGER,
    pool_balance_after      DECIMAL(15,2),
    error_log               JSONB,
    report_sent             BOOLEAN DEFAULT false,
    key_rotation_performed  BOOLEAN DEFAULT false
);

-- ══════════════════════════════════════════
-- KVKK VERİ SAKLAMA POLİTİKASI
-- ══════════════════════════════════════════
CREATE TABLE data_retention_policy (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    data_type               VARCHAR(50) NOT NULL,
    retention_days          INTEGER NOT NULL,
    description             TEXT,
    created_at              TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO data_retention_policy (data_type, retention_days, description) VALUES
('instagram_data', 365, 'Instagram verileri 1 yıl saklanır'),
('audit_log', 730, 'Audit logları 2 yıl saklanır'),
('transactions', 3650, 'Finansal işlemler 10 yıl saklanır (muhasebe)'),
('bot_runs', 365, 'Bot çalışma kayıtları 1 yıl saklanır'),
('ml_training_data', 730, 'ML eğitim verileri 2 yıl saklanır');

-- KVKK: Kullanıcı anonimleştirme
CREATE OR REPLACE FUNCTION anonymize_user(target_user_id UUID)
RETURNS VOID AS $$
BEGIN
    UPDATE users SET
        email = 'deleted_' || target_user_id || '@anonymized',
        full_name = 'Silinmiş Kullanıcı',
        password_hash = 'ANONYMIZED',
        instagram_handle = NULL,
        instagram_user_id = NULL,
        instagram_token_enc = NULL,
        instagram_token_iv = NULL,
        tiktok_handle = NULL,
        tiktok_user_id = NULL,
        tiktok_token_enc = NULL,
        tiktok_token_iv = NULL,
        tiktok_refresh_token_enc = NULL,
        tiktok_refresh_iv = NULL,
        wallet_address = NULL,
        totp_secret_enc = NULL,
        is_active = false,
        deactivated_at = NOW(),
        updated_at = NOW()
    WHERE id = target_user_id;

    -- ★ FIX O13: Bakiye sıfırlama öncesi ledger kaydı (denetlenebilirlik)
    INSERT INTO transactions (user_id, type, amount, description, formula_version)
    SELECT target_user_id, 'adjustment',
           -(b.available + b.pending),
           'KVKK anonimleştirme — bakiye sıfırlama',
           'v1'
    FROM balances b WHERE b.user_id = target_user_id AND (b.available > 0 OR b.pending > 0);

    UPDATE balances SET
        available = 0,
        pending = 0,
        updated_at = NOW()
    WHERE user_id = target_user_id;

    INSERT INTO audit_log (user_id, action, details)
    VALUES (target_user_id, 'user_anonymized', '{"reason": "KVKK hakkı kullanımı"}'::jsonb);
END;
$$ LANGUAGE plpgsql;

-- ══════════════════════════════════════════
-- BİLDİRİMLER (★ FIX O1: İndekslerden ÖNCE oluşturulmalı)
-- ══════════════════════════════════════════
CREATE TABLE IF NOT EXISTS notifications (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID REFERENCES users(id) ON DELETE CASCADE,
    type        VARCHAR(30) NOT NULL
                CHECK (type IN ('info', 'warning', 'error', 'success', 'system')),
    title       VARCHAR(255) NOT NULL,
    message     TEXT NOT NULL,
    is_read     BOOLEAN DEFAULT false,
    link        VARCHAR(500),
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ══════════════════════════════════════════
-- İNDEKSLER
-- ══════════════════════════════════════════
CREATE INDEX idx_transactions_user_id ON transactions(user_id);
CREATE INDEX idx_transactions_created_at ON transactions(created_at);
CREATE INDEX idx_transactions_type ON transactions(type);
CREATE INDEX idx_instagram_data_user_id ON instagram_data(user_id);
CREATE INDEX idx_instagram_data_collected_at ON instagram_data(collected_at);
CREATE INDEX idx_instagram_data_flagged ON instagram_data(flagged) WHERE flagged = true;
CREATE INDEX idx_withdrawals_status ON withdrawals(status);
CREATE INDEX idx_withdrawals_user_id ON withdrawals(user_id);
CREATE INDEX idx_audit_log_user_id ON audit_log(user_id);
CREATE INDEX idx_audit_log_action ON audit_log(action);
CREATE INDEX idx_audit_log_created_at ON audit_log(created_at);
CREATE INDEX idx_bot_runs_started_at ON bot_runs(started_at);
CREATE INDEX idx_users_instagram_token_expires ON users(instagram_token_expires);
CREATE INDEX idx_users_encryption_key_version ON users(encryption_key_version);
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_phone ON users(phone);
CREATE INDEX idx_pool_created_at ON pool(created_at);
CREATE INDEX idx_users_tiktok_token_expires ON users(tiktok_token_expires);
CREATE INDEX idx_instagram_data_platform ON instagram_data(platform);
CREATE INDEX idx_notifications_user_id ON notifications(user_id);
CREATE INDEX idx_notifications_is_read ON notifications(is_read) WHERE is_read = false;

-- ★ Anti-sybil: aynı cüzdana birden fazla aktif hesap kaydedilemez
CREATE UNIQUE INDEX uq_users_wallet_address
    ON users (LOWER(wallet_address))
    WHERE wallet_address IS NOT NULL AND is_active = true;

-- ★ Reel çift sayım koruması
CREATE UNIQUE INDEX uq_instagram_data_user_reel_snapshot
    ON instagram_data (user_id, platform, reel_id, snapshot_number)
    WHERE reel_id IS NOT NULL AND user_id IS NOT NULL;

CREATE INDEX idx_instagram_data_snapshot_at ON instagram_data(snapshot_at);

-- ★ FIX O11: campaign_id FK (campaigns tablosu init.sql'de daha önce oluşuyor)
ALTER TABLE instagram_data
    ADD CONSTRAINT fk_instagram_data_campaign
    FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE SET NULL;
CREATE INDEX idx_withdrawals_approved_at
    ON withdrawals(approved_at) WHERE status = 'approved';
CREATE INDEX idx_withdrawals_processing
    ON withdrawals(status, processed_at)
    WHERE status IN ('processing', 'approved');

-- ★ earn transaction'ları geçerli formula_version'a referans vermeli
-- ★ FIX O10: IMMEDIATE — FK ihlali INSERT anında yakalanır (rollback riski azalır)
ALTER TABLE transactions
    ADD CONSTRAINT fk_transactions_formula_version
    FOREIGN KEY (formula_version) REFERENCES formula_versions(version);

-- ★ Balance bütünlük güvenceleri
ALTER TABLE balances
    ADD CONSTRAINT chk_total_earned_nonneg CHECK (total_earned >= 0),
    ADD CONSTRAINT chk_total_withdrawn_nonneg CHECK (total_withdrawn >= 0);

-- ══════════════════════════════════════════
-- ENCRYPTION KEYS — multi-version rotation
-- ══════════════════════════════════════════
CREATE TABLE encryption_keys (
    version         INTEGER PRIMARY KEY,
    key_hash        VARCHAR(64) NOT NULL,
    is_current      BOOLEAN NOT NULL DEFAULT false,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    retired_at      TIMESTAMPTZ,
    rotated_by      UUID REFERENCES users(id),
    notes           TEXT
);

CREATE UNIQUE INDEX uq_encryption_keys_one_current
    ON encryption_keys (is_current) WHERE is_current = true;

-- ══════════════════════════════════════════
-- AUTO-UPDATE updated_at TRIGGER
-- ══════════════════════════════════════════
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_balances_updated_at
    BEFORE UPDATE ON balances
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ══════════════════════════════════════════
-- İLK ADMIN HESABI
-- ══════════════════════════════════════════
-- ⚠️  KRİTİK: Bu şifre ("Admin123!") SADECE ilk kurulum içindir!
-- ⚠️  Canlıya geçmeden önce admin panelden şifre DEĞİŞTİRİLMELİDİR.
-- ⚠️  force_password_change = true → ilk girişte şifre değişikliği zorlanır.
INSERT INTO users (email, password_hash, full_name, role, kvkk_consent, kvkk_consent_at, kvkk_data_processing, kvkk_retention_accepted, force_password_change)
VALUES (
    'admin@sistem.local',
    '$2b$12$MUSd0jSF8UxDar2uwYHU7eZPdcvM30shV4xfWG2H6GDDnIk2S9gOG',
    'Sistem Admin',
    'super_admin',
    true, NOW(), true, true,
    true  -- ★ İlk girişte şifre değişikliği zorunlu
);

-- Admin bakiye kaydı
INSERT INTO balances (user_id)
SELECT id FROM users WHERE email = 'admin@sistem.local';

-- ══════════════════════════════════════════
-- SİSTEM AYARLARI
-- ══════════════════════════════════════════
CREATE TABLE IF NOT EXISTS system_settings (
    key         VARCHAR(100) PRIMARY KEY,
    value       TEXT NOT NULL,
    updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Varsayılan ayarlar
INSERT INTO system_settings (key, value) VALUES
    ('token_per_view', '0.03'),
    ('min_withdrawal', '100'),
    ('max_daily_withdrawal', '5000'),
    ('token_to_usdt', '0.0305'),
    ('bot_run_hour', '4'),
    ('bot_run_minute', '0'),
    ('maintenance_mode', 'false'),
    ('registration_open', 'true'),
    ('max_sessions', '3'),
    ('auto_approve_withdrawals', 'false')
ON CONFLICT (key) DO NOTHING;


