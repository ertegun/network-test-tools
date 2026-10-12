# Ağ Test ve Yönetim Aracı — Ürün Gereksinimleri Dokümanı (PRD)

Oct 12, 2026 · @Erte

## Özet

Windows, macOS ve Linux'ta çalışan, Electron tabanlı tek bir masaüstü ağ aracı geliştirilecek. Araç; port testi, ağdaki cihazları bulma, bağlantı teşhisi, DNS araçları ve ağ yapılandırmasını (IP, DNS, hosts, route) tek arayüzde birleştirir. Çalışma adı: **NetKit** (kesin ad sonra belirlenecek).

**Problem:** Ağ sorunlarını teşhis etmek için bugün ping, traceroute, port tarama, hosts düzenleme ve IP ayarı gibi işler ayrı ayrı araçlarla, her işletim sisteminde farklı komutlarla yapılıyor. VPN sağlayıcısı gibi üçüncü taraflara "port kapalı, trafik şu IP'den çıkıyor" demek için tek ekranda net ve inandırıcı bir kanıt üretmek zor.

**Çözüm:** Tüm testleri tek uygulamada toplayan, her sonucun yanında hangi arayüzden ve hangi IP'den çıkıldığını gösteren ve tek tıkla paylaşılabilir teşhis raporu üreten bir masaüstü aracı.

## Hedefler ve kapsam

**Hedefler**

- Ağ teşhisi için gereken temel araçları üç masaüstü işletim sisteminde aynı arayüzle sunmak.
- Her test sonucunda kullanılan ağ arayüzünü, yerel kaynak IP'yi ve dış (public) IP'yi göstermek.
- Üçüncü taraflara gönderilebilecek, tek sayfalık teşhis raporu (PDF/PNG) üretmek.
- IP, DNS, hosts ve route değişikliklerini güvenli şekilde yapmak: yedek ve otomatik geri alma ile.

**Kapsam dışı (bu sürüm)**

- Mobil (Android/iOS) ve web sürümü.
- UDP port taraması (yalnızca TCP).
- Testleri belirli bir ağ kartından zorla çıkarmak. Trafik işletim sisteminin yönlendirmesiyle çıkar; uygulama hangi karttan çıkıldığını gösterir. İleride "gelişmiş ayar" olarak eklenebilir.
- Paket yakalama (Wireshark benzeri) ve güvenlik açığı taraması.
- Bulut hesabı, kullanıcı girişi, sunucu bağımlılığı. Uygulama tamamen yerel çalışır; tek dış bağımlılık public IP sorgusudur.

**Başarı kriterleri**

- Faz 1 özellikleri üç işletim sisteminde aynı sonuçlarla çalışır.
- /24 bir ağın cihaz keşfi 30 saniyenin altında tamamlanır.
- Tek hedefte 1–1024 aralığının TCP taraması yerel ağda 20 saniyenin altında tamamlanır.
- Teşhis raporu tek tıkla, 15 saniye içinde üretilir.
- IP/DNS değişikliği sonrası bağlantı kaybolursa ayar otomatik olarak geri alınır.

Süre hedefleri başlangıç tahminidir; ekip ilk prototipten sonra güncelleyebilir.

## Kullanıcılar ve senaryolar

Birincil kullanıcı, ağ ve sistem işleriyle uğraşan teknik kişidir: sistem yöneticisi, IT destek, saha teknisyeni, geliştirici. Kullanıcı temel ağ kavramlarını (IP, port, DNS) bilir ama her işletim sisteminin komutlarını ezbere bilmek zorunda kalmamalıdır.

