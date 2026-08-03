# Tines Romantasy Database – Håndbog

Version: 0.2 (synkroniseret fra Guide til romantasy database.docx)

Formål: Konsistent, verificerbar scoring efter Tines romantasy-præferencer. Subjektive felter følger denne håndbog — ikke objektiv "bogkvalitet".

## 1. Grundprincipper

- Ingen gæt på **fakta**. Objektive oplysninger kun når verificeret; ellers "Ikke verificeret".
- Subjektive vurderinger = match til Tines læsepræferencer (efter denne håndbog).
- Ingen halve rækker: udfyld relevante felter når serien er identificeret.
- **Tines score** og **Tines egen vurdering** udfyldes kun af Tine.
- **Tine-score** (0–100) er AI/håndbog-vurdering — en helhed, ikke et gennemsnit.
- Når Tine eller Excel-referencen har sat scores, bruges de til at kalibrere nye forslag.

## 2. Fælles 0–5 skala

| Score | Definition |
|------:|------------|
| 0 | Fraværende / spiller ingen reel rolle |
| 1 | Sporadisk, meget lille betydning |
| 2 | Tydeligt til stede, men begrænset |
| 3 | En vigtig del af historien |
| 4 | Meget fremtrædende og konsekvent stærkt |
| 5 | Et af seriens absolut stærkeste kendetegn |

0 betyder **fraværende**, ikke "ved ikke".

## 3. Tine-score (0–100)

Samlet sandsynlighed for at Tine vil elske serien. **Ikke** objektiv kvalitet, popularitet eller Goodreads.

**Høj vægt:** Episk plot · Romance (sommerfugle) · Kvindelig udvikling · Karakterudvikling · Beskyttende helt(e) · Bodyguard-vibe · Touch her and die-vibe · Rhysand-faktoren · Worldbuilding

**Mellem vægt:** Book hangover · Romance i fokus · Politiske intriger · Krig/militær · Spice-kvalitet

**Lav vægt:** Spice-mængde · Goodreads · Tempo

| Interval | Betydning |
|----------|-----------|
| 95–100 | Potentiel ny favorit |
| 90–94 | Meget stærkt match |
| 85–89 | Godt match med enkelte mangler |
| 80–84 | Delvist match |
| Under 80 | Matcher kun få af Tines præferencer |

Eksempler på høj score (reference-smag): ACOTAR, Age of Andinna, Rise of the Iliri, Throne of Glass.

Episk plot/worldbuilding alene er **ikke** nok til høj Tine-score uden romantasy-match (beskyttende MMC, romance, THAD/Rhysand-profil).

## 4. Felt for felt

### Book hangover (0–5)
- **Vurderes:** Heltindens udviklingsrejse (fx almindelig pige → dronning/leder/general/gudinde).
- **Ikke:** Hvor stærk hun er fra starten.
- 5/5 = episk transformation af rolle og ansvar.
- Eksempel høj: ACOTAR.

### Tempo
- **Vurderes:** Fortællingens fremdrift.
- **Ikke:** Hvor hurtigt man bliver fanget.
- Værdier: `Langsom` / `Moderat` / `Hurtig`.

### Worldbuilding (0–5)
- **Vurderes:** Omfang og kvalitet af verdenen.
- **Ikke:** Plottet.
- 5 = en af seriens største styrker; detaljeret worldbuilding.
- Eksempel høj: Game of Thrones.

### Episk plot (0–5)
- **Vurderes:** Skalaen af hovedkonflikten.
- **Ikke:** Romancen.
- 5 = skæbneafgørende konflikt.

### Politiske intriger (0–5)
- **Vurderes:** Magtspil og diplomati.
- **Ikke:** Små konflikter.
- 5 = driver plottet.

### Krig/militær (0–5)
- **Vurderes:** Militære konflikters betydning.
- **Ikke:** Enkeltstående kampe.
- 5 = gennemgående.

### Chosen one eller vokser naturligt ind i rollen?
- Værdier: `Chosen one` / `Vokser naturligt` / `Blandet`.

### Kvindelig udvikling (0–5)
- **Vurderes:** Heltindens udviklingsrejse.
- **Ikke:** Startstyrke.
- 5 = episk transformation.

### Karakterudvikling (0–5)
- **Vurderes:** Følelsesmæssig/psykologisk udvikling (modenhed, relationer, værdier, traumer, vækst).
- **Ikke:** Magtniveau, titel eller rang.
- En serie kan have 5 i kvindelig udvikling og 2 i karakterudvikling — eller omvendt.

### Beskyttende helt(e) (0–5)
- **Vurderes:** Heltens naturlige ønske om at beskytte hende (fysisk, følelsesmæssigt, politisk, socialt).
- **Ikke:** Hvor stærk/magtfuld han er.
- Høj score kræver omsorg og respekt — **ikke** kontrol.

### Bodyguard-vibe (0–5)
- **Vurderes:** Relationens "jeg passer på dig"-dynamik.
- **Ikke:** Hvor romantisk eller spicefyldt forholdet er.
- Forskellig fra Beskyttende: bodyguard = **relationens dynamik**; beskyttende = **heltens personlighed/instinkt**.

