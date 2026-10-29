/**
 * RISK ASSESSMENT TEST — questions, scores and result texts.
 *
 * Source: the original risk test HTML file.
 * Question and option texts, scores, thresholds and result texts were taken from that file WITHOUT CHANGES;
 * no value here was produced by the portal. Text or score changes come from the source file.
 *
 * If the question order or option order changes, RISK_TEST_VERSION must be bumped: saved answers are stored as option
 * indexes and answers from an old version are not evaluated with the new one.
 */

export const RISK_TEST_VERSION = 1;

export type RiskOption = {
  /** Option text. */
  text: string;
  /** Score. A negative score indicates a situation that affects the result negatively. */
  points: number;
};

export type RiskQuestion = {
  text: string;
  options: readonly RiskOption[];
  /** Pure bonus question: a positive answer raises the result, a negative answer has no effect. */
  bonus?: boolean;
  /** Warning shown for the lowest-scoring or negative-scoring answer. */
  lowFlag?: string;
};

export const RISK_QUESTIONS: readonly RiskQuestion[] = [
  {
    text: "Schengen, Kanada veya Avustralya vizesi aldınız mı?",
    options: [
      { text: "Hiç almadım", points: 1 },
      { text: "1-2 kez aldım", points: 6 },
      { text: "3'ten fazla aldım", points: 10 },
    ],
    lowFlag:
      "Daha önce vizeniz olmadığı için başvurunuz daha dikkatli incelenir. Bu nedenle destekleyici belgelerin titizlikle ve eksiksiz hazırlanması gerekir.",
  },
  {
    text: "Daha önce ABD vizesi aldınız mı?",
    bonus: true,
    options: [
      { text: "Hayır", points: 0 },
      { text: "Evet", points: 16 },
    ],
  },
  {
    text: "Daha önce UK (İngiltere) vizesi aldınız mı?",
    bonus: true,
    options: [
      { text: "Hayır, hiç almadım", points: 0 },
      { text: "Evet, aldım", points: 16 },
    ],
  },
  {
    text: "Bu ülkeler hariç, son 5 yılda başka bir ülkeye seyahat ettiniz mi?",
    options: [
      { text: "Hayır", points: 0 },
      { text: "Evet, 1-2 ülke", points: 3 },
      { text: "Evet, birçok ülke", points: 5 },
    ],
  },
  {
    text: "Aldığınız vizelerde/seyahatlerde kurallara uydunuz mu (süre aşımı vb.)?",
    options: [
      { text: "Daha önce hiç yurt dışı seyahatim olmadı", points: 2 },
      { text: "Her zaman kurallara uydum, süresinde döndüm", points: 5 },
      { text: "Bir kez süre aşımı / sorun yaşadım", points: -4 },
    ],
    lowFlag: "Geçmiş göçmenlik ihlali başvuruyu ciddi şekilde zorlaştırır — profesyonel destek şart.",
  },
  {
    text: "Türkiye'deki iş / istihdam durumunuz nedir?",
    options: [
      { text: "Çalışmıyorum / iş bağım yok", points: 0 },
      { text: "Ücretli çalışanım (SGK'lı)", points: 6 },
      { text: "İşyeri sahibiyim / şirketim var", points: 8 },
      { text: "Öğrenci / emekliyim (öğrenciyseniz maddi soruları sponsorunuz adına yanıtlayın)", points: 4 },
    ],
    lowFlag: "Ülkeye geri dönüş için güçlü bir iş bağı göstermek önemlidir.",
  },
  {
    text: "Aylık düzenli geliriniz (kendi adınıza) hangi aralıkta?",
    options: [
      { text: "30.000 - 40.000 TL", points: 2 },
      { text: "40.000 - 60.000 TL", points: 4 },
      { text: "60.000 - 100.000 TL", points: 6 },
      { text: "100.000 TL'den fazla", points: 8 },
    ],
    lowFlag: "Gelir düzeyi seyahat masraflarını rahat karşılayacak biçimde belgelenmeli.",
  },
  {
    text: "Son 3 aya ait geliriniz resmi kayıtlarla (maaş bordrosu, vergi levhası vb.) uyumlu mu?",
    options: [
      { text: "Hayır, resmi kaydım yok / uyumsuz", points: -14 },
      { text: "Kısmen uyumlu", points: 3 },
      { text: "Evet, tamamen uyumlu ve belgeli", points: 7 },
    ],
    lowFlag: "Beyan edilen gelir ile resmi kayıtların uyumsuzluğu en sık ret nedenlerindendir — mutlaka düzeltilmeli.",
  },
  {
    text: "Bankada ya da belgelenebilir platformlarda (borsa, kripto vb.) birikiminiz var mı?",
    options: [
      { text: "Belgelenebilir birikimim yok", points: -14 },
      { text: "0 - 100.000 TL karşılığı birikimim var", points: -4 },
      { text: "100.000 - 200.000 TL karşılığı birikimim var", points: 5 },
      { text: "200.000 TL üstünde birikimim var", points: 8 },
    ],
    lowFlag:
      "Banka veya belgelenebilir platformlar üzerinden görünen yeterli birikim başvuru için önemlidir; düşük birikim başvuruyu zayıflatır.",
  },
  {
    text: "Son 3 ayda banka hesabınıza, kaynağı açıklanması güç yüklü miktarda para girişi oldu mu?",
    options: [
      { text: "Evet, oldu", points: -22 },
      { text: "Küçük/açıklanabilir girişler var", points: 2 },
      { text: "Hayır, hesabım düzenli ve tutarlı", points: 7 },
    ],
    lowFlag: "Kaynağı belirsiz ani para girişleri şüphe uyandırır ve reddin başlıca sebeplerindendir — açıklayıcı belge şart.",
  },
  {
    text: "Türkiye'de kendiniz veya eşiniz üzerine ev, araç, arsa gibi bir yatırımınız var mı?",
    options: [
      { text: "Bir mal varlığım yok", points: 0 },
      { text: "Arabam var", points: 4 },
      { text: "Evim var", points: 6 },
      { text: "Evim ve arabam var", points: 8 },
    ],
    lowFlag: "Ülkeye bağlılığı gösteren mülk/varlık, geri döneceğinize dair güçlü bir kanıttır.",
  },
  {
    text: "Medeni durumunuz nedir?",
    options: [
      { text: "Bekarım", points: 3 },
      { text: "Evliyim", points: 6 },
      { text: "Evliyim ve bizimle yaşayan çocuklarım var", points: 8 },
    ],
  },
  {
    text: "Daha önce İngiltere'den (UK) vize başvurunuz reddedildi mi?",
    options: [
      { text: "Hiç reddedilmedim", points: 6 },
      { text: "Bir kez reddedildim", points: -4 },
      { text: "Birden fazla kez reddedildim", points: -10 },
    ],
    lowFlag: "Önceki UK ret kararları başvuruda açıklanmalı ve gerekçeler giderilmeli — uzman desteği önerilir.",
  },
  {
    text: "İngiltere'de sizi davet eden / destekleyen biri var mı?",
    options: [
      { text: "Hayır, kimse yok", points: 2 },
      { text: "Var ama resmi davet mektubu yok", points: 3 },
      { text: "Evet, davet mektubu ve destekçi belgeleri hazır", points: 5 },
    ],
  },
  {
    text: "İngiltere'de yaşayan birinci dereceden akrabanız var mı?",
    options: [
      { text: "Hayır, yok", points: 0 },
      { text: "Evet, var", points: 5 },
    ],
  },
  {
    text: "İngiltere'de yaşayan akrabanızın oturum/vize durumu nedir?",
    options: [
      { text: "Yaşayan akrabam yok", points: 0 },
      { text: "Geçici oturum izni (öğrencilik, dil okulu, iş/aile vizesi)", points: 6 },
      { text: "Kalıcı oturum", points: 7 },
      { text: "İngiliz vatandaşı", points: 9 },
    ],
  },
];