| Senaryo | Kullanıcının amacı | Kullanılan modüller |
| --- | --- | --- |
| VPN sağlayıcısına kanıt sunma | VPN bağlıyken hangi portların kapalı/filtreli olduğunu ve trafiğin hangi IP'den çıktığını tek ekranda göstermek | Port testi, ağ bilgi paneli, teşhis raporu |
| Ağdaki cihazları envanterleme | Ofis veya müşteri ağında hangi cihazların olduğunu ve hangi servisleri açtığını görmek | Ağ keşfi, port testi |
| "İnternet yavaş / kopuyor" şikayeti | Kopmanın ve gecikmenin nerede olduğunu kanıtlamak | Sürekli ping, traceroute, MTU testi |
| Yerel geliştirme ortamı | `proje.local` gibi bir alan adını yerel IP'ye yönlendirmek | Hosts yönetimi, DNS önbelleği temizleme |
| Sahada farklı ağlara geçiş | Müşteri sahasında statik IP ayarlayıp iş bitince eski ayara dönmek | Ağ profilleri, IP/DNS ayarı |
| DNS sorunları | Bir alan adının farklı DNS sunucularında farklı çözülüp çözülmediğini, VPN'de DNS sızıntısı olup olmadığını görmek | DNS araçları |

## Platform ve teknoloji kararları

Uygulama Electron + React + TypeScript ile, Windows, macOS ve Linux için tek kod tabanından geliştirilecek.

| Konu | Karar | Gerekçe |
| --- | --- | --- |
| Platformlar | Windows 10/11, macOS (Intel ve Apple Silicon), Linux (Ubuntu/Debian ve Fedora öncelikli) | Hedef kullanıcıların masaüstü ortamları |
| Çerçeve | Electron | Node.js'in ağ modüllerine doğrudan erişim, olgun ekosistem |
| Arayüz | React + TypeScript | Tek dil (TypeScript) tüm katmanlarda |
| Ağ işlemleri | Electron main process'te çalışan ayrı bir "çekirdek" modül | Arayüz ağ koduna doğrudan erişmez, IPC ile çağırır |
| Yetkili işlemler | Ayrı "yetkili yardımcı" (privileged helper) katmanı | Uygulamanın tamamı yönetici olarak çalışmaz |
| Dağıtım | Windows: imzalı kurulum dosyası; macOS: imzalı ve notarize DMG; Linux: AppImage + .deb | İşletim sistemi uyarılarını ve antivirüs yanlış alarmlarını azaltmak |
| Güncelleme | Uygulama içi otomatik güncelleme | Kullanıcının elle sürüm takibi yapmaması |

**Arayüz kütüphaneleri**

