import type { DayKey, WorkingHours } from './types';

export type AssistantService = { name: string; duration: string; price: string };

const DAY_ORDER: DayKey[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const DAY_NAMES_RO: Record<DayKey, string> = {
  mon: 'luni',
  tue: 'marți',
  wed: 'miercuri',
  thu: 'joi',
  fri: 'vineri',
  sat: 'sâmbătă',
  sun: 'duminică',
};
const DAY_NAMES_EN: Record<DayKey, string> = {
  mon: 'Mon',
  tue: 'Tue',
  wed: 'Wed',
  thu: 'Thu',
  fri: 'Fri',
  sat: 'Sat',
  sun: 'Sun',
};

function runDaily(part: string): boolean {
  // O singură grupare care acoperă toată săptămâna începe cu prima zi și conține „–” în eticheta de zile.
  return part.includes('–') && (part.startsWith('luni–') || part.startsWith('Mon–'));
}

/**
 * Programul săptămânal ca text scurt pentru asistent: zilele consecutive cu același
 * interval se grupează („luni–vineri 08:00–20:00”), zilele închise se numesc o singură dată.
 */
export function formatWorkingHoursText(
  hours: WorkingHours | null | undefined,
  lang: 'ro' | 'en'
): string {
  if (!hours || typeof hours !== 'object') return '';
  const names = lang === 'en' ? DAY_NAMES_EN : DAY_NAMES_RO;
  const closedLabel = lang === 'en' ? 'closed' : 'închis';
  const parts: string[] = [];
  const closed: string[] = [];
  let runStart: DayKey | null = null;
  let runEnd: DayKey | null = null;
  let runRange = '';
  const flush = () => {
    if (!runStart || !runEnd) return;
    parts.push(
      runStart === runEnd
        ? `${names[runStart]} ${runRange}`
        : `${names[runStart]}–${names[runEnd]} ${runRange}`
    );
    runStart = null;
    runEnd = null;
    runRange = '';
  };
  for (const key of DAY_ORDER) {
    const d = hours[key];
    if (!d || d.closed) {
      flush();
      closed.push(names[key]);
      continue;
    }
    const range = `${d.start}–${d.end}`;
    if (range === runRange && runEnd) {
      runEnd = key;
    } else {
      flush();
      runStart = key;
      runEnd = key;
      runRange = range;
    }
  }
  flush();
  // Toată săptămâna cu același interval: „zilnic 08:00–20:00”, mai natural decât „luni–duminică …”.
  if (parts.length === 1 && closed.length === 0 && runDaily(parts[0])) {
    const daily = lang === 'en' ? 'daily' : 'zilnic';
    return `${daily} ${parts[0].split(' ').slice(1).join(' ')}`;
  }
  if (closed.length > 0 && parts.length > 0) {
    parts.push(`${closed.join(', ')} ${closedLabel}`);
  }
  if (parts.length === 0 && closed.length === 7) {
    return closedLabel;
  }
  return parts.join('; ');
}

export type AssistantKnowledge = {
  businessName: string;
  address: string;
  phone: string;
  cancelNoticeText: string;
  depositText: string;
  /** Programul pe zile, deja formatat (ex. „luni–vineri 09:00–18:00; sâmbătă închis”). Gol = necunoscut. */
  hoursText: string;
  services: AssistantService[];
  staffNames: string[];
};

export type AssistantIntent =
  | 'greeting'
  | 'service_price'
  | 'services_list'
  | 'hours'
  | 'location'
  | 'staff'
  | 'book'
  | 'cancel_policy'
  | 'deposit'
  | 'human'
  | 'fallback';

export type AssistantAction = { type: 'book' } | { type: 'chat' } | { type: 'services' };

export type AssistantAnswer = {
  intent: AssistantIntent;
  /** 1 = regulă sigură, 0.6 = potrivire parțială, 0 = predare la om. */
  confidence: number;
  params: Record<string, string>;
  actions: AssistantAction[];
};

const DIACRITICS: Record<string, string> = {
  ă: 'a',
  â: 'a',
  î: 'i',
  ș: 's',
  ş: 's',
  ț: 't',
  ţ: 't',
};

function normalize(text: string): string {
  return (text ?? '')
    .toLowerCase()
    .split('')
    .map((c) => DIACRITICS[c] ?? c)
    .join('');
}

function includesAny(text: string, words: readonly string[]): boolean {
  return words.some((w) => text.includes(w));
}

export function buildAssistantKnowledge(input: {
  businessName: string;
  address: string;
  phone: string;
  cancelNoticeText: string;
  depositText: string;
  hoursText?: string;
  services: AssistantService[];
  staffNames: string[];
}): AssistantKnowledge {
  return {
    businessName: input.businessName.trim(),
    address: input.address.trim(),
    phone: input.phone.trim(),
    cancelNoticeText: input.cancelNoticeText.trim(),
    depositText: input.depositText.trim(),
    hoursText: (input.hoursText ?? '').trim(),
    services: input.services
      .map((s) => ({ name: s.name.trim(), duration: s.duration.trim(), price: s.price.trim() }))
      .filter((s) => s.name.length > 0),
    staffNames: input.staffNames.map((n) => n.trim()).filter((n) => n.length > 0),
  };
}

/** Răspuns determinist, doar din datele firmei; necunoscutul ajunge la om. */
export function answerAssistantMessage(
  knowledge: AssistantKnowledge,
  message: string
): AssistantAnswer {
  const text = normalize(message);

  if (/(^|\W)(buna|salut|hei|hello|hi|ziua buna|seara buna)(\W|$)/.test(text)) {
    return {
      intent: 'greeting',
      confidence: 1,
      params: { business: knowledge.businessName },
      actions: [{ type: 'book' }],
    };
  }

  if (
    includesAny(text, [
      'vorbesc cu cineva',
      'vorbesc cu un om',
      'operator',
      'persoana',
      'cineva de la salon',
      'suna',
      'sunati',
      'ma sun',
      'telefon',
      'apel',
      'contact',
    ])
  ) {
    return {
      intent: 'human',
      confidence: 1,
      params: { business: knowledge.businessName, phone: knowledge.phone },
      actions: [{ type: 'chat' }],
    };
  }

  if (
    includesAny(text, [
      'anulez',
      'anula',
      'anularea',
      'anulare',
      'mut',
      'mutarea',
      'reprogramez',
      'reprogramare',
      'amana',
      'amanare',
    ])
  ) {
    return {
      intent: 'cancel_policy',
      confidence: 1,
      params: { business: knowledge.businessName, notice: knowledge.cancelNoticeText },
      actions: [{ type: 'book' }, { type: 'chat' }],
    };
  }

  if (includesAny(text, ['avans', 'plata', 'platesc', 'card', 'depozit', 'garantie'])) {
    return {
      intent: 'deposit',
      confidence: 1,
      params: { business: knowledge.businessName, deposit: knowledge.depositText },
      actions: [{ type: 'book' }],
    };
  }

  if (
    includesAny(text, [
      'programare',
      'programeaza',
      'rezerv',
      'vreau',
      'as vrea',
      'ma program',
      'liber',
      'disponibil',
      'maine',
      'azi',
      'saptamana',
      // EN (chip „I want to book” + întrebări libere)
      'book',
      'appointment',
    ])
  ) {
    return {
      intent: 'book',
      confidence: 0.9,
      params: { business: knowledge.businessName },
      actions: [{ type: 'book' }],
    };
  }

  if (
    includesAny(text, [
      'specialist',
      'specialisti',
      'frizer',
      'barber',
      'stilist',
      'cine ma',
      'cine ne',
      'echipa',
      'cine lucreaza',
      'maestru',
      'tunde',
    ])
  ) {
    return {
      intent: 'staff',
      confidence: 1,
      params: { business: knowledge.businessName, names: knowledge.staffNames.join(', ') },
      actions: [{ type: 'book' }],
    };
  }

  if (
    includesAny(text, [
      'unde vorbesti',
      'unde vorbiti',
      'unde sunteti',
      'unde va aflati',
      'adresa',
      'locatie',
      'gasesti',
      'gasesc',
      'parcare',
      'parchez',
      'ajung',
      'harta',
      'zona',
    ])
  ) {
    return {
      intent: 'location',
      confidence: 1,
      params: { business: knowledge.businessName, address: knowledge.address },
      actions: [{ type: 'book' }],
    };
  }

  if (
    includesAny(text, [
      'program',
      'orar',
      'deschis',
      'inchis',
      'cand lucrati',
      'cand sunteti',
      'cand incepeti',
      'duminica',
      'sambata',
      // EN (chip „What are your hours?”)
      'hours',
      'opening',
    ])
  ) {
    return {
      intent: 'hours',
      confidence: 1,
      params: { business: knowledge.businessName, hours: knowledge.hoursText },
      actions: [{ type: 'book' }],
    };
  }

  // Numele unui serviciu real → preț sau listă, după context.
  const mentioned = knowledge.services.find((s) => {
    const name = normalize(s.name);
    return name.length >= 3 && text.includes(name);
  });
  if (mentioned) {
    if (includesAny(text, ['pret', 'costa', 'cat e', 'cat costa', 'tarif', 'lei', 'how much', 'price', 'cost'])) {
      return {
        intent: 'service_price',
        confidence: 1,
        params: {
          business: knowledge.businessName,
          name: mentioned.name,
          price: mentioned.price,
          duration: mentioned.duration,
        },
        actions: [{ type: 'book' }],
      };
    }
    return {
      intent: 'service_price',
      confidence: 0.6,
      params: {
        business: knowledge.businessName,
        name: mentioned.name,
        price: mentioned.price,
        duration: mentioned.duration,
      },
      actions: [{ type: 'book' }],
    };
  }

  if (
    includesAny(text, [
      'pret',
      'costa',
      'cat e',
      'tarif',
      'lei',
      'servicii',
      'serviciu',
      'ce faceti',
      'oferte',
      'oferiti',
      'lista',
      'meniu',
      // EN (chip „How much?”)
      'how much',
      'price',
      'cost',
    ])
  ) {
    return {
      intent: 'services_list',
      confidence: 0.9,
      params: {
        business: knowledge.businessName,
        list: knowledge.services.map((s) => `${s.name} — ${s.price}`).join(', '),
      },
      actions: [{ type: 'book' }, { type: 'services' }],
    };
  }

  return {
    intent: 'fallback',
    confidence: 0,
    params: { business: knowledge.businessName },
    actions: [{ type: 'chat' }],
  };
}
