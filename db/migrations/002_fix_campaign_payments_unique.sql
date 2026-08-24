-- ══════════════════════════════════════════
-- FIX L9: campaign_payments UNIQUE constraint güncelleme
-- Eski: UNIQUE(campaign_id, user_id)  → Bir kampanyada kullanıcıya tek ödeme
-- Yeni: UNIQUE(campaign_id, user_id, reel_id) → Bir kampanyada bir reel bir kez ödenir
-- ══════════════════════════════════════════

-- Mevcut constraint'i kaldır
ALTER TABLE campaign_payments DROP CONSTRAINT IF EXISTS campaign_payments_campaign_id_user_id_key;

-- Yeni constraint ekle (reel_id dahil)
ALTER TABLE campaign_payments ADD CONSTRAINT campaign_payments_campaign_id_user_id_reel_id_key
    UNIQUE(campaign_id, user_id, reel_id);

-- Bilgi
COMMENT ON CONSTRAINT campaign_payments_campaign_id_user_id_reel_id_key ON campaign_payments
    IS 'L9: Aynı kullanıcı aynı kampanyada farklı videolardan ödeme alabilir, ama aynı video bir kez ödenir';
