import { Test } from '@nestjs/testing';

import { GUS_TEST_KEY, GUS_URLS, GusUnavailableError } from './gus.config';
import { GusModule } from './gus.module';
import { normalizeNip } from './gus.nip';
import { GusService } from './gus.service';

const SID = 'abcdefghij0123456789';
const mtom = (body: string) =>
  `--uuid:x\r\nContent-Type: application/xop+xml\r\n\r\n<s:Envelope><s:Body>${body}</s:Body></s:Envelope>\r\n--uuid:x--`;
const escape = (xml: string) =>
  xml.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const report = (units: string) =>
  `<DaneSzukajPodmiotyResult>${escape(`<root>${units}</root>`)}</DaneSzukajPodmiotyResult>`;
const unit = (fields: Record<string, string>) =>
  '<dane>' +
  Object.entries(fields)
    .map(([k, v]) =>
      v ? `<${k}>${v.replace(/&/g, '&amp;')}</${k}>` : `<${k} />`,
    )
    .join('') +
  '</dane>';
const gus = {
  Regon: '000331501',
  Nip: '5261040828',
  StatusNip: '',
  Nazwa: 'GŁÓWNY URZĄD STATYSTYCZNY',
  Miejscowosc: 'Warszawa',
  KodPocztowy: '00-925',
  Ulica: 'ul. Test-Krucza',
  NrNieruchomosci: '208',
  NrLokalu: '',
  Typ: 'P',
  DataZakonczeniaDzialalnosci: '',
  MiejscowoscPoczty: 'Warszawa',
};