/** Question indexes (0-based). Conditional question and result rules refer to them. */
export const Q = {
  schengenVisa: 0,
  usaVisa: 1,
  ukVisa: 2,
  otherTravel: 3,
  ruleCompliance: 4,
  employment: 5,
  income: 6,
  incomeRecords: 7,
  savings: 8,
  unexplainedDeposit: 9,
  assets: 10,
  maritalStatus: 11,
  ukRefusal: 12,
  ukInviter: 13,
  ukRelative: 14,
  ukRelativeStatus: 15,
} as const;

export type RiskBandKey = "best" | "good" | "medium" | "needs_work" | "not_advised";

export type RiskBand = { key: RiskBandKey; min: number; badge: string; title: string; text: string };

/** Sorted from high to low; the result is the first band whose threshold is met. */
export const RISK_BANDS: readonly RiskBand[] = [
  {
    key: "best",
    min: 0.8,
    badge: "En İyi Uygunluk",
    title: "Profiliniz çok güçlü görünüyor",
    text: "Cevaplarınız oldukça güçlü bir başvuru profili gösteriyor. Ancak bu kadar iyi bir profilde bile, başvuru veya belgelemede yapılacak küçük bir hata ret ile sonuçlanabilir. Bu nedenle kesinlikle uzman desteği önerilir.",
  },
  {
    key: "good",
    min: 0.6,
    badge: "İyi Uygunluk",
    title: "İyi bir konumdasınız",
    text: "Profiliniz vize uygunluğunu yüksek gösterse de, başvuru ve belgeleme aşamasında yapılacak hatalar bu profili bile riske atabilir. Süreci doğru yönetmek ve olası eksikleri önceden gidermek için uzman desteği almanız önerilir.",
  },
  {
    key: "medium",
    min: 0.5,
    badge: "Orta Uygunluk",
    title: "Vize çıkabilir, ancak iyi bir başvuru şart",
    text: "Profilinizde belirgin bir risk görünmüyor; vize alma ihtimaliniz var. Ancak vize geçmişi, mülk veya aile bağı gibi güçlendirici unsurların eksik olması nedeniyle başvurunun çok iyi hazırlanması gerekiyor. Doğru belge stratejisi ve uzman desteğiyle şansınızı belirgin şekilde artırabilirsiniz.",
  },
  {
    key: "needs_work",
    min: 0.4,
    badge: "Üzerinde Çalışılmalı",
    title: "Profilinizin güçlendirilmesi gerekiyor",
    text: "Başvuru için profilinizin üzerinde çalışılması gerekiyor. Eksik alanlar giderilmeden yapılacak bir başvuru risklidir. Doğru bir hazırlık planı ve uzman desteğiyle profilinizi başvuruya hazır hale getirebilirsiniz.",
  },
  {
    key: "not_advised",
    min: 0,
    badge: "Başvuru Önerilmiyor",
    title: "Yakın zamanda başvuru tavsiye edilmiyor",
    text: "Başvurunuz mevcut haliyle riskli görünüyor ve yakın zamanda başvuru tavsiye edilmiyor. Profilinizi güçlendirmek için 3 ila 6 aylık bir hazırlık planlaması şart. Bu süreci en verimli şekilde geçirmek adına şimdiden planlama yapmanız ve uzman desteği almanız önerilir.",
  },
];

