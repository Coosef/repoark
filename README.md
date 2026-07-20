<p align="center">
  <img src="docs/banner.svg" alt="RepoArk" width="100%" />
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Docker-tek%20imaj-2496ED?logo=docker&logoColor=white" alt="Docker" />
  <a href="https://github.com/Coosef/repoark/pkgs/container/repoark"><img src="https://img.shields.io/badge/ghcr.io-hazır%20imaj-2496ED?logo=github&logoColor=white" alt="Container image" /></a>
  <img src="https://img.shields.io/badge/Backend-FastAPI-009688?logo=fastapi&logoColor=white" alt="FastAPI" />
  <img src="https://img.shields.io/badge/Panel-React%2018-61DAFB?logo=react&logoColor=black" alt="React" />
  <img src="https://img.shields.io/badge/self--hosted-CasaOS%20uyumlu-6c5ce7" alt="Self-hosted" />
  <img src="https://img.shields.io/badge/i18n-15%20dil-0071e3" alt="15 languages" />
  <img src="https://img.shields.io/badge/license-MIT-black" alt="MIT" />
</p>

## RepoArk

**Kendi sunucunda çalışan, panelden yönetilen bir GitHub yedekleme aracı.**

GitHub hesabını bir kişisel erişim token'ı (PAT) ile bağlarsın, neyi yedekleyeceğini
seçersin; zamanlayıcı belirli aralıklarla çalışır ve **değişiklik yoksa yedek almaz.**
Repolar bare git aynası olarak saklanır (kendi git geçmişi = sürüm kaydı); star, gist,
issue ve profil verisinin ise tarih damgalı **sürümlü geçmişi** tutulur.

Her şey **tek bir Docker imajında** çalışır — API ve panel aynı konteynerde. Kişisel bir
sunucuda, NAS'ta veya **CasaOS** üzerinde dakikalar içinde ayağa kalkar.

---

## ✨ Öne çıkanlar

**Yedekleme**
- 📦 Repolar (kod), özel repolar, fork'lar, wiki'ler
- ⭐ Yıldızladıkların — liste + isteğe bağlı kod klonu
- 🐛 Issue / PR / yorumlar, 📝 gist'ler, 👤 profil & sosyal graf
- ⏱️ Zamanlanmış **artımlı** yedekleme (cron / aralık / elle)
- 🧠 Akıllı değişiklik tespiti — hiçbir şey değişmediyse çalışmayı atlar
- 🗂️ Sürümlü snapshot geçmişi + canlı ilerleme göstergesi

**Gözat & geri yükle**
- 🔎 GitHub gibi içine gir: dosya ağacı, commit'ler, sürümler, issue/PR okuma
- 🔦 Tüm repolarda dosya adı ve içerik araması
- ⬇️ İndir: repo zip'i, `.bundle`, tek dosya, tüm yedek
- ↑ **GitHub'a geri yükle** — silinmiş bir repoyu yedekten tek tıkla yeniden oluştur

**Depolama & hedefler**
- ☁️ Uzak hedefler: **S3** (AWS · MinIO · Backblaze · Wasabi), **SMB**, **NAS/NFS**, yerel — `rclone` ile artımlı senkron
- 🧹 Saklama politikası (son N snapshot) + disk kullanımı paneli
- 🗄️ **Silinen repo kasası** — GitHub'dan silinen repolar yedekte korunur

**Güven & güvenlik**
- 🔐 Panel giriş şifresi (isteğe bağlı)
- 🩺 Yedek sağlık kontrolü — `git fsck` ile bütünlük doğrulaması
- ⚠️ Proaktif uyarılar: token süresi dolmak üzere / iş üst üste başarısız
- 🔒 Token'lar Fernet (AES-128) ile şifreli saklanır, loglara sızmaz
- 🔔 Bildirimler: e-posta (SMTP) + Telegram

**Deneyim**
- 🖥️ Zengin gösterge paneli: kapsam, boyut grafiği, dil dağılımı, "neler değişti?", yedekleme takvimi (ısı haritası)
- 🏢 Organizasyon desteği · 🧩 kurulum sihirbazı
- 💾 Panel ayarlarını yedekle / geri yükle (taşımada tek dosya)
- 🌍 **15 dil** · 🌗 açık / koyu tema · 📱 mobil uyumlu + PWA (ana ekrana eklenebilir)

---

## 🚀 Kurulum

Hazır imaj **`ghcr.io/coosef/repoark:latest`** olarak yayınlanır — Intel (`amd64`) ve ARM
(`arm64`) için. Aşağıdaki üç yoldan biriyle dakikalar içinde kur.

### Seçenek 1 — Hazır imaj (en hızlı, derleme yok)

```bash
docker run -d --name repoark \
  -p 8765:8000 \
  -v repoark-data:/data \
  -e TZ=Europe/Istanbul \
  --restart unless-stopped \
  ghcr.io/coosef/repoark:latest
```

Panel → **http://localhost:8765**

### Seçenek 2 — CasaOS (arayüzden, terminalsiz)