describe('shared-gus: GusService', () => {
  let calls: { url: string; action: string; sid?: string; body: string }[];
  let search: () => Promise<Response>;

  const service = async (
    key?: string,
    environment: 'test' | 'production' = 'test',
  ) => {
    const fetcher = jest.fn(async (url: string, init: RequestInit) => {
      const body = String(init.body);
      const action = /IUslugaBIRzewnPubl\/(\w+)</.exec(body)?.[1] ?? '';
      calls.push({
        url,
        action,
        sid: (init.headers as Record<string, string>)['sid'],
        body,
      });
      if (action === 'Zaloguj')
        return new Response(
          mtom(
            `<ZalogujResponse><ZalogujResult>${SID}</ZalogujResult></ZalogujResponse>`,
          ),
        );
      if (action === 'DaneSzukajPodmioty') return search();
      return new Response(mtom('<WylogujResult>true</WylogujResult>'));
    });
    const moduleRef = await Test.createTestingModule({
      imports: [
        GusModule.forRoot(
          { environment, ...(key ? { key } : {}) },
          fetcher as unknown as typeof fetch,
        ),
      ],
    }).compile();
    return { gus: moduleRef.get(GusService), fetcher };
  };

  beforeEach(() => {
    calls = [];
    search = async () => new Response(mtom(report(unit(gus))));
  });

  it('logs in with the test key, finds the company by NIP and logs out', async () => {
    const { gus: service_ } = await service();

    const company = await service_.findByNip('PL 526-104-08-28');

    expect(company).toEqual({
      nip: '5261040828',
      regon: '000331501',
      name: 'GŁÓWNY URZĄD STATYSTYCZNY',
      street: 'ul. Test-Krucza 208',
      postalCode: '00-925',
      city: 'Warszawa',
      active: true,
    });
    expect(calls.map((c) => c.action)).toEqual([
      'Zaloguj',
      'DaneSzukajPodmioty',
      'Wyloguj',
    ]);
    expect(calls[0].url).toBe(GUS_URLS.test);
    expect(calls[0].body).toContain(
      `<ns:pKluczUzytkownika>${GUS_TEST_KEY}</ns:pKluczUzytkownika>`,
    );
    expect(calls[1].sid).toBe(SID);
    expect(calls[1].body).toContain('<dat:Nip>5261040828</dat:Nip>');
  });

  it('uses the production register with the given key and never the test key', async () => {
    const { gus: service_ } = await service(
      'ProductionKey0123456',
      'production',
    );

    await service_.findByNip('5261040828');

    expect(calls[0].url).toBe(GUS_URLS.production);
    expect(calls[0].body).toContain('ProductionKey0123456');
    expect(calls[0].body).not.toContain(GUS_TEST_KEY);
  });

  it('refuses production without a key before any request', async () => {
    const { gus: service_ } = await service(undefined, 'production');

    await expect(service_.findByNip('5261040828')).rejects.toEqual(
      new GusUnavailableError('login'),
    );
    expect(calls).toEqual([]);
  });

  it('does not call GUS for an invalid NIP', async () => {
    const { gus: service_ } = await service();

    expect(await service_.findByNip('5261040827')).toBeNull();
    expect(await service_.findByNip('<Nip>1</Nip>')).toBeNull();
    expect(calls).toEqual([]);
  });

  it('returns null when REGON has no entity, and still logs out', async () => {
    search = async () => new Response(mtom('<DaneSzukajPodmiotyResult />'));
    const { gus: service_ } = await service();

    expect(await service_.findByNip('5261040828')).toBeNull();
    expect(calls.at(-1)?.action).toBe('Wyloguj');
  });

  it('prefers the legal person or sole trader over local units, joins numbers and marks closed activity', async () => {
    search = async () =>
      new Response(
        mtom(
          report(
            unit({ ...gus, Typ: 'LP', Nazwa: 'Oddział' }) +
              unit({
                ...gus,
                Nazwa: 'A&B Sp. z o.o.',
                Ulica: '',
                Miejscowosc: 'Wólka',
                NrLokalu: '5',
                MiejscowoscPoczty: '',
                DataZakonczeniaDzialalnosci: '2020-01-01',
              }),
          ),
        ),
      );
    const { gus: service_ } = await service();

    const company = await service_.findByNip('5261040828');

    expect(company).toMatchObject({
      name: 'A&B Sp. z o.o.',
      street: 'Wólka 208/5',
      city: 'Wólka',
      active: false,
    });
  });

  it('cleans control and bidi characters out of register text', async () => {
    search = async () =>
      new Response(
        mtom(report(unit({ ...gus, Nazwa: 'Firma\u202e\u0007  Test' }))),
      );
    const { gus: service_ } = await service();

    expect((await service_.findByNip('5261040828'))?.name).toBe('Firma Test');
  });

  it('reports an unavailable service without leaking the key, and logs out after a failed search', async () => {
    search = async () => new Response('busy', { status: 500 });
    const { gus: service_ } = await service('SecretKey0123456789');

    const error = await service_
      .findByNip('5261040828')
      .catch((e: unknown) => e);

    expect(error).toEqual(new GusUnavailableError('status'));
    expect(String((error as Error).message)).not.toContain('SecretKey');
    expect(calls.at(-1)?.action).toBe('Wyloguj');
  });

  it('treats a login without a session id as unavailable', async () => {
    const { gus: service_, fetcher } = await service();
    fetcher.mockImplementationOnce(
      async () => new Response(mtom('<ZalogujResult></ZalogujResult>')),
    );

    await expect(service_.findByNip('5261040828')).rejects.toEqual(
      new GusUnavailableError('login'),
    );
  });

  it('turns network errors into an unavailable service', async () => {
    const { gus: service_, fetcher } = await service();
    fetcher.mockImplementationOnce(async () => {
      throw new TypeError('fetch failed');
    });

    await expect(service_.findByNip('5261040828')).rejects.toEqual(
      new GusUnavailableError('network'),
    );
  });
});

describe('shared-gus: normalizeNip', () => {
  it('accepts separators and the PL prefix, checks the control digit', () => {
    expect(normalizeNip('526-104-08-28')).toBe('5261040828');
    expect(normalizeNip('PL5261040828')).toBe('5261040828');
    expect(normalizeNip('5261040827')).toBeNull();
    expect(normalizeNip('52610408')).toBeNull();
    expect(normalizeNip(5261040828)).toBeNull();
  });
});
