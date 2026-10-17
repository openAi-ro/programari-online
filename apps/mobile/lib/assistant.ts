export type AssistantService = { name: string; duration: string; price: string };

export type AssistantKnowledge = {
  businessName: string;
  address: string;
  phone: string;
  cancelNoticeText: string;
  depositText: string;
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
  services: AssistantService[];
  staffNames: string[];
}): AssistantKnowledge {
  return {
    businessName: input.businessName.trim(),
    address: input.address.trim(),
    phone: input.phone.trim(),
    cancelNoticeText: input.cancelNoticeText.trim(),
    depositText: input.depositText.trim(),
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
    ])
  ) {
    return {
      intent: 'hours',
      confidence: 1,
      params: { business: knowledge.businessName },
      actions: [{ type: 'book' }],
    };
  }

  // Numele unui serviciu real → preț sau listă, după context.
  const mentioned = knowledge.services.find((s) => {
    const name = normalize(s.name);
    return name.length >= 3 && text.includes(name);
  });
  if (mentioned) {
    if (includesAny(text, ['pret', 'costa', 'cat e', 'cat costa', 'tarif', 'lei'])) {
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
