**Episode 271: Foot Terminal** · ~1 sa 31 dk · podcast-transcript-etiketi (SRT)

Kaynak, yayıncının feed'deki transcript etiketi. Metin büyük olasılıkla otomatik üretilmiş, bu yüzden özel isim ve rakamlarda hata olabilir (ör. model adları "Quin 3.8", "Omarchi").

**Genel özet**

Podcasting 2.0'ın bu bölümünde Adam Curry ve Dave Jones önce yapay zekâ pazarını tartışıyor. Adam'a göre modeller artık eskisi kadar gelişmiyor, değer "harness" katmanında toplanıyor. Frontier laboratuvarların açık kaynak modellerin yaklaşık 4 ay geride kalması için yavaşlamak istediğini, bunu da "collusion" olarak gördüğünü söylüyor. Dave'e göre laboratuvarlar için asıl hendek donanım fiyatları: RAM çok pahalı, yerel çıkarım zorlaşıyor. AMD'nin Talos'u satın alması ve modeli doğrudan çipe gömmesi (Llama 3.1 8B üzerinde iddiaya göre ~17.000 token/sn) bu tartışmanın parçası. İkisi de çıkarımı yerelde çalıştırıyor; Dave "Swift" adlı Qwen 3.8 27B varyantını, Adam ise sık sık yeni modellerin daha fazla hata yaptığını anlatıyor.

Ardından Dave'in Cloudflare şikâyeti geliyor: aggregator'ını bot olarak kaydettirmek için önce 8–9 ay, sonra yeni sistemde ~3 hafta yanıt alamamış. Bu sırada Cloudflare yapay zekâ ajanlarıyla "EmDash" adlı WordPress benzeri bir CMS yazmış. Podcast Index'in crawler'ı da zaman zaman Cloudflare tarafından engelleniyor. Podcast Movement'tan Tom Webster'ın sunumu üzerinden platform hâkimiyeti ve RSS'in önemi konuşuluyor: Adam bunu RSS lehine okuyor ve "Wherever you get your podcast" cümlesini yayıncılıktaki en güçlü cümle olarak niteliyor.

Orta bölümde "vibe coding" ile yazılım yapmak var: Buzzcast kendi uzaktan kayıt aracını yazıyor, Adam kendi playout sistemini bir öğleden sonrada Python ile yazdığını anlatıyor. İkisine göre bir yazılım patlaması geliyor, ama SRE ihtiyacı da artacak. Adam ayrıca Omarchy'de Pi ajanına workspace düzenini boot'ta geri yüklettirdiğini gösteriyor.

Bölümün ana teknik konusu Dave'in Podcast Index refaktörü: yeni "podcast" tablosu sayesinde feed ID, GUID veya URL ile hangi kapıdan girilirse girilsin aynı ve güncel show verisi dönecek, API kullanıcılarının bir şey değiştirmesi gerekmiyor. Kalan edge case'ler günde 2–4 arasında. Dave endpoint'leri günde en fazla birer birer yayına alıyor, her birinden önce yapay zekâya kod incelemesi yaptırıp logları bir gece izliyor. Yönetim panosu henüz feed odaklı; bitince podcast odaklı yeniden yapılacak ve otomatik düzeltilemeyen değişimlerin haftada bir avuç kalacak şekilde topluluk panosuna taşınması hedefleniyor.

Sonda Tom Webster'ın henüz yayımlanmamış verisi tartışılıyor: katılımcıların %81'i reklamı ücretsiz içerik için adil takas sayıyor, %51'i podcast reklam yükünü "tam uygun" buluyor. Adam ve Dave buna itiraz ediyor ve karşılaştırmanın "en kötü reklamlı ortamla kıyas" olduğunu söylüyor; Adam iHeart'ın "guaranteed human" sloganına rağmen reklamların yapay zekâ sesiyle okunduğunu iddia ediyor. Bölüm, Dave'in oğlunun itfaiye okulundaki bayılma anısı ile bağış ve boost'larla kapanıyor.

