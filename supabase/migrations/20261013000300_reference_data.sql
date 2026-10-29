-- =============================================================================
-- Vize Başvuru Portalı — initial configuration
-- =============================================================================
-- This file also runs in PRODUCTION; it only contains information provided by the company.
-- Prices, IBAN, contact details, the city list and the folder mapping are DELIBERATELY empty:
-- the company enters them in the admin panel (Settings).

-- ---------------------------------------------------------------------------
-- ZIP category folders — the names the company uses, with their spelling.
-- ---------------------------------------------------------------------------
insert into public.zip_categories (folder_name, sort_order) values
  ('accomodation', 10),
  ('financial evidence', 20),
  ('life events', 30),
  ('other', 40),
  ('pasaport', 50),
  ('proof of business', 60),
  ('sponsor', 70)
on conflict (folder_name) do nothing;

-- ---------------------------------------------------------------------------
-- Settings (those with a null value are placeholders)
-- ---------------------------------------------------------------------------
insert into public.settings (key, value, visibility) values
  ('company.name', '"Vize Başvuru Portalı"', 'public'),
  ('company.contact_email', 'null', 'public'),
  ('company.contact_phone', 'null', 'public'),
  ('payment.account_holder', 'null', 'customer'),
  ('payment.bank_name', 'null', 'customer'),
  ('payment.iban', 'null', 'customer'),
  ('payment.instructions', 'null', 'customer'),
  -- Receipt upload: off until the company enables it.
  ('payment.receipt_upload_enabled', 'false', 'customer'),
  -- Appointment preference window: how many days from today it starts and how many days it lasts.
  -- Weekend / public holiday rules await the company's approval.
  ('appointment.start_offset_days', '1', 'customer'),
  ('appointment.window_days', '10', 'customer'),
  ('appointment.include_weekends', 'true', 'customer'),
  ('appointment.excluded_dates', '[]', 'customer')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- Document types
-- ---------------------------------------------------------------------------
-- The requirement values are INITIAL values derived from the wording in the company's document list:
--   written unconditionally           -> required
--   "varsa / ...ise / ...göre" (if)   -> conditional (the customer can say "not applicable", the consultant sees it)
--   only supporting                   -> optional
-- They can be changed in the admin panel with the company's approval. zip_category_id is deliberately empty.
--
-- Notes:
--  * The "İngiltere bilgi formu" (UK information form) in the shared list is not requested as an upload; the system
--    generates it as a PDF once the form in the portal is filled in.
--  * The person-specific erroneous entry "Oğlunuzun vize fotoğrafı ve pasaportu" was not added to the list.

insert into public.document_types
  (id, label, description, application_type, sponsor_status, requirement, allow_not_applicable, sort_order)