/** Bonus questions close at most this share of the remaining distance. */
export const BONUS_WEIGHT = 0.6;

/** A person without any negative (negative-scoring) answer never drops below this ratio. */
export const NO_NEGATIVE_FLOOR = 0.5;

export type RiskNoticeKey = "plan" | "uk_visa_boost" | "low_savings";

export const RISK_NOTICES: Record<RiskNoticeKey, { title: string; text: string }> = {
  plan: {
    title: "Önemli: Uzman Desteği ve Planlama Önerisi",
    text: "Verdiğiniz cevaplarda, başvuru sonucunu olumsuz etkileyebilecek en az bir kritik nokta bulunuyor. Skorunuz iyi görünse dahi, bu tür durumlar doğru yönetilmediğinde ret ile sonuçlanabilir. Bu nedenle başvuru öncesinde uzman desteği almanızı ve en az 3 aylık bir hazırlık planı yürütmenizi önemle öneririz.",
  },
  uk_visa_boost: {
    title: "Sizin İçin Önemli Bir Avantaj",
    text: "Daha önce UK vizeniz olduğu için güçlü bir avantaja sahipsiniz. Hesap hareketlerinizdeki eksiklikler doğru bir danışmanlıkla giderildiğinde, vize alma ihtimalinizi çok yükseğe çıkarabilirsiniz.",
  },
  low_savings: {
    title: "Birikim Konusunda Önemli Uyarı",
    text: "Belirttiğiniz birikim düzeyi vize başvurusu için yeterli görünmüyor. UK ziyaretçi vizesinde, seyahat masraflarını karşılayabileceğinizi ve ülkenize geri döneceğinizi gösteren yeterli ve belgelenebilir bir birikim büyük önem taşır. Başvurudan önce bankada veya belgelenebilir platformlarda düzenli bir birikim oluşturmanız güçlü şekilde önerilir.",
  },
};

export type RiskCloserKey =
  | "multiple_refusals"
  | "one_refusal"
  | "money_risk_uk_visa"
  | "money_risk_other_visa"
  | "money_risk"
  | "low_savings"
  | "very_low"
  | "no_visa_history"
  | "below_good"
  | "strong";

