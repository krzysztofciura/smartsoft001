import { Inject, Injectable, Optional } from '@nestjs/common';

import {
  GUS_CONFIG,
  GUS_FETCH,
  GUS_TEST_KEY,
  GUS_URLS,
  GusCompany,
  GusConfig,
  GusUnavailableError,
} from './gus.config';
import { normalizeNip } from './gus.nip';

const BIR = 'http://CIS/BIR/PUBL/2014/07';
const ENTITIES: Record<string, string> = {
  lt: '<',
  gt: '>',
  amp: '&',
  quot: '"',
  apos: "'",
};

/** XML entity decoding for the escaped report GUS returns inside the SOAP result. */
function decode(text: string): string {
  return text.replace(
    /&(#x[0-9a-f]+|#\d+|lt|gt|amp|quot|apos);/gi,
    (whole, name: string) => {
      if (name[0] !== '#') return ENTITIES[name.toLowerCase()] ?? whole;
      const code =
        name[1] === 'x' || name[1] === 'X'
          ? parseInt(name.slice(2), 16)
          : parseInt(name.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : whole;
    },
  );
}

/** Register text as plain, single-line text: no control or bidi characters, collapsed spaces, bounded length. */
function clean(value: string | undefined, max = 200): string {
  return (value ?? '')
    .replace(
      // eslint-disable-next-line no-control-regex -- strips control characters from register text
      /[\u0000-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069]/g,
      ' ',
    )
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function field(block: string, name: string): string | undefined {
  const match = new RegExp('<' + name + '>([\\s\\S]*?)</' + name + '>').exec(
    block,
  );
  return match ? decode(match[1]) : undefined;
}

/**
 * NIP lookup in the GUS REGON register (BIR1.1, SOAP 1.2 with WS-Addressing): log in with the user key, search by
 * NIP, log out. Returns the first legal person or sole trader found, or null when REGON has none. Network and service
 * failures raise {@link GusUnavailableError} without the key in the message.
 */
@Injectable()
export class GusService {
  constructor(
    @Inject(GUS_CONFIG) private readonly config: GusConfig,
    @Optional() @Inject(GUS_FETCH) private readonly fetcher?: typeof fetch,
  ) {}

  async findByNip(value: string): Promise<GusCompany | null> {
    const nip = normalizeNip(value);
    if (!nip) return null;
    const sid = await this.login();
    try {
      const response = await this.call(
        'DaneSzukajPodmioty',
        `<ns:DaneSzukajPodmioty><ns:pParametryWyszukiwania><dat:Nip>${nip}</dat:Nip></ns:pParametryWyszukiwania></ns:DaneSzukajPodmioty>`,
        sid,
      );
      return this.company(response, nip);
    } finally {
      await this.call(
        'Wyloguj',
        `<ns:Wyloguj><ns:pIdentyfikatorSesji>${sid}</ns:pIdentyfikatorSesji></ns:Wyloguj>`,
        sid,
      ).catch(() => undefined);
    }
  }

  private get url(): string {
    return GUS_URLS[this.config.environment];
  }

  private async login(): Promise<string> {
    const key =
      this.config.key ??
      (this.config.environment === 'test' ? GUS_TEST_KEY : '');
    if (!/^[A-Za-z0-9]{10,64}$/.test(key))
      throw new GusUnavailableError('login');
    const response = await this.call(
      'Zaloguj',
      `<ns:Zaloguj><ns:pKluczUzytkownika>${key}</ns:pKluczUzytkownika></ns:Zaloguj>`,
    );
    const sid =
      /<ZalogujResult>([^<]*)<\/ZalogujResult>/.exec(response)?.[1] ?? '';
    if (!/^[A-Za-z0-9]{10,64}$/.test(sid))
      throw new GusUnavailableError('login');
    return sid;
  }

  private async call(
    action: string,
    body: string,
    sid?: string,
  ): Promise<string> {
    const envelope =
      `<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope" xmlns:ns="${BIR}" xmlns:dat="${BIR}/DataContract">` +
      `<soap:Header xmlns:wsa="http://www.w3.org/2005/08/addressing"><wsa:To>${this.url}</wsa:To>` +
      `<wsa:Action>${BIR}/IUslugaBIRzewnPubl/${action}</wsa:Action></soap:Header><soap:Body>${body}</soap:Body></soap:Envelope>`;
    let response: Response;
    try {
      response = await (this.fetcher ?? fetch)(this.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/soap+xml;charset=UTF-8',
          ...(sid ? { sid } : {}),
        },
        body: envelope,
        signal: AbortSignal.timeout(this.config.timeoutMs ?? 10000),
        redirect: 'error',
      });
    } catch {
      throw new GusUnavailableError('network');
    }
    if (!response.ok) throw new GusUnavailableError('status');
    const text = await response.text();
    if (text.length > 1_000_000) throw new GusUnavailableError('response');
    return text;
  }

  private company(response: string, nip: string): GusCompany | null {
    const result =
      /<DaneSzukajPodmiotyResult>([\s\S]*?)<\/DaneSzukajPodmiotyResult>/.exec(
        response,
      );
    if (!result) {
      if (/<DaneSzukajPodmiotyResult\s*\/>/.test(response)) return null;
      throw new GusUnavailableError('response');
    }
    const report = decode(result[1]);
    const units = [...report.matchAll(/<dane>([\s\S]*?)<\/dane>/g)].map(
      (m) => m[1],
    );
    // A legal person (P) or a sole trader (F) before its local units (LP, LF).
    const unit =
      units.find((u) => /^[PF]$/.test(clean(field(u, 'Typ')))) ?? units[0];
    if (!unit || field(unit, 'ErrorCode') !== undefined) return null;
    const name = clean(field(unit, 'Nazwa'));
    if (!name) return null;
    const number = [
      clean(field(unit, 'NrNieruchomosci'), 20),
      clean(field(unit, 'NrLokalu'), 20),
    ]
      .filter(Boolean)
      .join('/');
    const town = clean(field(unit, 'Miejscowosc'), 80);
    const street = clean(field(unit, 'Ulica'), 120) || town;
    return {
      nip: normalizeNip(clean(field(unit, 'Nip'), 20)) ?? nip,
      regon: clean(field(unit, 'Regon'), 14),
      name,
      street: clean([street, number].filter(Boolean).join(' '), 160),
      postalCode: clean(field(unit, 'KodPocztowy'), 10),
      city: clean(field(unit, 'MiejscowoscPoczty'), 80) || town,
      active:
        !clean(field(unit, 'DataZakonczeniaDzialalnosci')) &&
        !clean(field(unit, 'StatusNip')),
    };
  }
}
