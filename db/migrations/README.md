# DB Migrations

Mevcut canlı ortamlarda [`db/init.sql`](../init.sql) yalnızca **fresh install**'da çalışır (docker-entrypoint-initdb.d → sadece pgdata boşsa). Mevcut DB'lere değişiklikleri uygulamak için bu klasördeki numaralı migration dosyaları elle çalıştırılmalıdır.

## Uygulama

```bash
# Container üzerinden
docker compose exec -T db psql -U app -d token_system < db/migrations/001_critical_fixes.sql

# Veya host'tan
psql "postgresql://app:PASS@localhost:5432/token_system" -f db/migrations/001_critical_fixes.sql
```

Tüm migration'lar **idempotent**'tir (`IF NOT EXISTS` / `DO $$`), tekrar çalıştırılabilir.

## Migration İndeksi

| # | Dosya | Kapsam |
|---|---|---|
| 001 | [`001_critical_fixes.sql`](001_critical_fixes.sql) | Withdrawal idempotency, pool advisory lock, wallet UNIQUE, earn→formula CHECK, encryption_keys tablosu |

## Yeni Migration Ekleme Kuralları

1. Numaralı, `NNN_kisa_aciklama.sql` formatında.
2. `BEGIN; ... COMMIT;` ile sarmalanmış.
3. İdempotent: yeniden çalıştırıldığında hata vermemeli.
4. Her migration sonrası [`db/init.sql`](../init.sql) fresh install için **aynı** değişiklikleri içermeli (drift olmamalı).
5. Prisma [`schema.prisma`](../../web/prisma/schema.prisma) güncellenmiş ve `npx prisma generate` çalıştırılmış olmalı.