| Konu | Karar | Not |
| --- | --- | --- |
| Stil | Tailwind CSS | Tüm bileşenler Tailwind sınıflarıyla stillenir |
| Bileşen kütüphanesi | [Material Tailwind](https://www.npmjs.com/package/@material-tailwind/react) (React, MIT lisanslı, açık kaynak) | Material Design görünümü, Tailwind tabanlı |
| İkonlar | Iconify (`@iconify/react`) | İkon setleri uygulamaya gömülür (aşağıya bakın) |
| Tema | Açık ve koyu tema, Tailwind `dark` modu | Varsayılan: sistem temasını izle |
| Çoklu dil | i18next / react-i18next | Dil dosyaları JSON; varsayılan dil yedekli |

Material Tailwind'in son kararlı sürümü yaklaşık bir yıl önce çıkmış ve açık hata sayısı yüksek ([kaynak](https://cloudsmith.com/navigator/npm/@material-tailwind/react)). Ekip başlamadan önce kullanılacak Tailwind sürümüyle uyumunu doğrulamalı; uyumsuzluk çıkarsa eşdeğer açık kaynak bir Material + Tailwind kütüphanesi seçilir. Bileşenler kendi ince sarmalayıcılarımız (Button, Card vb.) üzerinden kullanılır; böylece kütüphane değişirse yalnızca sarmalayıcılar güncellenir.

Iconify ikonları varsayılan olarak internetteki Iconify API'sinden yükler. Uygulama çevrimdışı da çalışmalı ve dış istek yapmamalıdır; bu yüzden kullanılan ikon setleri derleme sırasında uygulamaya gömülür ve çalışma anında API'ye istek gitmez. Tutarlı görünüm için tek bir ana ikon seti seçilir (Material Design ile uyumlu olarak Material Symbols önerilir).

**Yetki modeli:** Uygulama normal kullanıcı yetkisiyle açılır. IP/DNS/hosts/route değişikliği gibi işlemlerde işletim sisteminin kendi yetki penceresi çıkar: Windows'ta UAC, macOS'ta sistem parolası, Linux'ta polkit. Yardımcı katman yalnızca önceden tanımlanmış, parametreleri doğrulanmış komutları çalıştırır; serbest komut çalıştırmaz.

**Platform soyutlaması:** Yapılandırma işlemleri her işletim sisteminde farklı araçlarla yapılır. Windows'ta PowerShell/netsh, macOS'ta `networksetup`, Linux'ta NetworkManager (`nmcli`). Her özellik için ortak bir arayüz tanımlanır ve üç ayrı platform uygulaması yazılır. NetworkManager kullanmayan Linux dağıtımlarında yapılandırma özellikleri devre dışı gösterilir.

## Fonksiyonel gereksinimler

Uygulama 10 modülden oluşur. Her modül sol menüde ayrı bir sayfadır. Tüm test sonuçları kopyalanabilir, CSV olarak dışa aktarılabilir ve geçmişe kaydedilir.

### M1 — Ağ bilgi paneli (ana ekran)

- Tüm ağ arayüzlerini listeler: ad, tür (Ethernet, Wi-Fi, VPN/sanal), durum, MAC, IPv4/IPv6, alt ağ maskesi, ağ geçidi, DNS sunucuları, DHCP/statik bilgisi ve DHCP kira süresi.
- VPN/sanal arayüzleri ayrı işaretler.
- Public IP'yi gösterir; hangi servisten alındığı ve sorgu zamanı yanında yazar. Ulaşılamazsa ikinci bir servise geçer.
- Arayüzlerde değişiklik olunca (VPN bağlanıp kopunca) panel kendiliğinden güncellenir.
- *Kabul:* VPN bağlanınca 5 saniye içinde VPN arayüzü ve aldığı IP panelde görünür.

### M2 — Port testi

- Girdi: hedef (IP veya alan adı), port listesi (tekil, aralık, virgülle ayırma) veya hazır listeler (sık kullanılan 100 port, web, e-posta, uzak masaüstü, veritabanı).
- Ayarlar: zaman aşımı (varsayılan 2 sn), eşzamanlı bağlantı sayısı (varsayılan 200, üst sınır 1000).
- Sonuç durumları: **Açık** (bağlantı kuruldu), **Kapalı** (hedef reddetti), **Filtrelenmiş** (yanıt yok, muhtemelen güvenlik duvarı). Her durumun açıklaması ekranda görünür.
- Her sonuçta: port, durum, yanıt süresi (ms), bilinen servis adı (örn. 443 = HTTPS).
- Ekranın üstünde sabit bir **bağlam şeridı** bulunur: tarih/saat (saat dilimiyle), bilgisayar adı, hedefe gitmek için işletim sisteminin seçtiği arayüz adı ve yerel kaynak IP, public IP ve kaynağı, hedefin çözülen IP'si.
- Kaynak IP, paket gönderilmeden işletim sisteminin yönlendirmesinden öğrenilir; böylece filtrelenmiş portlarda da gösterilir.
- Split-tunnel uyarısı: Hedefe giden arayüz ile public IP sorgusunun gittiği arayüz farklıysa ekranda uyarı çıkar.
- Tarama sırasında ilerleme çubuğu ve durdurma butonu bulunur.
- *Kabul:* Bağlam şeridı ve sonuç tablosu, 1080p ekranda tek ekran görüntüsüne sığacak düzendedir.

### M3 — Ağ keşfi

- Varsayılan olarak seçili arayüzün alt ağını tarar; kullanıcı farklı bir aralık (CIDR veya başlangıç–bitiş) girebilir.
- Yöntem: ping ve sık kullanılan portlara TCP denemesi, ardından işletim sisteminin ARP tablosundan MAC adreslerini okuma. Yönetici yetkisi gerektirmez.
- Her cihaz için: IP, MAC, üretici firma (MAC'in OUI kısmından, çevrimdışı liste), cihaz adı (DNS ters sorgu, mDNS, NetBIOS), yanıt süresi, ilk/son görülme zamanı.
- Bulunan cihaza tek tıkla port taraması (M2'ye hedefi doldurarak geçer) ve Wake-on-LAN.
- Bilinen cihazlara kullanıcı not/etiket ekleyebilir; sonraki taramalarda yeni cihazlar işaretlenir.
- *Kabul:* /24 ağ 30 saniyenin altında taranır.

### M4 — Bağlantı teşhisi

- **Sürekli ping:** gecikme grafiği, jitter, paket kaybı yüzdesi, min/ort/maks. Birden fazla hedef yan yana izlenebilir.
- **Traceroute:** her atlama için IP, ad, gecikme. MTR modu: rotayı sürekli izleyip atlama başına kayıp gösterir.
- **MTU testi:** hedefe giden yolda parçalanmadan geçebilen en büyük paket boyutunu bulur ve önerilen MTU değerini gösterir.
- **HTTP/HTTPS kontrolü:** durum kodu, yönlendirmeler, yanıt süresi aşamaları (DNS, TCP, TLS, ilk bayt), SSL sertifikasının verildiği alan adları ve bitiş tarihi.

### M5 — DNS araçları

- Kayıt sorgulama: A, AAAA, CNAME, MX, TXT, NS, SOA, PTR.
- Aynı sorguyu birden fazla DNS sunucusuna (sistem DNS'i, Google, Cloudflare, kullanıcının ekledikleri) sorup sonuçları yan yana karşılaştırma.
- DNS sızıntı testi: VPN bağlıyken DNS sorgularının hangi çözümleyicilere gittiğini ve VPN dışından gidip gitmediğini gösterir.
- DNS önbelleğini temizleme (yetki gerekebilir).

### M6 — Teşhis raporu

- Tek butonla, seçilen testleri çalıştırıp tek bir rapor oluşturur: arayüz ve IP bilgileri, public IP, DNS sızıntı sonucu, hedefe traceroute, ping istatistikleri, MTU, port testi sonuçları.
- Çıktı: PDF ve PNG. Her raporda oluşturulma zamanı ve uygulama sürümü bulunur.
- Kullanıcı rapordaki MAC adresi ve bilgisayar adı gibi bilgileri göndermeden önce gizleyebilir.
- Hazır şablonlar: "VPN sorunu", "Yavaş internet", "Port erişimi".

### M7 — Ağ yapılandırması (yetki gerektirir)

- Seçilen arayüz için DHCP/statik geçişi; statikte IP, alt ağ maskesi (veya CIDR), ağ geçidi, DNS sunucuları.
- Girdiler kaydedilmeden önce doğrulanır: geçersiz IP, maskeyle uyumsuz ağ geçidi, ağdaki başka bir cihazla IP çakışması.
- DHCP yenileme (release/renew).
- **Otomatik geri alma:** Her değişiklikten sonra bağlantı test edilir ve kullanıcıdan onay istenir. 15 saniye içinde onay gelmezse eski ayara dönülür.
- **Ağ profilleri:** IP/DNS ayar setleri ad verilerek kaydedilir (örn. "Ofis", "Müşteri sahası") ve tek tıkla uygulanır. Değişiklikten önceki ayar her zaman "Önceki ayar" profili olarak saklanır.
- **Route tablosu:** görüntüleme, kalıcı/geçici route ekleme ve silme.

### M8 — Hosts yönetimi (yetki gerektirir)

- İşletim sistemleri yalnızca tek bir sistem hosts dosyasını okur. Uygulama bu dosyada **yalnızca kendi işaretli bloğunu** yönetir; bloğun dışındaki satırlara hiç dokunmaz:

```
# --- NetKit BEGIN (bu bloğu elle düzenlemeyin) ---
127.0.0.1  proje.local
# --- NetKit END ---
```

- Kayıtlar uygulama içinde gruplar halinde tutulur (örn. "Proje A", "Test ortamı"). Gruplar tek tıkla açılıp kapatılır; uygulama yalnızca açık grupları bloğa yazar.
- Her yazmadan önce sistem hosts dosyasının tam yedeği alınır; son 20 yedek saklanır ve tek tıkla geri yüklenebilir.
- Yazma sonrası DNS önbelleği otomatik temizlenir.
- Bloğun dışındaki satırlar salt okunur olarak gösterilir.
- "Tümünü kaldır" işlemi yalnızca uygulamanın bloğunu siler; uygulama kaldırılırken de blok temizlenir.
- Geçersiz IP veya alan adı kaydedilemez; aynı alan adı iki açık grupta farklı IP'ye gidiyorsa uyarı verilir.

### M9 — Yerel makine

- Aktif bağlantılar ve dinleyen portlar: yerel/uzak adres, port, durum ve ilgili program adı (netstat benzeri). Filtreleme ve arama.
- IP çakışması tespiti: makinenin IP'sini kullanan başka bir cihaz olup olmadığını kontrol eder.

### M10 — Yardımcı araçlar

- **Wake-on-LAN:** MAC adresine sihirli paket gönderme; kayıtlı cihaz listesi.
- **LAN hız testi:** iperf3 uyumlu istemci/sunucu modu; iki bilgisayar arası gerçek hızı ölçer.
- **Whois ve IP konum bilgisi:** alan adı ve IP için kayıt sahibi, ASN, ülke.
- **Alt ağ hesaplayıcı:** CIDR, ağ adresi, broadcast, kullanılabilir IP aralığı ve sayısı.

## Fonksiyonel olmayan gereksinimler

**Güvenlik**

- Yetkili yardımcı yalnızca beyaz listedeki işlemleri kabul eder; tüm parametreler doğrulanır. Kullanıcı girdisi hiçbir zaman doğrudan kabuk (shell) komutuna eklenmez.
- Arayüz (renderer) işlemi Node.js'e erişemez: context isolation açık, nodeIntegration kapalı. Ağ ve sistem işleri yalnızca main process üzerinden yapılır.
- Sistem ayarını değiştiren her işlem yerel bir denetim günlüğüne yazılır: zaman, işlem, önceki ve yeni değer.
- Uygulama kullanıcı verisini dışarı göndermez. Tek dış istek public IP sorgusudur; kullanıcı bu servisi ayarlardan değiştirebilir veya kapatabilir. Telemetri varsa varsayılan olarak kapalıdır.
- İlk açılışta ve ağ keşfi/port taraması ekranlarında kısa bir uyarı bulunur: yalnızca yetkili olunan ağlar taranmalıdır.

**Güvenilirlik ve geri alma**

- Sistem ayarı değiştiren hiçbir işlem yedeği alınmadan yapılmaz.
- Uygulama bir değişikliğin ortasında kapanır veya çökerse, bir sonraki açılışta yarım kalan işlem tespit edilir ve geri alma önerilir.
- Bir test hata verdiğinde uygulama çökmez; hata mesajı sade bir dille ve çözüm önerisiyle gösterilir.

**Performans**

- Taramalar arayüzü dondurmaz; uzun işlemler arka planda çalışır ve iptal edilebilir.
- Eşzamanlı bağlantı sayısı işletim sisteminin dosya tanımlayıcı sınırını aşmayacak şekilde sınırlanır.
- Boştayken bellek kullanımı 300 MB'ın altındadır.

**Kullanılabilirlik**

- Arayüz dili: ilk sürümde Türkçe ve İngilizce. İlk açılışta sistem dili algılanır; ayarlardan değiştirilebilir. Tüm metinler dil başına ayrı JSON dosyalarında tutulur; kodda sabit metin bulunmaz. Yeni dil eklemek yalnızca yeni bir dil dosyası eklemekle yapılır, kod değişikliği gerekmez. Eksik çeviri olursa İngilizce metin gösterilir. Tarih, saat ve sayı biçimleri seçilen dile göre gösterilir; teşhis raporu da seçilen dilde üretilir.
- Açık ve koyu tema: varsayılan olarak işletim sisteminin temasını izler, kullanıcı ayarlardan sabitleyebilir. Grafikler, durum renkleri (açık/kapalı/filtrelenmiş) ve rapor önizlemesi iki temada da okunaklıdır. Teşhis raporu PDF'i her zaman açık temada üretilir.
- Teknik terimlerin yanında kısa açıklama (bilgi simgesi) bulunur.
- Yetki gerektiren her özellik, yetki istemeden önce ne yapılacağını açıkça gösterir.

**Platform farkları**

- Bir özellik bir platformda desteklenmiyorsa gizlenmez; devre dışı gösterilir ve nedeni yazılır.
- macOS'ta yerel ağ erişimi ve güvenlik izinleri ilk kullanımda açıklamalı olarak istenir.
- Her sürüm üç platformda, en az bir VPN bağlıyken test edilir.

**Kod yapısı**

- Ağ mantığı (tarama, keşif, teşhis) arayüzden bağımsız bir paket olarak yazılır; ileride web veya CLI sürümü aynı paketi kullanabilir.
- Platforma özel kod tek bir katmanda toplanır (Windows / macOS / Linux uygulamaları aynı arayüzü gerçekler).
- Çekirdek paket için birim testleri, platform katmanı için üç işletim sisteminde CI testleri.

## Yol haritası

&#91;embedded content: yol haritası · 4 faz, 3 kapı\]

Fazlar sırayla ilerler; bir sonraki faza kapıdaki koşul sağlanınca geçilir. Süre tahminleri ekip tarafından ilk prototipten sonra eklenecek.

## Riskler ve açık sorular

| Risk | Etki | Önlem |
| --- | --- | --- |
| Split-tunnel VPN'de public IP ile gerçek çıkış yolu farklı olabilir | Raporda yanlış IP kanıt olarak sunulur | Kaynak IP hedef bazında gösterilir; arayüz uyuşmazlığında uyarı (M2) |
| Port taraması ve ağ keşfi kurumsal güvenlik sistemlerini alarma geçirebilir | Kullanıcı bağlantısı engellenebilir, IT ekibiyle sorun çıkar | Varsayılan eşzamanlılık makul tutulur; uyarı metni; "yavaş/sessiz tarama" seçeneği |
| Antivirüsler port tarayıcıları şüpheli işaretleyebilir | Kurulum engellenir | Kod imzalama, büyük antivirüs üreticilerine yanlış alarm bildirimi |
| Yapılandırma komutları işletim sistemi sürümlerine göre değişir | Bazı makinelerde IP/DNS değişikliği çalışmaz | Platform katmanı için sürüm matrisi testi; otomatik geri alma |
| Linux'ta ağ yönetimi dağıtımdan dağıtıma farklı | Yapılandırma özellikleri her yerde çalışmaz | İlk sürümde yalnızca NetworkManager desteklenir |
| Kullanıcı yanlış IP ayarıyla bağlantısını kaybeder | Uzak makinede erişim tamamen kaybolabilir | 15 saniyelik otomatik geri alma; "Önceki ayar" profili |

**Açık sorular**

- [ ] Uygulamanın kesin adı ve logosu ne olacak?
- [ ] Public IP için hangi servis(ler) kullanılacak; kendi küçük servisimizi mi kuracağız?
- [ ] Uygulama ücretsiz mi, açık kaynak mı, ticari mi olacak? Kod imzalama sertifikaları ve dağıtım kanalı buna bağlı.
- [ ] Desteklenecek en eski işletim sistemi sürümleri neler?
- [ ] Teşhis raporu kurum logosu/adıyla özelleştirilebilsin mi?
- [ ] Kurumsal kullanım için profiller ve hosts grupları dosya olarak dışa/içe aktarılabilsin mi?

---

## Geliştirici notları (kod için kısa rehber)

**Dil/çerçeve:** TypeScript · Electron 44 · React 18 · Tailwind 3 + Material Tailwind 2 · i18next · Vitest · electron-vite (Vite 7).

**Klasörler**
- `src/core/` — UI'dan bağımsız ağ mantığı (tarama, doğrulama, hosts bloğu, geri alma). Electron içermez.
- `src/platform/` — OS'e özel kod yalnızca burada (`win32.ts`, `darwin.ts`, `linux.ts`, ortak `Platform` arayüzü).
- `src/helper/` — yetkili yardımcı: beyaz liste (`operations.ts`) ve parametre doğrulama. Serbest komut yok.
- `src/main/` — Electron main: IPC, yetki yükseltme (`privileged.ts`), denetim günlüğü, servisler.
- `src/preload/` — `window.netkit` API'si (contextBridge). Tipi: `src/shared/api.ts`.
- `src/renderer/` — React arayüzü; metinler `src/renderer/src/locales/{tr,en}.json`.
- `tests/` — Vitest birim testleri.

**Komutlar**
- `npm install` · `npm run dev` (geliştirme) · `npm start` (derlenmişi önizle)
- `npm test` · `npm run lint` · `npm run typecheck` · `npm run build` (typecheck + derleme → `out/`)
- `npm run dist` (build + electron-builder → `dist/`, yalnızca bulunulan OS için) · `npm run release-notes -- <tag>` (release notu önizleme)
- Release: `v*` tag push → `.github/workflows/release.yml`. Commit mesajı Conventional Commits: `feat:` → Features, `fix:` → Bug Fixes, diğerleri → Other Changes.

**Kurallar**
- Renderer Node/Electron içe aktaramaz (ESLint kuralı); her şey `window.netkit` üzerinden.
- `BrowserWindow`: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`. Üretimde katı CSP (`connect-src 'none'`).
- Komutlar yalnızca `execFile` ile, argümanlar ayrı ayrı; kullanıcı girdisi kabuk komutuna eklenmez.
- Yetkili yeni işlem = `src/helper/operations.ts`'e beyaz liste girdisi + doğrulama + test.
- Main ↔ yardımcı yalnızca `src/helper/channel.ts` kanalıyla (named pipe / 0700 dizinde Unix soketi; istek özeti komut satırında). İstek/sonuç dosyası yazılmaz. Renderer'a genel yetkili çağrı açılmaz.
- IP/DNS değişikliği `ipv4.change` ile: yedek, uygulama ve 15 sn geri alma aynı yetkili süreçte (ikinci yetki penceresi yok).
- Sistem ayarını değiştiren her işlem yedekli, `audit.log`'a yazılır (userData).
- Arayüz metni koda yazılmaz; TR ve EN JSON'larına aynı anahtarla eklenir (test kontrol eder).
- Material Tailwind bileşenleri yalnızca `components/ui.tsx` sarmalayıcıları üzerinden kullanılır.
- **Responsif:** her yeni/değişen ekran daralan pencerede kullanılabilir olmalı (varsayılan 1280 px'ten `minWidth` 960 px'e kadar): taşma, üst üste binme ve sayfada yatay kaydırma yok; sığmayan alan alt satıra kayar. Bu kontrol (TR ve EN metinle) yapılmadan iş bitmiş sayılmaz.
- Form satırları `flex flex-wrap items-end` + alan başına `min-w-0 flex-[büyüme_küçülme_taban]` ile kurulur (`Select` etiketi kutunun üstünde durduğu için `items-end`).
- Kendiliğinden yapılan tek dış istek public IP sorgusudur (ayarlardan kapatılabilir).
