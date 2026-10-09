# @smartsoft001/gus

NIP lookup in the GUS REGON register through the BIR1.1 service (SOAP 1.2 with WS-Addressing): log in with the user key, search by NIP, log out.

```ts
import { GusModule, GusService } from '@smartsoft001/gus';

@Module({ imports: [GusModule.forRoot({ environment: 'production', key: process.env.GUS_API_KEY })] })
export class CompaniesModule {}

const company = await gusService.findByNip('526-104-08-28');
// { nip, regon, name, street: 'ul. Krucza 208', postalCode: '00-925', city: 'Warszawa', active: true } or null
```

- `environment: 'test'` uses the GUS test service with the public test key (`GUS_TEST_KEY`) and returns test data; `production` needs a key issued by GUS (https://api.stat.gov.pl/Home/RegonApi). Keep the key outside the code.
- The NIP is normalized (spaces, dashes, `PL` prefix) and checked with `NipService` from `@smartsoft001/utils`; an invalid NIP returns `null` without calling GUS (`normalizeNip` is exported too).
- The legal person or sole trader is preferred over its local units; `street` joins the street, building and premises number (the town where there is no street); `active` is false when REGON records the end of the activity or the NIP status is not empty.
- Register text is returned as plain single-line text: control and bidi characters are removed.
- Network errors, HTTP errors and refused logins raise `GusUnavailableError` (`network`, `status`, `login`, `response`); the message never contains the key. The session is closed also after a failed search.
- `GusModule.forRoot(config, fetch)` accepts an own `fetch` (proxy, test double).
