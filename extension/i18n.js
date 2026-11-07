// JDM — interfeys dili (AZ/RU/EN) və açıq/qaranlıq tema.
// Yalnız görünən mətnləri dəyişir; funksional kod/storage açarlarına toxunmur.
(() => {
  if (window.IDM_I18N) return;
  const D = {
    ru: {
      "Ayarlar":"Настройки","Bağla":"Закрыть","Sİ":"ИИ","Endirmələr":"Загрузки","Alt yazı":"Субтитры",
      "İnterfeys":"Интерфейс","Haqqında":"О программе","Dil":"Язык","Rejim":"Режим",
      "Aydınlıq":"Светлая","Qaranlıq":"Тёмная","Azərbaycan dili":"Азербайджанский","Rus dili":"Русский","İngilis dili":"Английский",
      "Sİ (Gemini)":"ИИ (Gemini)","API açarı":"API-ключ","Yoxla":"Проверить","Model":"Модель",
      "Hazırda işlədilən model":"Текущая модель","Açar yalnız":"Ключ только",
      "Endirmə butonunu göstər":"Показывать кнопку загрузки","Yükləmələri tut":"Перехватывать загрузки",
      "Subtitr seçimləri":"Параметры субтитров","Qısa video lenti":"Лента коротких видео",
      "Panel axınları":"Потоки панели","Video":"Видео","Audio":"Аудио","Sosial media axın tutması":"Перехват потоков соцсетей",
      "Üslub":"Стиль","Stil":"Оформление","Sİ tərcümə üslubu":"Стиль перевода ИИ",
      "Alt yazının vizual görünüşü":"Визуальный вид субтитров","Şrift":"Шрифт",
      "Alt yazı şrifti (YouTube · MPV · yükləmə)":"Шрифт субтитров (YouTube · MPV · загрузка)",
      "Alt yazı ölçüsü":"Размер субтитров","2–200 arası · default 16":"От 2 до 200 · по умолчанию 16",
      "Alt yazı stili":"Стиль субтитров","Qalın, kursiv, altdan xətt":"Жирный, курсив, подчёркивание",
      "Arxa fon qaralması":"Затемнение фона","0–100% · default 10%":"0–100% · по умолчанию 10%",
      "Önizləmə":"Предпросмотр","Alt yazı önizləməsi":"Предпросмотр субтитров",
      "Default":"По умолчанию","Akademik":"Академический","Danışıq":"Разговорный","Sadələşdirilmiş":"Упрощённый",
      "Kinematoqrafik":"Кинематографичный","Minimalist":"Минималистичный","Neon":"Неон",
      "Versiya":"Версия","Axınlar":"Потоки","Yüklənənlər":"Загрузки","Aktiv":"Активен","Söndürülüb":"Отключено",
      "Yüklənir":"Загружается","Növbədə":"В очереди","Dayandırılıb":"Приостановлено","Tamamlandı":"Готово","Xəta":"Ошибка",
      "Yüklə":"Скачать","Ləğv et":"Отмена","Saxla və yüklə":"Сохранить и скачать","Qovluq seç":"Выбрать папку",
      "Fərqli Saxla":"Сохранить как","URL Kopyala":"Копировать URL","URL Paylaş":"Поделиться URL",
      "Yalnız səs":"Только звук","Kəs":"Обрезать","Sİ (AI) ›":"ИИ (AI) ›","Sİ (AI)":"ИИ (AI)",
      "Başlanğıc":"Начало","Son":"Конец","Yükləmə panelinə əlavə edildi":"Добавлено в загрузки",
      "Boşdur":"Пусто","Ölçü":"Размер","Sürət":"Скорость","Qalan":"Осталось",
      "Orjinal":"Оригинал","Sİ tərəfindən yaradılmış":"Создано ИИ","Tərcümə":"Перевод","Tezlik":"Частота","İkili dil":"Двойной язык",
      "Subtitr yoxdur":"Нет субтитров","Avtomatik":"Автоматически","Manual":"Вручную","Tam":"Полный","SDH":"SDH",
      "Bütün":"Все","Ancaq 60FPS":"Только 60FPS","Ancaq HDR":"Только HDR","Ancaq 60FPS+HDR":"Только 60FPS+HDR",
      "Yükləmə":"Загрузка","Format":"Формат","Dil":"Язык","Növ":"Тип","Mənbə":"Источник","Həcm":"Размер",
      "Müddət":"Длительность","Keyfiyyət":"Качество","Səs":"Звук","Sub":"Субтитры","Filtr":"Фильтр",
      "Video + Səs":"Видео + Звук","Video + Səs + Subtitr":"Видео + Звук + Субтитры","Yalnız video":"Только видео",
      "Yalnız səs":"Только звук","Yalnız subtitr":"Только субтитры",
      "Bağlantılar":"Соединения","Yükləmələr":"Загрузки","Xəta yoxdur":"Без ошибок","Yenilə":"Обновить",
      "Yüklənir…":"Загружается…","Birləşdirilir":"Объединение","Kəsilir":"Обрезка","Gözləyir":"Ожидание",
      "Səs trekləri ayrıca yüklənir":"Аудиодорожки загружаются отдельно","Səs yüklənir":"Загрузка аудио",
      "Səs trekləri birləşdirilir (ffmpeg)":"Объединение аудиодорожек (ffmpeg)","Seqmentlər kəsilir…":"Обрезка сегментов…",
      "Birləşdirilir (stream copy)…":"Объединение (stream copy)…","Emal olunur (ffmpeg)":"Обработка (ffmpeg)",
      "Ağıllı video məzmun xülasəsi":"Умная сводка содержания видео","Smart keyword jump":"Умный переход по ключевому слову",
      "Ağıllı lüğət":"Умный словарь","Anki/flashcards":"Anki/карточки","Quiz":"Тест","Ağıllı konspekt generatoru":"Умный конспект",
      "Vocabulary level test parameters":"Параметры уровня словарного запаса","Sitatlar və tezislər":"Цитаты и тезисы",
      "Tonlama":"Тональность","Resurs və istinadlar":"Ресурсы и ссылки","Ağıllı fakt yoxlamaları":"Умная проверка фактов",
      "Müəllif hüquqları":"Авторские права","Sürət və çətinlik indeksi":"Индекс скорости и сложности","Yanaşma":"Позиция",
      "Ritorika və manipulyasiya":"Риторика и манипуляция","Obyektlər və əlaqələr qrafiki":"Граф объектов и связей",
      "Ağıllı resept və tərkib siyahısı":"Умный рецепт и состав","Avtomatik ziddiyyət və səhv axtaran":"Автопоиск противоречий и ошибок",
      "🔗 URL Kopyala":"🔗 Копировать URL","📤 URL Paylaş":"📤 Поделиться URL","💾 Fərqli Saxla":"💾 Сохранить как",
      "🎵 Yalnız səs":"🎵 Только звук","✂ Kəs":"✂ Обрезать","🧠 Sİ (AI) ›":"🧠 ИИ (AI) ›",
      "Ön üz":"Лицевая сторона","Arxa üz":"Обратная сторона","Qərar":"Решение","İzah":"Объяснение",
      "Risk növü":"Тип риска","Risk %":"Риск %","Səbəb":"Причина","Birinci ifadə":"Первое выражение",
      "İkinci ifadə":"Второе выражение","Tərkib":"Состав","Münasibət":"Отношение","Kimə qarşı":"К кому",
      "Əlaqə":"Связь","Düzgün cavab":"Правильный ответ","Ümumi söz sayı":"Всего слов","Unikal söz sayı":"Уникальных слов",
      "Leksik sıxlıq":"Лексическая плотность","CEFR səviyyəsi":"Уровень CEFR","Qabaqcıl nisbət":"Доля продвинутых",
      "Hazırda işlədilən model":"Текущая модель",
      "-da saxlanılır və birbaşa Google-a göndərilir.":"-da хранится и отправляется напрямую в Google.",
      "Boş = standart. Say 1–16. Parçalı (HLS/DASH) axınlarda və birbaşa fayllarda tətbiq olunur; düz YouTube axınları üçün aria2c lazımdır.":"Пусто = по умолчанию. Число 1–16. Применяется к сегментированным (HLS/DASH) потокам и прямым файлам; для обычных потоков YouTube нужен aria2c.",
      "Bütün interfeys, parametrlər və Sİ menyuları seçilmiş dilə keçir.":"Весь интерфейс, параметры и меню ИИ переключаются на выбранный язык.",
      "Açıq rejim bütün pəncərələrə, ayarlara və Sİ panelinə tətbiq olunur; vurğu rəngləri qorunur.":"Светлая тема применяется ко всем окнам, настройкам и панели ИИ; акцентные цвета сохраняются.",
      "Versiya:":"Версия:",
      "JDM — brauzer yükləmələrini aria2/yt-dlp ilə sürətləndirən, YouTube və digər saytlar üçün seqment kəsmə və alt yazı dəstəyi olan yükləmə meneceri.":"JDM — менеджер загрузок, ускоряющий загрузки браузера с помощью aria2/yt-dlp, с поддержкой нарезки сегментов и субтитров для YouTube и других сайтов.",
      "Media axınlarını yenidən yoxla":"Повторно проверить медиапотоки",
      "Hamısını dayandır":"Остановить все",
      "Hamısına davam":"Продолжить все",
      "Qalın":"Жирный",
      "Kursiv":"Курсив",
      "Altdan xətt":"Подчёркнутый",
      "avto":"авто",
      "Aktiv":"Активен",
      "Söndürülüb":"Отключено",
      "Qovluqda göstər":"Показать в папке",
      "Oynat / Aç":"Открыть / Воспроизвести",
      "Siyahıdan sil (fayl silinmir)":"Удалить из списка (файл не удаляется)",
      "Qovluq açılmadı":"Папка не открылась",
      "Fayl açılmadı":"Файл не открылся",
      "Dayandır":"Остановить",
      "Yenidən cəhd":"Повторить",
      "Faylı aç":"Открыть файл",
      "Qovluğu aç":"Открыть папку",
      "✓ Açar etibarlıdır":"✓ Ключ действителен",
      "✕ Açar etibarsızdır":"✕ Ключ недействителен",
      "Açar dəyişdi — yenidən yoxlayın":"Ключ изменён — проверьте снова",
      "Seçilmiş AI alt yazısı yoxdur":"Выбранные ИИ-субтитры отсутствуют",
      "Səhifə videosu (yt-dlp)":"Видео страницы (yt-dlp)",
      "Aşkarlanan subtitrlər":"Найденные субтитры",
      "Yüklənə bilən keyfiyyət tapılmadı":"Не найдено доступного качества",
      "yoxlanılır":"проверяется",
      "Keyfiyyətlər yoxlanılır...":"Качества проверяются...",
      "Keyfiyyətlər yoxlanılır…":"Качества проверяются…",
      "xəta":"ошибка",
      "Media müddəti yoxlanılır…":"Проверка длительности медиа…",
      "Müddət yoxlanılır…":"Проверка длительности…",
      "✗ Medianın müddəti bilinmir":"✗ Длительность медиа неизвестна",
      "✓ Yükləmə panelinə əlavə edildi":"✓ Добавлено в панель загрузок",
      "✓ Kəsmə yükləmə panelinə əlavə edildi":"✓ Нарезка добавлена в панель загрузок",
      "Baş. dəq":"Нач. мин",
      "Baş. san":"Нач. сек",
      "Son dəq":"Кон. мин",
      "Qismən":"Частично",
      "Qısa":"Короткий",
      "kənara klik":"клик вне",
      "Sırala":"Сортировать",
      "Nəticəni yoxla":"Проверить результат",
      "Sİ fəsillərini YouTube-a tətbiq et":"Применить главы ИИ к YouTube",
      "Tətbiq…":"Применение…",
      "tətbiq olunmadı":"не применено",
      "İxrac et":"Экспорт",
      "Kopyala":"Копировать",
      "Təlimat": "Инструкция",
      "JDM nədir?": "Что такое JDM?",
      "İlk quraşdırma": "Первая установка",
      "Əsas istifadə": "Основное использование",
      "Sağ klik menyusu": "Контекстное меню",
      "Süni intellekt (Sİ) xüsusiyyətləri": "Возможности искусственного интеллекта (ИИ)",
      "İkili (dual) alt yazı": "Двойные субтитры",
      "Dəstəklənən saytlar": "Поддерживаемые сайты",
      "Qısa problem həlli": "Краткое решение проблем",
      "Əsas imkanlar": "Основные возможности",
      "Texnoloji": "Технология",
      "▶ Hazırda oxudulur": "▶ Сейчас воспроизводится",
      "Seqment mətni": "Текст сегмента",
      "Genişləndir": "Расширить",
      "Gemini transkripti analiz edir… (bu 10–40 saniyə çəkə bilər)": "Gemini анализирует транскрипт… (это может занять 10–40 секунд)",
      "MPV/YouTube üçün": "Для MPV/YouTube",
      "— model seçilməyib —": "— модель не выбрана —",
      "Helper köhnədir (rejimlər/subtitr işləməz). Yeni helper.py-ni işləyən yerə köçürüb restart edin.": "Helper устарел (режимы/субтитры не работают). Скопируйте новый helper.py в рабочее место и перезапустите.",
      "Sayt": "Сайт",
      "Oxudulub": "Прочитано",
      "Təxmini": "Примерно",
      "Yarat": "Создать",
      "Rəng": "Цвет",
      "Tətbiq et": "Применить",
      "Alt yazı seç…": "Выбрать субтитры…",
      "Yox": "Нет",
      "Bu alt yazı YouTube-a inteqrasiya edilsin?": "Интегрировать эти субтитры в YouTube?",
      "İki alt yazını üst və aşağı sətir kimi birləşdir": "Объединить два субтитра как верхнюю и нижнюю строки",
      "Bütün AI alt yazılarını sil": "Удалить все ИИ-субтитры",
      "Cari videonu yenidən müəyyən et": "Повторно определить текущее видео",
      "Geri": "Назад",
      "Üst / aşağı sətir": "Верхняя / нижняя строка",
      "Alt yazı seçimi": "Выбор субтитров",
      "həcm bilinmir": "размер неизвестен",
      "təxmini həcm": "примерный размер",
      "Son san": "Кон. сек",
      "bilinmir": "неизвестно",
      "Ümumi müddət": "Общая длительность",
      "Rəqəmsal dəqiqə/saniyə daxil edin": "Введите цифровые минуты/секунды",
      "Fayl adı boşdur": "Имя файла пустое",
      "Əvvəl oxudulanlar": "Ранее просмотренные",
      "AI alt yazılar": "ИИ-субтитры",
      "Sİ · ": "ИИ · ",
      "✂ Kəs — ": "✂ Обрезать — ",
      "💾 Fərqli Saxla — ": "💾 Сохранить как — ",
      "Tərcümə et": "Перевести",
      "Metriklər": "Метрики",
      "Göstərici": "Показатель",
      "YouTube-un öz fəsil markerləri": "Собственные маркеры глав YouTube",
      "Mövzular üzrə bölgü (YouTube Native kimi)": "Разбивка по темам (как главы YouTube)",
      "Açar sözün keçdiyi yerlər (geniş pəncərə)": "Места с ключевым словом (широкое окно)",
      "Bütün sözlər — yazıldığı kimi, hərfi tərcümə ilə": "Все слова — как написано, с буквальным переводом",
      "Ən zəruri kartlar": "Самые нужные карточки",
      "İnteraktiv test": "Интерактивный тест",
      "Qısa qeydlər": "Краткие заметки",
      "Unikal söz sayı, leksik sıxlıq və s.": "Уникальные слова, лексическая плотность и др.",
      "Sitatlar və analitik tezislər": "Цитаты и аналитические тезисы",
      "Daha incə emosional xəritə": "Более тонкая эмоциональная карта",
      "Kitab/məqalə/sayt/alət siyahısı": "Список книг/статей/сайтов/инструментов",
      "İddiaların yoxlanması": "Проверка утверждений",
      "Hər dəqiqə/seqment üçün risk faizi": "Процент риска за минуту/сегмент",
      "Yalnız göstərilən parametrlər": "Только указанные параметры",
      "Danışanların yanaşması və qarşılıqlı münasibətləri": "Позиция и взаимоотношения говорящих",
      "Fallasiya və manipulyasiya (2 cümlə)": "Логические ошибки и манипуляции (2 предложения)",
      "Şəxslər, dövlətlər, təşkilatlar": "Лица, государства, организации",
      "Addım-addım resept": "Пошаговый рецепт",
      "Ziddiyyətlər (2 cümləlik izah)": "Противоречия (объяснение в 2 предложения)",
      "Uzun siyahı, 2 cümləlik izah": "Длинный список, объяснение в 2 предложения",
      "✓ Kopyalandı":"✓ Скопировано",
      "✗ Kopyalama alınmadı":"✗ Не удалось скопировать",
      "ixrac alınmadı":"экспорт не удался",
      "Sİ — AI xüsusiyyətləri":"ИИ — возможности AI",
      "Tab tapılmadı":"Вкладка не найдена",
      "Alt yazı mənbələri yoxlanılır…":"Проверка источников субтитров…",
      "Alt yazı mənbəyi:":"Источник субтитров:",
      "Sİ tərəfindən hazırlanmış":"Создано ИИ",
      "Axtarış metodu":"Метод поиска",
      "Hərfi axtarış":"Буквальный поиск",
      "Məna axtarışı":"Поиск по смыслу",
      "⟳ Alt yazını yenilə":"⟳ Обновить субтитры",
      "Alt yazının mövcudluğunu yenidən yoxla":"Повторно проверить наличие субтитров",
      "İşlənir…":"Обработка…",
      "Yenidən cəhd et":"Повторить",
      "Yenidən":"Снова",
      "Xüsusiyyət seçilməyib — siyahıdan birini seçin.":"Функция не выбрана — выберите одну из списка.",
      "Bu videoda alt yazı tapılmadı. Alt yazı olduğundan əmin olun və «⟳ Alt yazını yenilə» basın.":"В этом видео субтитры не найдены. Убедитесь, что они есть, и нажмите «⟳ Обновить субтитры».",
      "AI işləmədi":"AI не сработал",
      "Altyazıda görünmə sırası":"Порядок появления в субтитрах",
      "Əlifba A→Z":"По алфавиту A→Z",
      "Əlifba Z→A":"По алфавиту Z→A",
      "Tezliyə görə (çoxdan aza)":"По частоте (от высокой к низкой)",
      "Tezliyə görə (azdan çoxa)":"По частоте (от низкой к высокой)",
      "İlk görünmə vaxtına görə":"По времени первого появления",
      "Genişləndirilir…":"Расширение…",
      "Daha çox kart hazırlanır…":"Готовятся дополнительные карточки…",
      "Daha çox":"Ещё",
      "Hazırlanır…":"Готовится…",
      "Başladılır…":"Запуск…",
      "klip yaradılmadı":"клип не создан",
      "Avropa dil səviyyəsi":"Европейский уровень языка",
      "Dil səviyyəsi":"Языковой уровень",
      "Nitq sürəti (söz/dəqiqə)":"Скорость речи (слов/мин)",
      "Məlumat sıxlığı":"Плотность информации",
      "Çətinlik indeksi":"Индекс сложности",
      "Orta cümlə uzunluğu":"Средняя длина предложения",
      "Cümlə sayı":"Число предложений",
      "Ümumi cümlə sayı":"Всего предложений",
      "Söz sayı":"Число слов",
      "Qabaqcıl sözlər":"Продвинутые слова",
      "Əsas sözlər":"Основные слова",
      "Lüğət zənginliyi":"Богатство словаря",
      "Tip-token nisbəti":"Соотношение типов и токенов",
      "Köməkçi söz nisbəti":"Доля служебных слов",
      "Orta söz uzunluğu":"Средняя длина слова",
      "Uzun söz nisbəti":"Доля длинных слов",
      "Oxuma vaxtı":"Время чтения",
      "Nitq sürəti":"Скорость речи",
      "Mürəkkəblik":"Сложность",
      "Ümumi qiymət":"Общая оценка",
      "Müddət (dəqiqə)":"Длительность (мин)",
      "Söz/dəqiqə":"Слов/мин",
      "Ümumi":"Всего",
      "söz sayı":"число слов",
      "sıxlıq":"плотность",
      "Qabaqcıl":"Продвинутый",
      "nisbət":"доля",
      "cümlə":"предложение",
      "söz":"слово",
      "sürət":"скорость",
      "mürəkkəblik":"сложность",
      "ümumi qiymət":"общая оценка",
      "əsas":"основной",
      "lüğət":"словарь",
      "zənginlik":"богатство",
      "köməkçi söz":"служебное слово",
      "✗ Kəsmə işi tapılmadı (helper yenidən başladı?) — yenidən cəhd edin":"✗ Задача нарезки не найдена (helper перезапущен?) — повторите",
      "✓ Hazırdır:":"✓ Готово:",
      "Sİ alt yazı":"ИИ-субтитры",
      "AI subtitr yaradılmadı":"ИИ-субтитры не созданы",
      "Tərcümə et":"Перевести",
      "Mənbə alt yazı":"Исходные субтитры",
      "Tərcümə üçün mənbə seç":"Выберите источник для перевода",
      "Avtomatik tərcümə":"Автоперевод",
      "Sİ · Hazır":"ИИ · Готово",
      "Bütün rənglər":"Все цвета",
      "Qradientlər":"Градиенты",
      "Üst sətir":"Верхняя строка",
      "Aşağı sətir":"Нижняя строка",
      "Alt yazı yoxdur":"Нет субтитров",
      "İkili alt yazı modulu mövcud deyil":"Модуль двойных субтитров недоступен",
      "İkili alt yazı hazırlanır…":"Двойные субтитры готовятся…",
      "Mənbə alt yazılar oxunur…":"Чтение исходных субтитров…",
      "İkili alt yazı yaradılmadı":"Двойные субтитры не созданы",
      "Vaxtlar uyğunlaşdırılır…":"Синхронизация времени…",
      "✓ İkili alt yazı hazır":"✓ Двойные субтитры готовы",
      "YouTube seçimi":"Выбор YouTube",
      "Hə":"Да",
      "Sİ dilləri":"Языки ИИ",
      "Sİ hazır":"ИИ готов",
      "İkili":"Двойной",
      "Hazır":"Готово",
      "YouTube seçimi ✕":"Выбор YouTube ✕",
      "AI modulu mövcud deyil":"Модуль AI недоступен",
      "Səs:":"Звук:",
      "Seçilməyib":"Не выбрано",
      "Səsi seç — seçim sırası ilə inteqrasiya olunur":"Выберите звук — интегрируется в порядке выбора",
      "Keyfiyyət:":"Качество:",
      "⚠ Bu mənbədə ayrıca səs axını yoxdur: səs videonun içindədir. Ən kiçik keyfiyyətli video yüklənib ondan səs çıxarılacaq":"⚠ В этом источнике нет отдельной аудиодорожки: звук внутри видео. Будет загружено видео наименьшего качества, и из него извлечётся звук",
      "san əvvəl":"сек назад",
      "dəq əvvəl":"мин назад",
      "saat əvvəl":"ч назад",
      "hamısı":"все",
      "sətir":"строка",
      "Akronimlər və qısaltmalar lüğəti": "Словарь акронимов и сокращений",
      "YouTube Native": "Главы YouTube",
      "Danışan": "Говорящий",
      "Ton": "Тон",
      "Açılışı": "Расшифровка",
      "Kontekst": "Контекст",
      "Nümunə": "Пример",
      "Xüsusiyyətlər": "Функции",
      "Alt yazı mənbələri": "Источники субтитров",
      "Kopyala": "Копировать",
    },
    en: {
      "Ayarlar":"Settings","Bağla":"Close","Sİ":"AI","Endirmələr":"Downloads","Alt yazı":"Subtitles",
      "İnterfeys":"Interface","Haqqında":"About","Dil":"Language","Rejim":"Mode",
      "Aydınlıq":"Light","Qaranlıq":"Dark","Azərbaycan dili":"Azerbaijani","Rus dili":"Russian","İngilis dili":"English",
      "Sİ (Gemini)":"AI (Gemini)","API açarı":"API key","Yoxla":"Verify","Model":"Model",
      "Hazırda işlədilən model":"Current model","Açar yalnız":"Key is only",
      "Endirmə butonunu göstər":"Show download button","Yükləmələri tut":"Intercept downloads",
      "Subtitr seçimləri":"Subtitle options","Qısa video lenti":"Short video feed",
      "Panel axınları":"Panel streams","Video":"Video","Audio":"Audio","Sosial media axın tutması":"Social media capture",
      "Üslub":"Register","Stil":"Visual style","Sİ tərcümə üslubu":"AI translation style",
      "Alt yazının vizual görünüşü":"Subtitle visual appearance","Şrift":"Font",
      "Alt yazı şrifti (YouTube · MPV · yükləmə)":"Subtitle font (YouTube · MPV · download)",
      "Alt yazı ölçüsü":"Subtitle size","2–200 arası · default 16":"2–200 · default 16",
      "Alt yazı stili":"Subtitle style","Qalın, kursiv, altdan xətt":"Bold, italic, underline",
      "Arxa fon qaralması":"Background darkness","0–100% · default 10%":"0–100% · default 10%",
      "Önizləmə":"Preview","Alt yazı önizləməsi":"Subtitle preview",
      "Default":"Default","Akademik":"Academic","Danışıq":"Conversational","Sadələşdirilmiş":"Simplified",
      "Kinematoqrafik":"Cinematic","Minimalist":"Minimalist","Neon":"Neon",
      "Versiya":"Version","Axınlar":"Streams","Yüklənənlər":"Downloads","Aktiv":"Active","Söndürülüb":"Disabled",
      "Yüklənir":"Downloading","Növbədə":"Queued","Dayandırılıb":"Paused","Tamamlandı":"Completed","Xəta":"Error",
      "Yüklə":"Download","Ləğv et":"Cancel","Saxla və yüklə":"Save and download","Qovluq seç":"Choose folder",
      "Fərqli Saxla":"Save as","URL Kopyala":"Copy URL","URL Paylaş":"Share URL",
      "Yalnız səs":"Audio only","Kəs":"Cut","Sİ (AI) ›":"AI ›","Sİ (AI)":"AI",
      "Başlanğıc":"Start","Son":"End","Yükləmə panelinə əlavə edildi":"Added to downloads",
      "Boşdur":"Empty","Ölçü":"Size","Sürət":"Speed","Qalan":"Remaining",
      "Orjinal":"Original","Sİ tərəfindən yaradılmış":"AI generated","Tərcümə":"Translation","Tezlik":"Frequency","İkili dil":"Dual language",
      "Subtitr yoxdur":"No subtitles","Avtomatik":"Automatic","Manual":"Manual","Tam":"Full","SDH":"SDH",
      "Bütün":"All","Ancaq 60FPS":"60FPS only","Ancaq HDR":"HDR only","Ancaq 60FPS+HDR":"60FPS+HDR only",
      "Yükləmə":"Download","Format":"Format","Dil":"Language","Növ":"Type","Mənbə":"Source","Həcm":"Size",
      "Müddət":"Duration","Keyfiyyət":"Quality","Səs":"Audio","Sub":"Sub","Filtr":"Filter",
      "Video + Səs":"Video + Audio","Video + Səs + Subtitr":"Video + Audio + Subtitles","Yalnız video":"Video only",
      "Yalnız subtitr":"Subtitles only",
      "Bağlantılar":"Connections","Yükləmələr":"Downloads","Xəta yoxdur":"No errors","Yenilə":"Refresh",
      "Yüklənir…":"Downloading…","Birləşdirilir":"Merging","Kəsilir":"Cutting","Gözləyir":"Waiting",
      "Səs trekləri ayrıca yüklənir":"Audio tracks downloading","Səs yüklənir":"Downloading audio",
      "Səs trekləri birləşdirilir (ffmpeg)":"Merging audio tracks (ffmpeg)","Seqmentlər kəsilir…":"Cutting segments…",
      "Birləşdirilir (stream copy)…":"Merging (stream copy)…","Emal olunur (ffmpeg)":"Processing (ffmpeg)",
      "Ağıllı video məzmun xülasəsi":"Smart video summary","Smart keyword jump":"Smart keyword jump",
      "Ağıllı lüğət":"Smart glossary","Anki/flashcards":"Anki/flashcards","Quiz":"Quiz","Ağıllı konspekt generatoru":"Smart cheat sheet",
      "Vocabulary level test parameters":"Vocabulary level parameters","Sitatlar və tezislər":"Quotes and theses",
      "Tonlama":"Tone","Resurs və istinadlar":"Resources and references","Ağıllı fakt yoxlamaları":"Smart fact checking",
      "Müəllif hüquqları":"Copyright risk","Sürət və çətinlik indeksi":"Speed and difficulty index","Yanaşma":"Stance",
      "Ritorika və manipulyasiya":"Rhetoric and manipulation","Obyektlər və əlaqələr qrafiki":"Entities and relations graph",
      "Ağıllı resept və tərkib siyahısı":"Smart recipe and ingredients","Avtomatik ziddiyyət və səhv axtaran":"Automatic contradiction finder",
      "🔗 URL Kopyala":"🔗 Copy URL","📤 URL Paylaş":"📤 Share URL","💾 Fərqli Saxla":"💾 Save as",
      "🎵 Yalnız səs":"🎵 Audio only","✂ Kəs":"✂ Cut","🧠 Sİ (AI) ›":"🧠 AI ›",
      "Ön üz":"Front","Arxa üz":"Back","Qərar":"Verdict","İzah":"Explanation",
      "Risk növü":"Risk type","Risk %":"Risk %","Səbəb":"Reason","Birinci ifadə":"First statement",
      "İkinci ifadə":"Second statement","Tərkib":"Ingredients","Münasibət":"Stance","Kimə qarşı":"Toward whom",
      "Əlaqə":"Relation","Düzgün cavab":"Correct answer","Ümumi söz sayı":"Total words","Unikal söz sayı":"Unique words",
      "Leksik sıxlıq":"Lexical density","CEFR səviyyəsi":"CEFR level","Qabaqcıl nisbət":"Advanced ratio",
      "Hazırda işlədilən model":"Current model",
      "-da saxlanılır və birbaşa Google-a göndərilir.":"-da and sent directly to Google.",
      "Boş = standart. Say 1–16. Parçalı (HLS/DASH) axınlarda və birbaşa fayllarda tətbiq olunur; düz YouTube axınları üçün aria2c lazımdır.":"Empty = default. Number 1–16. Applies to segmented (HLS/DASH) streams and direct files; plain YouTube streams need aria2c.",
      "Bütün interfeys, parametrlər və Sİ menyuları seçilmiş dilə keçir.":"The whole interface, settings and AI menus switch to the selected language.",
      "Açıq rejim bütün pəncərələrə, ayarlara və Sİ panelinə tətbiq olunur; vurğu rəngləri qorunur.":"Light mode applies to all windows, settings and the AI panel; accent colors are kept.",
      "Versiya:":"Version:",
      "JDM — brauzer yükləmələrini aria2/yt-dlp ilə sürətləndirən, YouTube və digər saytlar üçün seqment kəsmə və alt yazı dəstəyi olan yükləmə meneceri.":"JDM — a download manager that speeds up browser downloads with aria2/yt-dlp, with segment cutting and subtitle support for YouTube and other sites.",
      "Media axınlarını yenidən yoxla":"Recheck media streams",
      "Hamısını dayandır":"Pause all",
      "Hamısına davam":"Resume all",
      "Qalın":"Bold",
      "Kursiv":"Italic",
      "Altdan xətt":"Underline",
      "avto":"auto",
      "Aktiv":"Active",
      "Söndürülüb":"Disabled",
      "Qovluqda göstər":"Show in folder",
      "Oynat / Aç":"Open / Play",
      "Siyahıdan sil (fayl silinmir)":"Remove from list (file is kept)",
      "Qovluq açılmadı":"Folder did not open",
      "Fayl açılmadı":"File did not open",
      "Dayandır":"Pause",
      "Yenidən cəhd":"Retry",
      "Faylı aç":"Open file",
      "Qovluğu aç":"Open folder",
      "✓ Açar etibarlıdır":"✓ Key is valid",
      "✕ Açar etibarsızdır":"✕ Key is invalid",
      "Açar dəyişdi — yenidən yoxlayın":"Key changed — verify again",
      "Seçilmiş AI alt yazısı yoxdur":"No selected AI subtitles",
      "Səhifə videosu (yt-dlp)":"Page video (yt-dlp)",
      "Aşkarlanan subtitrlər":"Detected subtitles",
      "Yüklənə bilən keyfiyyət tapılmadı":"No downloadable quality found",
      "yoxlanılır":"checking",
      "Keyfiyyətlər yoxlanılır...":"Checking qualities...",
      "Keyfiyyətlər yoxlanılır…":"Checking qualities…",
      "xəta":"error",
      "Media müddəti yoxlanılır…":"Checking media duration…",
      "Müddət yoxlanılır…":"Checking duration…",
      "✗ Medianın müddəti bilinmir":"✗ Media duration unknown",
      "✓ Yükləmə panelinə əlavə edildi":"✓ Added to downloads",
      "✓ Kəsmə yükləmə panelinə əlavə edildi":"✓ Cut added to downloads",
      "Baş. dəq":"Start min",
      "Baş. san":"Start sec",
      "Son dəq":"End min",
      "Qismən":"Partial",
      "Qısa":"Short",
      "kənara klik":"click outside",
      "Sırala":"Sort",
      "Nəticəni yoxla":"Validate result",
      "Sİ fəsillərini YouTube-a tətbiq et":"Apply AI chapters to YouTube",
      "Tətbiq…":"Applying…",
      "tətbiq olunmadı":"not applied",
      "İxrac et":"Export",
      "Kopyala":"Copy",
      "Təlimat": "Guide",
      "JDM nədir?": "What is JDM?",
      "İlk quraşdırma": "First-time setup",
      "Əsas istifadə": "Basic usage",
      "Sağ klik menyusu": "Context menu",
      "Süni intellekt (Sİ) xüsusiyyətləri": "AI features",
      "İkili (dual) alt yazı": "Dual subtitles",
      "Dəstəklənən saytlar": "Supported sites",
      "Qısa problem həlli": "Quick troubleshooting",
      "Əsas imkanlar": "Key features",
      "Texnoloji": "Technology",
      "▶ Hazırda oxudulur": "▶ Now playing",
      "Seqment mətni": "Segment text",
      "Genişləndir": "Expand",
      "Gemini transkripti analiz edir… (bu 10–40 saniyə çəkə bilər)": "Gemini is analyzing the transcript… (this may take 10–40 seconds)",
      "MPV/YouTube üçün": "For MPV/YouTube",
      "— model seçilməyib —": "— no model selected —",
      "Helper köhnədir (rejimlər/subtitr işləməz). Yeni helper.py-ni işləyən yerə köçürüb restart edin.": "Helper is outdated (modes/subtitles will not work). Copy the new helper.py into place and restart.",
      "Sayt": "Site",
      "Oxudulub": "Read",
      "Təxmini": "Approximate",
      "Yarat": "Create",
      "Rəng": "Color",
      "Tətbiq et": "Apply",
      "Alt yazı seç…": "Choose subtitles…",
      "Yox": "No",
      "Bu alt yazı YouTube-a inteqrasiya edilsin?": "Integrate these subtitles into YouTube?",
      "İki alt yazını üst və aşağı sətir kimi birləşdir": "Merge two subtitles as top and bottom lines",
      "Bütün AI alt yazılarını sil": "Delete all AI subtitles",
      "Cari videonu yenidən müəyyən et": "Re-detect the current video",
      "Geri": "Back",
      "Üst / aşağı sətir": "Top / bottom line",
      "Alt yazı seçimi": "Subtitle selection",
      "həcm bilinmir": "size unknown",
      "təxmini həcm": "approximate size",
      "Son san": "End sec",
      "bilinmir": "unknown",
      "Ümumi müddət": "Total duration",
      "Rəqəmsal dəqiqə/saniyə daxil edin": "Enter numeric minutes/seconds",
      "Fayl adı boşdur": "File name is empty",
      "Əvvəl oxudulanlar": "Previously viewed",
      "AI alt yazılar": "AI subtitles",
      "Sİ · ": "AI · ",
      "✂ Kəs — ": "✂ Cut — ",
      "💾 Fərqli Saxla — ": "💾 Save as — ",
      "Tərcümə et": "Translate",
      "Metriklər": "Metrics",
      "Göstərici": "Indicator",
      "YouTube-un öz fəsil markerləri": "YouTube's own chapter markers",
      "Mövzular üzrə bölgü (YouTube Native kimi)": "Topic breakdown (like YouTube chapters)",
      "Açar sözün keçdiyi yerlər (geniş pəncərə)": "Keyword occurrences (wide window)",
      "Bütün sözlər — yazıldığı kimi, hərfi tərcümə ilə": "All words — as written, with literal translation",
      "Ən zəruri kartlar": "Most essential cards",
      "İnteraktiv test": "Interactive quiz",
      "Qısa qeydlər": "Short notes",
      "Unikal söz sayı, leksik sıxlıq və s.": "Unique words, lexical density, etc.",
      "Sitatlar və analitik tezislər": "Quotes and analytical theses",
      "Daha incə emosional xəritə": "Finer emotional map",
      "Kitab/məqalə/sayt/alət siyahısı": "Books/articles/sites/tools list",
      "İddiaların yoxlanması": "Claim checking",
      "Hər dəqiqə/seqment üçün risk faizi": "Risk percentage per minute/segment",
      "Yalnız göstərilən parametrlər": "Only the specified parameters",
      "Danışanların yanaşması və qarşılıqlı münasibətləri": "Speakers' stances and relationships",
      "Fallasiya və manipulyasiya (2 cümlə)": "Fallacies and manipulation (2 sentences)",
      "Şəxslər, dövlətlər, təşkilatlar": "People, states, organizations",
      "Addım-addım resept": "Step-by-step recipe",
      "Ziddiyyətlər (2 cümləlik izah)": "Contradictions (2-sentence explanation)",
      "Uzun siyahı, 2 cümləlik izah": "Long list, 2-sentence explanation",
      "✓ Kopyalandı":"✓ Copied",
      "✗ Kopyalama alınmadı":"✗ Copy failed",
      "ixrac alınmadı":"export failed",
      "Sİ — AI xüsusiyyətləri":"AI — AI features",
      "Tab tapılmadı":"Tab not found",
      "Alt yazı mənbələri yoxlanılır…":"Checking subtitle sources…",
      "Alt yazı mənbəyi:":"Subtitle source:",
      "Sİ tərəfindən hazırlanmış":"AI generated",
      "Axtarış metodu":"Search method",
      "Hərfi axtarış":"Literal search",
      "Məna axtarışı":"Semantic search",
      "⟳ Alt yazını yenilə":"⟳ Refresh subtitles",
      "Alt yazının mövcudluğunu yenidən yoxla":"Recheck subtitle availability",
      "İşlənir…":"Processing…",
      "Yenidən cəhd et":"Retry",
      "Yenidən":"Again",
      "Xüsusiyyət seçilməyib — siyahıdan birini seçin.":"No feature selected — choose one from the list.",
      "Bu videoda alt yazı tapılmadı. Alt yazı olduğundan əmin olun və «⟳ Alt yazını yenilə» basın.":"No subtitles found in this video. Make sure they exist and press «⟳ Refresh subtitles».",
      "AI işləmədi":"AI failed",
      "Altyazıda görünmə sırası":"Subtitle appearance order",
      "Əlifba A→Z":"Alphabetical A→Z",
      "Əlifba Z→A":"Alphabetical Z→A",
      "Tezliyə görə (çoxdan aza)":"By frequency (high to low)",
      "Tezliyə görə (azdan çoxa)":"By frequency (low to high)",
      "İlk görünmə vaxtına görə":"By first appearance time",
      "Genişləndirilir…":"Expanding…",
      "Daha çox kart hazırlanır…":"Preparing more cards…",
      "Daha çox":"More",
      "Hazırlanır…":"Preparing…",
      "Başladılır…":"Starting…",
      "klip yaradılmadı":"clip not created",
      "Avropa dil səviyyəsi":"European language level",
      "Dil səviyyəsi":"Language level",
      "Nitq sürəti (söz/dəqiqə)":"Speech rate (words/min)",
      "Məlumat sıxlığı":"Information density",
      "Çətinlik indeksi":"Difficulty index",
      "Orta cümlə uzunluğu":"Average sentence length",
      "Cümlə sayı":"Sentence count",
      "Ümumi cümlə sayı":"Total sentences",
      "Söz sayı":"Word count",
      "Qabaqcıl sözlər":"Advanced words",
      "Əsas sözlər":"Key words",
      "Lüğət zənginliyi":"Vocabulary richness",
      "Tip-token nisbəti":"Type-token ratio",
      "Köməkçi söz nisbəti":"Function-word ratio",
      "Orta söz uzunluğu":"Average word length",
      "Uzun söz nisbəti":"Long-word ratio",
      "Oxuma vaxtı":"Reading time",
      "Nitq sürəti":"Speech rate",
      "Mürəkkəblik":"Complexity",
      "Ümumi qiymət":"Overall score",
      "Müddət (dəqiqə)":"Duration (min)",
      "Söz/dəqiqə":"Words/min",
      "Ümumi":"Total",
      "söz sayı":"word count",
      "sıxlıq":"density",
      "Qabaqcıl":"Advanced",
      "nisbət":"ratio",
      "cümlə":"sentence",
      "söz":"word",
      "sürət":"speed",
      "mürəkkəblik":"complexity",
      "ümumi qiymət":"overall score",
      "əsas":"key",
      "lüğət":"vocabulary",
      "zənginlik":"richness",
      "köməkçi söz":"function word",
      "✗ Kəsmə işi tapılmadı (helper yenidən başladı?) — yenidən cəhd edin":"✗ Cut job not found (helper restarted?) — retry",
      "✓ Hazırdır:":"✓ Ready:",
      "Sİ alt yazı":"AI subtitles",
      "AI subtitr yaradılmadı":"AI subtitles were not created",
      "Tərcümə et":"Translate",
      "Mənbə alt yazı":"Source subtitles",
      "Tərcümə üçün mənbə seç":"Choose a source to translate",
      "Avtomatik tərcümə":"Auto-translate",
      "Sİ · Hazır":"AI · Ready",
      "Bütün rənglər":"All colors",
      "Qradientlər":"Gradients",
      "Üst sətir":"Top line",
      "Aşağı sətir":"Bottom line",
      "Alt yazı yoxdur":"No subtitles",
      "İkili alt yazı modulu mövcud deyil":"Dual subtitle module is unavailable",
      "İkili alt yazı hazırlanır…":"Preparing dual subtitles…",
      "Mənbə alt yazılar oxunur…":"Reading source subtitles…",
      "İkili alt yazı yaradılmadı":"Dual subtitles were not created",
      "Vaxtlar uyğunlaşdırılır…":"Aligning timings…",
      "✓ İkili alt yazı hazır":"✓ Dual subtitles ready",
      "YouTube seçimi":"YouTube selection",
      "Hə":"Yes",
      "Sİ dilləri":"AI languages",
      "Sİ hazır":"AI ready",
      "İkili":"Dual",
      "Hazır":"Ready",
      "YouTube seçimi ✕":"YouTube selection ✕",
      "AI modulu mövcud deyil":"AI module is unavailable",
      "Səs:":"Audio:",
      "Seçilməyib":"Not selected",
      "Səsi seç — seçim sırası ilə inteqrasiya olunur":"Choose audio — integrated in selection order",
      "Keyfiyyət:":"Quality:",
      "⚠ Bu mənbədə ayrıca səs axını yoxdur: səs videonun içindədir. Ən kiçik keyfiyyətli video yüklənib ondan səs çıxarılacaq":"⚠ This source has no separate audio stream: audio is inside the video. The lowest-quality video will be downloaded and audio extracted from it",
      "san əvvəl":"sec ago",
      "dəq əvvəl":"min ago",
      "saat əvvəl":"h ago",
      "hamısı":"all",
      "sətir":"line",
      "Akronimlər və qısaltmalar lüğəti": "Acronyms and abbreviations",
      "YouTube Native": "YouTube chapters",
      "Danışan": "Speaker",
      "Ton": "Tone",
      "Açılışı": "Expansion",
      "Kontekst": "Context",
      "Nümunə": "Example",
      "Xüsusiyyətlər": "Features",
      "Alt yazı mənbələri": "Subtitle sources",
      "Kopyala": "Copy",
    }
  };
  // Dinamik mətnlərin əvvəlini tərcümə edir (məs. "Tərcümə et (2)", "Əvvəl oxudulanlar (5)").
  const PREFIX = [
    ["Əvvəl oxudulanlar", "Ранее просмотренные", "Previously viewed"],
    ["İkili dil", "Двойной язык", "Dual language"],
    ["Tərcümə et", "Перевести", "Translate"],
    ["✂ Kəs — ", "✂ Обрезать — ", "✂ Cut — "],
    ["💾 Fərqli Saxla — ", "💾 Сохранить как — ", "💾 Save as — "],
    ["Sİ · ", "ИИ · ", "AI · "],
    ["YouTube seçimi", "Выбор YouTube", "YouTube selection"],
  ];
  let lang = "az", theme = "dark";
  const isExt = location.protocol === "chrome-extension:" || location.protocol === "moz-extension:";
  const UI_SEL = ".idm-row-menu, .idm-si-menu, .ai-sub-pop, .idm-tip";
  const STYLE_ID = "jdm-ui-light-style";
  const LIGHT_CSS = `
html.jdm-light body,body.theme-light{background:#f4f5f7!important;color:#1b1b1f!important}
body.theme-light header,body.theme-light #tabs,body.theme-light #settings,body.theme-light .set-head,body.theme-light .set-nav,body.theme-light .set-pane,body.theme-light #activeWrap,body.theme-light .set-body,body.theme-light #main,body.theme-light .pane{background:#f4f5f7!important;color:#1b1b1f!important;border-color:#d0d2d8!important}
body.theme-light #tabs .tab{background:#e9ebef!important;color:#555!important;border-color:#d0d2d8!important}
body.theme-light #tabs .tab.on{background:#2f6fed1f!important;color:#1f5fd0!important;border-color:#2f6fed66!important}
body.theme-light .row:hover,body.theme-light .drow:hover,body.theme-light .set-nav button:hover,body.theme-light .gear:hover{background:#e5e8ee!important;color:#111!important}
body.theme-light .set-nav button{color:#444!important}
body.theme-light .set-nav button.on{background:#2f6fed!important;color:#fff!important}
body.theme-light .fld>label,body.theme-light .chk,body.theme-light .set-pane h3,body.theme-light .set-pane h4,body.theme-light .hint2,body.theme-light .now,body.theme-light .meta,body.theme-light .minihead,body.theme-light .sub-lab span,body.theme-light .sub-plabel,body.theme-light .streams,body.theme-light .ai-foot{color:#5c6068!important}
body.theme-light .name,body.theme-light .pct,body.theme-light .set-pane,body.theme-light .set-head b,body.theme-light .sub-lab b,body.theme-light .sub-dd,body.theme-light .sub-menu button,body.theme-light .drow .name{color:#1b1b1f!important}
body.theme-light input,body.theme-light select,body.theme-light .ib,body.theme-light .sub-dd,body.theme-light .sub-tg,body.theme-light .row2 input,body.theme-light #model,body.theme-light #uiLang,body.theme-light #uiTheme,body.theme-light .streams input{background:#fff!important;color:#1b1b1f!important;border-color:#c9ccd4!important}
body.theme-light .minihead button{background:#fff!important;color:#555!important;border-color:#c9ccd4!important}
body.theme-light .gear{color:#555!important}
body.theme-light .now b{color:#1f5fd0!important}
body.theme-light .doc{color:#40444c!important}
body.theme-light .doc h4{color:#1f5fd0!important}
body.theme-light .doc b{color:#16181d!important}
body.theme-light .doc code{background:#eef1f6!important;border-color:#d0d2d8!important;color:#1f5fd0!important}
body.theme-light .acthead{color:#1f5fd0!important}
body.theme-light .drow{border-color:#e3e6ec!important}
body.theme-light .si-feat:hover{border-color:#2f6fed!important;background:#eef4ff!important}
body.theme-light .si-item:hover{border-color:#b9c9e6!important}
body.theme-light .sub-card{background:#fff!important;border-color:#d0d2d8!important}
body.theme-light .sub-row{border-color:#e3e6ec!important}
body.theme-light .sub-preview{background:linear-gradient(135deg,#f7f8fa,#e9ecf2)!important;color:#1b1b1f!important;text-shadow:0 1px 2px #fff!important}
body.theme-light .sub-menu{background:#fff!important;border-color:#c9ccd4!important}
body.theme-light .sub-menu button:hover{background:#eef1f6!important}
body.theme-light .sub-tg.on,body.theme-light .tab.on,body.theme-light #tabs .tab.on{background:#2f6fed!important;border-color:#2f6fed!important;color:#fff!important}
body.theme-light .sub-menu button.on{background:#2f6fed26!important;color:#1f5fd0!important}
body.theme-light .sub-note{background:#fff8e1!important;color:#7a5b00!important;border-color:#eadfbd!important}
body.theme-light .bar{background:#d9dce3!important}
body.theme-light .bar i{background:#1f9d55!important}
body.theme-light .bar.paused i{background:#c9a227!important}
body.theme-light .bar.error i{background:#c0392b!important}
body.theme-light .tag{background:#1f9d55!important;color:#fff!important}
body.theme-light .stico.ok{color:#1a8f4c!important}
body.theme-light .stico.err{color:#c0392b!important}
body.theme-light .drow .st.ok{background:#1f9d5533!important;color:#1a8f4c!important;border-color:#1f9d5566!important}
body.theme-light .drow .st.err{background:#c0392b22!important;color:#c0392b!important;border-color:#c0392b66!important}
body.theme-light .ai-pct{color:#1f5fd0!important}
body.theme-light .ai-eta{color:#8a5c00!important}
body.theme-light .ai-bar{background:#d9dce3!important}
body.theme-light .si-root{background:#f4f5f7!important;color:#1b1b1f!important}
body.theme-light .si-head,body.theme-light .si-foot{border-color:#d0d2d8!important;background:#f4f5f7!important;color:#1b1b1f!important}
body.theme-light .si-head b{color:#1b1b1f!important}
body.theme-light .si-feat,body.theme-light .si-item,body.theme-light .si-b,body.theme-light .si-src,body.theme-light .si-src-menu,body.theme-light .si-menu,body.theme-light .si-diag,body.theme-light .si-segtext,body.theme-light .si-src-item{background:#fff!important;color:#1b1b1f!important;border-color:#d0d2d8!important}
body.theme-light .si-title,body.theme-light .si-quote,body.theme-light .si-toolbar,body.theme-light .si-src-item,body.theme-light .si-kv .v,body.theme-light .si-menu button{color:#1b1b1f!important}
body.theme-light .si-text,body.theme-light .si-note,body.theme-light .si-time,body.theme-light .si-jobbar .ph,body.theme-light .si-jobbar .r1 .m,body.theme-light .si-src-group,body.theme-light .si-src-l{color:#5c6068!important}
body.theme-light .si-btn.ghost,body.theme-light .si-mini,body.theme-light .si-ic{background:#e9ebef!important;color:#222!important;border-color:#c9ccd4!important}
body.theme-light .si-toolbar select,body.theme-light .si-toolbar input[type=text],body.theme-light .si-src-btn{background:#fff!important;color:#1b1b1f!important;border-color:#c9ccd4!important}
body.theme-light .si-src-item:hover{background:#eef1f6!important;border-color:#d0d2d8!important}
body.theme-light .si-src-item.on{background:#e3edff!important;border-color:#2f6fed!important;color:#1f5fd0!important}
body.theme-light .si-opt{border-color:#d0d2d8!important}
body.theme-light .si-opt.sel{border-color:#2f6fed!important;background:#e3edff!important;color:#1b1b1f!important}
body.theme-light .si-menu button:hover{background:#e5e8ee!important}
body.theme-light .si-menu button.on{background:#2f6fed!important;color:#fff!important}
body.theme-light .si-info{background:#eef4ff!important;color:#1b1b1f!important;border-left-color:#2f6fed!important}
body.theme-light .si-exp{color:#3d4652!important;border-top-color:#d0d2d8!important}
body.theme-light .si-kv .k{color:#1f5fd0!important}
body.theme-light .si-fields{border-top-color:#d0d2d8!important}
body.theme-light .si-diag{background:#fff!important;color:#5c6068!important;border-color:#d0d2d8!important}
body.theme-light .si-jobbar{background:#e9ebef!important;border-color:#d0d2d8!important}
body.theme-light .si-jobbar .r1{color:#1f5fd0!important}
body.theme-light .si-jobbar .bar{background:#d9dce3!important}
body.theme-light .si-err{background:#ffecec!important;color:#b42318!important;border-color:#f1b5b5!important}
body.theme-light .si-prog{color:#1f5fd0!important}
.idm-light.idm-row-menu,.idm-light.idm-si-menu,.idm-light.ai-sub-pop,.idm-light.idm-tip{background:#f7f8fa!important;color:#1b1b1f!important;border-color:#c9ccd4!important}
.idm-light .row-menu-item,.idm-light .si-menu-item,.idm-light .ai-sub-pop button{color:#1b1b1f!important}
.idm-light .row-menu-item:hover,.idm-light .si-menu-item:hover{background:#e5e8ee!important}
.idm-light.idm-tip *,.idm-light .ai-sub-pop *{color:#1b1b1f!important}
.idm-light.idm-si-menu>div:first-child{color:#1b1b1f!important}
.idm-light.ai-sub-pop>div:first-child{background:#f7f8fa!important;border-color:#d0d2d8!important;box-shadow:none!important}
.idm-light .ai-sub-pop [style*="background:#242426"],.idm-light .ai-sub-pop [style*="background:#1b1b1e"],.idm-light .ai-sub-pop [style*="background:#202024"],.idm-light .ai-sub-pop [style*="background:#2b2b2f"],.idm-light .ai-sub-pop [style*="background:#2c2c2e"]{background:#fff!important;border-color:#c9ccd4!important}
.idm-light .ai-sub-pop [style*="background:#2c3e55"]{background:#e3edff!important;border-color:#2f6fed!important;color:#1f5fd0!important}
.idm-light .row-menu-item[data-act="cut"]{color:#c0392b!important}
`;
  const injectCss = () => {
    try {
      let s = document.getElementById(STYLE_ID);
      if (!s) { s = document.createElement("style"); s.id = STYLE_ID; (document.head || document.documentElement).append(s); }
      s.textContent = LIGHT_CSS;
    } catch {}
  };
  const isSkipped = el => {
    if (!el || !el.closest) return false;
    return !!el.closest(".name, .si-title, .si-text, .si-quote, .si-segtext");
  };
  // Dəqiq uyğunluqdan əlavə ":" və "✓" kimi sonluqları olan mətnləri də tapır
  // (məs. "Tərcümə:" / "Əlifba A→Z ✓").
  const lookup = key => {
    const d = D[lang] || {};
    if (d[key] != null) return { v: d[key], suf: "" };
    let m = key.match(/^(.*?)(\s*:\s*)$/);
    if (m && d[m[1].trim()] != null) return { v: d[m[1].trim()], suf: m[2] };
    m = key.match(/^(.*?)(\s*✓\s*)$/);
    if (m && d[m[1].trim()] != null) return { v: d[m[1].trim()], suf: m[2] };
    m = key.match(/^(\s*✓\s*)(.*)$/);
    if (m && d[m[2].trim()] != null) return { v: m[1], suf: d[m[2].trim()] };
    for (const [az, ru, en] of PREFIX) {
      if (key.startsWith(az)) {
        const tr = lang === "ru" ? ru : lang === "en" ? en : az;
        return { v: tr + key.slice(az.length), suf: "" };
      }
    }
    return null;
  };
  const translateNode = node => {
    if (!node || node.nodeType !== 3) return;
    const parent = node.parentElement;
    if (isSkipped(parent)) return;
    const orig = node.__jdmOrig != null ? node.__jdmOrig : node.nodeValue;
    node.__jdmOrig = orig;
    if (lang === "az") { if (node.nodeValue !== orig) node.nodeValue = orig; return; }
    const key = String(orig || "").trim();
    if (!key) return;
    const hit = lookup(key);
    if (!hit) return;
    const lead = String(orig).match(/^\s*/)[0], trail = String(orig).match(/\s*$/)[0];
    node.nodeValue = lead + hit.v + hit.suf + trail;
  };
  const translateAttrs = el => {
    if (!el || el.nodeType !== 1) return;
    for (const a of ["placeholder", "title", "aria-label"]) {
      if (!el.hasAttribute(a)) continue;
      const cur = el.getAttribute(a);
      if (cur == null) continue;
      if (!el.__jdmAttr) el.__jdmAttr = {};
      if (el.__jdmAttr[a] == null) el.__jdmAttr[a] = cur;
      const orig = el.__jdmAttr[a];
      if (lang === "az") { if (cur !== orig) el.setAttribute(a, orig); continue; }
      const hit = lookup(orig.trim());
      if (hit) el.setAttribute(a, hit.v + hit.suf);
    }
  };
  const apply = root => {
    if (!root || lang === "az") {
      if (root && lang === "az") {
        const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        let n; while ((n = w.nextNode())) translateNode(n);
        if (root.querySelectorAll) for (const e of root.querySelectorAll("*")) translateAttrs(e);
      }
      return;
    }
    if (root.nodeType === 3) { translateNode(root); return; }
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let n; while ((n = w.nextNode())) translateNode(n);
    if (root.nodeType === 1) translateAttrs(root);
    if (root.querySelectorAll) for (const e of root.querySelectorAll("*")) translateAttrs(e);
  };
  const markMenus = root => {
    if (!root) return;
    const sel = ".idm-row-menu, .idm-si-menu, .ai-sub-pop, .idm-tip";
    const on = theme === "light";
    if (root.querySelectorAll) for (const e of root.querySelectorAll(sel)) e.classList.toggle("idm-light", on);
    if (root.nodeType === 1 && root.matches && root.matches(sel)) root.classList.toggle("idm-light", on);
  };
  const setLang = v => {
    lang = ["az", "ru", "en"].includes(String(v)) ? String(v) : "az";
    try { chrome.storage.local.set({ uiLang: lang }); } catch {}
    if (isExt) { try { apply(document.body); } catch {} }
    else { try { for (const e of document.querySelectorAll(UI_SEL)) apply(e); } catch {} }
    try { document.documentElement.lang = lang; } catch {}
  };
  const setTheme = v => {
    theme = String(v) === "light" ? "light" : "dark";
    try { chrome.storage.local.set({ uiTheme: theme }); } catch {}
    try { injectCss(); } catch {}
    if (isExt) {
      try { document.body.classList.toggle("theme-light", theme === "light"); } catch {}
      try { document.documentElement.classList.toggle("jdm-light", theme === "light"); } catch {}
    } else {
      try { markMenus(document.body); } catch {}
    }
  };
  const start = () => {
    injectCss();
    try {
      chrome.storage.local.get(["uiLang", "uiTheme"]).then(v => {
        lang = ["az", "ru", "en"].includes(v && v.uiLang) ? v.uiLang : "az";
        theme = v && v.uiTheme === "light" ? "light" : "dark";
        try { document.documentElement.lang = lang; } catch {}
        setTheme(theme);
        if (isExt) apply(document.body);
        else { try { for (const e of document.querySelectorAll(UI_SEL)) apply(e); } catch {} }
      }).catch(() => {});
      chrome.storage.onChanged.addListener((ch, area) => {
        if (area !== "local") return;
        if (ch.uiLang) {
          lang = ch.uiLang.newValue === "ru" || ch.uiLang.newValue === "en" ? ch.uiLang.newValue : "az";
          if (isExt) apply(document.body);
          else { try { for (const e of document.querySelectorAll(UI_SEL)) apply(e); } catch {} }
        }
        if (ch.uiTheme) setTheme(ch.uiTheme.newValue);
      });
    } catch {}
    try {
      const obs = new MutationObserver(muts => {
        for (const m of muts) {
          for (const n of m.addedNodes || []) {
            if (n.nodeType === 1) {
              markMenus(n);
              const insideUi = isExt || (n.matches && n.matches(UI_SEL)) || (n.closest && n.closest(UI_SEL));
              if (insideUi) apply(n);
            } else if (n.nodeType === 3) {
              const p = n.parentElement;
              if (isExt || (p && p.closest && p.closest(UI_SEL))) apply(n);
            }
          }
        }
      });
      obs.observe(document.body || document.documentElement, { childList: true, subtree: true });
    } catch {}
  };
  window.IDM_I18N = { setLang, setTheme, apply, start, get lang() { return lang; }, get theme() { return theme; }, DICT: D };
  start();
})();
