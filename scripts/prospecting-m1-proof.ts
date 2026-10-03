import fs from 'node:fs';
import { loadM1ProspectingConfig, searchProspects, scoreProspect } from '../backend/commercial.ts';

const config = loadM1ProspectingConfig();
const queries = config.queries.map(value => String(value).trim()).filter(Boolean).slice(0, 24);


const accepted = [];
const rejected = [];
const seen = new Set();

for (const query of queries) {
  let results = [];
  try {
    results = await searchProspects(query);
  } catch (error) {
    rejected.push({ query, reason: 'SEARCH_ERROR', detail: error instanceof Error ? error.message : String(error) });
    continue;
  }
  for (const result of results) {
    if (seen.has(result.url)) continue;
    seen.add(result.url);
    const review = scoreProspect(result);
    const row = {
      title: result.title,
      url: result.url,
      query,
      score: review.score,
      threshold: review.threshold,
      relevant: review.relevant,
      reason: review.reason,
    };
    if (review.relevant && accepted.length < 20) accepted.push(row);
    else rejected.push(row);
  }
  if (accepted.length >= 20) break;
}

const report = {
  schema: 'zevanory-m1-prospecting-proof/v1',
  generatedAt: new Date().toISOString(),
  querySource: 'M1',
  locale: 'pt-BR',
  country: 'BR',
  coldOutreach: false,
  requiredReviewedResults: 20,
  acceptedCount: accepted.length,
  rejectedCount: rejected.length,
  accepted,
  rejected: rejected.slice(0, 80),
};

fs.writeFileSync('prospecting-m1-proof.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({accepted: accepted.length,rejected: rejected.length,querySource:'M1',coldOutreach:false}));
for (const [index,item] of accepted.entries()) {
  console.log(`REVIEWED_${String(index+1).padStart(2,'0')} score=${item.score} reason="${item.reason}" title="${item.title.replaceAll('"',"'")}" url=${item.url}`);
}

if (accepted.length < 20) {
  console.error(`PROSPECTING_REVIEW_20=FAIL accepted=${accepted.length}`);
  process.exit(1);
}
console.log('PROSPECTING_REVIEW_20=PASS');