**Dakikalara göre**
- [00:00] Giriş; Omarchy ve Pi ile workspace düzeni.
- [08:05] Frontier laboratuvarlar, harness ve "collusion" iddiası: Adam'a göre modeller artık gelişmiyor, değer harness'te; laboratuvarlar açık kaynak modellerin ~4 ay geride kalması için yavaşlamak istiyor. Adam "dangerous regulation" da diyor.
- [10:23] Dave'e göre asıl hendek donanım fiyatları: RAM çok pahalı, yerel çıkarım zorlaşıyor. Dayanağı, Microsoft'un yalnızca 2 GW AI kapasitesi kurduğunu söyleyen bir Bloomberg haberi (Ed Zitron'un yorumuyla). Dave GPU'ların çoğunun gelecekteki alım sözleşmesi olduğunu düşünüyor.
- [12:30] AMD, Talos'u satın almış; Talos modeli çipe gömüyor (Llama 3.1 8B üzerinde iddiaya göre ~17.000 token/sn). Tech Tech Potato'nun demosunda chatjimmy.ai 14.200 token/sn gösterdi.
- [20:00] Dave "Swift" adlı Qwen 3.8 27B varyantının aynı işi daha az döngüyle yaptığını söylüyor; Adam yeni modellerin sık sık daha fazla hata yaptığını düşünüyor. İkisi de çıkarımı yerelde çalıştırıyor (Asus GX10); Adam bazı işlerde hâlâ Claude Code kullanıyor.
- [23:09] Cloudflare şikâyeti: aggregator'ı bot olarak kaydettirmek için 8–9 ay, sonra yeni sistemde ~3 hafta yanıtsız kalma. Cloudflare arada "EmDash" adlı WordPress benzeri bir CMS'i yapay zekâ ajanlarıyla yazdı; Podcast Index'in crawler'ı zaman zaman engelleniyor.
- [27:43] Podcast Movement: Tom Webster (Sounds Profitable) ilk üç kanalın YouTube, Spotify ve Netflix olduğunu ama platformların tam güce sahip olmadığını söylüyor. Adam bunu RSS lehine okuyor; Spotify No Agenda bölümlerini müzik yüzünden kaldırmaya devam ediyor.
- [36:03] Vibe coding: Buzzcast kendi uzaktan kayıt aracını yazıyor, Adam kendi playout sistemini bir öğleden sonrada Python ile yazdığını anlatıyor. İkisine göre yazılım patlaması geliyor ama SRE ihtiyacı da artacak.
- [41:00] Adam, Omarchy'de Pi ajanına workspace düzenini boot'ta geri yüklettirdi; Pi işi tamamladı.
- [43:27] Podcast Index refaktörü (Dave): yeni "podcast" tablosu, feed ID, GUID veya URL ile hangi kapıdan girilirse girilsin aynı ve güncel show verisi döner; API kullanıcılarının bir şey değiştirmesi gerekmiyor. Kalan edge case'ler günde 2–4. Dave endpoint'leri günde en fazla birer birer yayına alıyor; her birinden önce yapay zekâya kod incelemesi yaptırıp logları bir gece izliyor.
- [1:01:43] Yönetim panosu henüz feed odaklı, "podcast" rozeti kafa karıştırıcı; bitince podcast odaklı yeniden yapılacak. Hedef, otomatik düzeltilemeyen değişimleri haftada bir avuça indirip topluluk panosuna taşımak.
- [1:07:25] Ekran süresi ve teknoloji yorgunluğu.
- [1:11:00] Reklam yükü: Tom Webster'ın henüz yayımlanmamış verisine göre katılımcıların %81'i reklamı ücretsiz içerik için adil takas sayıyor, %51'i podcast reklam yükünü "tam uygun" buluyor. Adam ve Dave "en kötü reklamlı ortamla kıyas" diye itiraz ediyor; Adam iHeart'ın "guaranteed human" sloganına rağmen reklamların yapay zekâ sesiyle okunduğunu söylüyor.
- [1:18:22] Dave'in oğlunun itfaiye okulundaki bayılması.
- [1:22:27] Bağışlar ve boost'lar.

Belirli bir bölümü ayrıntılandırayım mı?