values
  -- Ortak evraklar — shared documents
  ('passport', 'Geçerli pasaport', 'Planlanan gidiş ve dönüş tarihinden itibaren en az altı ay geçerli olmalıdır.', null, null, 'required', false, 10),
  ('old_passports', 'Eski pasaportlar', 'Varsa eski pasaportlarınız.', null, null, 'conditional', true, 20),
  ('previous_visas', 'Eski seyahatlere ait vize fotoğrafları', 'Önceki seyahatlerinize ait vizelerin fotoğrafları.', null, null, 'conditional', true, 30),
  ('residence_certificate', 'Yerleşim yeri belgesi', 'E-Devlet üzerinden alınmış, kare kodlu.', null, null, 'required', false, 40),
  ('population_register', 'Tam vukuatlı nüfus kayıt örneği', 'E-Devlet üzerinden, tüm seçenekler “evet” seçilerek “Nüfus Aile” şeklinde alınmalıdır.', null, null, 'required', false, 50),
  ('id_card', 'Nüfus cüzdanı (ön ve arka yüz)', 'Ön ve arka yüzün fotoğrafı veya fotokopisi.', null, null, 'required', false, 60),
  ('marriage_certificate', 'Evlilik cüzdanı', 'Medeni durumunuza göre.', null, null, 'conditional', true, 70),
  ('bank_statement', 'Banka hesap dökümü', 'Maaş veya birikim hesabınıza ait, son üç aylık, bakiyeli.', null, null, 'required', false, 80),
  ('financial_support_documents', 'Maddi durumu destekleyen belgeler', 'Varsa tapu, araç ruhsatı, kira kontratı vb.', null, null, 'optional', false, 90),
  ('residence_or_work_permit', 'Türkiye ikamet veya çalışma izni', 'Yabancı uyruklu başvuru sahipleri için belgenin fotokopisi.', null, null, 'conditional', true, 100),

  -- Genel (Çalışan) — employed
  ('employee_company_letter', 'Şirket dilekçesi', 'Antetli kâğıtta, ilgili konsolosluğa hitaben, seyahat tarihlerini ve amacını içeren, ıslak imzalı ve kaşeli.', 'general_employee', null, 'required', false, 210),
  ('employee_sgk_statement', 'SGK Tescil ve Hizmet Dökümü', 'E-Devlet''ten alınmış, barkodlu.', 'general_employee', null, 'required', false, 220),
  ('employee_payslips', 'Maaş bordrosu', 'Son üç aylık.', 'general_employee', null, 'required', false, 230),

  -- Self Employed (Kendi İşinin Sahibi)
  ('self_company_letter', 'Şirket dilekçesi', 'Antetli kâğıtta, ilgili konsolosluğa hitaben, seyahat tarihlerini ve amacını içeren, ıslak imzalı ve kaşeli.', 'self_employed', null, 'required', false, 310),
  ('self_tax_certificate', 'Vergi levhası', '', 'self_employed', null, 'required', false, 320),
  ('self_activity_certificate', 'Faaliyet belgesi', '', 'self_employed', null, 'required', false, 330),
  ('self_trade_registry_gazette', 'Ticari Sicil Gazetesi', '', 'self_employed', null, 'required', false, 340),
  ('self_trial_balance', 'Şirket mizanı', 'Şirketin son bir yıllık mizanı.', 'self_employed', null, 'required', false, 350),
  ('self_sgk_statement', 'SGK Tescil ve Hizmet Dökümü', 'E-Devlet''ten alınmış, barkodlu.', 'self_employed', null, 'required', false, 360),
  ('self_company_bank_statement', 'Şirket banka hesap dökümü', 'Son üç aylık, bakiyeli.', 'self_employed', null, 'required', false, 370),
  ('self_personal_account_statements', 'Kişisel hesap dökümleri', 'Son üç aylık kişisel döviz, TL, altın, gümüş, fon veya kripto hesap dökümleri.', 'self_employed', null, 'required', false, 380),
  ('self_large_deposit_explanation', 'Yüksek tutarlı para girişi açıklaması', 'Son üç ayda hesaba yüksek miktarda para girişi olduysa bunu açıklayan fatura veya belgeler.', 'self_employed', null, 'conditional', true, 390),

  -- Emekli — retired
  ('retired_certificate', 'Emeklilik belgesi', 'E-Devlet''ten alınmış.', 'retired', null, 'required', false, 410),
  ('retired_invitation_letter', 'Davet mektubu', 'Ticari seyahat varsa şirket tarafından gönderilen, tarihleri içeren, kaşeli ve imzalı.', 'retired', null, 'conditional', true, 420),

  -- Öğrenci — student
  ('student_certificate', 'Öğrenci belgesi', 'Güncel.', 'student', null, 'required', false, 510),
  ('student_transcript', 'Transkript', 'Güncel.', 'student', null, 'required', false, 520),
  ('student_school_letter', 'Okul yazısı', 'Okuldan alınmış, aktif eğitim gördüğünüzü ve izinli olduğunuzu belirten İngilizce yazı.', 'student', null, 'required', false, 530),

  -- İngiltere Akraba Ziyareti — visiting relatives in the UK (documents requested from the inviting person)
  ('host_passport', 'Davet eden kişinin pasaportu', 'Pasaport fotoğraf sayfasının fotokopisi.', 'uk_family_visit', null, 'required', false, 610),
  ('host_immigration_status', 'Immigration Status ekran görüntüsü', 'Davet eden kişinin British pasaportu yoksa.', 'uk_family_visit', null, 'conditional', true, 620),
  ('host_address_proof', 'Davet eden kişinin adres kanıtı', 'Council Tax Bill veya elektrik, gaz, su faturası.', 'uk_family_visit', null, 'required', false, 630),
  ('host_property_document', 'Kira kontratı veya mülk belgesi', 'Davet eden kişinin kira kontratı veya ev sahibi olduğunu gösteren mülk belgesi.', 'uk_family_visit', null, 'required', false, 640),
  ('host_invitation_letter', 'Resmi davet mektubu', 'Davet eden kişi adına hazırlanmış.', 'uk_family_visit', null, 'required', false, 650),

  -- Sponsored applications — the sponsor's shared documents
  ('sponsor_letter', 'Sponsor dilekçesi', 'Seyahat masraflarınızı karşılayacağını belirten, imzalı.', 'sponsored', null, 'required', false, 710),
  ('sponsor_bank_statement', 'Sponsorun banka hesap dökümü', 'Son üç aylık, bakiyeli. Döküm sponsorun kendi hesabına ait olmalıdır.', 'sponsored', null, 'required', false, 720),
  ('sponsor_financial_documents', 'Sponsorun maddi durumunu destekleyen belgeler', 'Tapu, araç ruhsatı gibi belgeler.', 'sponsored', null, 'conditional', true, 730),
  ('sponsor_relationship_proof', 'Sponsor ile ilişkiyi gösteren belge', 'Sponsor ile aranızdaki ilişkiyi gösteren belge.', 'sponsored', null, 'required', false, 740),
  -- If the sponsor is employed
  ('sponsor_payslips', 'Sponsorun maaş bordrosu', 'Son üç aylık.', 'sponsored', 'employee', 'required', false, 750),
  ('sponsor_sgk_statement', 'Sponsorun SGK Tescil ve Hizmet Dökümü', 'Barkodlu.', 'sponsored', 'employee', 'required', false, 760),
  -- If the sponsor is retired
  ('sponsor_retirement_certificate', 'Sponsorun emeklilik belgesi', 'E-Devlet''ten alınmış.', 'sponsored', 'retired', 'required', false, 770),
  -- If the sponsor owns a business
  ('sponsor_tax_certificate', 'Sponsorun vergi levhası', '', 'sponsored', 'business_owner', 'required', false, 780),
  ('sponsor_activity_certificate', 'Sponsorun faaliyet belgesi', '', 'sponsored', 'business_owner', 'required', false, 790),
  ('sponsor_trade_registry_gazette', 'Sponsorun Ticari Sicil Gazetesi', '', 'sponsored', 'business_owner', 'required', false, 800)
on conflict (id) do nothing;