### Touch her and die-vibe (0–5)
- **Vurderes:** Intensiteten af hans beskyttelsesreaktion når hun trues/såres — ikke volden i sig selv.
- **Ikke:** Almindelig jalousi · at han kan slås · enkeltstående heroik.
- 0 = ingen særlig reaktion · 1 = lejlighedsvis · 2 = tydeligt i vigtige situationer · 3 = tilbagevendende stærke reaktioner · 4 = markant kendetegn · 5 = ikonisk; "rør hende ikke" gennemsyrer relationen.
- Ved 5: villig til at gå meget langt; andre forstår faren ved at true hende; drevet af loyalitet/beskyttelse (ikke kontrol/jalousi).
- Belønner **ikke** unødvendig vold.

### Bully-risiko
- **Vurderes:** Risiko for nedladende/ydmygende/manipulerende adfærd — især tidligt.
- **Ikke:** Sund konflikt · ligeværdigt drilleri · kort misforståelse.
- `Lav` = respektfuld · `Mellem` = perioder med hård adfærd uden at dominere · `Høj` = bully er væsentlig del af romantikken.

### Spice/erotik (0–5)
- **Vurderes:** Mængden af spice.
- **Ikke:** Kvaliteten.

### Spice/erotik kvalitet (0–5)
- **Vurderes:** Kvalitet — meningsfuldt vs. ligegyldigt fyld.
- **Ikke:** Mængden.

### Hvor hurtigt griber den? (0–100%)
- **Vurderes:** Hvornår serien fanger (ca. hvor langt inde i første bog).
- **Ikke:** Tempo.

### Falder kvaliteten?
- `Nej` / `Let` / `Ja` / `Varierer`.

### Tilfredsstillende slutning?
- Om slutningen føles tilfredsstillende (ikke det samme som Happy ending).
- `Ja` / `Nej` (eller Ikke verificeret).

### Romance i fokus (0–100%)
- **Vurderes:** Hvor meget romantikken fylder.
- **Ikke:** Kvaliteten.

### Minder mest om / Hvis du savner…
- Korte tekstværdier (sammenlignelige serier / favorit-vibes).

### Rhysand-faktoren (0–5)
Matcher Tines helteprofil:
- Respekt for heltinden
- Støtter hendes udvikling
- Kompetent/magtfuld
- Beskytter uden at kontrollere
- Emotionelt loyal
- Intelligent/strategisk
- Ikke bully

**Ikke:** Kun attraktiv, populær eller stærk.
- 0 ≈ ingen match · 3 = godt match · 5 ≈ ideel helt for Tine.

## 5. Tekstfelter (faste værdier)

- **Tempo:** Langsom / Moderat / Hurtig
- **Bully-risiko:** Lav / Mellem / Høj
- **Falder kvaliteten?:** Nej / Let / Ja / Varierer
- **Chosen one…:** Chosen one / Vokser naturligt / Blandet
- **Relation:** typisk MF, RH, MM, FF, Menage o.l. — udfyld når serien er kendt

## 6. Kalibrering

- Har Tine sat **Tines score**, vejer den tungest.
- Ellers bruges Excel-/database-**Tine-score** + udfyldte 0–5-felter som reference-ankre (høje vs. lave for kontrast).
- Nye scores skal være konsistente med ankrene og denne håndbog.

## 7. Tines eksplicitte bogprofil (taste-v1)

Kilde: Tines egen prioriterede smagsliste. Bruges ved scoring, discovery og teasers.

### Prioritet 1 (skal næsten altid rammes til høj score)
- Hovedserien **færdigskrevet** (standalones OK)
- Fantasy — gerne **high fantasy**
- **Episk plot**
- **Stærk romance** (MF eller meget gerne reverse harem)
- **Happy ending**
- **Heltindens udvikling** (personlig + fra ingenting til magt: dronning/gudinde/leder)
- **God worldbuilding**
- Romance med **sommerfugle / stærk kemi**
- Helteprofil: magtfuld uden at dominere · kompetent/intelligent · beskytterinstinkt · bodyguard-vibe · respekt · loyal · maskulin · lader hende vokse · **touch her and die** · **ingen bully**

### Prioritet 2 (plus)
- Lange bøger (gerne 300+ sider) · found family · politiske intriger · spice · velskrevet/gennemtænkt plot · FemDom (nice-to-have)

### Trækker ned
- Hjerteknuser · romcom · bully · spice > plot · fade to black · teenage hovedpersoner · kvalitetsfald senere · misforståelser som eneste konflikt · **urban fantasy**

### No go (lav Tine-score / fraråd)
- Ingen romance · ufærdige serier · ingen fantasy-elementer · permanente dødsfald blandt hovedpersonerne

### Favorit-ankre (kalibrering)
- FMC: Aelin (ToG), Feyre (ACOTAR), Sal (Iliri), Mave (Andinna), Shea (Broken Lands), Shara (Vampire Queen), Scarlet (Lady of Darkness), Aria (Nine Realms)
- MMC: Rhysand, Casteel, Rain (Tairen Soul), Rowan, Rik, Edward/Twilight (beskytter/bodyguard/dyb forelskelse)
- Serier: Age of the Andinna, ToG, Rise of the Iliri, Tairen Soul, WITSEC, Blood and Ash, ACOTAR, Twilight, Their Vampire Queen, Legacy of the Nine Realms (MMC dog lidt bully), Black Dagger Brotherhood, Red Queen, Rhapsodic, The Broken Lands, Plated Prisoner, Shadow Beast Shifters, War of Lost Hearts
