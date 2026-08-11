import https from 'node:https';

import { config } from '../src/config';
import { redactUri } from '../src/lib/envGuard';

/**
 * Converts a `mongodb+srv://` URI into the equivalent direct `mongodb://` URI.
 *
 *   cd backend && npx tsx scripts/atlas-direct-uri.ts                    # redacted
 *   cd backend && npx tsx scripts/atlas-direct-uri.ts --with-credentials # paste-ready
 *
 * ## Why this exists
 *
 * `mongodb+srv://` is convenient but it requires a DNS **SRV** record lookup, and a
 * fair number of networks refuse those: several Indian ISPs, most corporate DNS,
 * some VPNs, and ad-blocking resolvers. The symptom is
 * `querySrv ECONNREFUSED _mongodb._tcp.<cluster>` — which reads like Atlas rejected
 * the connection, when in fact nothing ever reached Atlas. The database is fine; only
 * the name lookup failed.
 *
 * The direct form lists the shard hosts explicitly, so it needs only ordinary A-record
 * lookups, which those same resolvers handle without complaint.
 *
 * ## Why DNS-over-HTTPS
 *
 * The SRV record still has to be read from somewhere, and the local resolver is the
 * thing that is broken. This asks Cloudflare's resolver over **HTTPS** (port 443)
 * instead, which is almost always reachable even where UDP DNS is filtered. It is used
 * here only to *generate* a connection string, never in the request path of the running
 * app — production reads `MONGO_URI` and connects directly, with no dependency on
 * Cloudflare.
 *
 * The output is equivalent, not a downgrade: same hosts, same replica set, same TLS.
 * The one trade-off is that a direct URI does not pick up a change to the cluster's
 * topology automatically, so re-run this if Atlas ever renames or rescales the shards.
 */

interface DohAnswer {
  name: string;
  type: number;
  data: string;
}

function resolveOverHttps(name: string, type: 'SRV' | 'TXT'): Promise<DohAnswer[]> {
  const url = `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=${type}`;
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { accept: 'application/dns-json' } }, (res) => {
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => {
          try {
            const parsed = JSON.parse(body) as { Answer?: DohAnswer[]; Status?: number };
            if (parsed.Status !== 0) {
              reject(new Error(`DNS query for ${name} (${type}) returned status ${parsed.Status}`));
              return;
            }
            resolve(parsed.Answer ?? []);
          } catch (err) {
            reject(err instanceof Error ? err : new Error(String(err)));
          }
        });
      })
      .on('error', reject);
  });
}

async function main(): Promise<void> {
  const uri = config.mongoUri;

  if (!uri.startsWith('mongodb+srv://')) {
    console.log('MONGO_URI is not an SRV URI, so there is nothing to convert:');
    console.log(`  ${redactUri(uri)}`);
    return;
  }

  // Parsed by hand rather than with `new URL()`: a Mongo URI may carry a comma-
  // separated host list, which `URL` does not accept.
  const rest = uri.slice('mongodb+srv://'.length);
  const atIndex = rest.lastIndexOf('@');
  const credentials = atIndex === -1 ? '' : rest.slice(0, atIndex);
  const afterCredentials = atIndex === -1 ? rest : rest.slice(atIndex + 1);
  const slashIndex = afterCredentials.indexOf('/');
  const host = slashIndex === -1 ? afterCredentials : afterCredentials.slice(0, slashIndex);
  const tail = slashIndex === -1 ? '' : afterCredentials.slice(slashIndex + 1);
  const [dbAndQuery = ''] = [tail];
  const questionIndex = dbAndQuery.indexOf('?');
  const dbName = (questionIndex === -1 ? dbAndQuery : dbAndQuery.slice(0, questionIndex)) || 'amit-olympiad';
  const existingQuery = questionIndex === -1 ? '' : dbAndQuery.slice(questionIndex + 1);

  console.log(`Cluster : ${host}`);
  console.log(`Database: ${dbName}`);
  console.log('Resolving the SRV record over HTTPS (your local resolver is bypassed)…\n');

  const srv = await resolveOverHttps(`_mongodb._tcp.${host}`, 'SRV');
  const hosts = srv
    .map((answer) => {
      // SRV data is "priority weight port target".
      const [, , port, target] = answer.data.trim().split(/\s+/);
      return port && target ? `${target.replace(/\.$/, '')}:${port}` : null;
    })
    .filter((value): value is string => value !== null)
    .sort();

  if (hosts.length === 0) throw new Error('No SRV records were returned for that cluster.');

  // The TXT record carries the options Atlas would otherwise have supplied implicitly,
  // notably `replicaSet` and `authSource`. Omitting them yields a URI that connects but
  // behaves subtly differently, so they are merged in rather than guessed.
  const txt = await resolveOverHttps(host, 'TXT');
  const params = new URLSearchParams(txt[0]?.data.replace(/^"|"$/g, '') ?? '');
  for (const [key, value] of new URLSearchParams(existingQuery)) params.set(key, value);
  params.set('ssl', 'true');
  if (!params.has('retryWrites')) params.set('retryWrites', 'true');
  if (!params.has('w')) params.set('w', 'majority');

  const direct = `mongodb://${credentials}@${hosts.join(',')}/${dbName}?${params.toString()}`;

  console.log(`Resolved ${hosts.length} shard host(s):`);
  for (const shard of hosts) console.log(`  ${shard}`);

  const withCredentials = process.argv.includes('--with-credentials');
  console.log('\nDirect (non-SRV) connection string:\n');
  console.log(`  ${withCredentials ? direct : redactUri(direct)}\n`);

  if (withCredentials) {
    console.log('Put this in backend/.env as MONGO_URI (one line, no quotes needed), and set the');
    console.log('same value in your Vercel project only if Vercel also fails SRV lookups — it');
    console.log('normally does not, and the SRV form is preferable where it works.');
  } else {
    console.log('Re-run with --with-credentials to print the paste-ready value.');
  }
}

main().catch((err) => {
  console.error('\nCould not build a direct URI:', err instanceof Error ? err.message : err);
  console.error('If HTTPS is also blocked, get the same string from the Atlas UI:');
  console.error('  Connect → Drivers → driver version "Node.js 2.2.12 or later".');
  process.exit(1);
});
