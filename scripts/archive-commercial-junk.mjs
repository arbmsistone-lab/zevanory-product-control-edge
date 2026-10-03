import pg from 'pg';
import fs from 'node:fs';

const { Pool } = pg;
const rawUrl = String(process.env.DATABASE_URL_PRIMARY || '').trim();
if (!rawUrl) throw new Error('DATABASE_URL_PRIMARY_SECRET_MISSING');

function hardenedDatabaseUrl(raw) {
  const url = new URL(raw);
  if (!['localhost','127.0.0.1','::1'].includes(url.hostname)) url.searchParams.set('sslmode','verify-full');
  return url.toString();
}

const pool = new Pool({
  connectionString: hardenedDatabaseUrl(rawUrl),
  max: 2,
  idleTimeoutMillis: 10_000,
  connectionTimeoutMillis: 8_000,
  ssl: { rejectUnauthorized: true },
});

const SOURCE_BUCKETS = ['zpc_commercial_leads','zpc_commercial_evidence'];
const ARCHIVE_BUCKET = 'zpc_commercial_archive';
const HARD_REJECT = [
  'falcons','nfl','peppa pig','wikipedia','wikimedia','microsoft store','xbox','fandom',
  'imdb','netflix','espn','sports','sport','futebol','football','nba','nfl.com','encyclopedia','enciclopedia'
];
const ICP = [
  'empresa','negocio','negócio','loja','varejo','comercio','comércio','clinica','clínica',
  'salao','salão','restaurante','oficina','academia','estetica','estética','imobiliaria','imobiliária',
  'escritorio','escritório','prestador','servico','serviço','microempresa','pequena empresa','mei'
];
const PRODUCT = [
  'whatsapp','instagram','vendas','atendimento','agendamento','automacao','automação','crm',
  'fluxo de caixa','financeiro','gestao','gestão','ia','inteligencia artificial','inteligência artificial',
  'marketing','cliente','clientes','pedido','pedidos'
];
const GEO = [
  'brasil','brazil','ceara','ceará','fortaleza','juazeiro do norte','crato','iguatu',
  'barbalha','varzea alegre','várzea alegre','.br'
];

function norm(v='') {
  return String(v).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,' ');
}
function any(text, arr) { return arr.some(x => text.includes(norm(x))); }
function scoreRecord(record) {
  const text = norm([record.title,record.detail,record.channel,record.product,record.sourceKey,...(record.evidence||[])].filter(Boolean).join(' '));
  const hardReject = HARD_REJECT.filter(x => text.includes(norm(x)));
  const icpHits = ICP.filter(x => text.includes(norm(x)));
  const productHits = PRODUCT.filter(x => text.includes(norm(x)));
  const geoHits = GEO.filter(x => text.includes(norm(x)));
  let score = 0;
  if (icpHits.length) score += 2;
  if (productHits.length) score += 2;
  if (geoHits.length) score += 1;
  if (/https?:\/\/[^\s/]+\.br(?:[/:]|$)/i.test(text)) score += 1;
  if (hardReject.length) score -= 8;
  const relevant = hardReject.length === 0 && score >= 5 && icpHits.length > 0 && productHits.length > 0 && geoHits.length > 0;
  return { score, relevant, hardReject, icpHits, productHits, geoHits };
}

const APPLY = String(process.env.COMMERCIAL_CLEANUP_APPLY || '').trim() === '1';

const report = {
  schema: 'zevanory-commercial-cleanup/v1',
  startedAt: new Date().toISOString(),
  mode: APPLY ? 'apply' : 'dry-run',
  sourceBuckets: SOURCE_BUCKETS,
  archiveBucket: ARCHIVE_BUCKET,
  scanned: 0,
  candidates: 0,
  archived: 0,
  wouldArchive: 0,
  wouldArchiveByType: {},
  preserved: 0,
  reasons: {},
  samplesArchived: [],
  samplesPreserved: [],
  supabaseTouched: false
};

const client = await pool.connect();
try {
  await client.query('begin');
  const rs = await client.query(
    `select bucket,id::text,record
       from public.zpc_records
      where bucket = any($1::text[])
      order by updated_at desc
      for update`,
    [SOURCE_BUCKETS]
  );

  report.scanned = rs.rows.length;

  for (const row of rs.rows) {
    const record = row.record || {};
    const source = norm(record.source || '');
    const sourceKey = norm(record.sourceKey || '');
    const publicSearch = source === 'public-search' || sourceKey.startsWith('bing:');
    if (!publicSearch) {
      report.preserved += 1;
      continue;
    }
    report.candidates += 1;
    const q = scoreRecord(record);
    if (q.relevant) {
      report.preserved += 1;
      if (report.samplesPreserved.length < 20) {
        report.samplesPreserved.push({id:row.id,bucket:row.bucket,title:record.title||'',score:q.score,why:{icp:q.icpHits,product:q.productHits,geo:q.geoHits}});
      }
      continue;
    }

    const reason = q.hardReject.length ? 'blocked-category' : 'below-relevance-threshold';
    report.reasons[reason] = (report.reasons[reason] || 0) + 1;
    const priorStatus = String(record.status || '');
    const evidence = Array.isArray(record.evidence) ? record.evidence.map(String) : [];
    const archivedRecord = {
      ...record,
      status: 'archived',
      updatedAt: new Date().toISOString(),
      evidence: [...evidence,
        'archive:premium-panel-cleanup-20261002',
        `archive-reason:${reason}`,
        `archive-score:${q.score}`,
        `previous-status:${priorStatus || 'unknown'}`
      ].slice(-20),
      archive: {
        at: new Date().toISOString(),
        reason,
        score: q.score,
        hardReject: q.hardReject,
        icpHits: q.icpHits,
        productHits: q.productHits,
        geoHits: q.geoHits,
        originalBucket: row.bucket
      }
    };

    report.wouldArchive += 1;
    report.wouldArchiveByType[row.bucket] = (report.wouldArchiveByType[row.bucket] || 0) + 1;
    if (APPLY) {
      await client.query(
        'update public.zpc_records set bucket=$1,record=$2::jsonb,updated_at=now() where bucket=$3 and id=$4::uuid',
        [ARCHIVE_BUCKET, JSON.stringify(archivedRecord), row.bucket, row.id]
      );
      report.archived += 1;
    }
    if (report.samplesArchived.length < 30) {
      report.samplesArchived.push({id:row.id,from:row.bucket,title:record.title||'',reason,score:q.score,hardReject:q.hardReject});
    }
  }

  if (APPLY) await client.query('commit');
  else await client.query('rollback');
} catch (error) {
  await client.query('rollback');
  report.error = error instanceof Error ? error.message : String(error);
  throw error;
} finally {
  client.release();
  await pool.end();
  report.finishedAt = new Date().toISOString();
  fs.writeFileSync('commercial-cleanup-report.json', JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report));
}
