import type { LegalBlock } from "./types";

/**
 * THE PORTAL'S ACTUAL COOKIE INVENTORY
 *
 * The table the legal counsel left as a "technical verification" field in the cookie policy is filled with the actual
 * inventory taken from the source code. Sources:
 *  - Supabase session cookies: @supabase/ssr (name: sb-<project id>-auth-token; large values are split into .0, .1 …
 *    chunks; -code-verifier for PKCE), lifetime rule in src/lib/supabase/session-cookies.ts ("Beni hatırla", remember me).
 *  - vbp-remember, vbp-last-email: src/lib/supabase/session-cookies.ts, src/server/actions/auth.ts.
 *  - Browser storage: src/components/application-form/section-form.tsx (vbp:prefill-declined:*),
 *    src/components/auth/register-link.tsx (vbp:signup-email).
 *  - Cloudflare Turnstile (CAPTCHA): src/components/auth/captcha.tsx.
 * If a new cookie or browser storage entry is added, this table and the policy are updated. If the live Supabase project
 * changes, the project id changes too.
 */

/** ID of the live Supabase project. Not secret. */
export const SUPABASE_PROJECT_ID = "proje-kimligi";

export const COOKIE_INVENTORY_BLOCKS: LegalBlock[] = [
  { type: "h2", text: "Portalda kullanılan çerezler ve benzeri teknolojiler" },
  {
    type: "p",
    text: "Aşağıdaki tablo, portalda kullanılan çerezleri ve tarayıcı depolama kayıtlarını gösterir. Hepsi portalın kendi adresinde (portal.example.com) tutulur; son satırdaki güvenlik doğrulaması hariç üçüncü taraf çerezi kullanılmaz.",
  },
  {
    type: "table",
    head: ["Çerez / kayıt adı", "Sağlayıcı", "Teknik amaç", "Saklama süresi"],
    rows: [
      [
        `sb-${SUPABASE_PROJECT_ID}-auth-token (değer büyükse .0, .1 … ekli parçalar)`,
        "portal.example.com (oturum altyapısı: Supabase)",
        "Giriş yapan kullanıcının oturumunu güvenli biçimde sürdürmek; kimlik doğrulama.",
        "“Beni hatırla” seçilmediyse tarayıcı kapanınca silinir; seçildiyse en fazla 400 gün. Çıkış yapılınca silinir.",
      ],
      [
        `sb-${SUPABASE_PROJECT_ID}-auth-token-code-verifier`,
        "portal.example.com (oturum altyapısı: Supabase)",
        "Kayıt doğrulama, şifre sıfırlama ve e-posta değişikliği bağlantılarının güvenliği için tek kullanımlık doğrulama değeri.",
        "Oturum çereziyle aynı kural: “Beni hatırla” seçilmediyse tarayıcı kapanınca silinir.",
      ],
      [
        "vbp-remember",
        "portal.example.com",
        "Kullanıcının girişte “Beni hatırla”yı seçtiğini saklar (değeri yalnızca “1”). Yalnızca kutu işaretlenirse oluşur.",
        "400 gün; çıkış yapılınca silinir.",
      ],
      [
        "vbp-last-email",
        "portal.example.com",
        "“Beni hatırla” seçildiyse giriş ekranındaki e-posta alanını doldurmak için son girişin e-posta adresi. Yalnızca giriş sayfasına gönderilir; sayfadaki betikler okuyamaz. Şifre saklanmaz.",
        "180 gün; “Beni hatırla” seçilmeden giriş yapılırsa silinir.",
      ],
      [
        "vbp:prefill-declined:[başvuru kimliği] (tarayıcının yerel depolaması)",
        "portal.example.com",
        "Müşteri, başvuru formunda risk testi cevaplarından yapılan öneriyi “Hayır” ile kapattıysa aynı başvuruda yeniden sorulmaması için bir işaret (değeri yalnızca “1”; kişisel veri içermez).",
        "Kullanıcı tarayıcı verilerini silene kadar.",
      ],
      [
        "vbp:signup-email (tarayıcının oturum depolaması)",
        "portal.example.com",
        "Giriş ekranında yazılan e-posta adresini “Hesap oluşturun” bağlantısıyla açılan kayıt formuna aktarmak.",
        "Kayıt formu açılınca hemen silinir; en geç sekme kapanınca.",
      ],
      [
        "Cloudflare Turnstile güvenlik doğrulaması",
        "Cloudflare, Inc. (challenges.cloudflare.com; üçüncü taraf)",
        "Giriş, kayıt ve şifre işlemlerinde otomatik (bot) istekleri engellemek. Cloudflare bu amaçla IP adresi ve tarayıcı bilgisi gibi teknik sinyalleri işler; Cloudflare'in Turnstile gizlilik ekine tabidir.",
        "Cloudflare'in kendi alanında, Cloudflare'in politikasına göre belirlenir.",
      ],
    ],
  },
];