/** Personalized closing paragraph of the result screen. */
export const RISK_CLOSERS: Record<RiskCloserKey, string> = {
  multiple_refusals:
    "Birden fazla ret almış olmanız başvurunuzun geçmişini daha da kritik hale getiriyor. Her ret kararının kendine özgü bir gerekçesi vardır ve bu gerekçeler doğru analiz edilmeden yapılacak yeni bir başvuru aynı sonucu doğurabilir. Ret mektuplarınız, tekrar eden hataları görmek ve gidermek için en değerli kaynaktır. Neden ret aldığınızın doğru değerlendirilmesi çok önemli; bu süreci birlikte planlamak için mutlaka bize ulaşın.",
  one_refusal:
    "Daha önce bir kez ret almış olmanız, sonraki başvurunuzda neden ret verildiğinin çok iyi anlaşılmasını gerektiriyor. Ret mektupları aslında sonraki başvurular için değerli bir yol göstericidir; içindeki gerekçeler doğru okunup eski hatalar tekrarlanmadan giderildiğinde, sonucu olumluya çevirmek için önemli bir adım atılmış olur. Ret gerekçenizi birlikte değerlendirmek için bize ulaşmanızı öneririz.",
  money_risk_uk_visa:
    "Daha önce UK vizeniz olması güçlü bir avantaj; bu, sizi diğer adaylardan öne çıkarır. Ancak cevaplarınızda başvuruyu etkileyebilecek mali riskler görünüyor. Bu eksikler doğru bir danışmanlıkla giderildiğinde vize alma ihtimaliniz oldukça yükselir. Durumunuzu değerlendirmek için bize ulaşmanızı öneririz.",
  money_risk_other_visa:
    "Daha önce ABD veya Schengen vizesi almış olmanız güçlü bir avantaj ve başvurunuzu olumlu yönde etkiler. Ancak cevaplarınızda bu avantajı gölgeleyebilecek mali riskler görünüyor. Vize geçmişiniz tek başına yeterli olmayabilir; mevcut eksiklerin düzeltilmesi durumunda bu güçlü geçmiş sizi çok daha avantajlı bir konuma taşır. Durumunuzu doğru değerlendirmek için bize ulaşmanızı öneririz.",
  money_risk:
    "Cevaplarınızda başvuruyu doğrudan etkileyebilecek bir mali risk görünüyor. Bu tür durumlar açıklayıcı belgelerle doğru yönetilmediğinde ret riski yüksektir. Başvurudan önce mutlaka bir uzmanla durumunuzu değerlendirmenizi öneririz.",
  low_savings:
    "Birikim düzeyiniz başvuru için zayıf kalıyor. Seyahat masraflarını karşılayabileceğinizi gösteren belgelenebilir bir birikim kritik önemde. Başvuru öncesinde bu alanı güçlendirmek için bir hazırlık planı yapmanız yararınıza olur; bu süreci birlikte planlamak için bize ulaşabilirsiniz.",
  very_low:
    "Şu an başvuru yapmanız yüksek ret riski taşıyor. Bu, hedefinizden vazgeçmeniz gerektiği anlamına gelmez; 3-6 aylık doğru bir hazırlıkla profilinizi başvuruya uygun hale getirmek mümkün. En sağlıklı yol, bu süreci bir uzmanla planlamaktır.",
  no_visa_history:
    "Genel durumunuz olumlu, fakat daha önce vizeniz olmaması başvurunuzun daha titiz incelenmesine yol açacaktır. İlk başvurusunu güçlü belgelerle yapan adayların şansı belirgin şekilde artar; bu aşamada profesyonel destek fark yaratır.",
  below_good:
    "Belirgin bir riskiniz yok, bu olumlu. Ancak sizi güçlü kılacak unsurların (vize geçmişi, mülk, aile bağı) eksik olması, başvurunun her detayının kusursuz sunulmasını gerektiriyor. Doğru bir dosya hazırlığıyla şansınızı ciddi biçimde yükseltebilirsiniz.",
  strong:
    "Profiliniz başvuru için oldukça elverişli. Ancak güçlü profillerde bile ret kararları çoğu zaman küçük belge hatalarından kaynaklanır. Bu avantajı boşa çıkarmamak için başvurunuzu bir uzmanla birlikte hazırlamanızı öneririz.",
};

export const RISK_TEST_TEXT = {
  title: "UK Ziyaretçi Vizesi Uygunluk Testi",
  intro: "Kısa sorularla başvuru şansınızı ölçün. Yaklaşık 3 dakika.",
  flagsHeading: "Dikkat edilmesi gereken noktalar",
  noFlagsHeading: "Değerlendirme",
  noFlags: "Profilinizde belirgin bir risk alanı tespit edilmedi. Belgelerinizi eksiksiz hazırlamanız yeterli olabilir.",
  disclaimer:
    "Bu test yalnızca genel bir ön değerlendirme aracıdır ve resmi bir uygunluk garantisi ya da hukuki tavsiye niteliği taşımaz. UK vize başvuruları her zaman bireysel olarak ve GOV.UK kurallarına göre değerlendirilir.",
} as const;
