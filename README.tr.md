# Token Reward System

> İçerik üreticileri Instagram/TikTok hesaplarını bağlar; bir Python worker'ı resmî platform API'lerinden gerçek izlenme sayılarını okur, her gönderiyi özgünlük açısından puanlar ve kazanılan bakiyeyi Tron üzerinde USDT olarak öder.

![Python 3.12](https://img.shields.io/badge/Python-3.12-3776AB?logo=python&logoColor=white)
![Next.js 14](https://img.shields.io/badge/Next.js-14-000000?logo=nextdotjs&logoColor=white)
![PostgreSQL 16](https://img.shields.io/badge/PostgreSQL-16-4169E1?logo=postgresql&logoColor=white)
![Redis 7](https://img.shields.io/badge/Redis-7-DC382D?logo=redis&logoColor=white)
![Docker Compose](https://img.shields.io/badge/Docker-Compose-2496ED?logo=docker&logoColor=white)
![Lisans MIT](https://img.shields.io/badge/Lisans-MIT-green)

[English README](README.md)

**Nasıl yazıldı:** kod yapay zekâ yardımıyla yazıldı ve yazar tarafından gözden geçirildi.

## Genel bakış

Bir marka bir içerik üreticisine gönderi başına ödeme yaptığında, o gönderinin gerçekte ne kazandırdığını kimse kanıtlayamaz. Ekran görüntüleri kolayca düzenlenir ve SMM panelleri 10.000 izlenmeyi bir kahve parasına satar. Buradaki öncül, ekran görüntüsünü döngüden tamamen çıkarmaktı: üretici platformu OAuth ile yetkilendirir ve sistem, üreticinin gönderdiği hiçbir şeye güvenmek yerine sayıları doğrudan Instagram'ın ve TikTok'un kendi API'lerinden okur.

Sayıları okumak problemin yalnızca yarısı — satın alınmış izlenmeler de gerçek sayılardır. Bu yüzden her gönderi ilk gününde birkaç kez örneklenir; büyüme eğrisinin biçimi, etkileşim oranları ve geçmişi bir özgünlük puanını besler. O puan ödemeyi yalnızca kapıya almaz, **ölçekler** de: temiz bir gönderi tam öder, sınırdaki bir gönderi kısmen öder, eşiğin altındaki bir gönderi hiç ödemez. Jetonlar bir bakiyede birikir, üretici çekim talep eder, bir yönetici onaylar ve arka plandaki bir worker karşılığı USDT'yi (TRC20) gönderip işlem özetini kaydeder.

Sistem, tek bir PostgreSQL veritabanını paylaşan iki dağıtılabilir parçadır: bir **Python worker'ı** (toplama, puanlama, ödemeler) ve bir **Next.js uygulaması** (üretici paneli, yönetim paneli, 37 API yolu); önlerinde Nginx, oturumlar ve hız sınırları için Redis. Her şey 13 Docker secret'ıyla Docker Compose altında çalışır. Rol modeli — `employee`, `registrar`, `admin`, `super_admin` — amaçlanan işletmeciyi yansıtır: bir üretici kadrosu yöneten ve onları yüz yüze kaydeden bir kayıt masası olan bir şirket. Oraya hiç ulaşamadı; bkz. [Durum](#durum).

## Teknoloji

| Katman | Tercih |
|---|---|
| Worker | Python 3.12, APScheduler (PostgreSQL iş deposu), asyncpg, httpx, structlog |
| Puanlama | kural + istatistiksel çözümleyiciler, isteğe bağlı katman olarak OpenAI (`gpt-4o-mini`), XGBoost/scikit-learn eğitici (bkz. sınırlamalar) |
| Ödemeler | tronpy — USDT TRC20, Nile testnet ya da mainnet |
| Web | Next.js 14 App Router (`output: 'standalone'`), React 18, TypeScript, Tailwind CSS |
| Veri | PostgreSQL 16 (16 tablo, elle yazılmış SQL), yalnızca tipli istemci olarak Prisma 5, Redis 7 |
| Kimlik | Elle yazılmış JWT + Redis oturum kaydı, bcrypt (maliyet 12) |
| Şifreleme | HKDF-SHA256 anahtar türetmeli AES-256-GCM, Python ve Node'da birebir aynı |
| Altyapı | Docker Compose, Docker secrets, Nginx (TLS, CSP, `limit_req`), sertleştirilmiş worker konteyneri |

Beş pakette kabaca 4.000 satır Python, web tarafında 20 sayfa ve 37 API yolu, 16 tablolu bir şema üzerinde 12 Prisma modeli ve 2 SQL göçü.

## Özellikler

**Üreticiler (`employee`)**
- E-posta kodu + SMS OTP ile kayıt (Resend / Netgsm), kayıtta KVKK onayı kaydedilir
- Instagram ve TikTok OAuth ile bağlanır; erişim jetonları veritabanına ulaşmadan önce şifrelenir; TikTok jetonları süresi dolunca kendiliğinden yenilenir
- Panel: kullanılabilir / bekleyen / toplam bakiye, haftalık kazanç, doğrulanmış toplam izlenme, çözümlenen reel sayısı, bağlantı sağlığı ve jeton süresi
- İşlem geçmişi ve uygulama içi bildirimler
- Kayıtlı bir TRC20 cüzdanına çekim talebi — en az 100 jeton, aynı anda tek açık talep, bakiye satır kilidi altında `kullanılabilir → bekleyen` durumuna taşınır

**Kayıt masası (`registrar`)**
- Kapıdan gelenler için üretici hesabı açar ve açtığı hesapları listeler; yeni hesaplar ilk girişte parola değiştirmeye zorlanır

**Yöneticiler (`admin` / `super_admin`)**
- Kullanıcı yönetimi: toplu içe aktarma (istek başına en fazla 100), etkinleştir / devre dışı bırak / rol değiştir; ortak bir varsayılan yerine **kullanıcı başına rastgele geçici parola** operatöre bir kez döndürülür
- Çekim kuyruğu: onayla ya da reddet; ödemeyi worker'a serbest bırakan şey onaydır
- Reel incelemesi, düşük bakiye uyarısıyla jeton havuzu izleme ve sürümlenmiş formüller olarak saklanan düzenlenebilir ödeme parametreleri (`base_rate`, günlük tavan, asgari özgünlük)
- İşaretlenmiş reel'ler için etiketleme kuyruğu (eğitim verisi toplama), denetim kaydı görüntüleyici, TikTok bağlantı özeti

**Worker (`bot/`)** — dört zamanlanmış iş
| İş | Zamanlama | Ne yapar |
|---|---|---|
| `daily_run` | 04:00 | Topla, çözümle, puanla, jetonları hesapla, bakiyeleri işle, bildir |
| `snapshot_collector` | 2 saatte bir | Büyüme eğrisi için ikinci ve üçüncü izlenme örnekleri |
| `withdrawal_processor` | 5 dakikada bir | Onaylı çekimler → USDT transferi → işlem özeti |
| `heartbeat` | 5 dakikada bir | Konteyner sağlık kontrolünün okuduğu Redis anahtarını yazar |

## Mimari

```
                     ┌────────────────┐
     İnternet  ─────▶│     nginx      │  TLS 1.2/1.3, HSTS, CSP,
                     │  ters vekil    │  bölge başına hız sınırı
                     └───────┬────────┘
                             │
                     ┌───────▼────────┐
                     │  web (Next.js) │  20 sayfa · 37 API yolu
                     └──┬──────────┬──┘
                        │          │
            ┌───────────▼──┐   ┌───▼──────────┐
            │  PostgreSQL  │   │    Redis     │  oturumlar, hız sınırları,
            │  16 tablo    │   │              │  bot kalp atışı
            └───────▲──────┘   └───▲──────────┘
                    │              │
                 ┌──┴──────────────┴──┐
                 │    bot (Python)    │  APScheduler, 4 iş
                 └─────────┬──────────┘
                           │
        Instagram · TikTok · OpenAI · Tron (USDT TRC20)
```

`db` ve `redis`, yayınlanmış portu olmayan bir `internal` Docker ağında durur; dışarıdan yalnız `nginx` erişilebilir.

```
bot/          collectors · analyzers · processors · security · notifications
web/          Next.js uygulaması — src/app (sayfalar + API yolları), src/lib (iş mantığı)
db/           init.sql (tam şema) + numaralı, idempotent göçler
nginx/        TLS, hız sınırı bölgeleri, güvenlik başlıkları
docker-compose{,.dev,.prod}.yml
```

## Tasarım notları

**İki dilde tek tel biçimi.** Worker platform jetonlarını Python'da çözer; web uygulaması OAuth geri çağrısında onları Node'da şifreler. Her şeyi tek bir servisten geçirmek yerine iki taraf da aynı ilkeli birebir aynı parametrelerle uygular — HKDF-SHA256, `info = "token-encryption-v1"`, 32 baytlık anahtar, 12 baytlık rastgele IV, `base64(şifreliMetin‖authTag)` artı onaltılık IV olarak saklanır ([`bot/security/token_encryption.py`](bot/security/token_encryption.py), [`web/src/lib/crypto.ts`](web/src/lib/crypto.ts)). Sözleşme parametrelerin kendisidir ve iki dosya da bunu başlık yorumlarında söyler.

**Bir yayın tek yönlüdür, dolayısıyla zaman aşımı başarısızlık değildir.** Ödeme worker'ı ([`bot/processors/withdrawal_processor.py`](bot/processors/withdrawal_processor.py)) satırları `UPDATE … WHERE status='approved' … FOR UPDATE SKIP LOCKED RETURNING` ile sahiplenir, böylece iki süreç aynı çekimi asla alamaz. Her çekim, kimliğinden ve onay zamanından türetilen belirlenimli bir idempotentlik anahtarı alır ve `tx_hash` veritabanı düzeyinde `UNIQUE`'tir. Asıl önemli kural üçüncüsü: bir işlem **yayınlandıktan sonra** kod asla yeniden denemez. Yayından sonraki bir ağ zaman aşımı "başarısız" değil "bilinmiyor" demektir, dolayısıyla satır, sonraki bir koşumun zincire karşı doğrulayacağı `unconfirmed` durumuna geçer. Otomatik yeniden deneme, ağa kanıtlanabilir biçimde hiç ulaşmamış başarısızlıklara ayrılmıştır.

**Para, kilit olmadan bir bakiyeden çıkmaz.** Çekim talebi bir işlem açar, bakiye satırında `SELECT … FOR UPDATE` alır, aynı kilit altında hem kullanılabilir tutarı hem açık talep olmadığını yeniden kontrol eder, sonra tutarı `kullanılabilir` durumundan `bekleyen` durumuna taşır ([`web/src/app/api/withdrawals/route.ts`](web/src/app/api/withdrawals/route.ts)).

**Birkaç örnek tek bir sayıyı yener.** Tek bir izlenme sayısı, o sayının nasıl elde edildiği hakkında hiçbir şey söylemez. Birinci örnek günlük koşumda alınır; iki saatlik toplayıcı, geçen süreye göre ikinci ve üçüncü örnekleri doldurur. [`bot/analyzers/view_tracker.py`](bot/analyzers/view_tracker.py) sonra biçime bakar: organik erişim öne yüklenip söner, dolayısıyla 2.000 izlenmeyi geçmiş bir gönderinin 8→24 saatlik büyümesi 2→8 saatlik büyümesini üç kat aşıyorsa, viral bir çıkış değil muhtemel satın alınmış bir sıçrama olarak işaretlenir.

**İkili yasak değil, kademeli sonuç.** Çözümleyici puanları ağırlıkla birleşir — kural %40, yapay zekâ %35, büyüme eğrisi %25 — ve bir bileşen kullanılamadığında (OpenAI anahtarı yok, yeterli örnek yok) toplam, sessizce sıfır vermek yerine gerçekten katkı veren ağırlıklar üzerinden yeniden normalleştirilir. İstatistiksel katman, 0–100 arasına sıkıştırılmış bir z-skoru düzeltmesi uygular. Ödeme sonra uçurumdan düşmek yerine basamak basamak iner: ≥90 için 1,0×, ≥80 için 0,9×, ≥70 için 0,7×, 70 altında hiç ([`bot/processors/token_calculator.py`](bot/processors/token_calculator.py)). Bir yanlış pozitif üreticiye hesabına değil, tek bir gönderisinin %10'una mal olur.

**Ayar parametreleri veritabanında yaşar.** `base_rate`, günlük tavan ve asgari özgünlük, hat başlarken `system_settings` tablosundan ve `formula_versions` içindeki yürürlükteki satırdan okunur; o okuma başarısız olursa sabit kodlanmış varsayılanlar yedektir. Ödeme kuralları yönetim panelinden değişir ve her hesaplama, kullandığı formül sürümünü saklar.

**Kaçırılan işler geri gelir.** APScheduler, `coalesce=True`, `max_instances=1` ve bir saatlik gecikme toleransıyla bir SQLAlchemy/PostgreSQL iş deposu üzerinde çalışır; böylece 04:00'te ayakta olmayan bir worker, döndüğünde günlük işi bir günü atlamak yerine yine de çalıştırır — ve aynı anda ikisini birden çalıştıramaz. İş deposuna erişilemezse bellek içine düşer ve bu düşüşü loglar.

**Sırlar birer dosyadır, anahtarlar sürümlüdür.** On üç Docker secret'ı çalışma anında `/run/secrets/{ad}` yolundan, geliştirme için ortam değişkeni yedeğiyle okunur ([`bot/config.py`](bot/config.py)); hiçbir şey bir imaja ya da compose dosyasına gömülmez. Anahtar döndürme ([`bot/security/key_rotator.py`](bot/security/key_rotator.py)) sürüm farkındadır: `encryption_keys` her sürümün SHA-256 özetini tutar ve her kullanıcı satırı hangi sürümle şifrelendiğini kaydeder, böylece karışık sürümlü bir tablo doğru çözülür. Döndürmeden önce diskteki her anahtar dosyasını saklanan özete karşı doğrular — yanlış ya da eksik bir eski anahtar, veriyi bozmak yerine koşumu durdurur — ve yeniden şifreleme tek bir işlem içinde olur. Aynı anahtarla yeniden çalıştırmak hiçbir şey yapmaz.

**`DRY_RUN` ağı seçer ve parayı tutar — ama varsayılan değildir.** `DRY_RUN=true` iken worker tronpy'yi Tron **Nile testnet**'ine yöneltir, USDT transferini atlar ve bakiyeleri işlemez; `DRY_RUN=false` mainnet'i seçer ve ikisini de gerçekten yapar. İki uyarı var ve ikisi de benim hatam. Bayrak adının düşündürdüğünden dardır: `bot/collectors/` ya da `bot/analyzers/` içinde hiçbir şey onu okumaz, dolayısıyla Instagram, TikTok ve OpenAI her hâlükârda çağrılır. Ve varsayılan güvensiz olandır — [`bot/config.py`](bot/config.py) `false` değerine düşer ve temel compose dosyası hiçbir şey ayarlamaz, yani dry-run yalnız `docker-compose.dev.yml` katmanı eklendiğinde açıktır. Güvenlik, varsayılana değil geliştirme katmanını hatırlamaya bağlıdır; bir para yolu için bu tersinden kurulmuştur.

**Kenarlarda derinlemesine savunma.** Nginx; TLS, HSTS, CSP ve giriş (dakikada 5), API (saniyede 30) ve genel trafik için ayrı `limit_req` bölgeleri uygular; Next.js middleware'i güvenlik başlıkları ekler, bilinen tarayıcı botlarını engeller ve ikinci bir Redis destekli IP başına sınır uygular. Kayıt, beş sybil karşıtı katmanla korunur ([`web/src/lib/anti-sybil.ts`](web/src/lib/anti-sybil.ts)): tekil Instagram kullanıcı kimliği, sanal/VoIP numara reddi, SHA-256 cihaz parmak izi, IP başına kayıt tavanı ve isteğe bağlı yönetici onayı. Worker konteyneri root olmayan bir kullanıcıyla, `read_only` kök dosya sistemiyle, `no-new-privileges` ile ve `/tmp` için `tmpfs` ile çalışır.

## Başlarken

**Ön koşullar** — Docker ve Docker Compose; Meta, TikTok, Resend ve Netgsm kimlik bilgileri (OpenAI isteğe bağlı); gerçek ödeme yapmayı düşünüyorsanız bakiyeli bir Tron cüzdanı.

**1. Secret dosyalarını oluştur.** Her kimlik bilgisi bir Docker secret'ıdır — gitignore'daki `secrets/` altında değer başına bir düz metin dosyası.

```bash
mkdir -p secrets

openssl rand -hex 32 > secrets/db_password.txt
openssl rand -hex 32 > secrets/redis_password.txt
openssl rand -hex 32 > secrets/jwt_secret.txt
openssl rand -hex 32 > secrets/encryption_key.txt
openssl rand -hex 16 > secrets/internal_api_key.txt

# Üçüncü taraf kimlik bilgileri — her dosyaya gerçek değerleri yapıştır
: > secrets/meta_app_secret.txt
: > secrets/tiktok_client_key.txt
: > secrets/tiktok_client_secret.txt
: > secrets/openai_api_key.txt      # isteğe bağlı — boşsa yapay zekâ katmanı atlanır
: > secrets/resend_api_key.txt
: > secrets/netgsm_password.txt
: > secrets/tron_private_key.txt    # ödemeleri fonlar — bakiyeyi asgaride tut
: > secrets/tron_api_key.txt        # TronGrid
```

**2. Kök dizinde bir `.env` oluştur** — compose'un yerine koyduğu birkaç sır olmayan değer için:

```env
APP_DOMAIN=https://localhost
NETGSM_USER=netgsm_kullanici_adin
NETGSM_HEADER=sms_gonderici_basligin
```

[`bot/.env.example`](bot/.env.example) ve [`web/.env.example`](web/.env.example), her API kimlik bilgisinin nereden alınacağı dahil tüm seçenekleri belgeler.

**3. TLS sertifikaları.** Nginx `nginx/ssl/fullchain.pem` ve `nginx/ssl/privkey.pem` dosyalarını bekler — üretimde Let's Encrypt, yerelde kendinden imzalı bir çift.

**4. Yığını başlat.**

```bash
# Geliştirme — DRY_RUN açık, nginx kapalı, portlar dışarı açık
docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build

# Üretim — nginx etkin, gerçek ödemeler
docker compose -f docker-compose.yml -f docker-compose.prod.yml up --build -d
```

İki katmandan birini **mutlaka** geçir. `docker-compose.yml` tek başına hiçbir `DRY_RUN` ayarlamaz ve `bot/config.py` içindeki yedek `false`'tur — yani çıplak temel dosya Tron mainnet'ini hedefler.

PostgreSQL şemayı yalnız ilk açılışta [`db/init.sql`](db/init.sql) dosyasından kurar. Sonraki değişiklikler [`db/migrations/`](db/migrations/) içindeki dosyaların elle çalıştırılmasıyla uygulanır; o klasörün README'sine bakın. Prisma yalnızca tipli istemci olarak kullanılır (`prisma generate`) — bu proje `prisma migrate` kullanmaz.

## Bilinen sınırlamalar

Yazıldı, çünkü bir mülakatçı nasıl olsa bulacak.

- **Otomatik test yok.** Tek bir test dosyası bile yok. Doğruluk; `DRY_RUN`, yapılandırılmış loglar ve elle doğrulamaya dayanıyor — ki bu, para taşıyan bir kod için tam olarak yanlış cevap.
- **Derleme kendi tip ve lint hatalarını yok sayıyor.** `web/next.config.js` içinde `typescript.ignoreBuildErrors` ve `eslint.ignoreDuringBuilds` `true`, dolayısıyla `next build` TypeScript ve ESLint hatalarının üstünden başarıyla geçiyor. Test de olmadığı için bozuk bir değişiklikle çalışan bir konteyner arasında otomatik hiçbir şey durmuyor.
- **`DRY_RUN` varsayılan olarak kapalı ve adının ima ettiğinden azını yapıyor.** Güvenli kipe geliştirme katmanıyla girmek gerekiyor ve bu kip, toplayıcıların canlı Instagram, TikTok ve OpenAI API'lerini çağırmasını durdurmuyor — bkz. [Tasarım notları](#tasarım-notları).
- **XGBoost katmanı canlı değil.** [`bot/analyzers/ml_analyzer.py`](bot/analyzers/ml_analyzer.py) eğitimi ve çıkarımı uyguluyor ve yönetici etiketleme kuyruğu eğitim verisini topluyor, ama eğitilmiş bir model yayınlanmıyor ve hat çözümleyiciyi hiç örneklemiyor. Bugünkü puanlama kural + istatistik + büyüme eğrisi + isteğe bağlı OpenAI. Eğitici en az 200 etiketli örnek istiyor; etiketleme kuyruğu oraya hiç ulaşmadı.
- **Instagram kapsam uyuşmazlığı.** OAuth adresi Basic Display kapsamları (`user_profile`, `user_media`) isterken toplayıcı `/insights` ucunu okuyor; o ise bir Business/Creator hesabı ve uygulama incelemesiyle verilen izinler gerektiriyor. Bu boşluk hiç kapanmadı, dolayısıyla Instagram yolu yalnız test hesaplarına karşı denendi.
- **Yazılmış ama bağlanmamış.** `bot/security/anomaly_detector.py` (kazanç sıçramaları, havuz tükenmesi, hız) ve `bot/notifications/notifier.py` (Telegram/Discord) tamamlanmış modüller ama şu an onları hiçbir şey çağırmıyor; yönetici uyarıları bunun yerine uygulama içi `notifications` tablosundan geçiyor. Anahtar döndürücü zamanlanmış bir iş değil, elle çalıştırılan bir CLI scripti. `web/src/app/api/_internal/rate-check` ise middleware doğrudan Redis'le konuşmadan önceki dönemden kalma.
- **İki aşamalı doğrulama yalnız şemada.** `totp_secret_enc` / `totp_enabled` veritabanında var ve anahtar döndürücü onları yeniden şifreliyor, ama web uygulamasında ne kayıt ne doğrulama kodu var.
- **Sentry yapılandırılmış ama kurulu değil.** `sentry.client.config.ts` / `sentry.server.config.ts` mevcut ve `beforeSend` içinde kişisel veriyi ayıklıyor, ama `@sentry/nextjs` `package.json` içinde değil ve onları hiçbir şey içe aktarmıyor. Hata takibi fiilen yalnızca loglardan ibaret.
- **Kullanılmayan bağımlılıklar.** `next-auth`, `csv-parse` ve `nodemailer` tanımlı ama hiç içe aktarılmıyor — kimlik elle yazılmış JWT, CSV tarayıcıda ayrıştırılıyor ve posta Resend üzerinden gidiyor.
- **Hız sınırlayıcı kayan değil sabit pencere** (`INCR` + TTL) ve Redis erişilemez olduğunda **açık** başarısız oluyor — katılık yerine erişilebilirlik seçildi. Nginx'in `limit_req` kuralı yedek koruma.
- **Prisma 16 tablonun 12'sini kapsıyor.** `campaigns`, `campaign_payments`, `encryption_keys` ve `system_settings` yalnız ham SQL ile erişilebilir, dolayısıyla şemanın iki ayrı doğruluk kaynağı var.
- **Geliştirme kipinde sahte veri.** `NODE_ENV !== 'production'` iken veritabanı sorgusu hata verirse `/api/dashboard` sabit kodlanmış örnek rakamlar döndürüyor. Yerelde kullanışlı, gerçek veriyle karıştırması kolay.
- **Tek düğüm, tek süreç.** Bir worker, bir gecelik toplu iş, bir Compose dosyası. Anlık görüntü toplama koşum başına 100 reel ile sınırlı ve çağrılar arasında 0,5 saniye bekliyor; birkaç bin etkin üretici, bir cron döngüsü yerine kuyruk ve worker'lar gerektirirdi.
- **Türkçe arayüz, yorumlar ve doğrulama.** Telefon kuralları yalnız Türk cep numaralarını kabul ediyor; hiçbir şey uluslararasılaştırılmamış.
- **Hiç güvenlik denetiminden geçmedi.** Özellikle ödeme yolunu incelenmemiş kabul edin.

## Durum

Kapatıldı. **Sıfır kullanıcı** — bu hiç halka açılmadı, dolayısıyla raporlanacak bir kullanım rakamı yok; ne iyi ne kötü.

İki şey onu öldürdü. Birincisi erişimdi: modelin tamamı Instagram ve TikTok API'lerinden izlenme sayısı okumaya dayanıyor ve iki uygulama incelemesi de toplayıcıların ihtiyaç duyduğu izinler için onaylanmadı. Bu olmadan ürün var olamaz ve hiçbir kod düzeltmesi bunu çözmez. İkincisi pazardı: bu iki taraflı bir pazar yeri ve soğuk başlangıç hiç çözülemedi — markalar kanıtlanmış erişimi olan üreticiler ister, üreticiler bütçesi olan markalar ister ve önce hangi tarafın tohumlanacağına dair inandırıcı bir plan yoktu. İki problem de itiraf edildiklerinden daha erken bilinebilirdi; asıl işe yarayan ders buydu.

Bu depo aynı zamanda daha büyük bir reklam platformunun Python ve web katmanıydı; o çalışmanın Go API'si, Go bot'u ve Flutter istemcisi ayrı bir depoda ve bu kod tabanının parçası değil.

**Yarım bırakıldı ve rafa kaldırıldı.** [Bilinen sınırlamalar](#bilinen-sınırlamalar) bölümündeki boşluklar zaman bekleyen ihmaller değil — bunun birine hizmet edebilmesi için yapılması gereken işin kendisi: para taşıyan bir yolda hiç test olmaması, `DRY_RUN` bayrağının güvensiz tarafa varsayılması, XGBoost katmanının yazılmış ama hiç eğitilmemiş ve bağlanmamış olması, anomali algılayıcı ile bildiricinin tamamlanmış ama hiçbir yerden çağrılmaması, iki aşamalı doğrulamanın yalnızca kolon olarak var olması ve ürünü en baştan tıkayan Instagram kapsam uyuşmazlığı. Bunların hiçbiri planlanmıyor. Depo, işin durduğu yerin bir anlık görüntüsü; birinin o parçaları kendisi yeniden yapmadan üzerine inşa edeceği bir taban değil.

Bir referans uygulaması ve portfolyo çalışması olarak yayımlanıyor: ilgi çekici kısımlar ödeme güvenlik modeli, diller arası şifreleme dikişi, sürümlü anahtar döndürme ve kademeli özgünlük puanlaması. Bakımı yapılmıyor ve denetimden geçmedi — gerçek parayla çalıştırmak sizin riskinizdir.

## Lisans

MIT — bkz. [LICENSE](LICENSE).
