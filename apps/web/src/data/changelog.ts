export interface ChangelogEntry {
  date: string;
  /** Display title shown in the modal header row */
  title: string;
  items: string[];
}

/**
 * Changelog of deployed changes.
 * Update this file whenever a new set of changes is deployed to production.
 * Most recent entry first.
 */
export const CHANGELOG: ChangelogEntry[] = [
  {
    date: '2026-02-23',
    title: '23. února 2026',
    items: [
      'Magnetické přichycení sliderů efektů na výchozí hodnotu (dvojklik pro reset)',
      'Kontextové menu pro rozdělení klipu (pravé tlačítko myši na klipu → Rozdělit)',
    ],
  },
  {
    date: '2026-02-22',
    title: '22. února 2026',
    items: [
      'Color Grade efekt s živým náhledem v canvasu',
      'Automatická detekce textu písně přes Whisper',
      'Výřez pozadí (cutout) – průběh zpracování zobrazen přímo na klipu',
      'Přesun tlačítka Přidat efekt z časové osy do panelu Nástroje',
      'Omezení přesunu klipů na stejný typ stopy + vkládání mezi řádky',
      'Skrytí audio sekce pro textové klipy, inline editace textu v náhledu',
      'Inline editace názvu projektu v horním panelu',
      'Přetahování klipů mezi stopami časové osy',
      'Vizuální kurzor rotace při tažení rotační úchytky',
      'Obousměrné scrollování na časové ose touchpadem',
    ],
  },
];