CasaOS'ta **sağ üst "+" → Import → Docker Compose** sekmesine şunu yapıştır ve **Submit**'e bas:

```yaml
name: repoark
services:
  repoark:
    image: ghcr.io/coosef/repoark:latest
    container_name: repoark
    ports:
      - "8765:8000"
    volumes:
      - /DATA/AppData/repoark/data:/data
    environment:
      - TZ=Europe/Istanbul
    restart: unless-stopped
    x-casaos:
      volumes:
        - container: /data
          description:
            en_us: "Yedekler, veritabanı ve şifreleme anahtarı"
      ports:
        - container: "8000"
          description:
            en_us: "Web panel"
x-casaos:
  architectures:
    - amd64
    - arm64
  main: repoark
  author: Coosef
  developer: Coosef
  category: Backup
  icon: https://raw.githubusercontent.com/Coosef/repoark/main/frontend/public/icon-512.png
  title:
    en_us: RepoArk
  tagline:
    en_us: Kendi sunucunda GitHub yedekleme
  description:
    en_us: Panelden yönetilen GitHub yedekleme — repolar, yıldızlar, gist, issue.
  port_map: "8765"
```

CasaOS masaüstüne **RepoArk** ikonu düşer; tıkla, panel açılır. (Port doluysa
`"8765:8000"` satırındaki soldaki sayıyı değiştir.)

### Seçenek 3 — Kaynaktan derle (Docker Compose)

```bash
git clone https://github.com/Coosef/repoark.git
cd repoark
cp .env.example .env          # (isteğe bağlı) port / timezone ayarı
docker compose up -d --build
```

---

### İlk açılış: GitHub PAT
Kurulum sihirbazı bir **Personal Access Token** ister:
GitHub → **Settings → Developer settings → Personal access tokens**
Önerilen izinler: `repo`, `gist`, `read:user`, `read:org`.

---

## 🔄 Güncelleme & sürümler

İmaj hem `:latest` hem sabit sürüm etiketiyle yayınlanır (ör. `:1.0.0`). Çalışan
sürüm panelin sol alt köşesinde görünür — güncellemenin oturduğunu böyle
doğrularsın.

**En temiz güncelleme** (yeni imajı kesin çeker):
```bash
docker pull ghcr.io/coosef/repoark:latest   # veya belirli bir sürüm
docker rm -f repoark
docker run -d --name repoark -p 8765:8000 -v /DATA/AppData/repoark/data:/data \
  -e TZ=Europe/Istanbul --restart unless-stopped ghcr.io/coosef/repoark:latest
```

> CasaOS arayüzünde uygulamanın compose'undaki `image:` satırını yeni sürüme
> (ör. `:1.0.0`) çevirip kaydetmek de yeni imajı çektirir — `:latest` bazen
> yerel önbellekten yeniden kullanıldığı için sürüm etiketi daha güvenilirdir.
> Veriler `/DATA/AppData/repoark/data` klasöründe durduğu için hiçbir ayar kaybolmaz.

---

## ⚙️ Yapılandırma

`.env` (hepsi isteğe bağlı):

| Değişken | Açıklama | Varsayılan |
|---|---|---|
| `HOST_PORT` | Panelin dinlediği port | `8765` |
| `TZ` | Zamanlayıcı ve tarihler için saat dilimi | `Europe/Istanbul` |
| `SECRET_KEY` | Sabit Fernet anahtarı (veri hacmini taşırken token'lar çözülebilsin diye) | otomatik üretilir |

Tüm kalıcı durum `./data` altında toplanır:

```
data/
├─ app.db                       # ayarlar, işler, çalışma geçmişi
├─ secret.key                   # token şifreleme anahtarı
└─ backups/<kullanıcı>/
   ├─ current/                  # güncel yedek (bare repolar + metadata)
   └─ snapshots/<tarih>/        # metadata sürüm geçmişi
```

---

## 🏗️ Teknoloji

| Katman | Kullanılan |
|---|---|
| İndirme motoru | [`github-backup`](https://github.com/josegonzalez/python-github-backup) |
| Backend | FastAPI · SQLModel/SQLite · APScheduler · httpx |
| Şifreleme | `cryptography` (Fernet) |
| Uzak senkron | `rclone` (S3 / SMB / yerel) |
| Panel | React 18 · Vite (kütüphanesiz özel i18n + tasarım sistemi) |
| Paketleme | Çok aşamalı tek Docker imajı (Node build → Python serve) |

---

## 🔒 Güvenlik

- GitHub token'ları **hiçbir zaman düz metin saklanmaz** — Fernet ile şifrelenir, loglarda maskelenir.
- Yedeklerin, veritabanın ve şifreleme anahtarın yalnızca **senin sunucunda** (`./data`) durur.
- İstersen panele bir **giriş şifresi** koyabilirsin.
- Bu depo yalnızca kaynak kodu içerir; hiçbir kişisel veri, token veya yedek içermez.

---

## 📄 Lisans

[MIT](LICENSE) — dilediğin gibi kullan, değiştir ve dağıt.
