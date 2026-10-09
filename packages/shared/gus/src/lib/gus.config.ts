export const GUS_CONFIG = 'GUS_CONFIG';
/** Optional fetch implementation (tests, proxies); defaults to the global fetch. */
export const GUS_FETCH = 'GUS_FETCH';

/**
 * The key GUS publishes for its test service (`test` environment only). Production needs a key issued by GUS
 * (https://api.stat.gov.pl/Home/RegonApi), kept outside the code.
 */
export const GUS_TEST_KEY = 'abcde12345abcde12345';

export const GUS_URLS = {
  test: 'https://wyszukiwarkaregontest.stat.gov.pl/wsBIR/UslugaBIRzewnPubl.svc',
  production:
    'https://wyszukiwarkaregon.stat.gov.pl/wsBIR/UslugaBIRzewnPubl.svc',
} as const;

export interface GusConfig {
  /** `test` uses the GUS test service (test data only); `production` the public REGON register. */
  environment: keyof typeof GUS_URLS;
  /** User key for the REGON BIR1.1 service; in `test` defaults to {@link GUS_TEST_KEY}. */
  key?: string;
  /** Per request; defaults to 10 s. */
  timeoutMs?: number;
}

/** A company or sole trader found in REGON by NIP. */
export interface GusCompany {
  nip: string;
  regon: string;
  name: string;
  /** Street with the building and premises number, or the town and number where there is no street. */
  street: string;
  postalCode: string;
  city: string;
  /** False when REGON records the end of the activity or the NIP status says it is not valid. */
  active: boolean;
}

/** The service did not answer usably (network, HTTP status, login refused); the message never carries the key. */
export class GusUnavailableError extends Error {
  constructor(readonly reason: 'network' | 'status' | 'login' | 'response') {
    super('GUS REGON service unavailable: ' + reason);
  }
}
